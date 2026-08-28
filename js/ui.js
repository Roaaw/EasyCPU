"use strict";

const UI = (() => {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    let runTimer = null;
    let assembled = null;
    let prevRegs = {};

    const editor = () => $('#code-editor');
    const lineNums = () => $('#line-numbers');

    function init() {
        bindEvents();
        initDock();
        initEditorResizer();
        updateLineNumbers();
        updateRegisters();
        updateFlags();
        updateLEDs(0);
        updateMemory();
        updateStack();
        loadSampleList();
        initConverter();
        logConsole('EasyCPU 8086 Simulator ready.', 'info');

        CPU.setOnPortWrite((port, val) => {
            if (port === 2) updateLEDs(val);
            if (typeof Peripherals !== 'undefined') Peripherals.handlePortWrite(port, val);
        });
        CPU.setOnPortRead((port) => {
            if (typeof Peripherals !== 'undefined') return Peripherals.handlePortRead(port);
            return null;
        });
        if (typeof CPU.setOnConsole === 'function') {
            CPU.setOnConsole({
                write: (b) => {
                    if (typeof Peripherals !== 'undefined') Peripherals.terminalWrite(b);
                },
                read: () => {
                    if (typeof Peripherals !== 'undefined') return Peripherals.terminalRead();
                    return 0;
                },
                ready: () => {
                    if (typeof Peripherals !== 'undefined') return Peripherals.terminalCanRead();
                    return false;
                }
            });
        }
        CPU.setOnHalt((msg) => {
            stopExecution();
            logConsole(msg, 'success');
        });
    }

    function bindEvents() {
        $('#btn-assemble').addEventListener('click', doAssemble);
        $('#btn-run').addEventListener('click', doRun);
        $('#btn-step').addEventListener('click', doStep);
        $('#btn-stop').addEventListener('click', doStop);
        $('#btn-reset').addEventListener('click', doReset);
        $('#btn-clear-console').addEventListener('click', () => {
            $('#console-output').innerHTML = '';
        });
        const btnToggleConsole = $('#btn-toggle-console');
        if (btnToggleConsole) {
            btnToggleConsole.addEventListener('click', () => togglePanel('console-panel', 'btn-toggle-console'));
        }
        const btnToggleMemory = $('#btn-toggle-memory');
        if (btnToggleMemory) {
            btnToggleMemory.addEventListener('click', () => togglePanel('memory-panel', 'btn-toggle-memory'));
        }
        const btnToggleTrace = $('#btn-toggle-trace');
        if (btnToggleTrace) {
            btnToggleTrace.addEventListener('click', () => togglePanel('trace-panel', 'btn-toggle-trace'));
        }
        const rightToggles = [
            ['btn-toggle-led', 'led-panel'],
            ['btn-toggle-sevenseg', 'seven-seg-panel'],
            ['btn-toggle-pixel', 'pixel-panel'],
            ['btn-toggle-io', 'io-panel'],
            ['btn-toggle-converter', 'converter-panel'],
            ['btn-toggle-keyboard', 'keyboard-panel'],
            ['btn-toggle-stack', 'stack-panel'],
            ['btn-toggle-challenge', 'challenge-panel'],
        ];
        rightToggles.forEach(([btnId, panelId]) => {
            const btn = document.getElementById(btnId);
            if (btn) btn.addEventListener('click', () => togglePanel(panelId, btnId));
        });
        $('#btn-mem-go').addEventListener('click', () => updateMemory());
        $('#mem-addr').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') updateMemory();
        });
        $('#mem-segment').addEventListener('change', () => updateMemory());

        const btnStepBack = $('#btn-step-back');
        if (btnStepBack) btnStepBack.addEventListener('click', doStepBack);

        const btnRunBP = $('#btn-run-bp');
        if (btnRunBP) btnRunBP.addEventListener('click', doRunToBreakpoint);

        editor().addEventListener('input', () => {
            updateLineNumbers();
            if (typeof Debugger !== 'undefined') Debugger.refreshBreakpointDisplay();
        });
        editor().addEventListener('scroll', syncScroll);
        editor().addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                e.preventDefault();
                let start = editor().selectionStart;
                let end = editor().selectionEnd;
                let val = editor().value;
                editor().value = val.substring(0, start) + '\t' + val.substring(end);
                editor().selectionStart = editor().selectionEnd = start + 1;
                updateLineNumbers();
                triggerHighlight();
            }
            if (e.ctrlKey && e.key === 'Enter') {
                e.preventDefault();
                doAssemble();
            }
        });

        $('#sample-select').addEventListener('change', (e) => {
            let name = e.target.value;
            if (name && typeof SAMPLES !== 'undefined' && SAMPLES[name]) {
                editor().value = SAMPLES[name];
                updateLineNumbers();
                triggerHighlight();
                doReset();
                logConsole('Loaded sample: ' + name, 'info');
            }
        });

        $('#input-port').addEventListener('change', (e) => {
            let val = parseInt(e.target.value, 16);
            if (!isNaN(val)) {
                CPU.setInputPort(1, val & 0xFF);
                e.target.value = (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
            }
        });
    }

    function triggerHighlight() {
        if (typeof Highlight !== 'undefined') Highlight.render();
    }

    function updateLineNumbers() {
        let lines = editor().value.split('\n');
        let html = '';
        for (let i = 1; i <= lines.length; i++) {
            html += '<div>' + i + '</div>';
        }
        lineNums().innerHTML = html;
    }

    function syncScroll() {
        lineNums().scrollTop = editor().scrollTop;
        const overlay = $('#highlight-overlay');
        if (overlay) {
            overlay.scrollTop = editor().scrollTop;
            overlay.scrollLeft = editor().scrollLeft;
        }
    }

    function highlightCurrentLine(lineNum) {
        $$('#line-numbers div').forEach((div, idx) => {
            div.classList.toggle('current-line', idx + 1 === lineNum);
        });
    }

    function clearLineHighlight() {
        $$('#line-numbers div').forEach(div => div.classList.remove('current-line'));
    }

    function doAssemble() {
        let source = editor().value;
        if (!source.trim()) {
            logConsole('Error: No source code to assemble.', 'error');
            return;
        }

        CPU.init();
        assembled = Assembler.assemble(source);

        if (typeof Highlight !== 'undefined') Highlight.clearErrors();

        if (assembled.errors.length > 0) {
            for (let err of assembled.errors) {
                logConsole('Line ' + err.line + ': ' + err.message, 'error');
            }
            logConsole('Assembly failed with ' + assembled.errors.length + ' error(s).', 'error');
            if (typeof Highlight !== 'undefined') Highlight.markErrors(assembled.errors);
            return;
        }

        CPU.loadProgram(assembled);

        let portVal = parseInt($('#input-port').value, 16);
        if (!isNaN(portVal)) CPU.setInputPort(1, portVal & 0xFF);

        logConsole('Assembly successful: ' + assembled.instructions.length + ' instructions.', 'success');

        $('#btn-run').disabled = false;
        $('#btn-step').disabled = false;
        const btnBP = $('#btn-run-bp');
        if (btnBP) btnBP.disabled = false;

        if (typeof Debugger !== 'undefined') {
            Debugger.resetAll();
        }
        if (typeof Peripherals !== 'undefined') {
            Peripherals.resetAll();
        }

        updateAll();
        highlightCurrentLine(getNextLine());
    }

    function getNextLine() {
        if (!assembled) return -1;
        let ip = CPU.getState().regs.ip;
        if (ip < assembled.instructions.length) {
            return assembled.instructions[ip].sourceLine;
        }
        return -1;
    }

    function doStep() {
        if (!assembled || CPU.isHalted()) return;
        if (typeof CPU.isBlockedOnInput === 'function' && CPU.isBlockedOnInput()) {
            logConsole('Waiting for a key. Click the VT100 terminal, then type.', 'warn');
            return;
        }
        if (typeof Debugger !== 'undefined') Debugger.pushSnapshot();
        let result = CPU.step();
        if (typeof Debugger !== 'undefined') {
            Debugger.recordTrace(result);
            Debugger.addCycles(result.mnemonic);
            Debugger.updateFlagExplanation(result);
        }
        if (typeof Peripherals !== 'undefined' && Peripherals.tickTimer()) {
            Peripherals.fireTimerInterrupt();
        }
        updateAll();
        updateCycleCounter();
        if (!result.halted) {
            highlightCurrentLine(getNextLine());
            updateStepBackBtn();
        } else {
            clearLineHighlight();
            $('#btn-run').disabled = true;
            $('#btn-step').disabled = true;
        }
    }

    function doStepBack() {
        if (typeof Debugger === 'undefined' || !Debugger.hasHistory()) return;
        Debugger.stepBack();
        updateAll();
        updateCycleCounter();
        highlightCurrentLine(getNextLine());
        updateStepBackBtn();
        const btnRun = $('#btn-run');
        const btnStep = $('#btn-step');
        if (btnRun) btnRun.disabled = false;
        if (btnStep) btnStep.disabled = false;
    }

    function updateStepBackBtn() {
        const btn = $('#btn-step-back');
        if (btn && typeof Debugger !== 'undefined') {
            btn.disabled = !Debugger.hasHistory();
        }
    }

    function doRun() {
        if (!assembled || CPU.isHalted()) return;
        $('#btn-run').disabled = true;
        $('#btn-step').disabled = true;
        $('#btn-stop').disabled = false;
        const btnBP = $('#btn-run-bp');
        if (btnBP) btnBP.disabled = true;

        let speedVal = parseInt($('#speed-slider').value);
        let delay = Math.max(1, 110 - speedVal);

        function tick() {
            if (CPU.isHalted()) {
                stopExecution();
                return;
            }
            if (typeof CPU.isBlockedOnInput === 'function' && CPU.isBlockedOnInput()) {
                runTimer = setTimeout(tick, Math.min(delay, 20));
                return;
            }
            if (typeof Debugger !== 'undefined') Debugger.pushSnapshot();
            let result = CPU.step();
            if (typeof Debugger !== 'undefined') {
                Debugger.recordTrace(result);
                Debugger.addCycles(result.mnemonic);
            }
            if (typeof Peripherals !== 'undefined' && Peripherals.tickTimer()) {
                Peripherals.fireTimerInterrupt();
            }
            updateAll();
            if (!result.halted) {
                let nextLine = getNextLine();
                highlightCurrentLine(nextLine);
                if (typeof Debugger !== 'undefined' && Debugger.isBreakpoint(nextLine)) {
                    stopExecution();
                    logConsole('Breakpoint hit at line ' + nextLine, 'warn');
                    return;
                }
                runTimer = setTimeout(tick, delay);
            } else {
                stopExecution();
            }
        }
        tick();
    }

    function doRunToBreakpoint() {
        if (!assembled || CPU.isHalted()) return;
        $('#btn-run').disabled = true;
        $('#btn-step').disabled = true;
        $('#btn-stop').disabled = false;

        let steps = 0;
        while (!CPU.isHalted() && steps < 100000) {
            if (typeof CPU.isBlockedOnInput === 'function' && CPU.isBlockedOnInput()) {
                logConsole('Waiting for a key. Click the VT100 terminal, then type.', 'warn');
                break;
            }
            if (typeof Debugger !== 'undefined') Debugger.pushSnapshot();
            let result = CPU.step();
            if (typeof Debugger !== 'undefined') {
                Debugger.recordTrace(result);
                Debugger.addCycles(result.mnemonic);
            }
            if (typeof Peripherals !== 'undefined' && Peripherals.tickTimer()) {
                Peripherals.fireTimerInterrupt();
            }
            steps++;
            if (result.halted) break;
            let nextLine = getNextLine();
            if (typeof Debugger !== 'undefined' && Debugger.isBreakpoint(nextLine)) {
                logConsole('Breakpoint hit at line ' + nextLine + ' after ' + steps + ' steps', 'warn');
                break;
            }
        }
        updateAll();
        updateCycleCounter();
        highlightCurrentLine(getNextLine());
        stopExecution();
    }

    function doStop() {
        stopExecution();
        logConsole('Execution stopped by user.', 'warn');
        highlightCurrentLine(getNextLine());
    }

    function stopExecution() {
        if (runTimer) {
            clearTimeout(runTimer);
            runTimer = null;
        }
        let isHalted = CPU.isHalted();
        $('#btn-run').disabled = isHalted;
        $('#btn-step').disabled = isHalted;
        $('#btn-stop').disabled = true;
        const btnBP = $('#btn-run-bp');
        if (btnBP) btnBP.disabled = isHalted;
        updateStepBackBtn();
        updateCycleCounter();
    }

    function doReset() {
        stopExecution();
        CPU.init();
        assembled = null;
        clearLineHighlight();
        updateAll();
        updateLEDs(0);
        $('#btn-run').disabled = true;
        $('#btn-step').disabled = true;
        $('#btn-stop').disabled = true;
        const btnBP = $('#btn-run-bp');
        if (btnBP) btnBP.disabled = true;
        const btnSB = $('#btn-step-back');
        if (btnSB) btnSB.disabled = true;
        if (typeof Debugger !== 'undefined') Debugger.resetAll();
        if (typeof Peripherals !== 'undefined') Peripherals.resetAll();
        const cc = $('#cycle-counter');
        if (cc) cc.textContent = '';
        logConsole('CPU reset.', 'info');
    }

    function updateCycleCounter() {
        const cc = $('#cycle-counter');
        if (!cc || typeof Debugger === 'undefined') return;
        const state = CPU.getState();
        cc.textContent = 'Steps: ' + state.stepCount + ' | Cycles: ~' + Debugger.getCycles();
    }

    function updateAll() {
        updateRegisters();
        updateFlags();
        updateMemory();
        updateStack();
        let ports = CPU.getIOPorts();
        if (ports[2] !== undefined) updateLEDs(ports[2]);
        if (typeof Peripherals !== 'undefined' && Peripherals.refreshPixelDisplay) {
            Peripherals.refreshPixelDisplay();
        }
    }

    function refreshAll() {
        updateAll();
        highlightCurrentLine(getNextLine());
    }

    function updateRegisters() {
        let state = CPU.getState();
        let r = state.regs;

        function hexW(v) { return (v & 0xFFFF).toString(16).toUpperCase().padStart(4, '0'); }
        function hexB(v) { return (v & 0xFF).toString(16).toUpperCase().padStart(2, '0'); }

        function setRegEl(id, val, prev) {
            let el = $(id);
            if (el) {
                if (el.querySelector('input')) return;
                el.textContent = val;
                if (prev !== undefined && val !== prev) {
                    el.classList.add('changed');
                    setTimeout(() => el.classList.remove('changed'), 400);
                }
            }
        }

        setRegEl('#reg-ax', hexW(r.ax), prevRegs.ax);
        setRegEl('#reg-ah', hexB((r.ax >> 8) & 0xFF));
        setRegEl('#reg-al', hexB(r.ax & 0xFF));
        setRegEl('#reg-bx', hexW(r.bx), prevRegs.bx);
        setRegEl('#reg-bh', hexB((r.bx >> 8) & 0xFF));
        setRegEl('#reg-bl', hexB(r.bx & 0xFF));
        setRegEl('#reg-cx', hexW(r.cx), prevRegs.cx);
        setRegEl('#reg-ch', hexB((r.cx >> 8) & 0xFF));
        setRegEl('#reg-cl', hexB(r.cx & 0xFF));
        setRegEl('#reg-dx', hexW(r.dx), prevRegs.dx);
        setRegEl('#reg-dh', hexB((r.dx >> 8) & 0xFF));
        setRegEl('#reg-dl', hexB(r.dx & 0xFF));

        setRegEl('#reg-sp', hexW(r.sp), prevRegs.sp);
        setRegEl('#reg-bp', hexW(r.bp), prevRegs.bp);
        setRegEl('#reg-si', hexW(r.si), prevRegs.si);
        setRegEl('#reg-di', hexW(r.di), prevRegs.di);
        setRegEl('#reg-ip', hexW(r.ip), prevRegs.ip);
        setRegEl('#reg-ds', hexW(r.ds), prevRegs.ds);
        setRegEl('#reg-ss', hexW(r.ss), prevRegs.ss);
        setRegEl('#reg-cs', hexW(r.cs), prevRegs.cs);

        prevRegs = {
            ax: hexW(r.ax), bx: hexW(r.bx), cx: hexW(r.cx), dx: hexW(r.dx),
            sp: hexW(r.sp), bp: hexW(r.bp), si: hexW(r.si), di: hexW(r.di),
            ip: hexW(r.ip), ds: hexW(r.ds), ss: hexW(r.ss), cs: hexW(r.cs)
        };
    }

    function updateFlags() {
        let f = CPU.getState().flags;
        const flagIds = ['cf', 'zf', 'sf', 'of', 'pf', 'af'];
        for (let name of flagIds) {
            let el = $('#flag-' + name);
            if (el) {
                let val = f[name] || 0;
                el.querySelector('.flag-val').textContent = val;
                el.classList.toggle('active', val === 1);
            }
        }
    }

    function updateLEDs(val) {
        val = val & 0xFF;
        for (let i = 0; i < 8; i++) {
            let led = $('#led-' + i);
            if (led) {
                led.classList.toggle('on', ((val >> i) & 1) === 1);
            }
        }
        $('#led-hex').textContent = val.toString(16).toUpperCase().padStart(2, '0') + 'h';
        $('#led-dec').textContent = val;
    }

    function updateMemory() {
        let mem = CPU.getMemory();
        if (!mem) return;

        let segment = $('#mem-segment').value;
        let state = CPU.getState();
        let segBase = 0;
        switch (segment) {
            case 'ds': segBase = state.regs.ds; break;
            case 'ss': segBase = state.regs.ss; break;
            case 'cs': segBase = state.regs.cs; break;
        }

        let startAddr = parseInt($('#mem-addr').value, 16) || 0;
        startAddr = startAddr & 0xFFF0;
        let rows = 12;
        let html = '';

        let labelAtOffset = {};
        if (assembled && assembled.dataSizes) {
            let entries = Object.keys(assembled.dataSizes).map(name => ({
                name,
                offset: assembled.labels[name]
            })).filter(e => e.offset !== undefined).sort((a, b) => a.offset - b.offset);
            let dataLen = assembled.dataBytes ? assembled.dataBytes.length : 0;
            for (let i = 0; i < entries.length; i++) {
                let start = entries[i].offset;
                let end = (i + 1 < entries.length) ? entries[i + 1].offset : dataLen;
                if (end <= start) {
                    end = start + (assembled.dataSizes[entries[i].name] === 16 ? 2 : 1);
                }
                for (let off = start; off < end; off++) {
                    labelAtOffset[off] = entries[i].name;
                }
            }
        }

        for (let row = 0; row < rows; row++) {
            let addr = (segBase + startAddr + row * 16) & 0xFFFF;
            let addrStr = '<span class="mem-addr">' +
                addr.toString(16).toUpperCase().padStart(4, '0') + '</span>  ';

            let hexPart = '';
            let ascPart = '';
            for (let col = 0; col < 16; col++) {
                let byteAddr = (addr + col) & 0xFFFF;
                let b = mem[byteAddr] || 0;
                let cls = b !== 0 ? 'mem-val-nonzero' : 'mem-val';
                let dataOff = startAddr + row * 16 + col;
                let title = '';
                if (segment === 'ds' && labelAtOffset[dataOff]) {
                    title = ' title="' + labelAtOffset[dataOff] + '"';
                    cls += ' mem-val-label';
                }
                hexPart += '<span class="' + cls + '"' + title + '>' +
                    b.toString(16).toUpperCase().padStart(2, '0') + '</span> ';
                if (col === 7) hexPart += ' ';
                ascPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
            }

            html += addrStr + hexPart + ' <span class="mem-ascii">|' + ascPart + '|</span>\n';
        }

        $('#memory-dump').innerHTML = html;
        updateDataSymbols(mem, segment === 'ds' ? segBase : null);
    }

    function updateDataSymbols(mem, dsBase) {
        const el = $('#data-symbols');
        if (!el) return;
        if (dsBase == null || !assembled || !assembled.dataSizes) {
            el.innerHTML = '';
            return;
        }
        let names = Object.keys(assembled.dataSizes);
        if (names.length === 0) {
            el.innerHTML = '';
            return;
        }
        let entries = names.map(name => ({
            name,
            offset: assembled.labels[name],
            size: assembled.dataSizes[name]
        })).sort((a, b) => a.offset - b.offset);
        let dataLen = assembled.dataBytes ? assembled.dataBytes.length : 0;
        let html = '';
        for (let i = 0; i < entries.length; i++) {
            let e = entries[i];
            let nextOff = (i + 1 < entries.length) ? entries[i + 1].offset : dataLen;
            let len = Math.max(nextOff - e.offset, e.size === 16 ? 2 : 1);
            let value;
            if (e.size === 16) {
                let phys = (dsBase + e.offset) & 0xFFFF;
                let val = (mem[phys] | (mem[(phys + 1) & 0xFFFF] << 8)) & 0xFFFF;
                value = val.toString(16).toUpperCase().padStart(4, '0') + 'h';
            } else {
                let bytes = [];
                let printable = len > 1;
                for (let j = 0; j < len; j++) {
                    let b = mem[(dsBase + e.offset + j) & 0xFFFF] || 0;
                    bytes.push(b);
                    if (b < 32 || b > 126) printable = false;
                }
                if (printable) {
                    value = '"' + bytes.map(b => String.fromCharCode(b)).join('') + '"';
                } else {
                    value = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') + 'h';
                }
            }
            html += '<span class="data-sym"><span class="data-sym-name">' + e.name +
                '</span>=' + String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') + '</span>';
        }
        el.innerHTML = html;
    }

    function updateStack() {
        let entries = CPU.getStackEntries(16);
        let container = $('#stack-content');
        if (entries.length === 0) {
            container.innerHTML = '<div class="stack-empty">Stack is empty</div>';
            return;
        }
        let html = '';
        for (let entry of entries) {
            let cls = entry.isSP ? 'stack-entry sp-pointer' : 'stack-entry';
            let pointer = entry.isSP ? ' <-- SP' : '';
            html += '<div class="' + cls + '">' +
                '<span class="stack-addr">' + entry.address.toString(16).toUpperCase().padStart(4, '0') + '</span>' +
                '<span class="stack-val">' + entry.value.toString(16).toUpperCase().padStart(4, '0') + '</span>' +
                pointer +
                '</div>';
        }
        container.innerHTML = html;
    }

    function togglePanel(panelId, btnId) {
        const panel = document.getElementById(panelId);
        const btn = document.getElementById(btnId);
        if (!panel || !btn) return;
        const collapsed = panel.classList.toggle('collapsed');
        const isExpanded = !collapsed;
        btn.setAttribute('aria-expanded', String(isExpanded));
        const labelMap = {
            'console-panel': 'Output Console',
            'memory-panel': 'Memory Viewer',
            'trace-panel': 'Trace Log',
            'led-panel': 'LED Output',
            'seven-seg-panel': '7-Seg Display',
            'pixel-panel': 'Pixel Display',
            'io-panel': 'I/O Ports',
            'converter-panel': 'Number Converter',
            'keyboard-panel': 'Keyboard',
            'stack-panel': 'Stack',
            'challenge-panel': 'Challenges'
        };
        const label = labelMap[panelId] || panelId;
        if (collapsed) {
            btn.textContent = '☐';
            btn.title = 'Maximizar';
            btn.setAttribute('aria-label', 'Maximizar ' + label);
        } else {
            btn.textContent = '−';
            btn.title = 'Minimizar';
            btn.setAttribute('aria-label', 'Minimizar ' + label);
        }
    }

    function toggleConsole() {
        togglePanel('console-panel', 'btn-toggle-console');
    }

    // ---- Bottom dock: drag & drop reordering ----
    const DOCK_ORDER_KEY = 'easycpu:bottom-dock-order';
    const DOCK_LAYOUT_KEY = 'easycpu:bottom-dock-layout';
    let dockDragEl = null;

    function initDock() {
        const dock = document.getElementById('bottom-dock');
        if (dock) {
            restoreDockOrder();
            initDockLayout();
            const panels = dock.querySelectorAll('.dockable');
            panels.forEach((panel) => {
                const handle = panel.querySelector('.drag-handle');
                const header = panel.querySelector('.panel-header');
                [handle, header, panel].forEach(el => {
                    if (!el) return;
                    el.setAttribute('draggable', 'true');
                    el.addEventListener('dragstart', onDockDragStart);
                    el.addEventListener('dragend', onDockDragEnd);
                });
            });
            dock.addEventListener('dragover', onDockDragOver);
            dock.addEventListener('drop', onDockDrop);
            dock.addEventListener('dragleave', onDockDragLeave);
            const btnStack = document.getElementById('btn-dock-stack');
            const btnGrid = document.getElementById('btn-dock-grid');
            if (btnStack) btnStack.addEventListener('click', () => setDockLayout('stack'));
            if (btnGrid) btnGrid.addEventListener('click', () => setDockLayout('grid'));
        }
        initRightDock();
    }

    const RIGHT_DOCK_ORDER_KEY = 'easycpu:right-dock-order';
    let rightDragEl = null;

    function initRightDock() {
        const dock = document.getElementById('right-panels');
        if (!dock) return;
        restoreRightDockOrder();
        const panels = dock.querySelectorAll('.dockable-right');
        panels.forEach((panel) => {
            const handle = panel.querySelector('.drag-handle');
            const header = panel.querySelector('.panel-header');
            [handle, header].forEach(el => {
                if (!el) return;
                el.setAttribute('draggable', 'true');
                el.addEventListener('dragstart', onRightDragStart);
                el.addEventListener('dragend', onRightDragEnd);
            });
            // fallback no panel para arrasto por qualquer área do header
            panel.addEventListener('dragstart', onRightDragStart);
            panel.addEventListener('dragend', onRightDragEnd);
        });
        dock.addEventListener('dragover', onRightDragOver);
        dock.addEventListener('drop', onRightDrop);
        dock.addEventListener('dragleave', onRightDragLeave);
    }

    function onRightDragStart(e) {
        if (e.target.closest('button.collapse-btn')) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.target.closest('button, input, select, textarea')) {
            e.preventDefault();
            return;
        }
        const panel = e.target.closest('.dockable-right');
        if (!panel) return;
        if (!e.target.closest('.panel-header') && !e.target.closest('.drag-handle')) return;
        rightDragEl = panel;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panel.id);
        try { e.dataTransfer.setDragImage(panel, 20, 20); } catch (_) {}
        requestAnimationFrame(() => panel.classList.add('dragging'));
        document.getElementById('right-panels')?.classList.add('drag-active');
    }

    function onRightDragEnd() {
        if (rightDragEl) rightDragEl.classList.remove('dragging');
        rightDragEl = null;
        document.getElementById('right-panels')?.classList.remove('drag-active');
        document.querySelectorAll('#right-panels .dockable-right.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function onRightDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dock = document.getElementById('right-panels');
        if (!dock || !rightDragEl) return;
        const afterEl = getRightAfterElement(dock, e.clientY);
        document.querySelectorAll('#right-panels .dockable-right.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (afterEl) afterEl.classList.add('drag-over');
        else {
            const last = [...dock.querySelectorAll('.dockable-right')].filter(el => el !== rightDragEl).pop();
            if (last) last.classList.add('drag-over');
        }
    }

    function onRightDragLeave(e) {
        const dock = document.getElementById('right-panels');
        if (!dock || !dock.contains(e.relatedTarget)) {
            dock.querySelectorAll('.dockable-right.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    }

    function onRightDrop(e) {
        e.preventDefault();
        const dock = document.getElementById('right-panels');
        if (!dock || !rightDragEl) return;
        const afterEl = getRightAfterElement(dock, e.clientY);
        if (afterEl == null) dock.appendChild(rightDragEl);
        else dock.insertBefore(rightDragEl, afterEl);
        dock.querySelectorAll('.dockable-right.drag-over').forEach(el => el.classList.remove('drag-over'));
        saveRightDockOrder();
    }

    function getRightAfterElement(dock, y) {
        const els = [...dock.querySelectorAll('.dockable-right:not(.dragging)')];
        for (const el of els) {
            const box = el.getBoundingClientRect();
            if (y < box.top + box.height / 2) return el;
        }
        return null;
    }

    function saveRightDockOrder() {
        const dock = document.getElementById('right-panels');
        if (!dock) return;
        const order = [...dock.querySelectorAll('.dockable-right')].map(el => el.id);
        try { localStorage.setItem(RIGHT_DOCK_ORDER_KEY, JSON.stringify(order)); } catch (_) {}
    }

    function restoreRightDockOrder() {
        const dock = document.getElementById('right-panels');
        if (!dock) return;
        let order;
        try { order = JSON.parse(localStorage.getItem(RIGHT_DOCK_ORDER_KEY) || 'null'); } catch (_) { order = null; }
        if (!Array.isArray(order) || order.length === 0) return;
        const byId = {};
        dock.querySelectorAll('.dockable-right').forEach(el => { byId[el.id] = el; });
        const ordered = order.map(id => byId[id]).filter(Boolean);
        if (ordered.length !== Object.keys(byId).length) return;
        const children = [...dock.children];
        const newChildren = [];
        let oi = 0;
        children.forEach(ch => {
            if (ch.classList.contains('dockable-right')) {
                newChildren.push(ordered[oi++]);
            } else {
                newChildren.push(ch);
            }
        });
        newChildren.forEach(ch => dock.appendChild(ch));
    }

    function setDockLayout(layout) {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return;
        dock.classList.toggle('layout-stack', layout === 'stack');
        dock.classList.toggle('layout-grid', layout === 'grid');
        const btnStack = document.getElementById('btn-dock-stack');
        const btnGrid = document.getElementById('btn-dock-grid');
        if (btnStack) {
            btnStack.classList.toggle('active', layout === 'stack');
            btnStack.setAttribute('aria-pressed', String(layout === 'stack'));
        }
        if (btnGrid) {
            btnGrid.classList.toggle('active', layout === 'grid');
            btnGrid.setAttribute('aria-pressed', String(layout === 'grid'));
        }
        try { localStorage.setItem(DOCK_LAYOUT_KEY, layout); } catch (_) {}
    }

    function initDockLayout() {
        let layout = 'grid';
        try {
            const saved = localStorage.getItem(DOCK_LAYOUT_KEY);
            if (saved === 'stack' || saved === 'grid') layout = saved;
        } catch (_) {}
        setDockLayout(layout);
    }

    function onDockDragStart(e) {
        if (e.target.closest('button.collapse-btn')) {
            e.preventDefault();
            e.stopPropagation();
            return;
        }
        if (e.target.closest('button, input, select, textarea')) {
            e.preventDefault();
            return;
        }
        const panel = e.target.closest('.dockable');
        if (!panel) return;
        if (!e.target.closest('.panel-header') && !e.target.closest('.drag-handle')) return;
        dockDragEl = panel;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', panel.id);
        try { e.dataTransfer.setDragImage(panel, 20, 20); } catch (_) {}
        requestAnimationFrame(() => panel.classList.add('dragging'));
        document.getElementById('bottom-dock')?.classList.add('drag-active');
    }

    function onDockDragEnd() {
        if (dockDragEl) dockDragEl.classList.remove('dragging');
        dockDragEl = null;
        document.getElementById('bottom-dock')?.classList.remove('drag-active');
        document.querySelectorAll('#bottom-dock .dockable.drag-over').forEach(el => el.classList.remove('drag-over'));
    }

    function onDockDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const dock = document.getElementById('bottom-dock');
        if (!dock || !dockDragEl) return;
        const afterEl = getDockAfterElement(dock, e.clientX, e.clientY);
        document.querySelectorAll('#bottom-dock .dockable.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (afterEl) {
            afterEl.classList.add('drag-over');
        } else {
            const last = [...dock.querySelectorAll('.dockable')].filter(el => el !== dockDragEl).pop();
            if (last) last.classList.add('drag-over');
        }
    }

    function onDockDragLeave(e) {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return;
        if (!dock.contains(e.relatedTarget)) {
            dock.querySelectorAll('.dockable.drag-over').forEach(el => el.classList.remove('drag-over'));
        }
    }

    function onDockDrop(e) {
        e.preventDefault();
        const dock = document.getElementById('bottom-dock');
        if (!dock || !dockDragEl) return;
        const afterEl = getDockAfterElement(dock, e.clientX, e.clientY);
        if (afterEl == null) {
            dock.appendChild(dockDragEl);
        } else {
            dock.insertBefore(dockDragEl, afterEl);
        }
        dock.querySelectorAll('.dockable.drag-over').forEach(el => el.classList.remove('drag-over'));
        saveDockOrder();
    }

    function getDockAfterElement(dock, x, y) {
        const els = [...dock.querySelectorAll('.dockable:not(.dragging)')];
        // grid/flex wrap: ordenação visual é por linha (top) e depois coluna (left)
        // procura o primeiro elemento cujo centro está à frente do cursor na ordem de leitura
        for (const el of els) {
            const box = el.getBoundingClientRect();
            const midY = box.top + box.height / 2;
            const midX = box.left + box.width / 2;
            // mesma linha: compara X
            const sameRow = y >= box.top && y <= box.bottom;
            if (sameRow) {
                if (x < midX) return el;
            } else if (y < midY) {
                return el;
            }
        }
        return null;
    }

    function saveDockOrder() {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return;
        const order = [...dock.querySelectorAll('.dockable')].map(el => el.id);
        try { localStorage.setItem(DOCK_ORDER_KEY, JSON.stringify(order)); } catch (_) {}
    }

    function restoreDockOrder() {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return;
        let order;
        try { order = JSON.parse(localStorage.getItem(DOCK_ORDER_KEY) || 'null'); } catch (_) { order = null; }
        if (!Array.isArray(order) || order.length === 0) return;
        const byId = {};
        dock.querySelectorAll('.dockable').forEach(el => { byId[el.id] = el; });
        order.forEach(id => {
            if (byId[id]) dock.appendChild(byId[id]);
        });
    }

    function logConsole(msg, type) {
        let el = $('#console-output');
        let cls = type ? 'console-' + type : '';
        let line = document.createElement('div');
        line.className = cls;
        let timestamp = new Date().toLocaleTimeString();
        line.textContent = '[' + timestamp + '] ' + msg;
        el.appendChild(line);
        $('#console-body').scrollTop = $('#console-body').scrollHeight;
    }

    function loadSampleList() {
        if (typeof SAMPLES === 'undefined') return;
        let select = $('#sample-select');
        for (let name of Object.keys(SAMPLES)) {
            let opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            select.appendChild(opt);
        }
    }

    function initConverter() {
        const hex = $('#conv-hex');
        const dec = $('#conv-dec');
        const bin = $('#conv-bin');
        if (!hex || !dec || !bin) return;

        hex.addEventListener('input', () => {
            const v = parseInt(hex.value, 16);
            if (!isNaN(v)) {
                dec.value = v;
                bin.value = v.toString(2);
            }
        });
        dec.addEventListener('input', () => {
            const v = parseInt(dec.value, 10);
            if (!isNaN(v)) {
                hex.value = v.toString(16).toUpperCase();
                bin.value = v.toString(2);
            }
        });
        bin.addEventListener('input', () => {
            const v = parseInt(bin.value, 2);
            if (!isNaN(v)) {
                hex.value = v.toString(16).toUpperCase();
                dec.value = v;
            }
        });
    }

    function initEditorResizer() {
        const resizer = document.getElementById('editor-vt100-resizer');
        const editorPanel = document.getElementById('editor-panel');
        const editorContainer = document.getElementById('editor-container');
        const terminalPanel = document.getElementById('terminal-panel');
        if (!resizer || !editorPanel || !editorContainer || !terminalPanel) return;
        const STORAGE_KEY = 'easycpu:editor-vt100-ratio';
        // restaura proporção salva
        try {
            const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
            if (!isNaN(saved) && saved > 0.15 && saved < 0.85) {
                applyRatio(saved);
            }
        } catch (_) {}
        let dragging = false;
        let startY = 0;
        let startEditorH = 0;
        let startTermH = 0;

        function applyRatio(ratio) {
            const total = editorPanel.clientHeight;
            const headerH = editorPanel.querySelector('.panel-header')?.offsetHeight || 28;
            const avail = total - headerH - resizer.offsetHeight;
            if (avail <= 0) return;
            const termH = Math.round(avail * ratio);
            const editH = avail - termH;
            editorContainer.style.flex = `0 0 ${editH}px`;
            editorContainer.style.height = '';
            terminalPanel.style.flex = `1 1 ${termH}px`;
            terminalPanel.style.height = '';
            terminalPanel.style.minHeight = termH + 'px';
        }

        resizer.addEventListener('mousedown', (e) => {
            e.preventDefault();
            dragging = true;
            startY = e.clientY;
            startEditorH = editorContainer.offsetHeight;
            startTermH = terminalPanel.offsetHeight;
            resizer.classList.add('dragging');
            document.body.style.cursor = 'row-resize';
            document.body.style.userSelect = 'none';
        });

        window.addEventListener('mousemove', (e) => {
            if (!dragging) return;
            const dy = e.clientY - startY;
            const totalAvail = startEditorH + startTermH;
            let newEditorH = startEditorH + dy;
            let newTermH = totalAvail - newEditorH;
            const minH = 80;
            if (newEditorH < minH) { newEditorH = minH; newTermH = totalAvail - minH; }
            if (newTermH < minH) { newTermH = minH; newEditorH = totalAvail - minH; }
            editorContainer.style.flex = `0 0 ${newEditorH}px`;
            editorContainer.style.height = '';
            terminalPanel.style.flex = `1 1 ${newTermH}px`;
            terminalPanel.style.height = '';
            terminalPanel.style.minHeight = newTermH + 'px';
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            resizer.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            const totalAvail = editorContainer.offsetHeight + terminalPanel.offsetHeight;
            if (totalAvail > 0) {
                const ratio = terminalPanel.offsetHeight / totalAvail;
                try { localStorage.setItem(STORAGE_KEY, String(ratio)); } catch (_) {}
            }
        });

        // double click restaura padrão
        resizer.addEventListener('dblclick', () => {
            editorContainer.style.height = '';
            editorContainer.style.flex = '';
            terminalPanel.style.height = '';
            terminalPanel.style.minHeight = '';
            terminalPanel.style.flex = '';
            try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    return { logConsole, refreshAll };
})();

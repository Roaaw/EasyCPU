"use strict";

const UI = (() => {
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    let runTimer = null;
    let assembled = null;
    let prevRegs = {};
    let currentHighlightLine = 0;

    const editor = () => $('#code-editor');
    const lineNums = () => $('#line-numbers');

    function init() {
        bindEvents();
        initDock();
        initEditorResizer();
        initEditorZoom();
        initVt100Zoom();
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
        // memory viewers - delegated to support duplicates
        document.getElementById('bottom-dock')?.addEventListener('click', (e) => {
            if (e.target.closest('.btn-mem-go')) {
                const panel = e.target.closest('.memory-viewer');
                if (panel) updateMemoryForPanel(panel);
            }
            if (e.target.closest('#btn-duplicate-memory')) {
                duplicateMemoryViewer();
            }
        });
        document.getElementById('bottom-dock')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target.classList.contains('mem-addr')) {
                const panel = e.target.closest('.memory-viewer');
                if (panel) updateMemoryForPanel(panel);
            }
        });
        document.getElementById('bottom-dock')?.addEventListener('change', (e) => {
            if (e.target.classList.contains('mem-segment')) {
                const panel = e.target.closest('.memory-viewer');
                if (panel) updateMemoryForPanel(panel);
            }
        });
        // keep original ids for backward compat
        const origGo = document.getElementById('btn-mem-go');
        if (origGo) origGo.addEventListener('click', () => updateMemory());
        const origAddr = document.getElementById('mem-addr');
        if (origAddr) origAddr.addEventListener('keydown', (e) => { if (e.key === 'Enter') updateMemory(); });
        const origSeg = document.getElementById('mem-segment');
        if (origSeg) origSeg.addEventListener('change', () => updateMemory());

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
            if (e.key === 'F10') {
                e.preventDefault();
                if (!$('#btn-step').disabled) doStep();
            }
        });
        // F10 global (VSCode Step Over) - works even when VT100 or other panel focused
        document.addEventListener('keydown', (e) => {
            if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.metaKey) {
                const ae = document.activeElement;
                // evita duplo disparo quando editor já tratou
                if (ae && ae.id === 'code-editor') return;
                e.preventDefault();
                if (!$('#btn-step').disabled) doStep();
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
        if (currentHighlightLine) updateEditorLineHighlight(currentHighlightLine);
    }

    function highlightCurrentLine(lineNum) {
        currentHighlightLine = lineNum || 0;
        $$('#line-numbers div').forEach((div, idx) => {
            div.classList.toggle('current-line', idx + 1 === lineNum);
        });
        updateEditorLineHighlight(lineNum);
        if (lineNum > 0) scrollEditorToLine(lineNum);
    }

    function updateEditorLineHighlight(lineNum) {
        const hl = document.getElementById('editor-line-highlight');
        const ed = editor();
        if (!hl || !ed) return;
        if (!lineNum || lineNum < 1) {
            hl.classList.remove('visible');
            return;
        }
        const style = getComputedStyle(ed);
        let lh = parseFloat(style.lineHeight);
        if (isNaN(lh)) {
            const fs = parseFloat(style.fontSize) || 13;
            lh = fs * 1.6;
        }
        const padTop = parseFloat(style.paddingTop) || 10;
        hl.style.height = lh + 'px';
        hl.style.top = (padTop + (lineNum - 1) * lh - ed.scrollTop) + 'px';
        hl.classList.add('visible');
    }

    function scrollEditorToLine(lineNum) {
        const ed = editor();
        const gutter = lineNums();
        if (!ed || !gutter || lineNum < 1) return;
        // calcula altura da linha a partir do estilo computado
        const style = getComputedStyle(ed);
        let lh = parseFloat(style.lineHeight);
        if (isNaN(lh)) {
            const fs = parseFloat(style.fontSize) || 13;
            lh = fs * 1.6;
        }
        const targetTop = (lineNum - 1) * lh;
        const viewH = ed.clientHeight;
        const curTop = ed.scrollTop;
        // só rola se a linha estiver fora da viewport (com margem de 1 linha)
        if (targetTop < curTop + lh || targetTop + lh > curTop + viewH - lh) {
            const newTop = Math.max(0, targetTop - viewH / 2 + lh / 2);
            ed.scrollTop = newTop;
            gutter.scrollTop = newTop;
            const overlay = document.getElementById('highlight-overlay');
            if (overlay) {
                overlay.scrollTop = newTop;
                overlay.scrollLeft = ed.scrollLeft;
            }
        }
    }

    function clearLineHighlight() {
        currentHighlightLine = 0;
        $$('#line-numbers div').forEach(div => div.classList.remove('current-line'));
        const hl = document.getElementById('editor-line-highlight');
        if (hl) hl.classList.remove('visible');
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
        const viewers = document.querySelectorAll('.memory-viewer');
        if (viewers.length === 0) {
            const single = document.getElementById('memory-panel');
            if (single) updateMemoryForPanel(single);
            return;
        }
        viewers.forEach(panel => updateMemoryForPanel(panel));
    }

    function updateMemoryForPanel(panel) {
        let mem = CPU.getMemory();
        if (!mem || !panel) return;
        const segSel = panel.querySelector('.mem-segment') || document.getElementById('mem-segment');
        const addrInput = panel.querySelector('.mem-addr') || document.getElementById('mem-addr');
        const dumpEl = panel.querySelector('.memory-dump') || panel.querySelector('#memory-dump') || document.getElementById('memory-dump');
        const symbolsEl = panel.querySelector('.data-symbols') || panel.querySelector('#data-symbols') || document.getElementById('data-symbols');
        if (!segSel || !addrInput || !dumpEl) return;
        let segment = segSel.value;
        let state = CPU.getState();
        let segBase = 0;
        switch (segment) {
            case 'ds': segBase = state.regs.ds; break;
            case 'ss': segBase = state.regs.ss; break;
            case 'cs': segBase = state.regs.cs; break;
        }
        let startAddr = parseInt(addrInput.value, 16) || 0;
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
        let codeInfoAtOffset = {};
        let labelAtCodeOffset = {};
        let ipOffset = -1;
        if (segment === 'cs' && assembled && assembled.codeOffsets && assembled.instructions) {
            ipOffset = CPU.getState().regs.ip;
            for (let i = 0; i < assembled.instructions.length; i++) {
                const off = assembled.codeOffsets[i];
                const nextOff = (i + 1 < assembled.codeOffsets.length) ? assembled.codeOffsets[i + 1] : (assembled.codeLength || off + 1);
                const instr = assembled.instructions[i];
                const info = `${instr.mnemonic} (line ${instr.sourceLine})`;
                for (let b = off; b < nextOff; b++) codeInfoAtOffset[b] = info;
                if (instr.label) labelAtCodeOffset[off] = instr.label;
            }
            if (assembled.labels) {
                for (const [name, idx] of Object.entries(assembled.labels)) {
                    if (assembled.codeOffsets[idx] !== undefined && labelAtCodeOffset[assembled.codeOffsets[idx]] === undefined) {
                        if (assembled.dataSizes && assembled.dataSizes[name]) continue;
                        labelAtCodeOffset[assembled.codeOffsets[idx]] = name;
                    }
                }
            }
        }
        for (let row = 0; row < rows; row++) {
            let addr = (segBase + startAddr + row * 16) & 0xFFFF;
            let addrStr = '<span class="mem-addr">' + addr.toString(16).toUpperCase().padStart(4, '0') + '</span>  ';
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
                } else if (segment === 'cs' && codeInfoAtOffset[dataOff] !== undefined) {
                    const label = labelAtCodeOffset[dataOff];
                    const info = codeInfoAtOffset[dataOff];
                    const tip = label ? label + ': ' + info : info;
                    title = ' title="' + tip.replace(/"/g, '&quot;') + '"';
                    cls += ' mem-val-label';
                    if (dataOff === ipOffset) cls += ' mem-val-ip';
                    else if (label) cls += ' mem-val-label-code';
                } else if (segment === 'cs' && dataOff === ipOffset) {
                    title = ' title="IP → ' + (codeInfoAtOffset[dataOff] || 'code') + '"';
                    cls += ' mem-val-ip';
                }
                hexPart += '<span class="' + cls + '"' + title + '>' + b.toString(16).toUpperCase().padStart(2, '0') + '</span> ';
                if (col === 7) hexPart += ' ';
                ascPart += (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.';
            }
            html += addrStr + hexPart + ' <span class="mem-ascii">|' + ascPart + '|</span>\n';
        }
        dumpEl.innerHTML = html;
        // data symbols only for DS
        const dsBase = segment === 'ds' ? segBase : null;
        if (symbolsEl) {
            if (dsBase === null) {
                // keep original global symbols element also cleared
                if (symbolsEl.id === 'data-symbols' || symbolsEl.classList.contains('data-symbols')) {
                    // will be handled by updateDataSymbolsForPanel
                }
            }
            updateDataSymbolsForPanel(symbolsEl, mem, dsBase);
        } else {
            updateDataSymbols(mem, segment === 'ds' ? segBase : null);
        }
    }

    function updateDataSymbolsForPanel(el, mem, dsBase) {
        if (!el) return;
        if (dsBase == null || !assembled || !assembled.dataSizes) { el.innerHTML = ''; return; }
        let names = Object.keys(assembled.dataSizes);
        if (names.length === 0) { el.innerHTML = ''; return; }
        let entries = names.map(name => ({ name, offset: assembled.labels[name], size: assembled.dataSizes[name] })).sort((a, b) => a.offset - b.offset);
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
                if (printable) value = '"' + bytes.map(b => String.fromCharCode(b)).join('') + '"';
                else value = bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ') + 'h';
            }
            html += '<span class="data-sym"><span class="data-sym-name">' + e.name + '</span>=' + String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;') + '</span>';
        }
        el.innerHTML = html;
    }

    let memViewerCounter = 1;
    function countMaximizedBottom() {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return 0;
        return [...dock.querySelectorAll('.dockable, .memory-viewer')].filter(p => !p.classList.contains('collapsed') && !p.classList.contains('tray-minimized') && p.style.display !== 'none').length;
    }

    function minimizeForLimit(excludeId) {
        const dock = document.getElementById('bottom-dock');
        if (!dock) return false;
        const isRestoringTray = excludeId === 'console-panel' || excludeId === 'trace-panel';
        // quando restaurar Output/Trace, prioriza substituir Memory 2/3
        if (isRestoringTray) {
            const viewers = [...dock.querySelectorAll('.memory-viewer')].filter(p => p.id !== excludeId && !p.classList.contains('collapsed') && !p.classList.contains('tray-minimized'));
            viewers.sort((a,b) => {
                const aIsClone = a.id !== 'memory-panel';
                const bIsClone = b.id !== 'memory-panel';
                if (aIsClone && !bIsClone) return -1;
                if (!aIsClone && bIsClone) return 1;
                return b.id.localeCompare(a.id);
            });
            if (viewers.length) {
                const p = viewers[0];
                const btn = p.querySelector('.collapse-btn');
                if (btn && !p.classList.contains('collapsed')) {
                    if (p.id === 'memory-panel') togglePanel(p.id, btn.id);
                    else {
                        const label = p.querySelector('.panel-title-group span:last-child')?.textContent.trim() || p.id;
                        p.classList.add('collapsed');
                        p.classList.add('tray-minimized');
                        btn.textContent = '☐';
                        btn.setAttribute('aria-expanded', 'false');
                        minimizeMemoryToTray(p, label, btn.id);
                    }
                    return true;
                }
            }
        }
        // caso geral (clone Memory): prioriza Trace Log depois Output Console (1º clone → Trace, 2º → Output)
        const priority = ['trace-panel', 'console-panel'];
        for (const pid of priority) {
            const p = document.getElementById(pid);
            if (p && p.id !== excludeId && !p.classList.contains('collapsed') && !p.classList.contains('tray-minimized')) {
                const btnId = pid === 'console-panel' ? 'btn-toggle-console' : 'btn-toggle-trace';
                togglePanel(pid, btnId);
                return true;
            }
        }
        // senão minimiza memory viewer maximizado, priorizando clones 2/3
        const viewers = [...dock.querySelectorAll('.memory-viewer')].filter(p => p.id !== excludeId && !p.classList.contains('collapsed') && !p.classList.contains('tray-minimized'));
        viewers.sort((a,b) => {
            const aIsClone = a.id !== 'memory-panel';
            const bIsClone = b.id !== 'memory-panel';
            if (aIsClone && !bIsClone) return -1;
            if (!aIsClone && bIsClone) return 1;
            return b.id.localeCompare(a.id);
        });
        if (viewers.length) {
            const p = viewers[0];
            const btn = p.querySelector('.collapse-btn');
            if (btn) {
                const isCollapsed = p.classList.contains('collapsed');
                if (!isCollapsed) {
                    // usa togglePanel se for o original, senão toggle direto
                    if (p.id === 'memory-panel') togglePanel(p.id, btn.id);
                    else {
                        const label = p.querySelector('.panel-title-group span:last-child')?.textContent.trim() || p.id;
                        p.classList.add('collapsed');
                        p.classList.add('tray-minimized');
                        btn.textContent = '☐';
                        btn.setAttribute('aria-expanded', 'false');
                        minimizeMemoryToTray(p, label, btn.id);
                    }
                    return true;
                }
            }
        }
        return false;
    }

    function duplicateMemoryViewer() {
        const dock = document.getElementById('bottom-dock');
        const template = document.getElementById('memory-panel');
        if (!dock || !template) return;
        const existing = dock.querySelectorAll('.memory-viewer').length;
        if (existing >= 3) { logConsole('Maximum 3 memory viewers (DS/SS/CS).', 'warn'); return; }
        // limite de 3 maximizadas na área inferior
        if (countMaximizedBottom() >= 3) {
            if (!minimizeForLimit()) { logConsole('Minimize a window to open a new Memory Viewer (max 3 maximized).', 'warn'); return; }
        }
        const clone = template.cloneNode(true);
        memViewerCounter++;
        const newId = 'memory-panel-' + memViewerCounter;
        clone.id = newId;
        // update title with segment hint
        const titleSpan = clone.querySelector('.panel-title-group span:last-child');
        if (titleSpan) titleSpan.textContent = 'Memory Viewer ' + memViewerCounter;
        // clear duplicate button, add close button
        const dupBtn = clone.querySelector('#btn-duplicate-memory');
        if (dupBtn) dupBtn.remove();
        // add close button before toggle
        const headerActions = clone.querySelector('.header-actions');
        const toggleBtn = clone.querySelector('.collapse-btn');
        const closeBtn = document.createElement('button');
        closeBtn.className = 'small-btn';
        closeBtn.textContent = '×';
        closeBtn.title = 'Close viewer';
        closeBtn.addEventListener('click', () => {
            const tray = document.getElementById('minimized-tray');
            const chip = tray?.querySelector(`[data-panel-id="${newId}"]`);
            if (chip) chip.remove();
            clone.remove();
        });
        if (headerActions && toggleBtn) headerActions.insertBefore(closeBtn, toggleBtn);
        // reset inputs: cycle segment DS->SS->CS
        const segSel = clone.querySelector('.mem-segment');
        if (segSel) {
            const segs = ['ds','ss','cs'];
            segSel.value = segs[existing % 3];
            segSel.id = '';
            segSel.addEventListener('change', () => updateMemoryForPanel(clone));
        }
        const addrInput = clone.querySelector('.mem-addr');
        if (addrInput) { addrInput.id = ''; addrInput.value = '0000'; addrInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') updateMemoryForPanel(clone); }); }
        const goBtn = clone.querySelector('.btn-mem-go');
        if (goBtn) { goBtn.id=''; goBtn.addEventListener('click', ()=>updateMemoryForPanel(clone)); }
        const toggle = clone.querySelector('.collapse-btn');
        if (toggle) {
            toggle.id = 'btn-toggle-' + newId;
            const labelForChip = () => clone.querySelector('.panel-title-group span:last-child')?.textContent.trim() || newId;
            toggle.addEventListener('click', () => {
                const collapsed = clone.classList.toggle('collapsed');
                const isExpanded = !collapsed;
                toggle.setAttribute('aria-expanded', String(isExpanded));
                if (collapsed) {
                    toggle.textContent = '☐';
                    toggle.title = 'Maximize';
                    toggle.setAttribute('aria-label', 'Maximize ' + labelForChip());
                    minimizeMemoryToTray(clone, labelForChip(), toggle.id);
                } else {
                    toggle.textContent = '−';
                    toggle.title = 'Minimize';
                    toggle.setAttribute('aria-label', 'Minimize ' + labelForChip());
                    restoreMemoryFromTray(newId);
                    clone.classList.remove('tray-minimized');
                    if (countMaximizedBottom() > 3) minimizeForLimit(newId);
                }
            });
        }
        // make draggable
        clone.setAttribute('draggable','true');
        const handle = clone.querySelector('.drag-handle');
        const header = clone.querySelector('.panel-header');
        [handle, header, clone].forEach(el=>{ if(!el) return; el.setAttribute('draggable','true'); el.addEventListener('dragstart', onDockDragStart); el.addEventListener('dragend', onDockDragEnd); });
        // ensure body ids are not duplicated
        const body = clone.querySelector('.memory-body');
        if (body) body.id = '';
        const dump = clone.querySelector('.memory-dump');
        if (dump) dump.id = '';
        const symbols = clone.querySelector('.data-symbols');
        if (symbols) symbols.id = '';
        dock.appendChild(clone);
        updateMemoryForPanel(clone);
        logConsole('Duplicated Memory Viewer (' + segSel.value.toUpperCase() + ')', 'info');
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
        const isMemoryViewer = panel.classList.contains('memory-viewer');
        const toTray = isMemoryViewer || panelId === 'trace-panel' || panelId === 'console-panel';
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
        const baseLabel = labelMap[panelId] || panelId;
        // for duplicated memory viewers, use panel title
        let label = baseLabel;
        if (isMemoryViewer && panelId !== 'memory-panel') {
            const t = panel.querySelector('.panel-title-group span:last-child');
            if (t) label = t.textContent.trim();
        }
        if (collapsed) {
            btn.textContent = '☐';
            btn.title = 'Maximize';
            btn.setAttribute('aria-label', 'Maximize ' + label);
            if (toTray) minimizeMemoryToTray(panel, label, btnId);
        } else {
            btn.textContent = '−';
            btn.title = 'Minimize';
            btn.setAttribute('aria-label', 'Minimize ' + label);
            if (toTray) {
                restoreMemoryFromTray(panelId);
                if (countMaximizedBottom() > 3) minimizeForLimit(panelId);
            }
        }
    }

    function minimizeMemoryToTray(panel, label, btnId) {
        const tray = document.getElementById('minimized-tray');
        if (!tray || !panel) return;
        panel.classList.add('tray-minimized');
        // avoid duplicate chip
        if (tray.querySelector(`[data-panel-id="${panel.id}"]`)) return;
        const seg = panel.querySelector('.mem-segment')?.value?.toUpperCase() || '';
        const chip = document.createElement('button');
        chip.className = 'minimized-chip';
        chip.dataset.panelId = panel.id;
        chip.dataset.btnId = btnId;
        chip.title = `Restore ${label} (${seg})`;
        chip.innerHTML = `${label}${seg ? ' ('+seg+')' : ''} <span class="chip-restore">☐</span>`;
        chip.addEventListener('click', () => {
            const p = document.getElementById(panel.id);
            const b = document.getElementById(btnId);
            if (p) {
                p.classList.remove('tray-minimized');
                p.classList.remove('collapsed');
                if (b) {
                    b.textContent = '−';
                    b.title = 'Minimize';
                    b.setAttribute('aria-label', 'Minimize ' + label);
                    b.setAttribute('aria-expanded', 'true');
                }
                if (countMaximizedBottom() > 3) minimizeForLimit(p.id);
            }
            chip.remove();
        });
        tray.appendChild(chip);
    }

    function restoreMemoryFromTray(panelId) {
        const tray = document.getElementById('minimized-tray');
        const chip = tray?.querySelector(`[data-panel-id="${panelId}"]`);
        if (chip) chip.remove();
        const panel = document.getElementById(panelId);
        if (panel) panel.classList.remove('tray-minimized');
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
        // fix overlap code/vt100 when switching dock layout (editor height changes)
        requestAnimationFrame(() => clampEditorHeights());
    }

    function clampEditorHeights() {
        const editorPanel = document.getElementById('editor-panel');
        const editorContainer = document.getElementById('editor-container');
        const terminalPanel = document.getElementById('terminal-panel');
        const resizer = document.getElementById('editor-vt100-resizer');
        if (!editorPanel || !editorContainer || !terminalPanel || !resizer) return;
        const headerH = editorPanel.querySelector('.panel-header')?.offsetHeight || 28;
        const avail = editorPanel.clientHeight - headerH - resizer.offsetHeight;
        if (avail <= 80) return;
        const total = editorContainer.offsetHeight + terminalPanel.offsetHeight;
        if (total > avail + 2) {
            // rescale proportionally to fit, keep VT100 at least 80px
            const ratio = terminalPanel.offsetHeight / total;
            let newTermH = Math.round(avail * ratio);
            let newEditH = avail - newTermH;
            const minH = 80;
            if (newTermH < minH) { newTermH = minH; newEditH = avail - minH; }
            if (newEditH < minH) { newEditH = minH; newTermH = avail - minH; }
            editorContainer.style.flex = `0 0 ${newEditH}px`;
            editorContainer.style.height = '';
            terminalPanel.style.flex = `1 1 ${newTermH}px`;
            terminalPanel.style.height = '';
            terminalPanel.style.minHeight = newTermH + 'px';
            try { localStorage.setItem('easycpu:editor-vt100-ratio', String(newTermH / avail)); } catch (_) {}
        }
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
            const minEditor = 80;
            const minTerm = 110; // header 28 + hint 22 + screen 60 → hint nunca some, serve como limitador
            if (newEditorH < minEditor) { newEditorH = minEditor; newTermH = totalAvail - minEditor; }
            if (newTermH < minTerm) { newTermH = minTerm; newEditorH = totalAvail - minTerm; }
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

    function initEditorZoom() {
        const editor = document.getElementById('code-editor');
        const lineNums = document.getElementById('line-numbers');
        const overlay = document.getElementById('highlight-overlay');
        const slider = document.getElementById('zoom-slider');
        const btnIn = document.getElementById('btn-zoom-in');
        const btnOut = document.getElementById('btn-zoom-out');
        const label = document.getElementById('zoom-label');
        if (!editor || !slider) return;
        const STORAGE_KEY = 'easycpu:editor-zoom';
        const baseSize = 13;
        const step = 5;

        function applyZoom(percent) {
            const size = (baseSize * percent / 100);
            const lineH = 1.6;
            [editor, lineNums, overlay].forEach(el => {
                if (!el) return;
                el.style.fontSize = size + 'px';
                el.style.lineHeight = String(lineH);
            });
            if (label) label.textContent = percent + '%';
            if (slider) slider.value = String(percent);
            try { localStorage.setItem(STORAGE_KEY, String(percent)); } catch (_) {}
        }

        let current = 100;
        try {
            const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '100', 10);
            if (!isNaN(saved) && saved >= 80 && saved <= 300) current = saved;
        } catch (_) {}
        applyZoom(current);

        if (slider) {
            slider.addEventListener('input', () => {
                current = parseInt(slider.value, 10);
                applyZoom(current);
            });
        }
        if (btnIn) btnIn.addEventListener('click', () => {
            current = Math.min(300, current + step);
            applyZoom(current);
        });
        if (btnOut) btnOut.addEventListener('click', () => {
            current = Math.max(80, current - step);
            applyZoom(current);
        });
        // atalhos Ctrl + / Ctrl -
        editor.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
                e.preventDefault();
                current = Math.min(300, current + step);
                applyZoom(current);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '-') {
                e.preventDefault();
                current = Math.max(80, current - step);
                applyZoom(current);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                current = 100;
                applyZoom(current);
            }
        });
    }

    function initVt100Zoom() {
        const screen = document.getElementById('vt100-screen');
        const slider = document.getElementById('zoom-slider-vt100');
        const btnIn = document.getElementById('btn-zoom-in-vt100');
        const btnOut = document.getElementById('btn-zoom-out-vt100');
        const label = document.getElementById('zoom-label-vt100');
        if (!screen || !slider) return;
        const STORAGE_KEY = 'easycpu:vt100-zoom';
        const baseSize = 11;
        const baseLine = 13;
        const step = 5;

        function applyZoom(percent) {
            const size = (baseSize * percent / 100);
            const lh = (baseLine * percent / 100);
            screen.style.fontSize = size + 'px';
            screen.style.lineHeight = lh + 'px';
            // ajusta altura da linha VT100 para cursor
            const style = document.getElementById('vt100-zoom-style');
            if (style) style.remove();
            const s = document.createElement('style');
            s.id = 'vt100-zoom-style';
            s.textContent = `.vt100-row{height:${lh}px !important}`;
            document.head.appendChild(s);
            if (label) label.textContent = percent + '%';
            if (slider) slider.value = String(percent);
            try { localStorage.setItem(STORAGE_KEY, String(percent)); } catch (_) {}
        }

        let current = 100;
        try {
            const saved = parseInt(localStorage.getItem(STORAGE_KEY) || '100', 10);
            if (!isNaN(saved) && saved >= 80 && saved <= 300) current = saved;
        } catch (_) {}
        applyZoom(current);

        slider.addEventListener('input', () => {
            current = parseInt(slider.value, 10);
            applyZoom(current);
        });
        if (btnIn) btnIn.addEventListener('click', () => {
            current = Math.min(300, current + step);
            applyZoom(current);
        });
        if (btnOut) btnOut.addEventListener('click', () => {
            current = Math.max(80, current - step);
            applyZoom(current);
        });
        screen.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) {
                e.preventDefault();
                current = Math.min(300, current + step);
                applyZoom(current);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '-') {
                e.preventDefault();
                current = Math.max(80, current - step);
                applyZoom(current);
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '0') {
                e.preventDefault();
                current = 100;
                applyZoom(current);
            }
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    return { logConsole, refreshAll };
})();

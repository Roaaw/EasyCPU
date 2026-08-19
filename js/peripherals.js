"use strict";

const Peripherals = (() => {
    // ---- 7-Segment Display (Port 3) ----
    const SEVEN_SEG_MAP = {
        0x0: [1,1,1,1,1,1,0], 0x1: [0,1,1,0,0,0,0], 0x2: [1,1,0,1,1,0,1],
        0x3: [1,1,1,1,0,0,1], 0x4: [0,1,1,0,0,1,1], 0x5: [1,0,1,1,0,1,1],
        0x6: [1,0,1,1,1,1,1], 0x7: [1,1,1,0,0,0,0], 0x8: [1,1,1,1,1,1,1],
        0x9: [1,1,1,1,0,1,1], 0xA: [1,1,1,0,1,1,1], 0xB: [0,0,1,1,1,1,1],
        0xC: [1,0,0,1,1,1,0], 0xD: [0,1,1,1,1,0,1], 0xE: [1,0,0,1,1,1,1],
        0xF: [1,0,0,0,1,1,1]
    };

    function updateSevenSeg(val) {
        const nibble = val & 0x0F;
        const segments = SEVEN_SEG_MAP[nibble] || [0,0,0,0,0,0,0];
        const ids = ['seg-a','seg-b','seg-c','seg-d','seg-e','seg-f','seg-g'];
        ids.forEach((id, i) => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('seg-on', segments[i] === 1);
        });
        const hexEl = document.getElementById('sevenseg-hex');
        if (hexEl) hexEl.textContent = nibble.toString(16).toUpperCase();
    }

    // ---- Pixel Display (Port 4 + memory-mapped E000h) ----
    const PIXEL_COLORS = ['#0f0f23','#22c55e','#7aa2f7','#f7768e','#e0af68','#bb9af7','#7dcfff','#c0caf5'];
    let pixelGrid = null;

    function initPixelDisplay() {
        pixelGrid = document.getElementById('pixel-grid');
        if (!pixelGrid) return;
        pixelGrid.innerHTML = '';
        for (let i = 0; i < 1024; i++) {
            const px = document.createElement('div');
            px.className = 'pixel';
            pixelGrid.appendChild(px);
        }
    }

    function refreshPixelDisplay() {
        if (!pixelGrid) return;
        const mem = CPU.getMemory();
        if (!mem) return;
        const pixels = pixelGrid.children;
        for (let i = 0; i < 1024; i++) {
            const colorIdx = mem[0xE000 + i] & 0x07;
            if (pixels[i]) pixels[i].style.background = PIXEL_COLORS[colorIdx];
        }
    }

    // ---- Keyboard Buffer (Port 5 read = char, Port 6 read = length) ----
    const keyBuffer = [];

    function initKeyboard() {
        const input = document.getElementById('keyboard-input');
        if (!input) return;
        input.addEventListener('keydown', (e) => {
            if (e.key.length === 1) {
                keyBuffer.push(e.key.charCodeAt(0) & 0xFF);
                updateKeyboardDisplay();
            } else if (e.key === 'Enter') {
                keyBuffer.push(0x0D);
                updateKeyboardDisplay();
            }
        });
    }

    function readKeyBuffer() {
        if (keyBuffer.length === 0) return 0;
        const ch = keyBuffer.shift();
        updateKeyboardDisplay();
        return ch;
    }

    function getKeyBufferLength() {
        return Math.min(keyBuffer.length, 255);
    }

    function clearKeyBuffer() {
        keyBuffer.length = 0;
        updateKeyboardDisplay();
    }

    function updateKeyboardDisplay() {
        const el = document.getElementById('keybuf-display');
        if (!el) return;
        if (keyBuffer.length === 0) {
            el.textContent = '(empty)';
        } else {
            el.textContent = keyBuffer.map(c => {
                if (c >= 32 && c <= 126) return String.fromCharCode(c);
                return '[' + c.toString(16).toUpperCase().padStart(2, '0') + ']';
            }).join('');
        }
    }

    // ---- Timer Interrupt (Port 7) ----
    let timerInterval = 0;
    let timerCounter = 0;

    function setTimerInterval(n) {
        timerInterval = n & 0xFF;
        timerCounter = 0;
    }

    function tickTimer() {
        if (timerInterval === 0) return false;
        timerCounter++;
        if (timerCounter >= timerInterval) {
            timerCounter = 0;
            return true;
        }
        return false;
    }

    function fireTimerInterrupt() {
        const mem = CPU.getMemory();
        if (!mem) return;
        const vectorAddr = 0x0080;
        const handler = mem[vectorAddr] | (mem[vectorAddr + 1] << 8);
        if (handler === 0) return;
        const state = CPU.getState();
        let flagsWord = 0;
        flagsWord |= state.flags.cf;
        flagsWord |= (state.flags.pf << 2);
        flagsWord |= (state.flags.af << 4);
        flagsWord |= (state.flags.zf << 6);
        flagsWord |= (state.flags.sf << 7);
        flagsWord |= (state.flags.of << 11);
        CPU.pushStack(flagsWord);
        CPU.pushStack(state.regs.ip);
        CPU.setReg16('ip', handler);
    }

    function resetTimer() {
        timerInterval = 0;
        timerCounter = 0;
    }

    // ---- VT100 Terminal (Port 8 data, Port 9 status) ----
    const TERM_DATA_PORT = 8;
    const TERM_STATUS_PORT = 9;
    const TERM_FG = [
        '#1a1b26', '#f7768e', '#9ece6a', '#e0af68',
        '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5',
        '#565f89', '#ff9aad', '#b9f27c', '#f3d17c',
        '#89b4fa', '#d0a9ff', '#9ae5ff', '#ffffff'
    ];
    const TERM_DEFAULT_FG = '#9ece6a';
    const TERM_DEFAULT_BG = '#0b0e14';

    let term = null;
    let termInput = [];
    let termScreen = null;
    let termRaf = 0;

    function ensureTerm() {
        if (!term && typeof VT100 !== 'undefined') {
            term = VT100.create();
        }
        return term;
    }

    function terminalWrite(byte) {
        const t = ensureTerm();
        if (!t) return;
        t.writeByte(byte);
        if (t.consumeBell()) flashBell();
        scheduleTermRender();
    }

    function terminalRead() {
        if (termInput.length === 0) return 0;
        const ch = termInput.shift();
        updateTermStatus();
        return ch & 0xFF;
    }

    function terminalCanRead() {
        return termInput.length > 0;
    }

    function terminalStatus() {
        let status = 0x02;
        if (termInput.length > 0) status |= 0x01;
        return status;
    }

    function getTerminalText() {
        const t = ensureTerm();
        return t ? t.getText() : '';
    }

    function resetTerminal() {
        termInput.length = 0;
        if (term) term.reset();
        updateTermStatus();
        scheduleTermRender();
    }

    function flashBell() {
        const panel = document.getElementById('terminal-panel');
        if (!panel) return;
        panel.classList.remove('vt100-bell');
        void panel.offsetWidth;
        panel.classList.add('vt100-bell');
        setTimeout(() => panel.classList.remove('vt100-bell'), 160);
    }

    function cellStyle(cell) {
        let fg = cell.fg < 0 ? TERM_DEFAULT_FG : (TERM_FG[cell.fg] || TERM_DEFAULT_FG);
        let bg = cell.bg < 0 ? '' : (TERM_FG[cell.bg] || '');
        if (cell.bold && cell.fg >= 0 && cell.fg < 8) {
            fg = TERM_FG[cell.fg + 8] || fg;
        }
        if (cell.reverse) {
            let nextFg = bg || TERM_DEFAULT_BG;
            bg = fg;
            fg = nextFg;
        }
        return { fg: fg, bg: bg };
    }

    function escapeHtml(ch) {
        if (ch === '&') return '&amp;';
        if (ch === '<') return '&lt;';
        if (ch === '>') return '&gt;';
        if (ch === ' ') return '&nbsp;';
        return ch;
    }

    function renderTerminal() {
        const t = ensureTerm();
        if (!t || !termScreen) return;
        const cursor = t.getCursor();
        const showCursor = t.isCursorVisible();
        let html = '';
        for (let r = 0; r < t.rows; r++) {
            html += '<div class="vt100-row">';
            let run = '';
            let runFg = null;
            let runBg = null;
            function flush() {
                if (!run) return;
                html += '<span style="color:' + runFg;
                if (runBg) html += ';background:' + runBg;
                html += '">' + run + '</span>';
                run = '';
            }
            for (let c = 0; c < t.cols; c++) {
                const cell = t.getCell(r, c);
                const st = cellStyle(cell);
                const isCursor = showCursor && r === cursor.row && c === cursor.col;
                if (isCursor) {
                    flush();
                    html += '<span class="vt100-cursor"' +
                        (st.bg ? ' style="outline-color:' + st.fg + '"' : '') +
                        '>' + escapeHtml(cell.ch) + '</span>';
                    runFg = null;
                    continue;
                }
                if (run && (st.fg !== runFg || st.bg !== runBg)) flush();
                if (!run) {
                    runFg = st.fg;
                    runBg = st.bg;
                }
                run += escapeHtml(cell.ch);
            }
            flush();
            html += '</div>';
        }
        termScreen.innerHTML = html;
        const cursorRow = termScreen.children[cursor.row];
        if (cursorRow && typeof cursorRow.scrollIntoView === 'function') {
            cursorRow.scrollIntoView({ block: 'nearest' });
        }
        t.clearDirty();
        updateTermStatus();
    }

    function scheduleTermRender() {
        if (!termScreen) return;
        if (typeof requestAnimationFrame !== 'function') {
            renderTerminal();
            return;
        }
        if (termRaf) return;
        termRaf = requestAnimationFrame(() => {
            termRaf = 0;
            renderTerminal();
        });
    }

    function updateTermStatus() {
        const el = document.getElementById('vt100-status');
        if (!el) return;
        el.textContent = termInput.length ? ('keys: ' + termInput.length) : '';
    }

    function pushTermByte(b) {
        termInput.push(b & 0xFF);
        updateTermStatus();
    }

    function initTerminal() {
        termScreen = document.getElementById('vt100-screen');
        if (!termScreen) return;
        ensureTerm();
        termScreen.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.key === 'Enter') return;
            let bytes = null;
            if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
                bytes = [e.key.charCodeAt(0) & 0xFF];
            } else if (e.ctrlKey && e.key.length === 1 && !e.metaKey && !e.altKey) {
                const code = e.key.toUpperCase().charCodeAt(0);
                if (code >= 64 && code <= 95) bytes = [code - 64];
            } else if (e.key === 'Enter') {
                bytes = [0x0D];
            } else if (e.key === 'Backspace') {
                bytes = [0x08];
            } else if (e.key === 'Tab') {
                bytes = [0x09];
            } else if (e.key === 'Escape') {
                bytes = [0x1B];
            } else if (e.key === 'Delete') {
                bytes = [0x7F];
            } else if (e.key === 'ArrowUp') {
                bytes = [0x1B, 0x5B, 0x41];
            } else if (e.key === 'ArrowDown') {
                bytes = [0x1B, 0x5B, 0x42];
            } else if (e.key === 'ArrowRight') {
                bytes = [0x1B, 0x5B, 0x43];
            } else if (e.key === 'ArrowLeft') {
                bytes = [0x1B, 0x5B, 0x44];
            } else if (e.key === 'Home') {
                bytes = [0x1B, 0x5B, 0x48];
            } else if (e.key === 'End') {
                bytes = [0x1B, 0x5B, 0x46];
            }
            if (!bytes) return;
            e.preventDefault();
            for (let i = 0; i < bytes.length; i++) pushTermByte(bytes[i]);
        });
        termScreen.addEventListener('paste', (e) => {
            const text = e.clipboardData && e.clipboardData.getData('text');
            if (!text) return;
            e.preventDefault();
            for (let i = 0; i < text.length; i++) {
                const ch = text.charCodeAt(i);
                if (ch === 0x0A) pushTermByte(0x0D);
                else if (ch !== 0x0D) pushTermByte(ch & 0xFF);
            }
        });
        const clearBtn = document.getElementById('btn-clear-terminal');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                if (!term) return;
                term.write('\x1b[2J\x1b[H');
                scheduleTermRender();
            });
        }
        renderTerminal();
    }

    function handlePortWrite(port, val) {
        if (port === 3) updateSevenSeg(val);
        if (port === 4) refreshPixelDisplay();
        if (port === 7) setTimerInterval(val);
        if (port === TERM_DATA_PORT) terminalWrite(val);
    }

    function handlePortRead(port) {
        if (port === 5) return readKeyBuffer();
        if (port === 6) return getKeyBufferLength();
        if (port === TERM_DATA_PORT) return terminalRead();
        if (port === TERM_STATUS_PORT) return terminalStatus();
        return null;
    }

    // ---- Init ----

    function init() {
        initPixelDisplay();
        initKeyboard();
        initTerminal();
    }

    function resetAll() {
        clearKeyBuffer();
        resetTimer();
        resetTerminal();
        updateSevenSeg(0);
        if (pixelGrid) {
            Array.from(pixelGrid.children).forEach(px => { px.style.background = PIXEL_COLORS[0]; });
        }
    }

    document.addEventListener('DOMContentLoaded', init);

    return {
        handlePortWrite, handlePortRead,
        refreshPixelDisplay, tickTimer, fireTimerInterrupt,
        resetAll,
        terminalWrite, terminalRead, terminalCanRead, getTerminalText
    };
})();

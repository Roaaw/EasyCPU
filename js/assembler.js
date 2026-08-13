"use strict";

const Assembler = (() => {

    const REGISTERS_8 = ['al','ah','bl','bh','cl','ch','dl','dh'];
    const REGISTERS_16 = ['ax','bx','cx','dx','sp','bp','si','di','ds','ss','cs','es','ip'];
    const ALL_REGISTERS = [...REGISTERS_8, ...REGISTERS_16];

    const MNEMONICS = [
        'mov','add','sub','inc','dec','cmp','and','or','not','xor',
        'rol','ror','shl','shr','jmp','jz','jnz','jc','jnc','je','jne',
        'js','jns','jg','jge','jl','jle','ja','jae','jb','jbe','jo','jno',
        'jnle','jnl','jnge','jng','jnbe','jna',
        'call','ret','iret','int','in','out','push','pop','nop',
        'mul','div','neg','test','xchg','lea','cbw','cwd',
        'stc','clc','cmc','std','cld','cli','sti','hlt',
        'loop','loope','loopne','loopz','loopnz',
        'movsb','cmpsb','lodsb','stosb','scasb',
        'rep','repe','repne','repz','repnz',
        'xlatb','lahf','sahf'
    ];

    const DIRECTIVES = ['.model','.stack','.data','.code','equ','db','dw','dd','end','org'];

    function isRegister8(s) { return REGISTERS_8.includes(s.toLowerCase()); }
    function isRegister16(s) { return REGISTERS_16.includes(s.toLowerCase()); }
    function isRegister(s) { return ALL_REGISTERS.includes(s.toLowerCase()); }

    function parseNumber(s) {
        if (s == null) return NaN;
        s = s.trim();
        if (/^0x[0-9a-fA-F]+$/.test(s)) return parseInt(s, 16);
        if (/^[0-9a-fA-F]+h$/i.test(s)) {
            let hex = s.slice(0, -1);
            return parseInt(hex, 16);
        }
        if (/^[01]+b$/i.test(s)) return parseInt(s.slice(0, -1), 2);
        if (/^[0-9]+d?$/i.test(s)) return parseInt(s.replace(/d$/i, ''), 10);
        return NaN;
    }

    // Strip a ; comment, ignoring semicolons inside quoted strings
    function stripComment(line) {
        let inQuote = null;
        for (let i = 0; i < line.length; i++) {
            let ch = line[i];
            if (inQuote) {
                if (ch === inQuote) inQuote = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inQuote = ch;
                continue;
            }
            if (ch === ';') return line.substring(0, i);
        }
        return line;
    }

    // Emit bytes for one DB/DW initializer: number, '?', or a quoted string.
    // DB "MIGUEL" → one byte per character; DW packs two characters per word.
    function emitDataBytes(s, width) {
        if (s == null) return null;
        s = s.trim();
        if (s === '?') {
            return width === 'dw' ? [0, 0] : [0];
        }
        let n = parseNumber(s);
        if (!isNaN(n)) {
            if (width === 'dw') return [n & 0xFF, (n >> 8) & 0xFF];
            return [n & 0xFF];
        }
        let ch = s.match(/^(['"])([\s\S]*)\1$/);
        if (ch) {
            let text = ch[2];
            if (text.length === 0) {
                return width === 'dw' ? [0, 0] : [0];
            }
            let bytes = [];
            if (width === 'db') {
                for (let i = 0; i < text.length; i++) {
                    bytes.push(text.charCodeAt(i) & 0xFF);
                }
            } else {
                for (let i = 0; i < text.length; i += 2) {
                    let lo = text.charCodeAt(i) & 0xFF;
                    let hi = (i + 1 < text.length) ? (text.charCodeAt(i + 1) & 0xFF) : 0;
                    bytes.push(lo, hi);
                }
            }
            return bytes;
        }
        return null;
    }

    function parseOperand(token, labels, equates, dataSegAddr, dataSizes) {
        if (token == null || token === '') return null;
        let t = token.trim();
        let tl = t.toLowerCase();

        // Explicit size override: BYTE PTR / WORD PTR
        let ptrMatch = t.match(/^(byte|word)\s+ptr\s+(.+)$/i);
        if (ptrMatch) {
            let forcedSize = ptrMatch[1].toLowerCase() === 'word' ? 16 : 8;
            let innerOp = parseOperand(ptrMatch[2], labels, equates, dataSegAddr, dataSizes);
            if (innerOp) {
                innerOp.size = forcedSize;
                return innerOp;
            }
            return { type: 'unknown', raw: t };
        }

        // OFFSET label → address as a 16-bit immediate (MASM-style)
        let offsetMatch = t.match(/^offset\s+(.+)$/i);
        if (offsetMatch) {
            let name = offsetMatch[1].trim().toLowerCase();
            if (labels[name] !== undefined) {
                return { type: 'immediate', value: labels[name] & 0xFFFF, size: 16 };
            }
            if (equates[name] !== undefined) {
                return { type: 'immediate', value: equates[name] & 0xFFFF, size: 16 };
            }
            return { type: 'unknown', raw: t };
        }

        if (tl === '@data') {
            return { type: 'immediate', value: dataSegAddr, size: 16 };
        }

        if (isRegister8(tl)) {
            return { type: 'register', reg: tl, size: 8 };
        }
        if (isRegister16(tl)) {
            return { type: 'register', reg: tl, size: 16 };
        }

        let segOverride = null;
        let tokenClean = t;
        let segMatch = t.match(/^([a-zA-Z]{2})\s*:\s*(.+)$/);
        if (segMatch && ['ds','ss','cs','es'].includes(segMatch[1].toLowerCase())) {
            segOverride = segMatch[1].toLowerCase();
            tokenClean = segMatch[2].trim();
        }

        let memMatch = tokenClean.match(/^\[(.+)\]$/);
        if (memMatch) {
            let inner = memMatch[1].trim().toLowerCase();
            if (isRegister16(inner) || isRegister8(inner)) {
                return { type: 'memory_reg', reg: inner, size: 8, segment: segOverride };
            }
            let twoRegDisp = inner.match(/^(\w+)\s*\+\s*(\w+)\s*\+\s*(.+)$/);
            if (twoRegDisp && isRegister16(twoRegDisp[1]) && isRegister16(twoRegDisp[2])) {
                let dispVal = parseNumber(twoRegDisp[3]);
                if (isNaN(dispVal) && equates[twoRegDisp[3]]) dispVal = equates[twoRegDisp[3]];
                return { type: 'memory_reg2_disp', reg: twoRegDisp[1], reg2: twoRegDisp[2], disp: dispVal || 0, size: 8, segment: segOverride };
            }
            let twoReg = inner.match(/^(\w+)\s*\+\s*(\w+)$/);
            if (twoReg && isRegister16(twoReg[1]) && isRegister16(twoReg[2])) {
                return { type: 'memory_reg2', reg: twoReg[1], reg2: twoReg[2], size: 8, segment: segOverride };
            }
            let innerWithPlus = inner.match(/^(\w+)\s*\+\s*(.+)$/);
            if (innerWithPlus) {
                let base = innerWithPlus[1];
                let disp = innerWithPlus[2];
                let dispVal = parseNumber(disp);
                if (isNaN(dispVal) && equates[disp]) dispVal = equates[disp];
                if (isNaN(dispVal) && labels[disp] !== undefined) dispVal = labels[disp];
                return { type: 'memory_reg_disp', reg: base, disp: dispVal || 0, size: 8, segment: segOverride };
            }
            let num = parseNumber(inner);
            if (isNaN(num) && equates[inner] !== undefined) num = equates[inner];
            if (isNaN(num) && labels[inner] !== undefined) num = labels[inner];
            if (!isNaN(num)) {
                // Prefer declared DB/DW size when the bracketed name is a data label
                let sizeFromData = !!(dataSizes && dataSizes[inner]);
                let size = sizeFromData ? dataSizes[inner] : 8;
                return { type: 'memory_direct', address: num & 0xFFFF, size, sizeFromData, segment: segOverride };
            }
            // Unresolved symbol in [brackets] — keep as unknown so pass 2 can report an error
            return { type: 'unknown', raw: inner };
        }

        let num = parseNumber(t);
        if (!isNaN(num)) {
            let size = num > 255 ? 16 : 8;
            return { type: 'immediate', value: num, size };
        }

        if (equates[tl] !== undefined) {
            let val = equates[tl];
            return { type: 'immediate', value: val, size: val > 255 ? 16 : 8 };
        }

        if (labels[tl] !== undefined) {
            // Data labels are memory operands (mov ax, delta / inc delta).
            // Code labels stay jump/call targets.
            if (dataSizes && dataSizes[tl]) {
                return {
                    type: 'memory_direct',
                    address: labels[tl] & 0xFFFF,
                    size: dataSizes[tl],
                    sizeFromData: true,
                    segment: segOverride
                };
            }
            return { type: 'label', name: tl, address: labels[tl] };
        }

        return { type: 'unknown', raw: t };
    }

    function splitOperands(operandStr) {
        if (!operandStr || !operandStr.trim()) return [];
        let result = [];
        let depth = 0;
        let current = '';
        let inQuote = null;
        for (let ch of operandStr) {
            if (inQuote) {
                current += ch;
                if (ch === inQuote) inQuote = null;
                continue;
            }
            if (ch === '"' || ch === "'") {
                inQuote = ch;
                current += ch;
                continue;
            }
            if (ch === '[') depth++;
            if (ch === ']') depth--;
            if (ch === ',' && depth === 0) {
                result.push(current.trim());
                current = '';
            } else {
                current += ch;
            }
        }
        if (current.trim()) result.push(current.trim());
        return result;
    }

    function assemble(source) {
        const lines = source.split('\n');
        const errors = [];
        const labels = {};
        const equates = {};
        const dataSizes = {}; // label → 8 (DB) or 16 (DW)
        const dataBytes = [];
        let dataSegAddr = 0x1000;
        let inDataSection = false;
        let inCodeSection = false;
        let dataOffset = 0;

        // pass 1: collect labels, equates, data, calculate addresses
        let instrIndex = 0;
        const parsedLines = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            let originalLine = line;
            let lineNum = i + 1;

            line = stripComment(line).trim();
            if (!line) {
                parsedLines.push({ lineNum, original: originalLine, type: 'empty' });
                continue;
            }

            let lower = line.toLowerCase();

            if (lower === '.data') {
                inDataSection = true;
                inCodeSection = false;
                parsedLines.push({ lineNum, original: originalLine, type: 'directive', directive: '.data' });
                continue;
            }
            if (lower === '.code') {
                inDataSection = false;
                inCodeSection = true;
                parsedLines.push({ lineNum, original: originalLine, type: 'directive', directive: '.code' });
                continue;
            }
            if (lower.startsWith('.model') || lower.startsWith('.stack') || lower === 'end') {
                parsedLines.push({ lineNum, original: originalLine, type: 'directive', directive: lower.split(/\s/)[0] });
                continue;
            }

            // EQU directive
            let equMatch = line.match(/^(\w+)\s+equ\s+(.+)$/i);
            if (equMatch) {
                let name = equMatch[1].toLowerCase();
                let val = parseNumber(equMatch[2].trim());
                if (isNaN(val)) val = equMatch[2].trim().charCodeAt(0);
                equates[name] = val;
                parsedLines.push({ lineNum, original: originalLine, type: 'equ', name, value: val });
                continue;
            }

            // Data directives (DB / DW) in .data section
            if (inDataSection) {
                let namedData = line.match(/^(\w+)\s+(db|dw)\s+(.+)$/i);
                if (namedData) {
                    let name = namedData[1].toLowerCase();
                    let width = namedData[2].toLowerCase();
                    let vals = splitOperands(namedData[3]);
                    labels[name] = dataOffset;
                    dataSizes[name] = (width === 'dw') ? 16 : 8;
                    for (let v of vals) {
                        let bytes = emitDataBytes(v, width);
                        if (!bytes) {
                            errors.push({ line: lineNum, message: `Invalid ${width.toUpperCase()} value: "${v}"` });
                            continue;
                        }
                        for (let b of bytes) {
                            dataBytes[dataOffset] = b;
                            dataOffset++;
                        }
                    }
                    parsedLines.push({ lineNum, original: originalLine, type: 'data', name, width });
                    continue;
                }
                let anonData = line.match(/^(db|dw)\s+(.+)$/i);
                if (anonData) {
                    let width = anonData[1].toLowerCase();
                    let vals = splitOperands(anonData[2]);
                    for (let v of vals) {
                        let bytes = emitDataBytes(v, width);
                        if (!bytes) {
                            errors.push({ line: lineNum, message: `Invalid ${width.toUpperCase()} value: "${v}"` });
                            continue;
                        }
                        for (let b of bytes) {
                            dataBytes[dataOffset] = b;
                            dataOffset++;
                        }
                    }
                    parsedLines.push({ lineNum, original: originalLine, type: 'data', width });
                    continue;
                }
            }

            // Check for label
            let label = null;
            let labelMatch = line.match(/^(\w+)\s*:\s*(.*)$/);
            if (labelMatch) {
                label = labelMatch[1].toLowerCase();
                line = labelMatch[2].trim();
                labels[label] = instrIndex;
            }

            if (!line) {
                parsedLines.push({ lineNum, original: originalLine, type: 'label', label });
                continue;
            }

            let parts = line.match(/^(\w+)(?:\s+(.*))?$/);
            if (!parts) {
                errors.push({ line: lineNum, message: `Syntax error: "${line}"` });
                parsedLines.push({ lineNum, original: originalLine, type: 'error' });
                continue;
            }

            let mnemonic = parts[1].toLowerCase();
            let operandStr = parts[2] ? parts[2].trim() : '';

            if (DIRECTIVES.includes(mnemonic) || mnemonic === '.model' || mnemonic === '.stack') {
                parsedLines.push({ lineNum, original: originalLine, type: 'directive', directive: mnemonic });
                continue;
            }

            if (!MNEMONICS.includes(mnemonic)) {
                if (label) {
                    // The "mnemonic" might actually be part of an instruction attached to label
                    // re-parse the whole rest
                    let fullRest = labelMatch ? (labelMatch[1] + ': ' + mnemonic + ' ' + operandStr).trim() : line;
                }
                if (!MNEMONICS.includes(mnemonic)) {
                    errors.push({ line: lineNum, message: `Unknown instruction: "${mnemonic}"` });
                    parsedLines.push({ lineNum, original: originalLine, type: 'error' });
                    continue;
                }
            }

            // Allow "rep movsb" (prefix + string op) on one line
            const REP_PREFIXES = ['rep', 'repe', 'repne', 'repz', 'repnz'];
            if (REP_PREFIXES.includes(mnemonic) && operandStr) {
                let restMnem = operandStr.toLowerCase().split(/\s+/)[0];
                if (MNEMONICS.includes(restMnem) && !REP_PREFIXES.includes(restMnem)) {
                    parsedLines.push({
                        lineNum, original: originalLine, type: 'instruction',
                        label, mnemonic, operandStr: '', index: instrIndex
                    });
                    instrIndex++;
                    parsedLines.push({
                        lineNum, original: originalLine, type: 'instruction',
                        label: null, mnemonic: restMnem,
                        operandStr: operandStr.slice(restMnem.length).trim(),
                        index: instrIndex
                    });
                    instrIndex++;
                    continue;
                }
            }

            parsedLines.push({
                lineNum,
                original: originalLine,
                type: 'instruction',
                label,
                mnemonic,
                operandStr,
                index: instrIndex
            });
            instrIndex++;
        }

        // pass 2: resolve operands
        const instructions = [];
        for (let pl of parsedLines) {
            if (pl.type !== 'instruction') continue;

            let ops = splitOperands(pl.operandStr);
            let operands = ops.map(o => parseOperand(o, labels, equates, dataSegAddr, dataSizes));

            for (let op of operands) {
                if (op && op.type === 'unknown') {
                    let name = op.raw.toLowerCase();
                    if (dataSizes[name]) {
                        op.type = 'memory_direct';
                        op.address = labels[name] & 0xFFFF;
                        op.size = op.size || dataSizes[name];
                        op.sizeFromData = true;
                    } else if (labels[name] !== undefined) {
                        op.type = 'label';
                        op.name = name;
                        op.address = labels[name];
                    } else if (equates[name] !== undefined) {
                        op.type = 'immediate';
                        op.value = equates[name];
                        op.size = equates[name] > 255 ? 16 : 8;
                    } else {
                        errors.push({ line: pl.lineNum, message: `Unknown symbol: "${op.raw}"` });
                    }
                }
            }

            // Infer memory operand size from a paired register or 16-bit immediate
            // (e.g. mov [var], ax → 16-bit; mov [bx], 1234h → 16-bit).
            // Declared DB/DW sizes come from parseOperand; registers override them.
            // A 16-bit immediate widens only untyped memory (not a DB label).
            const memTypes = new Set([
                'memory_direct', 'memory_reg', 'memory_reg_disp', 'memory_reg2', 'memory_reg2_disp'
            ]);
            if (operands.length === 2) {
                let a = operands[0], b = operands[1];
                if (a && b) {
                    if (memTypes.has(a.type) && b.type === 'register') a.size = b.size;
                    else if (memTypes.has(b.type) && a.type === 'register') b.size = a.size;
                    else if (memTypes.has(a.type) && b.type === 'immediate' && b.size === 16 && !a.sizeFromData) a.size = 16;
                    else if (memTypes.has(b.type) && a.type === 'immediate' && a.size === 16 && !b.sizeFromData) b.size = 16;
                }
            }

            instructions.push({
                index: pl.index,
                mnemonic: pl.mnemonic,
                operands,
                sourceLine: pl.lineNum,
                label: pl.label
            });
        }

        // Build line-to-instruction mapping
        const lineMap = {};
        for (let instr of instructions) {
            lineMap[instr.sourceLine] = instr.index;
        }
        const indexToLine = {};
        for (let instr of instructions) {
            indexToLine[instr.index] = instr.sourceLine;
        }

        return {
            instructions,
            labels,
            equates,
            dataSizes,
            dataBytes,
            dataSegAddr,
            lineMap,
            indexToLine,
            errors
        };
    }

    return { assemble, parseNumber };
})();

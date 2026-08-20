"use strict";

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

function loadProject() {
    const sandbox = vm.createContext({
        console,
        Uint8Array,
        Array,
        Object,
        Math,
        parseInt,
        String,
        Number,
        module: { exports: {} },
        exports: {},
        window: {}
    });
    function load(rel) {
        const code = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
        vm.runInContext(
            code +
            '\nglobalThis.SAMPLES = (typeof SAMPLES !== "undefined") ? SAMPLES : globalThis.SAMPLES;' +
            '\nglobalThis.CPU = (typeof CPU !== "undefined") ? CPU : globalThis.CPU;' +
            '\nglobalThis.Assembler = (typeof Assembler !== "undefined") ? Assembler : globalThis.Assembler;',
            sandbox
        );
    }
    load('js/samples.js');
    load('js/assembler.js');
    load('js/cpu.js');
    return sandbox;
}

const ctx = loadProject();
const { CPU, Assembler, SAMPLES } = ctx;
assert.ok(CPU && Assembler && SAMPLES, 'CPU, Assembler, and SAMPLES should load');

let failed = 0;
function test(name, fn) {
    try {
        fn();
        console.log('  ok  ' + name);
    } catch (err) {
        failed++;
        console.log('  FAIL  ' + name);
        console.log('    ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n    ') : err));
    }
}

function runToHalt(maxSteps) {
    maxSteps = maxSteps || 200000;
    let n = 0;
    while (!CPU.isHalted() && n < maxSteps) {
        CPU.step();
        n++;
    }
    return n;
}

function assembleAndRun(source) {
    const assembled = Assembler.assemble(source);
    assert.ok(assembled.errors && assembled.errors.length === 0,
        'assembly errors: ' + JSON.stringify(assembled.errors || []));
    CPU.init();
    CPU.loadProgram(assembled);
    const steps = runToHalt();
    assert.ok(CPU.isHalted(), 'program should halt');
    return { assembled, steps, mem: CPU.getMemory(), state: CPU.getState() };
}

console.log('pixel display');

test('Pixel Drawing sample writes the color pattern at physical E000h', () => {
    const src = SAMPLES['Advanced: Pixel Drawing'];
    assert.ok(src, 'sample should exist');
    const { mem, state, assembled } = assembleAndRun(src);
    assert.strictEqual(assembled.dataSegAddr, 0x1000);
    assert.strictEqual(state.regs.ds, 0x1000, 'sample keeps DS = @data');

    for (let i = 0; i < 1024; i++) {
        assert.strictEqual(mem[0xE000 + i], i & 7, 'E000h+' + i);
    }
    const spilled = [...mem.slice(0xF000, 0xF400)].reduce((n, b) => n + (b ? 1 : 0), 0);
    assert.strictEqual(spilled, 0, 'must not write the pattern to DS+E000h (F000h)');
});

test('mov [bx], al with BX=E000h hits VRAM while DS=@data', () => {
    const src = `
.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax
mov bx, 0E000h
mov al, 5
mov [bx], al
mov ah, 4ch
int 21h
end
`;
    const { mem, state } = assembleAndRun(src);
    assert.strictEqual(state.regs.ds, 0x1000);
    assert.strictEqual(mem[0xE000], 5);
    assert.strictEqual(mem[0xF000], 0);
});

test('mov [0E000h], al hits VRAM while DS=@data', () => {
    const src = `
.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax
mov al, 3
mov [0E000h], al
mov ah, 4ch
int 21h
end
`;
    const { mem } = assembleAndRun(src);
    assert.strictEqual(mem[0xE000], 3);
    assert.strictEqual(mem[0xF000], 0);
});

test('DS=0 and BX=E000h still writes physical E000h', () => {
    const src = `
.model small
.stack 100h
.data
.code
xor ax, ax
mov ds, ax
mov bx, 0E000h
mov al, 6
mov [bx], al
mov ah, 4ch
int 21h
end
`;
    const { mem } = assembleAndRun(src);
    assert.strictEqual(mem[0xE000], 6);
});

test('DS=E000h and offset 0 writes physical E000h', () => {
    const src = `
.model small
.stack 100h
.data
.code
mov ax, 0E000h
mov ds, ax
xor bx, bx
mov al, 4
mov [bx], al
mov ah, 4ch
int 21h
end
`;
    const { mem } = assembleAndRun(src);
    assert.strictEqual(mem[0xE000], 4);
});

test('STOSB to DI=E000h hits VRAM even if ES is the data segment', () => {
    const src = `
.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax
mov es, ax
mov di, 0E000h
mov al, 2
stosb
mov ah, 4ch
int 21h
end
`;
    const { mem } = assembleAndRun(src);
    assert.strictEqual(mem[0xE000], 2);
    assert.strictEqual(mem[0xF000], 0);
});

test('normal DS-relative data writes are unchanged', () => {
    const src = `
.model small
.stack 100h
.data
val db 0
.code
mov ax, @data
mov ds, ax
mov al, 9
mov [val], al
mov ah, 4ch
int 21h
end
`;
    const { mem, assembled } = assembleAndRun(src);
    const phys = (assembled.dataSegAddr + 0) & 0xFFFF;
    assert.strictEqual(mem[phys], 9);
    assert.strictEqual(mem[0xE000], 0);
});

if (failed) {
    console.log('\n' + failed + ' test(s) failed');
    process.exit(1);
}
console.log('\nall tests passed');

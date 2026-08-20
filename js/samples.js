"use strict";

const SAMPLES = {

"Beginner: Hello LEDs": `.model small        ; use the "small" memory model
.stack 100h         ; reserve 256 bytes for the stack
.data               ; data section (empty for now)
.code               ; code section starts here
mov ax, @data       ; load the data segment address into AX
mov ds, ax          ; copy it to DS so we can access data

; --- Turn ALL LEDs on ---
mov al, 0FFh        ; AL = FFh = 11111111 in binary (all 8 bits ON)
out 2, al           ; send AL to port 2 (the LED display)
                    ; you should see all 8 LEDs light up!

; --- Turn ALL LEDs off ---
mov al, 0           ; AL = 0 = 00000000 in binary (all bits OFF)
out 2, al           ; send 0 to the LEDs (all off)

; --- End the program ---
mov ah, 4ch         ; DOS function: exit program
int 21h             ; call DOS
end`,

"Beginner: Hello Terminal": `.model small        ; use the "small" memory model
.stack 100h         ; reserve 256 bytes for the stack
.data               ; data section — the message lives here
msg db 'Hello, EasyCPU!', 13, 10, '$'   ; DOS string: CR, LF, ends with $
.code
mov ax, @data
mov ds, ax          ; DS must point at .data before we print

; INT 21h AH=09h prints the $-terminated string at DS:DX
; Output appears on the VT100 terminal (not the log console)
mov dx, offset msg
mov ah, 9
int 21h

mov ah, 4ch         ; DOS function: exit program
int 21h
end`,

"Beginner: Add Two Numbers": `.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax

; --- Add 5 + 3 and display the result ---
mov al, 5           ; put the first number (5) into AL
add al, 3           ; add the second number (3) to AL
                    ; AL is now 8  (5 + 3 = 8)
out 2, al           ; show the result on LEDs
                    ; 8 = 00001000 in binary, so LED #3 lights up

; --- Try changing the numbers above! ---
; For example: mov al, 15 / add al, 1  -> result is 16

mov ah, 4ch
int 21h
end`,

"Beginner: Countdown": `.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax

; --- Count from 10 down to 0, showing each value on LEDs ---
mov cl, 10          ; CL is our counter, starting at 10

countdown:          ; this label marks the start of our loop
    mov al, cl      ; copy the counter value into AL
    out 2, al       ; display it on the LEDs
    dec cl          ; subtract 1 from CL  (CL = CL - 1)
    jnz countdown   ; if CL is NOT zero, jump back to "countdown"
                    ; when CL reaches 0, the loop ends

; --- After the loop, CL is 0 and the LEDs show 0 ---
mov al, 0
out 2, al           ; make sure LEDs show 0 at the end

mov ah, 4ch
int 21h
end`,

"Beginner: Compare and Branch": `.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax

; --- Compare two numbers and branch ---
mov al, 7           ; first number
mov bl, 7           ; second number  (try changing this!)

cmp al, bl          ; compare AL with BL  (sets flags, doesn't change AL)
je  they_are_equal  ; if AL == BL, jump to "they_are_equal"

; --- If we get here, they are NOT equal ---
mov al, 0F0h        ; top 4 LEDs on = "not equal" signal
out 2, al
jmp done            ; skip over the "equal" part

they_are_equal:
; --- If we get here, AL and BL were equal ---
mov al, 0Fh         ; bottom 4 LEDs on = "equal" signal
out 2, al

done:
mov ah, 4ch
int 21h
end`,

"Beginner: Simple Subroutine": `.model small
.stack 100h
.data
.code
mov ax, @data
mov ds, ax

; --- Main program ---
; A subroutine (function) is a reusable block of code.
; We CALL it to run it, and it uses RET to come back.

mov al, 1           ; AL = 1  (binary 00000001, LED #0 on)
out 2, al           ; show on LEDs

call double_it      ; call our subroutine to double AL
                    ; AL is now 2 (the subroutine doubled it)
out 2, al           ; show 2 on LEDs

call double_it      ; call it again: AL goes from 2 to 4
out 2, al           ; show 4 on LEDs

call double_it      ; again: AL goes from 4 to 8
out 2, al           ; show 8 on LEDs

mov ah, 4ch
int 21h

; --- Subroutine: double the value in AL ---
double_it:
    add al, al      ; AL = AL + AL  (same as multiplying by 2)
    ret             ; return to wherever we were called from
end`,

"Template": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds, ax

; here your program starts



; here your program ends

mov ah,4ch
int 21h
end`,

"LED Counter (LEDINCR)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
;***************
\tmov cl,32
\tmov al,0
startlp:\tout 2,al
\tadd al,1
\tdec cl
\tjnz startlp
;**************
mov ah,4ch
int 21h
end`,

"Arithmetic (ARITHMET)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
mov  cl,0ffh
mov ah,al
mov  al,0
out  2,al
in al,1

;   a d d i t i o n

cmp al,1
jne mor2
mov al,ah
add al,bl

jmp sof

;   s u b t r a c t

mor2:cmp al,2
jne mor3
mov al,ah
sub al,bl
jmp sof

;   m u l t i p l y

mor3:cmp al,3
jne mor4
mov  al,ah
cmp bl,0
jne loop1
mov al,0
jmp loop1e
loop1: dec bl
         jz loop1e
         add al,ah
         jmp loop1
loop1e: jmp sof

; d i v i s i o n

mor4: cmp al,4
jne sof1
cmp bl,0
jz sof1
mov al,0

loopd:sub ah,bl
         js loopde
         inc al
         jmp loopd
loopde:add ah,bl
         jmp sof
sof1:mov  al,cl
      out 2,al
sof: mov ah,4ch
      int 21h
end`,

"Arithmetic Basics (ARITMET1)": `.model small
.stack
.data
.code
\tmov ax,@data
\tmov ds,ax
start: nop
add:\tmov al,03ch
\tmov bl, 0c3h
\tmov cl,bl
\tadd cl,al
sub: nop
\tmov ah,0ffh
\tmov bh,0c3h
\tmov ch,ah
\tsub ch,bh
inc:\tnop
\tmov dl,cl
\tinc dl
dec:\tnop
\tmov dh,dl
\tdec dh
comp: nop
\tcmp dl,dh
\tmov dl,dh
\tcmp dl,dh
\tjmp start
mov ah,4ch
int 21h
end`,

"Logic Operations (LOGIC1)": `.model small
.stack 100h
.data
.code
\tmov ax,@data
\tmov ds,ax
start: nop
and1:  mov bh,0c3h
        mov bl, 3ch
        and bl,bh
        mov al,bl
\tout 2,al
or1: nop
        mov cl,0c3h
        mov ch, 3ch
        or cl,ch
        mov al,cl
\tout 2,al
 not1:  nop
       mov dl,0c3h
       mov dh,dl
       not dl
       mov al,dl
       out 2,al
mov ah,4ch
int 21h
end`,

"Jump Conditions (JUMPCON1)": `.model small
.stack 100h
.data
.code
\tmov ax,@data
\tmov ds,ax
start: nop
        mov al,03bh
add1: inc al
        mov bl,0c3h
        mov cl,bl
        add cl, al
        jnc add1
        mov ah,0
sub1: dec ah
        mov bh,0feh
        mov ch,ah
        sub ch,bh
        jnz  sub1
        mov ch,0feh
comp:   inc ch
             cmp cl,ch
             jnz comp
             jmp start

mov ah,4ch
int 21h
end`,

"LED with Call (LEDCALL)": `.model small
.stack 100h
.data
outport equ 2
inport   equ 1
lighton equ 0ffh
count db 32
.code
mov ax,@data
mov ds,ax
\tmov cl, count
\tmov al,lighton
startlp:\tout outport,al
\tnot al
\tpush ax
\tin al,inport
\tcmp al,1
\tpop ax
\tjnz cont
\tcall roll
cont:\tdec cl
\tjnz startlp
mov ah,4ch
int 21h

roll:         mov cl,8
\tmov al,1
lp:\tout outport,al
\trol al,1
\tdec cl
\tjnz lp
\tret
end`,

"LED On/Off + Interrupt (LED01INT)": `.model small
.stack 100h
.data
on equ 0ffh
off equ 0h
spk_pt equ 61h
.code
\tmov ax,@data
\tmov ds,ax
\tmov cl,0ffh

start:\tcall led_on
\tcall led_off
\tjmp start
\tmov ah,4ch
\tint 21h

led_on: mov al, on
             out 2,al
             ret

led_off: mov al, off
             out 2,al
             ret

intr:    call beep
         iret

beep: mov dh,0
         mov dl, spk_pt
         mov al, on
         out dx,al
         and al,0feh
         out dx,al
         ret
end`,

"Nested Calls (NESTCALL)": `.model small
.stack 100h
.data
on equ 0ffh
off equ 0h
.code
\tmov ax,@data
\tmov ds,ax

\tmov cl,0ffh
start:\tmov dh,0
\tmov dl,61h
\tmov al,0ffh
\tout dx,al
\tmov al,0feh
\tout dx,al
\tcall on_off
\tjmp start

exit:  mov ah,4ch
        int 21h

on_off:  mov al, on
             out 2,al
             call led_off
             ret

led_off: mov al, off
             out 2,al
             ret
end`,

"Number Sort (NUMORDER)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
;*********************
mov cl,00
mov ch,00
mov dh,cl
l2: mov bl,cl
mov bh,ch
mov al,[bx]
mov ah,al
l1: inc cl
mov bl,cl
mov al,[bx]
cmp ah,al
jc sw
l5: cmp cl,04h
jnz l1
inc dh
mov cl,dh
cmp dh,04h
jnz l2
jmp l3
sw: mov dl,ah
mov ah,al
mov al,dl
mov bl,dh
mov [bx],ah
mov bl,cl
mov [bx],al
jmp l5
l3: mov bl,00
l4: mov al,[bx]
    out 2,al
    add bl,05h
    mov [bx],al
    sub bl,04h
    cmp bl,5
     jnz l4

;**********************
mov ah,4ch
int 21h
end`,

"Speaker Beep (BEEPCSVR)": `.model small
.stack 100h
.data
spk_pt equ 61h
on equ 0ffh
off equ 0feh
.code
\tmov ax,@data
\tmov ds,ax
again:\tmov dh,0
\tmov dl, spk_pt
\tmov al, on
\tout dx,al
\tmov al, off
\tout dx,al
\tjmp again
\tmov ah,4ch
\tint 21h
end`,

"Exercise 11 (EXERC11L)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
\tmov cl, 32
\tmov al,0
startlp:\tout 2,al
\tadd al,1
\tdec cl
\tjnz startlp
mov ah,4ch
int 21h
end`,

"Memory Fill (EXM632)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds, ax
mov al, 0
mov bx, 0
start:          mov [bx], al
\t\tinc al
\t\tinc bl
\t\tjmp start
mov ah,4ch
int 21h
end`,

"Memory Fill 255 (ADM36ER)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
mov cl,0ffh
mov bl,0
mov bh, bl
 start:\tmov [bx],255
\tmov [255],0
\tadd bl,1
\tsub cl,1
\tjnz start
mov ah,4ch
int 21h
end`,

"Memory Subtract (EXM200)": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax
mov al, [0]
mov bl, [1]
mov cl, al
sub cl, [1]
mov [2], cl
mov ah,4ch
int 21h
end`,

"Loop Counter (EXM810)": `.model small
.stack 100h
.data
.code
\tmov ax,@data
\tmov ds,ax
\tmov al, 0
startlp:    out 2, al
              add al, 1
              cmp al, 15
              jnz startlp
mov ah,4ch
int 21h
end`,

"Advanced: LOOP Countdown": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax

; LOOP decrements CX and jumps if CX != 0
mov cx, 20          ; loop 20 times
mov al, 0           ; counter starts at 0

count:
    inc al          ; AL = AL + 1
    out 2, al       ; show on LEDs
    loop count      ; CX--, jump to count if CX != 0

; AL is now 20, CX is 0
mov ah,4ch
int 21h
end`,

"Advanced: String Copy (MOVSB)": `.model small
.stack 100h
.data
msg db "Hello"
.code
mov ax,@data
mov ds,ax
mov es,ax

; Copy 5 bytes from DS:SI to ES:DI
mov si, offset msg  ; source offset
mov di, 10          ; destination offset
mov cx, 5           ; byte count
cld                 ; direction = forward
rep movsb           ; repeat MOVSB CX times

mov al, [10]        ; should be 48h = 'H'
out 2, al

mov ah,4ch
int 21h
end`,

"Advanced: String Compare (REPE CMPSB)": `.model small
.stack 100h
.data
nome1 db "S403",0
nome2 db "S303",0
.code
mov ax, @data
mov ds, ax
mov es, ax

; Compare 4 bytes at DS:SI with ES:DI while they are equal
mov si, offset nome1
mov di, offset nome2
mov cx, 4
cld
repe cmpsb          ; stops on first mismatch; CX = remaining count

; "S403" vs "S303": first byte matches, second differs
; CX should be 2 (not 0), ZF = 0
mov al, cl
out 2, al           ; show remaining CX on LEDs

mov ah,4ch
int 21h
end`,

"Advanced: Pixel Drawing": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax

; Fill the 32x32 pixel display (memory-mapped E000h-E3FFh).
; Each byte is a color 0-7. Offsets E000h-E3FFh always hit the
; framebuffer, even after mov ds, ax (DS = 1000h).
mov bx, 0E000h
mov cx, 0
mov al, 0

fill:
    mov [bx], al
    inc bx
    inc al
    and al, 7
    inc cx
    cmp cx, 1024
    jnz fill

; Refresh display (the grid also updates live while you Step/Run)
mov al, 1
out 4, al

mov ah,4ch
int 21h
end`,

"Advanced: Keyboard Echo": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax

; Read from keyboard buffer (port 5) and show on LEDs
; Port 6 = buffer length. Type in Keyboard panel first!
mov cx, 10

readloop:
    in al, 6
    cmp al, 0
    je done
    in al, 5
    out 2, al
    dec cx
    jnz readloop

done:
mov ah,4ch
int 21h
end`,

"Advanced: Timer Interrupt": `.model small
.stack 100h
.data
.code
mov ax,@data
mov ds,ax

; Simple demo: set LEDs to different patterns
mov al, 0FFh
out 2, al
mov al, 0
out 2, al
mov al, 0AAh
out 2, al
mov al, 55h
out 2, al

mov ah,4ch
int 21h
end`,

"Advanced: VT100 Color": `.model small
.stack 100h
.data
cls  db 1Bh, '[2J', 1Bh, '[H$'
red  db 1Bh, '[31mRed text', 1Bh, '[0m', 13, 10, '$'
pos  db 1Bh, '[5;10HCursor at row 5, col 10', 13, 10, '$'
.code
mov ax, @data
mov ds, ax

; Clear screen (ESC [ 2 J) and home the cursor (ESC [ H)
mov dx, offset cls
mov ah, 9
int 21h

; SGR color: ESC [ 31 m  (red), then reset with ESC [ 0 m
mov dx, offset red
int 21h

; CUP: ESC [ 5 ; 10 H  moves the cursor to row 5, column 10
mov dx, offset pos
int 21h

mov ah, 4ch
int 21h
end`,

"Advanced: Terminal Echo": `.model small
.stack 100h
.data
prompt db 'Type keys (they echo). ESC to quit.', 13, 10, '$'
.code
mov ax, @data
mov ds, ax

mov dx, offset prompt
mov ah, 9
int 21h

; Click the VT100 screen, then type. INT 21h AH=01 waits for a key.
echo:
    mov ah, 1
    int 21h
    cmp al, 1Bh          ; ESC?
    je done
    jmp echo

done:
mov ah, 4ch
int 21h
end`

};

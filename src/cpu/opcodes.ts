import { AddressingMode } from './addressing';
import { InstructionContext } from './instructions';
import {
  adc, and, asl, bcc, bcs, beq, bit, bmi, bne, bpl, brk, bvc, bvs,
  clc, cld, cli, clv, cmp, cpx, cpy, dec, dex, dey, eor, inc, inx, iny,
  jmp, jsr, lda, ldx, ldy, lsr, nop, ora, pha, php, pla, plp,
  rol, ror, rti, rts, sbc, sec, sed, sei, sta, stx, sty,
  tax, tay, tsx, txa, txs, tya,
} from './instructions';

export interface OpcodeEntry {
  name: string;
  execute: (ctx: InstructionContext) => void;
  mode: AddressingMode;
  cycles: number;
  bytes: number;
  pageCrossPenalty: boolean;
}

function op(
  name: string,
  execute: (ctx: InstructionContext) => void,
  mode: AddressingMode,
  cycles: number,
  bytes: number,
  pageCrossPenalty: boolean,
): OpcodeEntry {
  return { name, execute, mode, cycles, bytes, pageCrossPenalty };
}

const IMP = AddressingMode.Implied;
const ACC = AddressingMode.Accumulator;
const IMM = AddressingMode.Immediate;
const ZPG = AddressingMode.ZeroPage;
const ZPX = AddressingMode.ZeroPageX;
const ZPY = AddressingMode.ZeroPageY;
const ABS = AddressingMode.Absolute;
const ABX = AddressingMode.AbsoluteX;
const ABY = AddressingMode.AbsoluteY;
const IND = AddressingMode.Indirect;
const IZX = AddressingMode.IndexedIndirect;
const IZY = AddressingMode.IndirectIndexed;
const REL = AddressingMode.Relative;

const illegalNop = op('NOP', nop, IMP, 2, 1, false);

export const opcodeTable: (OpcodeEntry | null)[] = new Array(256).fill(null);

// Fill with illegal NOPs first
for (let i = 0; i < 256; i++) {
  opcodeTable[i] = illegalNop;
}

// ADC
opcodeTable[0x69] = op('ADC', adc, IMM, 2, 2, false);
opcodeTable[0x65] = op('ADC', adc, ZPG, 3, 2, false);
opcodeTable[0x75] = op('ADC', adc, ZPX, 4, 2, false);
opcodeTable[0x6D] = op('ADC', adc, ABS, 4, 3, false);
opcodeTable[0x7D] = op('ADC', adc, ABX, 4, 3, true);
opcodeTable[0x79] = op('ADC', adc, ABY, 4, 3, true);
opcodeTable[0x61] = op('ADC', adc, IZX, 6, 2, false);
opcodeTable[0x71] = op('ADC', adc, IZY, 5, 2, true);

// AND
opcodeTable[0x29] = op('AND', and, IMM, 2, 2, false);
opcodeTable[0x25] = op('AND', and, ZPG, 3, 2, false);
opcodeTable[0x35] = op('AND', and, ZPX, 4, 2, false);
opcodeTable[0x2D] = op('AND', and, ABS, 4, 3, false);
opcodeTable[0x3D] = op('AND', and, ABX, 4, 3, true);
opcodeTable[0x39] = op('AND', and, ABY, 4, 3, true);
opcodeTable[0x21] = op('AND', and, IZX, 6, 2, false);
opcodeTable[0x31] = op('AND', and, IZY, 5, 2, true);

// ASL
opcodeTable[0x0A] = op('ASL', asl, ACC, 2, 1, false);
opcodeTable[0x06] = op('ASL', asl, ZPG, 5, 2, false);
opcodeTable[0x16] = op('ASL', asl, ZPX, 6, 2, false);
opcodeTable[0x0E] = op('ASL', asl, ABS, 6, 3, false);
opcodeTable[0x1E] = op('ASL', asl, ABX, 7, 3, false);

// Branch instructions
opcodeTable[0x90] = op('BCC', bcc, REL, 2, 2, false);
opcodeTable[0xB0] = op('BCS', bcs, REL, 2, 2, false);
opcodeTable[0xF0] = op('BEQ', beq, REL, 2, 2, false);
opcodeTable[0x30] = op('BMI', bmi, REL, 2, 2, false);
opcodeTable[0xD0] = op('BNE', bne, REL, 2, 2, false);
opcodeTable[0x10] = op('BPL', bpl, REL, 2, 2, false);
opcodeTable[0x50] = op('BVC', bvc, REL, 2, 2, false);
opcodeTable[0x70] = op('BVS', bvs, REL, 2, 2, false);

// BIT
opcodeTable[0x24] = op('BIT', bit, ZPG, 3, 2, false);
opcodeTable[0x2C] = op('BIT', bit, ABS, 4, 3, false);

// BRK
opcodeTable[0x00] = op('BRK', brk, IMP, 7, 1, false);

// Clear flags
opcodeTable[0x18] = op('CLC', clc, IMP, 2, 1, false);
opcodeTable[0xD8] = op('CLD', cld, IMP, 2, 1, false);
opcodeTable[0x58] = op('CLI', cli, IMP, 2, 1, false);
opcodeTable[0xB8] = op('CLV', clv, IMP, 2, 1, false);

// CMP
opcodeTable[0xC9] = op('CMP', cmp, IMM, 2, 2, false);
opcodeTable[0xC5] = op('CMP', cmp, ZPG, 3, 2, false);
opcodeTable[0xD5] = op('CMP', cmp, ZPX, 4, 2, false);
opcodeTable[0xCD] = op('CMP', cmp, ABS, 4, 3, false);
opcodeTable[0xDD] = op('CMP', cmp, ABX, 4, 3, true);
opcodeTable[0xD9] = op('CMP', cmp, ABY, 4, 3, true);
opcodeTable[0xC1] = op('CMP', cmp, IZX, 6, 2, false);
opcodeTable[0xD1] = op('CMP', cmp, IZY, 5, 2, true);

// CPX
opcodeTable[0xE0] = op('CPX', cpx, IMM, 2, 2, false);
opcodeTable[0xE4] = op('CPX', cpx, ZPG, 3, 2, false);
opcodeTable[0xEC] = op('CPX', cpx, ABS, 4, 3, false);

// CPY
opcodeTable[0xC0] = op('CPY', cpy, IMM, 2, 2, false);
opcodeTable[0xC4] = op('CPY', cpy, ZPG, 3, 2, false);
opcodeTable[0xCC] = op('CPY', cpy, ABS, 4, 3, false);

// DEC
opcodeTable[0xC6] = op('DEC', dec, ZPG, 5, 2, false);
opcodeTable[0xD6] = op('DEC', dec, ZPX, 6, 2, false);
opcodeTable[0xCE] = op('DEC', dec, ABS, 6, 3, false);
opcodeTable[0xDE] = op('DEC', dec, ABX, 7, 3, false);

// DEX/DEY
opcodeTable[0xCA] = op('DEX', dex, IMP, 2, 1, false);
opcodeTable[0x88] = op('DEY', dey, IMP, 2, 1, false);

// EOR
opcodeTable[0x49] = op('EOR', eor, IMM, 2, 2, false);
opcodeTable[0x45] = op('EOR', eor, ZPG, 3, 2, false);
opcodeTable[0x55] = op('EOR', eor, ZPX, 4, 2, false);
opcodeTable[0x4D] = op('EOR', eor, ABS, 4, 3, false);
opcodeTable[0x5D] = op('EOR', eor, ABX, 4, 3, true);
opcodeTable[0x59] = op('EOR', eor, ABY, 4, 3, true);
opcodeTable[0x41] = op('EOR', eor, IZX, 6, 2, false);
opcodeTable[0x51] = op('EOR', eor, IZY, 5, 2, true);

// INC
opcodeTable[0xE6] = op('INC', inc, ZPG, 5, 2, false);
opcodeTable[0xF6] = op('INC', inc, ZPX, 6, 2, false);
opcodeTable[0xEE] = op('INC', inc, ABS, 6, 3, false);
opcodeTable[0xFE] = op('INC', inc, ABX, 7, 3, false);

// INX/INY
opcodeTable[0xE8] = op('INX', inx, IMP, 2, 1, false);
opcodeTable[0xC8] = op('INY', iny, IMP, 2, 1, false);

// JMP
opcodeTable[0x4C] = op('JMP', jmp, ABS, 3, 3, false);
opcodeTable[0x6C] = op('JMP', jmp, IND, 5, 3, false);

// JSR
opcodeTable[0x20] = op('JSR', jsr, ABS, 6, 3, false);

// LDA
opcodeTable[0xA9] = op('LDA', lda, IMM, 2, 2, false);
opcodeTable[0xA5] = op('LDA', lda, ZPG, 3, 2, false);
opcodeTable[0xB5] = op('LDA', lda, ZPX, 4, 2, false);
opcodeTable[0xAD] = op('LDA', lda, ABS, 4, 3, false);
opcodeTable[0xBD] = op('LDA', lda, ABX, 4, 3, true);
opcodeTable[0xB9] = op('LDA', lda, ABY, 4, 3, true);
opcodeTable[0xA1] = op('LDA', lda, IZX, 6, 2, false);
opcodeTable[0xB1] = op('LDA', lda, IZY, 5, 2, true);

// LDX
opcodeTable[0xA2] = op('LDX', ldx, IMM, 2, 2, false);
opcodeTable[0xA6] = op('LDX', ldx, ZPG, 3, 2, false);
opcodeTable[0xB6] = op('LDX', ldx, ZPY, 4, 2, false);
opcodeTable[0xAE] = op('LDX', ldx, ABS, 4, 3, false);
opcodeTable[0xBE] = op('LDX', ldx, ABY, 4, 3, true);

// LDY
opcodeTable[0xA0] = op('LDY', ldy, IMM, 2, 2, false);
opcodeTable[0xA4] = op('LDY', ldy, ZPG, 3, 2, false);
opcodeTable[0xB4] = op('LDY', ldy, ZPX, 4, 2, false);
opcodeTable[0xAC] = op('LDY', ldy, ABS, 4, 3, false);
opcodeTable[0xBC] = op('LDY', ldy, ABX, 4, 3, true);

// LSR
opcodeTable[0x4A] = op('LSR', lsr, ACC, 2, 1, false);
opcodeTable[0x46] = op('LSR', lsr, ZPG, 5, 2, false);
opcodeTable[0x56] = op('LSR', lsr, ZPX, 6, 2, false);
opcodeTable[0x4E] = op('LSR', lsr, ABS, 6, 3, false);
opcodeTable[0x5E] = op('LSR', lsr, ABX, 7, 3, false);

// NOP
opcodeTable[0xEA] = op('NOP', nop, IMP, 2, 1, false);

// ORA
opcodeTable[0x09] = op('ORA', ora, IMM, 2, 2, false);
opcodeTable[0x05] = op('ORA', ora, ZPG, 3, 2, false);
opcodeTable[0x15] = op('ORA', ora, ZPX, 4, 2, false);
opcodeTable[0x0D] = op('ORA', ora, ABS, 4, 3, false);
opcodeTable[0x1D] = op('ORA', ora, ABX, 4, 3, true);
opcodeTable[0x19] = op('ORA', ora, ABY, 4, 3, true);
opcodeTable[0x01] = op('ORA', ora, IZX, 6, 2, false);
opcodeTable[0x11] = op('ORA', ora, IZY, 5, 2, true);

// Stack
opcodeTable[0x48] = op('PHA', pha, IMP, 3, 1, false);
opcodeTable[0x08] = op('PHP', php, IMP, 3, 1, false);
opcodeTable[0x68] = op('PLA', pla, IMP, 4, 1, false);
opcodeTable[0x28] = op('PLP', plp, IMP, 4, 1, false);

// ROL
opcodeTable[0x2A] = op('ROL', rol, ACC, 2, 1, false);
opcodeTable[0x26] = op('ROL', rol, ZPG, 5, 2, false);
opcodeTable[0x36] = op('ROL', rol, ZPX, 6, 2, false);
opcodeTable[0x2E] = op('ROL', rol, ABS, 6, 3, false);
opcodeTable[0x3E] = op('ROL', rol, ABX, 7, 3, false);

// ROR
opcodeTable[0x6A] = op('ROR', ror, ACC, 2, 1, false);
opcodeTable[0x66] = op('ROR', ror, ZPG, 5, 2, false);
opcodeTable[0x76] = op('ROR', ror, ZPX, 6, 2, false);
opcodeTable[0x6E] = op('ROR', ror, ABS, 6, 3, false);
opcodeTable[0x7E] = op('ROR', ror, ABX, 7, 3, false);

// RTI / RTS
opcodeTable[0x40] = op('RTI', rti, IMP, 6, 1, false);
opcodeTable[0x60] = op('RTS', rts, IMP, 6, 1, false);

// SBC
opcodeTable[0xE9] = op('SBC', sbc, IMM, 2, 2, false);
opcodeTable[0xE5] = op('SBC', sbc, ZPG, 3, 2, false);
opcodeTable[0xF5] = op('SBC', sbc, ZPX, 4, 2, false);
opcodeTable[0xED] = op('SBC', sbc, ABS, 4, 3, false);
opcodeTable[0xFD] = op('SBC', sbc, ABX, 4, 3, true);
opcodeTable[0xF9] = op('SBC', sbc, ABY, 4, 3, true);
opcodeTable[0xE1] = op('SBC', sbc, IZX, 6, 2, false);
opcodeTable[0xF1] = op('SBC', sbc, IZY, 5, 2, true);

// Set flags
opcodeTable[0x38] = op('SEC', sec, IMP, 2, 1, false);
opcodeTable[0xF8] = op('SED', sed, IMP, 2, 1, false);
opcodeTable[0x78] = op('SEI', sei, IMP, 2, 1, false);

// STA
opcodeTable[0x85] = op('STA', sta, ZPG, 3, 2, false);
opcodeTable[0x95] = op('STA', sta, ZPX, 4, 2, false);
opcodeTable[0x8D] = op('STA', sta, ABS, 4, 3, false);
opcodeTable[0x9D] = op('STA', sta, ABX, 5, 3, false);
opcodeTable[0x99] = op('STA', sta, ABY, 5, 3, false);
opcodeTable[0x81] = op('STA', sta, IZX, 6, 2, false);
opcodeTable[0x91] = op('STA', sta, IZY, 6, 2, false);

// STX
opcodeTable[0x86] = op('STX', stx, ZPG, 3, 2, false);
opcodeTable[0x96] = op('STX', stx, ZPY, 4, 2, false);
opcodeTable[0x8E] = op('STX', stx, ABS, 4, 3, false);

// STY
opcodeTable[0x84] = op('STY', sty, ZPG, 3, 2, false);
opcodeTable[0x94] = op('STY', sty, ZPX, 4, 2, false);
opcodeTable[0x8C] = op('STY', sty, ABS, 4, 3, false);

// Transfers
opcodeTable[0xAA] = op('TAX', tax, IMP, 2, 1, false);
opcodeTable[0xA8] = op('TAY', tay, IMP, 2, 1, false);
opcodeTable[0xBA] = op('TSX', tsx, IMP, 2, 1, false);
opcodeTable[0x8A] = op('TXA', txa, IMP, 2, 1, false);
opcodeTable[0x9A] = op('TXS', txs, IMP, 2, 1, false);
opcodeTable[0x98] = op('TYA', tya, IMP, 2, 1, false);

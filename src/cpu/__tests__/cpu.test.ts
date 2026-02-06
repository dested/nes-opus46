import { describe, test, expect, beforeEach } from 'bun:test';
import { CPU } from '../cpu';
import { StatusFlag } from '../../types';

let cpu: CPU;
let memory: Uint8Array;

beforeEach(() => {
  memory = new Uint8Array(65536);
  cpu = new CPU();
  cpu.read = (addr) => memory[addr & 0xFFFF];
  cpu.write = (addr, val) => { memory[addr & 0xFFFF] = val; };
});

function loadProgram(addr: number, bytes: number[]) {
  for (let i = 0; i < bytes.length; i++) {
    memory[addr + i] = bytes[i];
  }
  memory[0xFFFC] = addr & 0xFF;
  memory[0xFFFD] = (addr >> 8) & 0xFF;
  cpu.reset();
}

// ============================================================
// 1. Reset behavior
// ============================================================
describe('Reset', () => {
  test('reads PC from reset vector', () => {
    memory[0xFFFC] = 0x00;
    memory[0xFFFD] = 0x80;
    cpu.reset();
    expect(cpu.pc).toBe(0x8000);
  });

  test('sets SP to 0xFD', () => {
    cpu.reset();
    expect(cpu.sp).toBe(0xFD);
  });

  test('sets status to 0x24 (I flag + U flag)', () => {
    cpu.reset();
    expect(cpu.status).toBe(0x24);
  });

  test('clears A, X, Y registers', () => {
    cpu.a = 0xFF;
    cpu.x = 0xFF;
    cpu.y = 0xFF;
    cpu.reset();
    expect(cpu.a).toBe(0);
    expect(cpu.x).toBe(0);
    expect(cpu.y).toBe(0);
  });

  test('sets total cycles to 7', () => {
    cpu.reset();
    expect(cpu.getTotalCycles()).toBe(7);
  });
});

// ============================================================
// 2. Load/Store instructions
// ============================================================
describe('LDA', () => {
  test('immediate mode', () => {
    // LDA #$42
    loadProgram(0x8000, [0xA9, 0x42]);
    cpu.step();
    expect(cpu.a).toBe(0x42);
  });

  test('sets Z flag when loading zero', () => {
    loadProgram(0x8000, [0xA9, 0x00]);
    cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });

  test('sets N flag when loading negative value', () => {
    loadProgram(0x8000, [0xA9, 0x80]);
    cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
  });

  test('zero page mode', () => {
    memory[0x10] = 0x55;
    loadProgram(0x8000, [0xA5, 0x10]);
    cpu.step();
    expect(cpu.a).toBe(0x55);
  });

  test('zero page X mode', () => {
    memory[0x15] = 0x77;
    loadProgram(0x8000, [0xA2, 0x05, 0xB5, 0x10]); // LDX #$05; LDA $10,X
    cpu.step(); // LDX
    cpu.step(); // LDA
    expect(cpu.a).toBe(0x77);
  });

  test('absolute mode', () => {
    memory[0x1234] = 0xAB;
    loadProgram(0x8000, [0xAD, 0x34, 0x12]);
    cpu.step();
    expect(cpu.a).toBe(0xAB);
  });

  test('absolute X mode', () => {
    memory[0x1239] = 0xCD;
    loadProgram(0x8000, [0xA2, 0x05, 0xBD, 0x34, 0x12]); // LDX #$05; LDA $1234,X
    cpu.step(); // LDX
    cpu.step(); // LDA
    expect(cpu.a).toBe(0xCD);
  });

  test('absolute Y mode', () => {
    memory[0x1237] = 0xEF;
    loadProgram(0x8000, [0xA0, 0x03, 0xB9, 0x34, 0x12]); // LDY #$03; LDA $1234,Y
    cpu.step(); // LDY
    cpu.step(); // LDA
    expect(cpu.a).toBe(0xEF);
  });

  test('indexed indirect (X) mode', () => {
    // ($10,X) with X=0x04 -> pointer at $14 -> address $3456
    memory[0x14] = 0x56;
    memory[0x15] = 0x34;
    memory[0x3456] = 0xBB;
    loadProgram(0x8000, [0xA2, 0x04, 0xA1, 0x10]); // LDX #$04; LDA ($10,X)
    cpu.step(); // LDX
    cpu.step(); // LDA
    expect(cpu.a).toBe(0xBB);
  });

  test('indirect indexed (Y) mode', () => {
    // ($20),Y with Y=0x03 -> pointer at $20 -> base $4000 + Y -> $4003
    memory[0x20] = 0x00;
    memory[0x21] = 0x40;
    memory[0x4003] = 0xCC;
    loadProgram(0x8000, [0xA0, 0x03, 0xB1, 0x20]); // LDY #$03; LDA ($20),Y
    cpu.step(); // LDY
    cpu.step(); // LDA
    expect(cpu.a).toBe(0xCC);
  });
});

describe('LDX', () => {
  test('immediate mode', () => {
    loadProgram(0x8000, [0xA2, 0x33]);
    cpu.step();
    expect(cpu.x).toBe(0x33);
  });

  test('sets Z flag when zero', () => {
    loadProgram(0x8000, [0xA2, 0x00]);
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('zero page mode', () => {
    memory[0x20] = 0x44;
    loadProgram(0x8000, [0xA6, 0x20]);
    cpu.step();
    expect(cpu.x).toBe(0x44);
  });

  test('zero page Y mode', () => {
    memory[0x25] = 0x99;
    loadProgram(0x8000, [0xA0, 0x05, 0xB6, 0x20]); // LDY #$05; LDX $20,Y
    cpu.step(); // LDY
    cpu.step(); // LDX
    expect(cpu.x).toBe(0x99);
  });
});

describe('LDY', () => {
  test('immediate mode', () => {
    loadProgram(0x8000, [0xA0, 0x77]);
    cpu.step();
    expect(cpu.y).toBe(0x77);
  });

  test('sets N flag when negative', () => {
    loadProgram(0x8000, [0xA0, 0xFF]);
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('zero page mode', () => {
    memory[0x30] = 0x88;
    loadProgram(0x8000, [0xA4, 0x30]);
    cpu.step();
    expect(cpu.y).toBe(0x88);
  });
});

describe('STA', () => {
  test('zero page mode', () => {
    loadProgram(0x8000, [0xA9, 0x42, 0x85, 0x10]); // LDA #$42; STA $10
    cpu.step();
    cpu.step();
    expect(memory[0x10]).toBe(0x42);
  });

  test('absolute mode', () => {
    loadProgram(0x8000, [0xA9, 0xAB, 0x8D, 0x00, 0x20]); // LDA #$AB; STA $2000
    cpu.step();
    cpu.step();
    expect(memory[0x2000]).toBe(0xAB);
  });
});

describe('STX', () => {
  test('zero page mode', () => {
    loadProgram(0x8000, [0xA2, 0x55, 0x86, 0x10]); // LDX #$55; STX $10
    cpu.step();
    cpu.step();
    expect(memory[0x10]).toBe(0x55);
  });

  test('absolute mode', () => {
    loadProgram(0x8000, [0xA2, 0xCD, 0x8E, 0x00, 0x30]); // LDX #$CD; STX $3000
    cpu.step();
    cpu.step();
    expect(memory[0x3000]).toBe(0xCD);
  });
});

describe('STY', () => {
  test('zero page mode', () => {
    loadProgram(0x8000, [0xA0, 0x66, 0x84, 0x10]); // LDY #$66; STY $10
    cpu.step();
    cpu.step();
    expect(memory[0x10]).toBe(0x66);
  });

  test('absolute mode', () => {
    loadProgram(0x8000, [0xA0, 0xEF, 0x8C, 0x00, 0x40]); // LDY #$EF; STY $4000
    cpu.step();
    cpu.step();
    expect(memory[0x4000]).toBe(0xEF);
  });
});

// ============================================================
// 3. Arithmetic: ADC, SBC
// ============================================================
describe('ADC', () => {
  test('simple addition without carry', () => {
    // CLC; LDA #$10; ADC #$20
    loadProgram(0x8000, [0x18, 0xA9, 0x10, 0x69, 0x20]);
    cpu.step(); // CLC
    cpu.step(); // LDA
    cpu.step(); // ADC
    expect(cpu.a).toBe(0x30);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(false);
  });

  test('addition with carry in', () => {
    // SEC; LDA #$10; ADC #$20
    loadProgram(0x8000, [0x38, 0xA9, 0x10, 0x69, 0x20]);
    cpu.step(); // SEC
    cpu.step(); // LDA
    cpu.step(); // ADC
    expect(cpu.a).toBe(0x31);
  });

  test('sets carry on overflow past 0xFF', () => {
    // CLC; LDA #$FF; ADC #$01
    loadProgram(0x8000, [0x18, 0xA9, 0xFF, 0x69, 0x01]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('signed overflow: positive + positive = negative', () => {
    // CLC; LDA #$7F; ADC #$01 => 0x80 (overflow)
    loadProgram(0x8000, [0x18, 0xA9, 0x7F, 0x69, 0x01]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('signed overflow: negative + negative = positive', () => {
    // CLC; LDA #$80; ADC #$80 => 0x00 (overflow)
    loadProgram(0x8000, [0x18, 0xA9, 0x80, 0x69, 0x80]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('no overflow: positive + negative', () => {
    // CLC; LDA #$50; ADC #$D0 => 0x20 + carry
    loadProgram(0x8000, [0x18, 0xA9, 0x50, 0x69, 0xD0]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x20);
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('zero page mode', () => {
    memory[0x42] = 0x10;
    // CLC; LDA #$05; ADC $42
    loadProgram(0x8000, [0x18, 0xA9, 0x05, 0x65, 0x42]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x15);
  });
});

describe('SBC', () => {
  test('simple subtraction with carry set (no borrow)', () => {
    // SEC; LDA #$50; SBC #$20
    loadProgram(0x8000, [0x38, 0xA9, 0x50, 0xE9, 0x20]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x30);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });

  test('subtraction with borrow (carry clear)', () => {
    // CLC; LDA #$50; SBC #$20 => $50 - $20 - 1 = $2F
    loadProgram(0x8000, [0x18, 0xA9, 0x50, 0xE9, 0x20]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x2F);
  });

  test('clears carry on underflow', () => {
    // SEC; LDA #$10; SBC #$20
    loadProgram(0x8000, [0x38, 0xA9, 0x10, 0xE9, 0x20]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xF0);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('signed overflow detection', () => {
    // SEC; LDA #$80; SBC #$01 => 0x7F (positive from negative = overflow)
    loadProgram(0x8000, [0x38, 0xA9, 0x80, 0xE9, 0x01]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x7F);
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(true);
  });

  test('equal values produce zero', () => {
    // SEC; LDA #$42; SBC #$42
    loadProgram(0x8000, [0x38, 0xA9, 0x42, 0xE9, 0x42]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });
});

// ============================================================
// 4. Logic: AND, ORA, EOR
// ============================================================
describe('AND', () => {
  test('immediate mode', () => {
    // LDA #$FF; AND #$0F
    loadProgram(0x8000, [0xA9, 0xFF, 0x29, 0x0F]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x0F);
  });

  test('sets Z flag when result is zero', () => {
    // LDA #$F0; AND #$0F
    loadProgram(0x8000, [0xA9, 0xF0, 0x29, 0x0F]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('sets N flag', () => {
    // LDA #$FF; AND #$80
    loadProgram(0x8000, [0xA9, 0xFF, 0x29, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

describe('ORA', () => {
  test('immediate mode', () => {
    // LDA #$F0; ORA #$0F
    loadProgram(0x8000, [0xA9, 0xF0, 0x09, 0x0F]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xFF);
  });

  test('sets N flag when result is negative', () => {
    // LDA #$00; ORA #$80
    loadProgram(0x8000, [0xA9, 0x00, 0x09, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('zero OR zero is zero', () => {
    // LDA #$00; ORA #$00
    loadProgram(0x8000, [0xA9, 0x00, 0x09, 0x00]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });
});

describe('EOR', () => {
  test('immediate mode', () => {
    // LDA #$FF; EOR #$0F
    loadProgram(0x8000, [0xA9, 0xFF, 0x49, 0x0F]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xF0);
  });

  test('XOR with same value produces zero', () => {
    // LDA #$AA; EOR #$AA
    loadProgram(0x8000, [0xA9, 0xAA, 0x49, 0xAA]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('sets N flag', () => {
    // LDA #$00; EOR #$80
    loadProgram(0x8000, [0xA9, 0x00, 0x49, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

// ============================================================
// 5. Shifts: ASL, LSR, ROL, ROR
// ============================================================
describe('ASL', () => {
  test('accumulator mode', () => {
    // LDA #$01; ASL A
    loadProgram(0x8000, [0xA9, 0x01, 0x0A]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x02);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('accumulator mode sets carry', () => {
    // LDA #$80; ASL A
    loadProgram(0x8000, [0xA9, 0x80, 0x0A]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('memory mode (zero page)', () => {
    memory[0x10] = 0x41;
    loadProgram(0x8000, [0x06, 0x10]); // ASL $10
    cpu.step();
    expect(memory[0x10]).toBe(0x82);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('memory mode sets carry from bit 7', () => {
    memory[0x10] = 0xC0;
    loadProgram(0x8000, [0x06, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });
});

describe('LSR', () => {
  test('accumulator mode', () => {
    // LDA #$04; LSR A
    loadProgram(0x8000, [0xA9, 0x04, 0x4A]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x02);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('accumulator mode sets carry from bit 0', () => {
    // LDA #$01; LSR A
    loadProgram(0x8000, [0xA9, 0x01, 0x4A]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('memory mode (zero page)', () => {
    memory[0x10] = 0x82;
    loadProgram(0x8000, [0x46, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0x41);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('always clears N flag', () => {
    // LDA #$FF; LSR A
    loadProgram(0x8000, [0xA9, 0xFF, 0x4A]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x7F);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });
});

describe('ROL', () => {
  test('accumulator mode without carry', () => {
    // CLC; LDA #$55; ROL A
    loadProgram(0x8000, [0x18, 0xA9, 0x55, 0x2A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xAA);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('accumulator mode with carry in', () => {
    // SEC; LDA #$55; ROL A => bit 0 gets carry
    loadProgram(0x8000, [0x38, 0xA9, 0x55, 0x2A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xAB);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('sets carry from bit 7', () => {
    // CLC; LDA #$80; ROL A
    loadProgram(0x8000, [0x18, 0xA9, 0x80, 0x2A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('memory mode (zero page)', () => {
    memory[0x10] = 0x80;
    // CLC; ROL $10
    loadProgram(0x8000, [0x18, 0x26, 0x10]);
    cpu.step(); cpu.step();
    expect(memory[0x10]).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });
});

describe('ROR', () => {
  test('accumulator mode without carry', () => {
    // CLC; LDA #$02; ROR A
    loadProgram(0x8000, [0x18, 0xA9, 0x02, 0x6A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x01);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('accumulator mode with carry in', () => {
    // SEC; LDA #$00; ROR A => bit 7 gets carry
    loadProgram(0x8000, [0x38, 0xA9, 0x00, 0x6A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('sets carry from bit 0', () => {
    // CLC; LDA #$01; ROR A
    loadProgram(0x8000, [0x18, 0xA9, 0x01, 0x6A]);
    cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('memory mode (zero page)', () => {
    memory[0x10] = 0x01;
    // CLC; ROR $10
    loadProgram(0x8000, [0x18, 0x66, 0x10]);
    cpu.step(); cpu.step();
    expect(memory[0x10]).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });
});

// ============================================================
// 6. Compare: CMP, CPX, CPY
// ============================================================
describe('CMP', () => {
  test('equal values: Z=1, C=1', () => {
    // LDA #$42; CMP #$42
    loadProgram(0x8000, [0xA9, 0x42, 0xC9, 0x42]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });

  test('A > M: Z=0, C=1', () => {
    // LDA #$50; CMP #$20
    loadProgram(0x8000, [0xA9, 0x50, 0xC9, 0x20]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('A < M: Z=0, C=0, N depends on result', () => {
    // LDA #$20; CMP #$50
    loadProgram(0x8000, [0xA9, 0x20, 0xC9, 0x50]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true); // 0x20-0x50 = 0xD0 -> N set
  });
});

describe('CPX', () => {
  test('equal values', () => {
    // LDX #$10; CPX #$10
    loadProgram(0x8000, [0xA2, 0x10, 0xE0, 0x10]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('X > M', () => {
    // LDX #$50; CPX #$20
    loadProgram(0x8000, [0xA2, 0x50, 0xE0, 0x20]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
  });

  test('X < M', () => {
    // LDX #$10; CPX #$20
    loadProgram(0x8000, [0xA2, 0x10, 0xE0, 0x20]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
  });
});

describe('CPY', () => {
  test('equal values', () => {
    // LDY #$10; CPY #$10
    loadProgram(0x8000, [0xA0, 0x10, 0xC0, 0x10]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('Y > M', () => {
    // LDY #$80; CPY #$40
    loadProgram(0x8000, [0xA0, 0x80, 0xC0, 0x40]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('Y < M', () => {
    // LDY #$05; CPY #$FF
    loadProgram(0x8000, [0xA0, 0x05, 0xC0, 0xFF]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });
});

// ============================================================
// 7. Branch instructions
// ============================================================
describe('Branch instructions', () => {
  test('BEQ taken when Z=1', () => {
    // LDA #$00; BEQ +$02 (skip 2 bytes)
    loadProgram(0x8000, [0xA9, 0x00, 0xF0, 0x02, 0xA9, 0x01, 0xA9, 0x42]);
    cpu.step(); // LDA #$00 -> Z=1
    cpu.step(); // BEQ -> should branch forward 2 bytes
    cpu.step(); // should execute LDA #$42, not LDA #$01
    expect(cpu.a).toBe(0x42);
  });

  test('BEQ not taken when Z=0', () => {
    // LDA #$01; BEQ +$02
    loadProgram(0x8000, [0xA9, 0x01, 0xF0, 0x02, 0xA9, 0x42]);
    cpu.step(); // LDA #$01 -> Z=0
    cpu.step(); // BEQ -> not taken
    cpu.step(); // should execute LDA #$42 (next instruction after BEQ)
    expect(cpu.a).toBe(0x42);
  });

  test('BNE taken when Z=0', () => {
    // LDA #$01; BNE +$02
    loadProgram(0x8000, [0xA9, 0x01, 0xD0, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // LDA #$01
    cpu.step(); // BNE -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BNE not taken when Z=1', () => {
    // LDA #$00; BNE +$02
    loadProgram(0x8000, [0xA9, 0x00, 0xD0, 0x02, 0xA9, 0x42]);
    cpu.step(); // LDA #$00 -> Z=1
    cpu.step(); // BNE -> not taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BCC taken when C=0', () => {
    // CLC; BCC +$02
    loadProgram(0x8000, [0x18, 0x90, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // CLC
    cpu.step(); // BCC -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BCS taken when C=1', () => {
    // SEC; BCS +$02
    loadProgram(0x8000, [0x38, 0xB0, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // SEC
    cpu.step(); // BCS -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BMI taken when N=1', () => {
    // LDA #$80; BMI +$02
    loadProgram(0x8000, [0xA9, 0x80, 0x30, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // LDA #$80 -> N=1
    cpu.step(); // BMI -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BPL taken when N=0', () => {
    // LDA #$01; BPL +$02
    loadProgram(0x8000, [0xA9, 0x01, 0x10, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // LDA #$01 -> N=0
    cpu.step(); // BPL -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('backward branch', () => {
    // LDA #$00; INX; BNE -$03 (back to INX). After first pass X=1, second pass X=2 then next
    // Actually, let's test backward branching simpler:
    // At $8000: LDX #$02
    // At $8002: DEX       (X becomes 1, then 0)
    // At $8003: BNE $FD   (branch back to $8002 when Z=0)
    // After loop: X=0
    loadProgram(0x8000, [0xA2, 0x02, 0xCA, 0xD0, 0xFD]);
    cpu.step(); // LDX #$02
    cpu.step(); // DEX -> X=1, Z=0
    cpu.step(); // BNE -> taken, back to DEX
    cpu.step(); // DEX -> X=0, Z=1
    cpu.step(); // BNE -> not taken
    expect(cpu.x).toBe(0);
  });

  test('branch taken adds 1 extra cycle', () => {
    // LDA #$01; BNE +$00 (branch to next instruction, same page)
    loadProgram(0x8000, [0xA9, 0x01, 0xD0, 0x00]);
    cpu.step(); // LDA
    const cycles = cpu.step(); // BNE taken, same page
    expect(cycles).toBe(3); // 2 base + 1 for taken
  });

  test('branch taken crossing page adds 2 extra cycles', () => {
    // Place BNE at $80FE so after reading operand (at $80FF), PC=$8100
    // Branch backward with offset $FD (-3) -> target = $8100 + (-3) = $80FD (page $80 != page $81)
    loadProgram(0x80FC, [0xA9, 0x01, 0xD0, 0xFD]);
    cpu.step(); // LDA
    const cycles = cpu.step(); // BNE taken, page cross ($8100 -> $80FD)
    expect(cycles).toBe(4); // 2 base + 1 taken + 1 page cross
  });
});

// ============================================================
// 8. Jump: JMP, JSR/RTS
// ============================================================
describe('JMP', () => {
  test('absolute', () => {
    // JMP $1234
    loadProgram(0x8000, [0x4C, 0x34, 0x12]);
    cpu.step();
    expect(cpu.pc).toBe(0x1234);
  });

  test('indirect', () => {
    memory[0x1234] = 0x00;
    memory[0x1235] = 0x40;
    // JMP ($1234)
    loadProgram(0x8000, [0x6C, 0x34, 0x12]);
    cpu.step();
    expect(cpu.pc).toBe(0x4000);
  });

  test('indirect page boundary bug', () => {
    // When pointer low byte is $FF, high byte wraps within page
    // JMP ($10FF) should read low from $10FF and high from $1000 (not $1100)
    memory[0x10FF] = 0x34;
    memory[0x1100] = 0x56; // this should NOT be used
    memory[0x1000] = 0x12; // this SHOULD be used (page boundary bug)
    loadProgram(0x8000, [0x6C, 0xFF, 0x10]);
    cpu.step();
    expect(cpu.pc).toBe(0x1234);
  });
});

describe('JSR / RTS', () => {
  test('JSR pushes return address - 1 and jumps', () => {
    // JSR $1234 at $8000 -> pushes $8002 (return - 1)
    loadProgram(0x8000, [0x20, 0x34, 0x12]);
    const spBefore = cpu.sp;
    cpu.step();
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.sp).toBe(spBefore - 2); // pushed 2 bytes
    // Check pushed address (should be $8002 = PC after JSR - 1)
    const lo = memory[0x0100 | ((cpu.sp + 1) & 0xFF)];
    const hi = memory[0x0100 | ((cpu.sp + 2) & 0xFF)];
    expect((hi << 8) | lo).toBe(0x8002);
  });

  test('RTS pops return address and adds 1', () => {
    // Set up: JSR $9000, then at $9000 have RTS
    memory[0x9000] = 0x60; // RTS
    loadProgram(0x8000, [0x20, 0x00, 0x90, 0xA9, 0x42]); // JSR $9000; LDA #$42
    cpu.step(); // JSR $9000
    expect(cpu.pc).toBe(0x9000);
    cpu.step(); // RTS
    expect(cpu.pc).toBe(0x8003); // return address ($8002) + 1
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });
});

// ============================================================
// 9. Stack: PHA/PLA, PHP/PLP
// ============================================================
describe('PHA / PLA', () => {
  test('PHA pushes A onto stack', () => {
    // LDA #$42; PHA
    loadProgram(0x8000, [0xA9, 0x42, 0x48]);
    cpu.step(); cpu.step();
    expect(memory[0x01FD]).toBe(0x42); // SP starts at $FD, push goes to $FD then decrements
  });

  test('PLA pulls A from stack and updates flags', () => {
    // LDA #$42; PHA; LDA #$00; PLA
    loadProgram(0x8000, [0xA9, 0x42, 0x48, 0xA9, 0x00, 0x68]);
    cpu.step(); // LDA #$42
    cpu.step(); // PHA
    cpu.step(); // LDA #$00
    expect(cpu.a).toBe(0x00);
    cpu.step(); // PLA
    expect(cpu.a).toBe(0x42);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });

  test('PLA sets Z flag when pulling zero', () => {
    // LDA #$00; PHA; LDA #$FF; PLA
    loadProgram(0x8000, [0xA9, 0x00, 0x48, 0xA9, 0xFF, 0x68]);
    cpu.step(); cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('PLA sets N flag when pulling negative', () => {
    // LDA #$80; PHA; LDA #$00; PLA
    loadProgram(0x8000, [0xA9, 0x80, 0x48, 0xA9, 0x00, 0x68]);
    cpu.step(); cpu.step(); cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

describe('PHP / PLP', () => {
  test('PHP pushes status with B and U flags set', () => {
    loadProgram(0x8000, [0x08]); // PHP
    cpu.status = 0x00;
    cpu.step();
    // Should push with B (0x10) and U (0x20) set
    expect(memory[0x01FD]).toBe(0x30);
  });

  test('PLP pulls status, clears B, sets U', () => {
    // Push a known value, then PLP
    loadProgram(0x8000, [0xA9, 0xFF, 0x48, 0x28]); // LDA #$FF; PHA; PLP
    cpu.step(); // LDA #$FF
    cpu.step(); // PHA (push $FF)
    cpu.step(); // PLP -> status = ($FF & ~0x10) | 0x20 = 0xEF
    expect(cpu.status).toBe(0xEF);
    expect(cpu.getFlag(StatusFlag.Break)).toBe(false);
    expect(cpu.getFlag(StatusFlag.Unused)).toBe(true);
  });
});

// ============================================================
// 10. Inc/Dec: INC, DEC, INX, INY, DEX, DEY
// ============================================================
describe('INC', () => {
  test('increments memory value', () => {
    memory[0x10] = 0x05;
    loadProgram(0x8000, [0xE6, 0x10]); // INC $10
    cpu.step();
    expect(memory[0x10]).toBe(0x06);
  });

  test('wraps from $FF to $00', () => {
    memory[0x10] = 0xFF;
    loadProgram(0x8000, [0xE6, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('sets N flag when result is negative', () => {
    memory[0x10] = 0x7F;
    loadProgram(0x8000, [0xE6, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

describe('DEC', () => {
  test('decrements memory value', () => {
    memory[0x10] = 0x05;
    loadProgram(0x8000, [0xC6, 0x10]); // DEC $10
    cpu.step();
    expect(memory[0x10]).toBe(0x04);
  });

  test('wraps from $00 to $FF', () => {
    memory[0x10] = 0x00;
    loadProgram(0x8000, [0xC6, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0xFF);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('sets Z flag when result is zero', () => {
    memory[0x10] = 0x01;
    loadProgram(0x8000, [0xC6, 0x10]);
    cpu.step();
    expect(memory[0x10]).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });
});

describe('INX / DEX', () => {
  test('INX increments X', () => {
    loadProgram(0x8000, [0xA2, 0x05, 0xE8]); // LDX #$05; INX
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x06);
  });

  test('INX wraps from $FF to $00', () => {
    loadProgram(0x8000, [0xA2, 0xFF, 0xE8]);
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('DEX decrements X', () => {
    loadProgram(0x8000, [0xA2, 0x05, 0xCA]); // LDX #$05; DEX
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x04);
  });

  test('DEX wraps from $00 to $FF', () => {
    loadProgram(0x8000, [0xA2, 0x00, 0xCA]);
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0xFF);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

describe('INY / DEY', () => {
  test('INY increments Y', () => {
    loadProgram(0x8000, [0xA0, 0x05, 0xC8]); // LDY #$05; INY
    cpu.step(); cpu.step();
    expect(cpu.y).toBe(0x06);
  });

  test('INY wraps from $FF to $00', () => {
    loadProgram(0x8000, [0xA0, 0xFF, 0xC8]);
    cpu.step(); cpu.step();
    expect(cpu.y).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('DEY decrements Y', () => {
    loadProgram(0x8000, [0xA0, 0x05, 0x88]); // LDY #$05; DEY
    cpu.step(); cpu.step();
    expect(cpu.y).toBe(0x04);
  });

  test('DEY wraps from $00 to $FF', () => {
    loadProgram(0x8000, [0xA0, 0x00, 0x88]);
    cpu.step(); cpu.step();
    expect(cpu.y).toBe(0xFF);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

// ============================================================
// 11. Transfer: TAX, TAY, TXA, TYA, TSX, TXS
// ============================================================
describe('Transfers', () => {
  test('TAX transfers A to X', () => {
    loadProgram(0x8000, [0xA9, 0x42, 0xAA]); // LDA #$42; TAX
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x42);
  });

  test('TAX sets Z flag', () => {
    loadProgram(0x8000, [0xA9, 0x00, 0xAA]); // LDA #$00; TAX
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x00);
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
  });

  test('TAX sets N flag', () => {
    loadProgram(0x8000, [0xA9, 0x80, 0xAA]); // LDA #$80; TAX
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0x80);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('TAY transfers A to Y', () => {
    loadProgram(0x8000, [0xA9, 0x33, 0xA8]); // LDA #$33; TAY
    cpu.step(); cpu.step();
    expect(cpu.y).toBe(0x33);
  });

  test('TXA transfers X to A', () => {
    loadProgram(0x8000, [0xA2, 0x55, 0x8A]); // LDX #$55; TXA
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x55);
  });

  test('TYA transfers Y to A', () => {
    loadProgram(0x8000, [0xA0, 0x66, 0x98]); // LDY #$66; TYA
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0x66);
  });

  test('TSX transfers SP to X', () => {
    loadProgram(0x8000, [0xBA]); // TSX
    cpu.step();
    expect(cpu.x).toBe(0xFD);
  });

  test('TSX sets N flag for high SP values', () => {
    loadProgram(0x8000, [0xBA]); // TSX
    cpu.step();
    expect(cpu.x).toBe(0xFD);
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });

  test('TXS transfers X to SP (no flag changes)', () => {
    loadProgram(0x8000, [0xA2, 0xFF, 0x9A]); // LDX #$FF; TXS
    const statusBefore = cpu.status;
    cpu.step(); // LDX sets flags
    cpu.step(); // TXS should NOT change flags
    expect(cpu.sp).toBe(0xFF);
    // TXS does not affect flags; LDX #$FF sets N=1,Z=0
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
  });
});

// ============================================================
// 12. Flag operations
// ============================================================
describe('Flag operations', () => {
  test('CLC clears carry', () => {
    loadProgram(0x8000, [0x38, 0x18]); // SEC; CLC
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(false);
  });

  test('SEC sets carry', () => {
    loadProgram(0x8000, [0x18, 0x38]); // CLC; SEC
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Carry)).toBe(true);
  });

  test('CLI clears interrupt disable', () => {
    loadProgram(0x8000, [0x58]); // CLI
    cpu.step();
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(false);
  });

  test('SEI sets interrupt disable', () => {
    loadProgram(0x8000, [0x58, 0x78]); // CLI; SEI
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(true);
  });

  test('CLV clears overflow', () => {
    cpu.setFlag(StatusFlag.Overflow, true);
    loadProgram(0x8000, [0xB8]); // CLV
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(false);
  });

  test('CLD clears decimal', () => {
    cpu.setFlag(StatusFlag.Decimal, true);
    loadProgram(0x8000, [0xD8]); // CLD
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Decimal)).toBe(false);
  });

  test('SED sets decimal', () => {
    loadProgram(0x8000, [0xF8]); // SED
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Decimal)).toBe(true);
  });
});

// ============================================================
// 13. Interrupts: NMI, IRQ
// ============================================================
describe('NMI', () => {
  test('NMI handler pushes PC and status, jumps to NMI vector', () => {
    memory[0xFFFA] = 0x00;
    memory[0xFFFB] = 0x90;
    memory[0x9000] = 0xA9; // LDA #$42 at NMI handler
    memory[0x9001] = 0x42;
    loadProgram(0x8000, [0xEA, 0xEA]); // NOP; NOP

    const spBefore = cpu.sp;
    const pcBefore = cpu.pc; // $8000
    cpu.triggerNMI();
    const cycles = cpu.step(); // handles NMI

    expect(cpu.pc).toBe(0x9000);
    expect(cpu.sp).toBe(spBefore - 3); // pushed PC (2 bytes) + status (1 byte)
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(true);
    expect(cycles).toBe(7);
  });

  test('NMI pushes status with U set and B clear', () => {
    memory[0xFFFA] = 0x00;
    memory[0xFFFB] = 0x90;
    loadProgram(0x8000, [0xEA]);
    cpu.status = 0x00; // clear all flags
    cpu.triggerNMI();
    cpu.step();

    // Status byte pushed to stack should have U set (0x20) and B clear (0x10 cleared)
    const pushedStatus = memory[0x0100 | ((cpu.sp + 1) & 0xFF)];
    expect(pushedStatus & 0x20).toBe(0x20); // U set
    expect(pushedStatus & 0x10).toBe(0x00); // B clear
  });
});

describe('IRQ', () => {
  test('IRQ handler when I flag is clear', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xA0;
    loadProgram(0x8000, [0x58, 0xEA]); // CLI; NOP

    cpu.step(); // CLI - clears I flag
    cpu.triggerIRQ();
    const cycles = cpu.step(); // handles IRQ

    expect(cpu.pc).toBe(0xA000);
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(true);
    expect(cycles).toBe(7);
  });

  test('IRQ blocked when I flag is set', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xA0;
    loadProgram(0x8000, [0xEA, 0xA9, 0x42]); // NOP; LDA #$42

    // I flag is set after reset (status = 0x24)
    cpu.triggerIRQ();
    cpu.step(); // NOP (IRQ blocked)
    cpu.step(); // LDA #$42

    expect(cpu.a).toBe(0x42);
    expect(cpu.pc).not.toBe(0xA000);
  });

  test('IRQ pushes status with U set and B clear', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xA0;
    loadProgram(0x8000, [0x58, 0xEA]); // CLI; NOP
    cpu.step(); // CLI
    cpu.triggerIRQ();
    cpu.step();

    const pushedStatus = memory[0x0100 | ((cpu.sp + 1) & 0xFF)];
    expect(pushedStatus & 0x20).toBe(0x20); // U set
    expect(pushedStatus & 0x10).toBe(0x00); // B clear
  });

  test('NMI has priority over IRQ', () => {
    memory[0xFFFA] = 0x00;
    memory[0xFFFB] = 0x90;
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xA0;
    loadProgram(0x8000, [0x58, 0xEA]); // CLI; NOP

    cpu.step(); // CLI
    cpu.triggerNMI();
    cpu.triggerIRQ();
    cpu.step(); // should handle NMI first

    expect(cpu.pc).toBe(0x9000); // NMI vector, not IRQ
  });
});

// ============================================================
// 14. BRK instruction
// ============================================================
describe('BRK', () => {
  test('pushes PC+2 and status, jumps to IRQ vector', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xB0;
    // BRK at $8000
    loadProgram(0x8000, [0x00, 0x00]); // BRK + padding byte
    const spBefore = cpu.sp;
    cpu.step();

    expect(cpu.pc).toBe(0xB000);
    expect(cpu.sp).toBe(spBefore - 3); // pushed PC (2 bytes) + status (1 byte)
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(true);
  });

  test('pushes status with B and U flags set', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xB0;
    loadProgram(0x8000, [0x00, 0x00]);
    cpu.status = 0x24;
    cpu.step();

    const pushedStatus = memory[0x0100 | ((cpu.sp + 1) & 0xFF)];
    expect(pushedStatus & 0x30).toBe(0x30); // Both B and U set
  });

  test('skips padding byte after BRK', () => {
    // BRK at $8000 increments PC past opcode ($8001) then past padding byte ($8002)
    // pushes $8002. Return from interrupt should go to $8002
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xB0;
    memory[0xB000] = 0x40; // RTI
    loadProgram(0x8000, [0x00, 0xFF, 0xA9, 0x42]); // BRK; (pad); LDA #$42
    cpu.step(); // BRK -> jumps to $B000
    cpu.step(); // RTI -> returns to $8002
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });
});

// ============================================================
// 15. Status flags: Z and N set correctly for various ops
// ============================================================
describe('Status flags', () => {
  test('Z flag cleared when result is non-zero', () => {
    loadProgram(0x8000, [0xA9, 0x00, 0xA9, 0x01]); // LDA #$00; LDA #$01
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
  });

  test('N flag cleared when result is positive', () => {
    loadProgram(0x8000, [0xA9, 0x80, 0xA9, 0x01]); // LDA #$80; LDA #$01
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true);
    cpu.step();
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(false);
  });

  test('BIT sets Z based on A AND M, copies M bits 7,6 to N,V', () => {
    // LDA #$00; BIT $10 (where $10 contains $C0)
    memory[0x10] = 0xC0; // bits 7,6 set
    loadProgram(0x8000, [0xA9, 0x00, 0x24, 0x10]);
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(true);    // A AND M = 0
    expect(cpu.getFlag(StatusFlag.Negative)).toBe(true); // bit 7 of M
    expect(cpu.getFlag(StatusFlag.Overflow)).toBe(true); // bit 6 of M
  });

  test('BIT with non-zero result clears Z', () => {
    memory[0x10] = 0xFF;
    loadProgram(0x8000, [0xA9, 0x01, 0x24, 0x10]); // LDA #$01; BIT $10
    cpu.step(); cpu.step();
    expect(cpu.getFlag(StatusFlag.Zero)).toBe(false);
  });
});

// ============================================================
// RTI
// ============================================================
describe('RTI', () => {
  test('restores status and PC from stack', () => {
    memory[0xFFFE] = 0x00;
    memory[0xFFFF] = 0xC0;
    memory[0xC000] = 0x40; // RTI
    // CLI at $8000 (1 byte); NOP at $8001 (1 byte); LDA #$42 at $8002
    loadProgram(0x8000, [0x58, 0xEA, 0xA9, 0x42]); // CLI; NOP; LDA #$42
    cpu.step(); // CLI -> PC=$8001, I flag cleared
    cpu.step(); // NOP -> PC=$8002
    cpu.triggerIRQ();
    cpu.step(); // IRQ -> pushes PC ($8002) and status, jumps to $C000
    cpu.step(); // RTI -> restores status and PC
    expect(cpu.pc).toBe(0x8002);
    expect(cpu.getFlag(StatusFlag.InterruptDisable)).toBe(false);
  });
});

// ============================================================
// Cycle counting
// ============================================================
describe('Cycle counting', () => {
  test('LDA immediate takes 2 cycles', () => {
    loadProgram(0x8000, [0xA9, 0x42]);
    const cycles = cpu.step();
    expect(cycles).toBe(2);
  });

  test('LDA zero page takes 3 cycles', () => {
    loadProgram(0x8000, [0xA5, 0x10]);
    const cycles = cpu.step();
    expect(cycles).toBe(3);
  });

  test('LDA absolute takes 4 cycles', () => {
    loadProgram(0x8000, [0xAD, 0x00, 0x10]);
    const cycles = cpu.step();
    expect(cycles).toBe(4);
  });

  test('LDA absolute,X with page cross takes 5 cycles', () => {
    // LDX #$FF; LDA $10FF,X -> crosses page to $11FE
    loadProgram(0x8000, [0xA2, 0xFF, 0xBD, 0xFF, 0x10]);
    cpu.step(); // LDX #$FF
    const cycles = cpu.step(); // LDA $10FF,X
    expect(cycles).toBe(5); // 4 + 1 page cross
  });

  test('LDA absolute,X without page cross takes 4 cycles', () => {
    // LDX #$01; LDA $1000,X -> no page cross
    loadProgram(0x8000, [0xA2, 0x01, 0xBD, 0x00, 0x10]);
    cpu.step(); // LDX #$01
    const cycles = cpu.step(); // LDA $1001
    expect(cycles).toBe(4);
  });

  test('JSR takes 6 cycles', () => {
    loadProgram(0x8000, [0x20, 0x00, 0x90]);
    const cycles = cpu.step();
    expect(cycles).toBe(6);
  });

  test('NOP takes 2 cycles', () => {
    loadProgram(0x8000, [0xEA]);
    const cycles = cpu.step();
    expect(cycles).toBe(2);
  });
});

// ============================================================
// Stall cycles
// ============================================================
describe('Stall cycles', () => {
  test('stallCycles delays execution', () => {
    loadProgram(0x8000, [0xEA]); // NOP
    cpu.stallCycles(3);
    expect(cpu.step()).toBe(1); // stall cycle 1
    expect(cpu.step()).toBe(1); // stall cycle 2
    expect(cpu.step()).toBe(1); // stall cycle 3
    expect(cpu.step()).toBe(2); // NOP executes now
  });
});

// ============================================================
// Addressing mode: zero page wrapping
// ============================================================
describe('Zero page wrapping', () => {
  test('ZeroPageX wraps within zero page', () => {
    // LDX #$FF; LDA $80,X => address is ($80 + $FF) & 0xFF = $7F
    memory[0x7F] = 0xAB;
    loadProgram(0x8000, [0xA2, 0xFF, 0xB5, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xAB);
  });

  test('ZeroPageY wraps within zero page', () => {
    // LDY #$FF; LDX $80,Y => address is ($80 + $FF) & 0xFF = $7F
    memory[0x7F] = 0xCD;
    loadProgram(0x8000, [0xA0, 0xFF, 0xB6, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.x).toBe(0xCD);
  });

  test('IndexedIndirect (X) wraps within zero page', () => {
    // LDX #$FF; LDA ($80,X) => pointer at ($80 + $FF) & $FF = $7F
    memory[0x7F] = 0x00;
    memory[0x80] = 0x30; // pointer -> $3000
    memory[0x3000] = 0xEE;
    loadProgram(0x8000, [0xA2, 0xFF, 0xA1, 0x80]);
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xEE);
  });

  test('IndirectIndexed (Y) zero page pointer wraps', () => {
    // LDA ($FF),Y => read pointer from $FF and ($FF+1)&$FF = $00
    memory[0xFF] = 0x00;
    memory[0x00] = 0x20; // pointer -> $2000
    memory[0x2003] = 0xDD;
    loadProgram(0x8000, [0xA0, 0x03, 0xB1, 0xFF]); // LDY #$03; LDA ($FF),Y
    cpu.step(); cpu.step();
    expect(cpu.a).toBe(0xDD);
  });
});

// ============================================================
// BVC / BVS
// ============================================================
describe('BVC / BVS', () => {
  test('BVC taken when V=0', () => {
    loadProgram(0x8000, [0xB8, 0x50, 0x02, 0xA9, 0x99, 0xA9, 0x42]); // CLV; BVC +$02; LDA #$99; LDA #$42
    cpu.step(); // CLV
    cpu.step(); // BVC -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });

  test('BVS taken when V=1', () => {
    // Create overflow: CLC; LDA #$7F; ADC #$01 -> sets V
    loadProgram(0x8000, [0x18, 0xA9, 0x7F, 0x69, 0x01, 0x70, 0x02, 0xA9, 0x99, 0xA9, 0x42]);
    cpu.step(); // CLC
    cpu.step(); // LDA #$7F
    cpu.step(); // ADC #$01 -> V=1
    cpu.step(); // BVS -> taken
    cpu.step(); // LDA #$42
    expect(cpu.a).toBe(0x42);
  });
});

// ============================================================
// NOP
// ============================================================
describe('NOP', () => {
  test('does not change any state', () => {
    loadProgram(0x8000, [0xA9, 0x42, 0xEA]); // LDA #$42; NOP
    cpu.step(); // LDA #$42
    const a = cpu.a;
    const x = cpu.x;
    const y = cpu.y;
    const sp = cpu.sp;
    const status = cpu.status;
    cpu.step(); // NOP
    expect(cpu.a).toBe(a);
    expect(cpu.x).toBe(x);
    expect(cpu.y).toBe(y);
    expect(cpu.sp).toBe(sp);
    expect(cpu.status).toBe(status);
  });
});

// ============================================================
// Integration: small programs
// ============================================================
describe('Integration', () => {
  test('counting loop: sum 1 to 5', () => {
    // A = 0, X = 5
    // loop: CLC; ADC #$01; DEX; BNE loop
    loadProgram(0x8000, [
      0xA9, 0x00,       // LDA #$00
      0xA2, 0x05,       // LDX #$05
      // loop ($8004):
      0x18,             // CLC
      0x69, 0x01,       // ADC #$01
      0xCA,             // DEX
      0xD0, 0xFB,       // BNE -5 (back to $8004)
      0xEA,             // NOP (exit point)
    ]);

    // Run enough steps: 2 setup + 5 iterations * 4 instructions + 1 final BNE not taken
    for (let i = 0; i < 25; i++) {
      cpu.step();
    }

    expect(cpu.a).toBe(5);
    expect(cpu.x).toBe(0);
  });

  test('subroutine call and return', () => {
    // Main: JSR $9000; stores result
    // Sub at $9000: LDA #$42; RTS
    memory[0x9000] = 0xA9; // LDA #$42
    memory[0x9001] = 0x42;
    memory[0x9002] = 0x60; // RTS

    loadProgram(0x8000, [
      0x20, 0x00, 0x90,  // JSR $9000
      0x85, 0x10,         // STA $10
    ]);

    cpu.step(); // JSR $9000
    cpu.step(); // LDA #$42
    cpu.step(); // RTS
    cpu.step(); // STA $10

    expect(memory[0x10]).toBe(0x42);
  });

  test('nested subroutine calls', () => {
    // Main: JSR $9000
    // Sub1 at $9000: LDX #$10; JSR $9010; RTS
    // Sub2 at $9010: LDY #$20; RTS
    memory[0x9000] = 0xA2; memory[0x9001] = 0x10; // LDX #$10
    memory[0x9002] = 0x20; memory[0x9003] = 0x10; memory[0x9004] = 0x90; // JSR $9010
    memory[0x9005] = 0x60; // RTS

    memory[0x9010] = 0xA0; memory[0x9011] = 0x20; // LDY #$20
    memory[0x9012] = 0x60; // RTS

    loadProgram(0x8000, [
      0x20, 0x00, 0x90,  // JSR $9000
      0xEA,               // NOP (landing pad)
    ]);

    cpu.step(); // JSR $9000
    cpu.step(); // LDX #$10
    cpu.step(); // JSR $9010
    cpu.step(); // LDY #$20
    cpu.step(); // RTS (from sub2, back to $9005)
    cpu.step(); // RTS (from sub1, back to $8003)
    expect(cpu.pc).toBe(0x8003);
    expect(cpu.x).toBe(0x10);
    expect(cpu.y).toBe(0x20);
  });
});

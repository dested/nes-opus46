import { AddressingMode } from './addressing';
import { StatusFlag } from '../types';

export interface InstructionContext {
  cpu: CPUState;
  address: number;
  mode: AddressingMode;
  read: (addr: number) => number;
  write: (addr: number, value: number) => void;
  pageCrossed: boolean;
  extraCycles: number;
}

export interface CPUState {
  a: number;
  x: number;
  y: number;
  sp: number;
  pc: number;
  status: number;
  getFlag(flag: number): boolean;
  setFlag(flag: number, value: boolean): void;
  updateZN(value: number): void;
  pushByte(value: number): void;
  pullByte(): number;
  pushWord(value: number): void;
  pullWord(): number;
}

// --- Helpers ---

function compare(cpu: CPUState, register: number, value: number): void {
  const result = (register - value) & 0xFFFF;
  cpu.setFlag(StatusFlag.Carry, register >= value);
  cpu.setFlag(StatusFlag.Zero, (result & 0xFF) === 0);
  cpu.setFlag(StatusFlag.Negative, (result & 0x80) !== 0);
}

function branch(ctx: InstructionContext, condition: boolean): void {
  if (condition) {
    ctx.extraCycles += 1;
    if (ctx.pageCrossed) {
      ctx.extraCycles += 1;
    }
    ctx.cpu.pc = ctx.address;
  }
}

// --- Instruction implementations ---

export function adc(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address);
  const carry = ctx.cpu.getFlag(StatusFlag.Carry) ? 1 : 0;
  const sum = ctx.cpu.a + val + carry;
  ctx.cpu.setFlag(StatusFlag.Carry, sum > 0xFF);
  ctx.cpu.setFlag(StatusFlag.Overflow, ((ctx.cpu.a ^ sum) & (val ^ sum) & 0x80) !== 0);
  ctx.cpu.a = sum & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function and(ctx: InstructionContext): void {
  ctx.cpu.a &= ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function asl(ctx: InstructionContext): void {
  if (ctx.mode === AddressingMode.Accumulator) {
    ctx.cpu.setFlag(StatusFlag.Carry, (ctx.cpu.a & 0x80) !== 0);
    ctx.cpu.a = (ctx.cpu.a << 1) & 0xFF;
    ctx.cpu.updateZN(ctx.cpu.a);
  } else {
    let val = ctx.read(ctx.address);
    ctx.cpu.setFlag(StatusFlag.Carry, (val & 0x80) !== 0);
    val = (val << 1) & 0xFF;
    ctx.write(ctx.address, val);
    ctx.cpu.updateZN(val);
  }
}

export function bcc(ctx: InstructionContext): void {
  branch(ctx, !ctx.cpu.getFlag(StatusFlag.Carry));
}

export function bcs(ctx: InstructionContext): void {
  branch(ctx, ctx.cpu.getFlag(StatusFlag.Carry));
}

export function beq(ctx: InstructionContext): void {
  branch(ctx, ctx.cpu.getFlag(StatusFlag.Zero));
}

export function bit(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address);
  ctx.cpu.setFlag(StatusFlag.Zero, (ctx.cpu.a & val) === 0);
  ctx.cpu.setFlag(StatusFlag.Overflow, (val & 0x40) !== 0);
  ctx.cpu.setFlag(StatusFlag.Negative, (val & 0x80) !== 0);
}

export function bmi(ctx: InstructionContext): void {
  branch(ctx, ctx.cpu.getFlag(StatusFlag.Negative));
}

export function bne(ctx: InstructionContext): void {
  branch(ctx, !ctx.cpu.getFlag(StatusFlag.Zero));
}

export function bpl(ctx: InstructionContext): void {
  branch(ctx, !ctx.cpu.getFlag(StatusFlag.Negative));
}

export function brk(ctx: InstructionContext): void {
  ctx.cpu.pc = (ctx.cpu.pc + 1) & 0xFFFF; // skip padding byte
  ctx.cpu.pushWord(ctx.cpu.pc);
  ctx.cpu.pushByte(ctx.cpu.status | 0x30); // B and U set
  ctx.cpu.setFlag(StatusFlag.InterruptDisable, true);
  ctx.cpu.pc = ctx.read(0xFFFE) | (ctx.read(0xFFFF) << 8);
}

export function bvc(ctx: InstructionContext): void {
  branch(ctx, !ctx.cpu.getFlag(StatusFlag.Overflow));
}

export function bvs(ctx: InstructionContext): void {
  branch(ctx, ctx.cpu.getFlag(StatusFlag.Overflow));
}

export function clc(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.Carry, false);
}

export function cld(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.Decimal, false);
}

export function cli(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.InterruptDisable, false);
}

export function clv(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.Overflow, false);
}

export function cmp(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address);
  compare(ctx.cpu, ctx.cpu.a, val);
}

export function cpx(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address);
  compare(ctx.cpu, ctx.cpu.x, val);
}

export function cpy(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address);
  compare(ctx.cpu, ctx.cpu.y, val);
}

export function dec(ctx: InstructionContext): void {
  const val = (ctx.read(ctx.address) - 1) & 0xFF;
  ctx.write(ctx.address, val);
  ctx.cpu.updateZN(val);
}

export function dex(ctx: InstructionContext): void {
  ctx.cpu.x = (ctx.cpu.x - 1) & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.x);
}

export function dey(ctx: InstructionContext): void {
  ctx.cpu.y = (ctx.cpu.y - 1) & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.y);
}

export function eor(ctx: InstructionContext): void {
  ctx.cpu.a ^= ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function inc(ctx: InstructionContext): void {
  const val = (ctx.read(ctx.address) + 1) & 0xFF;
  ctx.write(ctx.address, val);
  ctx.cpu.updateZN(val);
}

export function inx(ctx: InstructionContext): void {
  ctx.cpu.x = (ctx.cpu.x + 1) & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.x);
}

export function iny(ctx: InstructionContext): void {
  ctx.cpu.y = (ctx.cpu.y + 1) & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.y);
}

export function jmp(ctx: InstructionContext): void {
  ctx.cpu.pc = ctx.address;
}

export function jsr(ctx: InstructionContext): void {
  ctx.cpu.pushWord((ctx.cpu.pc - 1) & 0xFFFF);
  ctx.cpu.pc = ctx.address;
}

export function lda(ctx: InstructionContext): void {
  ctx.cpu.a = ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function ldx(ctx: InstructionContext): void {
  ctx.cpu.x = ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.x);
}

export function ldy(ctx: InstructionContext): void {
  ctx.cpu.y = ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.y);
}

export function lsr(ctx: InstructionContext): void {
  if (ctx.mode === AddressingMode.Accumulator) {
    ctx.cpu.setFlag(StatusFlag.Carry, (ctx.cpu.a & 0x01) !== 0);
    ctx.cpu.a = (ctx.cpu.a >> 1) & 0xFF;
    ctx.cpu.updateZN(ctx.cpu.a);
  } else {
    let val = ctx.read(ctx.address);
    ctx.cpu.setFlag(StatusFlag.Carry, (val & 0x01) !== 0);
    val = (val >> 1) & 0xFF;
    ctx.write(ctx.address, val);
    ctx.cpu.updateZN(val);
  }
}

export function nop(_ctx: InstructionContext): void {
  // No operation
}

export function ora(ctx: InstructionContext): void {
  ctx.cpu.a |= ctx.read(ctx.address);
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function pha(ctx: InstructionContext): void {
  ctx.cpu.pushByte(ctx.cpu.a);
}

export function php(ctx: InstructionContext): void {
  ctx.cpu.pushByte(ctx.cpu.status | 0x30); // B and U flags set
}

export function pla(ctx: InstructionContext): void {
  ctx.cpu.a = ctx.cpu.pullByte();
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function plp(ctx: InstructionContext): void {
  ctx.cpu.status = (ctx.cpu.pullByte() & ~0x10) | 0x20; // Clear B, set U
}

export function rol(ctx: InstructionContext): void {
  const oldCarry = ctx.cpu.getFlag(StatusFlag.Carry) ? 1 : 0;
  if (ctx.mode === AddressingMode.Accumulator) {
    ctx.cpu.setFlag(StatusFlag.Carry, (ctx.cpu.a & 0x80) !== 0);
    ctx.cpu.a = ((ctx.cpu.a << 1) | oldCarry) & 0xFF;
    ctx.cpu.updateZN(ctx.cpu.a);
  } else {
    let val = ctx.read(ctx.address);
    ctx.cpu.setFlag(StatusFlag.Carry, (val & 0x80) !== 0);
    val = ((val << 1) | oldCarry) & 0xFF;
    ctx.write(ctx.address, val);
    ctx.cpu.updateZN(val);
  }
}

export function ror(ctx: InstructionContext): void {
  const oldCarry = ctx.cpu.getFlag(StatusFlag.Carry) ? 0x80 : 0;
  if (ctx.mode === AddressingMode.Accumulator) {
    ctx.cpu.setFlag(StatusFlag.Carry, (ctx.cpu.a & 0x01) !== 0);
    ctx.cpu.a = ((ctx.cpu.a >> 1) | oldCarry) & 0xFF;
    ctx.cpu.updateZN(ctx.cpu.a);
  } else {
    let val = ctx.read(ctx.address);
    ctx.cpu.setFlag(StatusFlag.Carry, (val & 0x01) !== 0);
    val = ((val >> 1) | oldCarry) & 0xFF;
    ctx.write(ctx.address, val);
    ctx.cpu.updateZN(val);
  }
}

export function rti(ctx: InstructionContext): void {
  ctx.cpu.status = (ctx.cpu.pullByte() & ~0x10) | 0x20; // Clear B, set U
  ctx.cpu.pc = ctx.cpu.pullWord();
}

export function rts(ctx: InstructionContext): void {
  ctx.cpu.pc = (ctx.cpu.pullWord() + 1) & 0xFFFF;
}

export function sbc(ctx: InstructionContext): void {
  const val = ctx.read(ctx.address) ^ 0xFF;
  const carry = ctx.cpu.getFlag(StatusFlag.Carry) ? 1 : 0;
  const sum = ctx.cpu.a + val + carry;
  ctx.cpu.setFlag(StatusFlag.Carry, sum > 0xFF);
  ctx.cpu.setFlag(StatusFlag.Overflow, ((ctx.cpu.a ^ sum) & (val ^ sum) & 0x80) !== 0);
  ctx.cpu.a = sum & 0xFF;
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function sec(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.Carry, true);
}

export function sed(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.Decimal, true);
}

export function sei(ctx: InstructionContext): void {
  ctx.cpu.setFlag(StatusFlag.InterruptDisable, true);
}

export function sta(ctx: InstructionContext): void {
  ctx.write(ctx.address, ctx.cpu.a);
}

export function stx(ctx: InstructionContext): void {
  ctx.write(ctx.address, ctx.cpu.x);
}

export function sty(ctx: InstructionContext): void {
  ctx.write(ctx.address, ctx.cpu.y);
}

export function tax(ctx: InstructionContext): void {
  ctx.cpu.x = ctx.cpu.a;
  ctx.cpu.updateZN(ctx.cpu.x);
}

export function tay(ctx: InstructionContext): void {
  ctx.cpu.y = ctx.cpu.a;
  ctx.cpu.updateZN(ctx.cpu.y);
}

export function tsx(ctx: InstructionContext): void {
  ctx.cpu.x = ctx.cpu.sp;
  ctx.cpu.updateZN(ctx.cpu.x);
}

export function txa(ctx: InstructionContext): void {
  ctx.cpu.a = ctx.cpu.x;
  ctx.cpu.updateZN(ctx.cpu.a);
}

export function txs(ctx: InstructionContext): void {
  ctx.cpu.sp = ctx.cpu.x;
}

export function tya(ctx: InstructionContext): void {
  ctx.cpu.a = ctx.cpu.y;
  ctx.cpu.updateZN(ctx.cpu.a);
}

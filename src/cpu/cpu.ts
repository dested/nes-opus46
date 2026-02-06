import { StatusFlag } from '../types';
import { AddressingMode, AddressResult } from './addressing';
import { InstructionContext } from './instructions';
import { opcodeTable } from './opcodes';

export class CPU {
  a: number = 0;
  x: number = 0;
  y: number = 0;
  sp: number = 0xFD;
  pc: number = 0;
  status: number = 0x24; // I flag set, U flag set

  private totalCycles: number = 0;
  private stallCyclesCount: number = 0;
  private nmiPending: boolean = false;
  private irqPending: boolean = false;

  read: (address: number) => number = () => 0;
  write: (address: number, value: number) => void = () => {};

  reset(): void {
    this.a = 0;
    this.x = 0;
    this.y = 0;
    this.sp = 0xFD;
    this.status = 0x24;
    this.pc = this.read(0xFFFC) | (this.read(0xFFFD) << 8);
    this.totalCycles = 7;
    this.stallCyclesCount = 0;
    this.nmiPending = false;
    this.irqPending = false;
  }

  step(): number {
    if (this.stallCyclesCount > 0) {
      this.stallCyclesCount--;
      this.totalCycles++;
      return 1;
    }

    if (this.nmiPending) {
      this.handleNMI();
      this.nmiPending = false;
      return 7;
    }

    if (this.irqPending && !this.getFlag(StatusFlag.InterruptDisable)) {
      this.handleIRQ();
      return 7;
    }

    const opcode = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xFFFF;

    const entry = opcodeTable[opcode];
    if (!entry) {
      this.totalCycles += 2;
      return 2;
    }

    const resolved = this.resolveAddress(entry.mode);

    const ctx: InstructionContext = {
      cpu: this as any,
      address: resolved.address,
      mode: entry.mode,
      read: (addr: number) => this.read(addr),
      write: (addr: number, val: number) => this.write(addr, val),
      pageCrossed: resolved.pageCrossed,
      extraCycles: 0,
    };

    entry.execute(ctx);

    let cycles = entry.cycles + ctx.extraCycles;
    if (entry.pageCrossPenalty && resolved.pageCrossed) {
      cycles++;
    }

    this.totalCycles += cycles;
    return cycles;
  }

  private resolveAddress(mode: AddressingMode): AddressResult {
    switch (mode) {
      case AddressingMode.Implied:
      case AddressingMode.Accumulator:
        return { address: 0, pageCrossed: false };

      case AddressingMode.Immediate: {
        const addr = this.pc;
        this.pc = (this.pc + 1) & 0xFFFF;
        return { address: addr, pageCrossed: false };
      }

      case AddressingMode.ZeroPage: {
        const addr = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return { address: addr, pageCrossed: false };
      }

      case AddressingMode.ZeroPageX: {
        const base = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const addr = (base + this.x) & 0xFF;
        return { address: addr, pageCrossed: false };
      }

      case AddressingMode.ZeroPageY: {
        const base = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const addr = (base + this.y) & 0xFF;
        return { address: addr, pageCrossed: false };
      }

      case AddressingMode.Absolute: {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        return { address: (hi << 8) | lo, pageCrossed: false };
      }

      case AddressingMode.AbsoluteX: {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const base = (hi << 8) | lo;
        const addr = (base + this.x) & 0xFFFF;
        const pageCrossed = ((base & 0xFF00) !== (addr & 0xFF00));
        return { address: addr, pageCrossed };
      }

      case AddressingMode.AbsoluteY: {
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const base = (hi << 8) | lo;
        const addr = (base + this.y) & 0xFFFF;
        const pageCrossed = ((base & 0xFF00) !== (addr & 0xFF00));
        return { address: addr, pageCrossed };
      }

      case AddressingMode.Indirect: {
        // JMP indirect bug: if low byte of pointer is 0xFF, wraps within same page
        const lo = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const hi = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const pointer = (hi << 8) | lo;
        const effLo = this.read(pointer);
        // Bug: high byte wraps within same page
        const effHi = this.read((pointer & 0xFF00) | ((pointer + 1) & 0x00FF));
        return { address: (effHi << 8) | effLo, pageCrossed: false };
      }

      case AddressingMode.IndexedIndirect: {
        // (Indirect,X): ZP pointer, X offset, wraps in ZP
        const base = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const pointer = (base + this.x) & 0xFF;
        const lo = this.read(pointer);
        const hi = this.read((pointer + 1) & 0xFF);
        return { address: (hi << 8) | lo, pageCrossed: false };
      }

      case AddressingMode.IndirectIndexed: {
        // (Indirect),Y: ZP pointer, then add Y
        const base = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        const lo = this.read(base);
        const hi = this.read((base + 1) & 0xFF);
        const pointer = (hi << 8) | lo;
        const addr = (pointer + this.y) & 0xFFFF;
        const pageCrossed = ((pointer & 0xFF00) !== (addr & 0xFF00));
        return { address: addr, pageCrossed };
      }

      case AddressingMode.Relative: {
        let offset = this.read(this.pc);
        this.pc = (this.pc + 1) & 0xFFFF;
        // Convert to signed
        if (offset >= 0x80) {
          offset -= 0x100;
        }
        const addr = (this.pc + offset) & 0xFFFF;
        const pageCrossed = ((this.pc & 0xFF00) !== (addr & 0xFF00));
        return { address: addr, pageCrossed };
      }

      default:
        return { address: 0, pageCrossed: false };
    }
  }

  triggerNMI(): void {
    this.nmiPending = true;
  }

  triggerIRQ(): void {
    this.irqPending = true;
  }

  clearIRQ(): void {
    this.irqPending = false;
  }

  stallCycles(n: number): void {
    this.stallCyclesCount += n;
  }

  getTotalCycles(): number {
    return this.totalCycles;
  }

  // Flag helpers
  getFlag(flag: number): boolean {
    return (this.status & flag) !== 0;
  }

  setFlag(flag: number, value: boolean): void {
    if (value) {
      this.status |= flag;
    } else {
      this.status &= ~flag;
    }
  }

  updateZN(value: number): void {
    this.setFlag(StatusFlag.Zero, (value & 0xFF) === 0);
    this.setFlag(StatusFlag.Negative, (value & 0x80) !== 0);
  }

  // Stack operations
  pushByte(value: number): void {
    this.write(0x0100 | this.sp, value);
    this.sp = (this.sp - 1) & 0xFF;
  }

  pullByte(): number {
    this.sp = (this.sp + 1) & 0xFF;
    return this.read(0x0100 | this.sp);
  }

  pushWord(value: number): void {
    this.pushByte((value >> 8) & 0xFF);
    this.pushByte(value & 0xFF);
  }

  pullWord(): number {
    const lo = this.pullByte();
    const hi = this.pullByte();
    return (hi << 8) | lo;
  }

  private handleNMI(): void {
    this.pushWord(this.pc);
    this.pushByte((this.status | 0x20) & ~0x10); // U set, B clear
    this.setFlag(StatusFlag.InterruptDisable, true);
    this.pc = this.read(0xFFFA) | (this.read(0xFFFB) << 8);
    this.totalCycles += 7;
  }

  private handleIRQ(): void {
    this.pushWord(this.pc);
    this.pushByte((this.status | 0x20) & ~0x10); // U set, B clear
    this.setFlag(StatusFlag.InterruptDisable, true);
    this.pc = this.read(0xFFFE) | (this.read(0xFFFF) << 8);
    this.totalCycles += 7;
  }
}

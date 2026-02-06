import { MirrorMode } from '../types';
import { RomInfo } from '../rom';
import { Mapper } from './mapper';

export function createMapper4(romInfo: RomInfo): Mapper {
  const prgRom = romInfo.prgRom;
  const chrRom = romInfo.chrRom;
  const chrIsRam = romInfo.chrIsRam;
  const prgRam = new Uint8Array(8192);

  const prgBankCount = prgRom.length / 0x2000; // Number of 8KB PRG banks
  const chrBankCount = chrRom.length / 0x400;   // Number of 1KB CHR banks

  // Bank registers R0-R7
  const bankRegisters = new Uint8Array(8);

  // Control state
  let bankSelect = 0;     // $8000 write: which register to update + mode bits
  let mirrorMode = romInfo.mirrorMode;
  let prgRamEnable = true;

  // IRQ state
  let irqLatch = 0;
  let irqCounter = 0;
  let irqReloadPending = false;
  let irqEnabled = false;
  let irqActive = false;

  // Pre-computed bank offsets (byte offsets into ROM arrays)
  const prgOffsets = new Int32Array(4); // 4 x 8KB PRG windows
  const chrOffsets = new Int32Array(8); // 8 x 1KB CHR windows

  function updatePrgOffsets(): void {
    const prgMode = (bankSelect >> 6) & 1;
    const secondToLast = (prgBankCount - 2) * 0x2000;
    const last = (prgBankCount - 1) * 0x2000;

    if (prgMode === 0) {
      // Mode 0: $8000=R6, $A000=R7, $C000=(-2), $E000=(-1)
      prgOffsets[0] = (bankRegisters[6] % prgBankCount) * 0x2000;
      prgOffsets[1] = (bankRegisters[7] % prgBankCount) * 0x2000;
      prgOffsets[2] = secondToLast;
      prgOffsets[3] = last;
    } else {
      // Mode 1: $8000=(-2), $A000=R7, $C000=R6, $E000=(-1)
      prgOffsets[0] = secondToLast;
      prgOffsets[1] = (bankRegisters[7] % prgBankCount) * 0x2000;
      prgOffsets[2] = (bankRegisters[6] % prgBankCount) * 0x2000;
      prgOffsets[3] = last;
    }
  }

  function updateChrOffsets(): void {
    const chrInversion = (bankSelect >> 7) & 1;

    if (chrInversion === 0) {
      // R0: 2KB at $0000, R1: 2KB at $0800, R2-R5: 1KB at $1000-$1C00
      chrOffsets[0] = ((bankRegisters[0] & 0xFE) % chrBankCount) * 0x400;
      chrOffsets[1] = ((bankRegisters[0] | 0x01) % chrBankCount) * 0x400;
      chrOffsets[2] = ((bankRegisters[1] & 0xFE) % chrBankCount) * 0x400;
      chrOffsets[3] = ((bankRegisters[1] | 0x01) % chrBankCount) * 0x400;
      chrOffsets[4] = (bankRegisters[2] % chrBankCount) * 0x400;
      chrOffsets[5] = (bankRegisters[3] % chrBankCount) * 0x400;
      chrOffsets[6] = (bankRegisters[4] % chrBankCount) * 0x400;
      chrOffsets[7] = (bankRegisters[5] % chrBankCount) * 0x400;
    } else {
      // Inverted: R2-R5: 1KB at $0000-$0C00, R0: 2KB at $1000, R1: 2KB at $1800
      chrOffsets[0] = (bankRegisters[2] % chrBankCount) * 0x400;
      chrOffsets[1] = (bankRegisters[3] % chrBankCount) * 0x400;
      chrOffsets[2] = (bankRegisters[4] % chrBankCount) * 0x400;
      chrOffsets[3] = (bankRegisters[5] % chrBankCount) * 0x400;
      chrOffsets[4] = ((bankRegisters[0] & 0xFE) % chrBankCount) * 0x400;
      chrOffsets[5] = ((bankRegisters[0] | 0x01) % chrBankCount) * 0x400;
      chrOffsets[6] = ((bankRegisters[1] & 0xFE) % chrBankCount) * 0x400;
      chrOffsets[7] = ((bankRegisters[1] | 0x01) % chrBankCount) * 0x400;
    }
  }

  // Initialize offsets
  updatePrgOffsets();
  updateChrOffsets();

  return {
    cpuRead(address: number): number {
      if (address >= 0x8000) {
        const bank = (address - 0x8000) >> 13; // 0-3
        const offset = address & 0x1FFF;
        return prgRom[prgOffsets[bank] + offset];
      }
      if (address >= 0x6000) {
        if (prgRamEnable) {
          return prgRam[address - 0x6000];
        }
        return 0;
      }
      return 0;
    },

    cpuWrite(address: number, value: number): void {
      if (address >= 0x8000) {
        const isEven = (address & 1) === 0;

        if (address < 0xA000) {
          if (isEven) {
            // $8000: Bank select
            bankSelect = value;
            updatePrgOffsets();
            updateChrOffsets();
          } else {
            // $8001: Bank data
            const reg = bankSelect & 0x07;
            bankRegisters[reg] = value;
            if (reg < 6) {
              updateChrOffsets();
            } else {
              updatePrgOffsets();
            }
          }
        } else if (address < 0xC000) {
          if (isEven) {
            // $A000: Mirroring
            if (romInfo.mirrorMode !== MirrorMode.FourScreen) {
              mirrorMode = (value & 1) ? MirrorMode.Horizontal : MirrorMode.Vertical;
            }
          } else {
            // $A001: PRG RAM protect
            prgRamEnable = (value & 0x80) !== 0;
          }
        } else if (address < 0xE000) {
          if (isEven) {
            // $C000: IRQ latch
            irqLatch = value;
          } else {
            // $C001: IRQ reload
            irqCounter = 0;
            irqReloadPending = true;
          }
        } else {
          if (isEven) {
            // $E000: IRQ disable + acknowledge
            irqEnabled = false;
            irqActive = false;
          } else {
            // $E001: IRQ enable
            irqEnabled = true;
          }
        }
      } else if (address >= 0x6000) {
        if (prgRamEnable) {
          prgRam[address - 0x6000] = value;
        }
      }
    },

    ppuRead(address: number): number {
      if (address < 0x2000) {
        const bank = address >> 10; // 0-7
        const offset = address & 0x3FF;
        return chrRom[chrOffsets[bank] + offset];
      }
      return 0;
    },

    ppuWrite(address: number, value: number): void {
      if (address < 0x2000 && chrIsRam) {
        const bank = address >> 10;
        const offset = address & 0x3FF;
        chrRom[chrOffsets[bank] + offset] = value;
      }
    },

    getMirrorMode(): MirrorMode {
      return mirrorMode;
    },

    scanlineTick(): void {
      if (irqCounter === 0 || irqReloadPending) {
        irqCounter = irqLatch;
        irqReloadPending = false;
      } else {
        irqCounter--;
      }

      if (irqCounter === 0 && irqEnabled) {
        irqActive = true;
      }
    },

    irqPending(): boolean {
      return irqActive;
    },
  };
}

import { MirrorMode } from '../types';
import { RomInfo } from '../rom';
import { Mapper } from './mapper';

export function createMapper1(romInfo: RomInfo): Mapper {
  const prgRom = romInfo.prgRom;
  const chrRom = romInfo.chrRom;
  const chrIsRam = romInfo.chrIsRam;
  const prgRam = new Uint8Array(8192);

  const prgBankCount16 = prgRom.length / 0x4000; // Number of 16KB PRG banks
  const chrBankCount4 = chrRom.length / 0x1000;   // Number of 4KB CHR banks

  // Shift register (serial port)
  let shiftRegister = 0;
  let shiftCount = 0;

  // Internal registers (written via serial port)
  let regControl = 0x0C;  // Power-on: PRG mode 3 (fix last bank at $C000)
  let regChrBank0 = 0;
  let regChrBank1 = 0;
  let regPrgBank = 0;

  // Pre-computed bank offsets
  let prgOffset0 = 0;                                   // $8000-$BFFF
  let prgOffset1 = (prgBankCount16 - 1) * 0x4000;       // $C000-$FFFF (last bank)
  let chrOffset0 = 0;                                    // $0000-$0FFF
  let chrOffset1 = chrBankCount4 > 1 ? 0x1000 : 0;      // $1000-$1FFF
  let mirrorMode = romInfo.mirrorMode;

  function updatePrgOffsets(): void {
    const prgMode = (regControl >> 2) & 3;
    const bank = regPrgBank & 0x0F;

    switch (prgMode) {
      case 0:
      case 1:
        // 32KB mode: switch 32KB at $8000, ignore low bit
        {
          const bank32 = (bank >> 1) % prgBankCount16;
          prgOffset0 = bank32 * 0x4000;
          prgOffset1 = (bank32 + 1) % prgBankCount16 * 0x4000;
        }
        break;
      case 2:
        // Fix first bank at $8000, switch 16KB at $C000
        prgOffset0 = 0;
        prgOffset1 = (bank % prgBankCount16) * 0x4000;
        break;
      case 3:
        // Switch 16KB at $8000, fix last bank at $C000
        prgOffset0 = (bank % prgBankCount16) * 0x4000;
        prgOffset1 = (prgBankCount16 - 1) * 0x4000;
        break;
    }
  }

  function updateChrOffsets(): void {
    const chrMode = (regControl >> 4) & 1;

    if (chrMode === 0) {
      // 8KB mode: switch 8KB at $0000, ignore low bit of bank
      if (chrBankCount4 > 0) {
        const bank8 = (regChrBank0 >> 1) % (chrBankCount4 >> 1);
        chrOffset0 = bank8 * 0x2000;
        chrOffset1 = bank8 * 0x2000 + 0x1000;
      }
    } else {
      // 4KB mode: two independent 4KB banks
      if (chrBankCount4 > 0) {
        chrOffset0 = (regChrBank0 % chrBankCount4) * 0x1000;
        chrOffset1 = (regChrBank1 % chrBankCount4) * 0x1000;
      }
    }
  }

  function updateMirroring(): void {
    switch (regControl & 3) {
      case 0:
        mirrorMode = MirrorMode.SingleScreenLower;
        break;
      case 1:
        mirrorMode = MirrorMode.SingleScreenUpper;
        break;
      case 2:
        mirrorMode = MirrorMode.Vertical;
        break;
      case 3:
        mirrorMode = MirrorMode.Horizontal;
        break;
    }
  }

  // Initialize
  updatePrgOffsets();
  updateChrOffsets();
  updateMirroring();

  function writeRegister(address: number, value: number): void {
    const reg = (address >> 13) & 3; // 0=$8000, 1=$A000, 2=$C000, 3=$E000

    switch (reg) {
      case 0:
        regControl = value;
        updateMirroring();
        updatePrgOffsets();
        updateChrOffsets();
        break;
      case 1:
        regChrBank0 = value;
        updateChrOffsets();
        break;
      case 2:
        regChrBank1 = value;
        updateChrOffsets();
        break;
      case 3:
        regPrgBank = value;
        updatePrgOffsets();
        break;
    }
  }

  return {
    cpuRead(address: number): number {
      if (address >= 0xC000) {
        return prgRom[prgOffset1 + (address & 0x3FFF)];
      }
      if (address >= 0x8000) {
        return prgRom[prgOffset0 + (address & 0x3FFF)];
      }
      if (address >= 0x6000) {
        return prgRam[address - 0x6000];
      }
      return 0;
    },

    cpuWrite(address: number, value: number): void {
      if (address >= 0x8000) {
        // Bit 7 set: reset shift register
        if (value & 0x80) {
          shiftRegister = 0;
          shiftCount = 0;
          // Reset sets PRG mode to 3 (fix last bank)
          regControl |= 0x0C;
          updatePrgOffsets();
          return;
        }

        // Shift in bit 0
        shiftRegister |= (value & 1) << shiftCount;
        shiftCount++;

        if (shiftCount === 5) {
          writeRegister(address, shiftRegister);
          shiftRegister = 0;
          shiftCount = 0;
        }
      } else if (address >= 0x6000) {
        prgRam[address - 0x6000] = value;
      }
    },

    ppuRead(address: number): number {
      if (address < 0x1000) {
        return chrRom[chrOffset0 + address];
      }
      if (address < 0x2000) {
        return chrRom[chrOffset1 + (address & 0xFFF)];
      }
      return 0;
    },

    ppuWrite(address: number, value: number): void {
      if (chrIsRam) {
        if (address < 0x1000) {
          chrRom[chrOffset0 + address] = value;
        } else if (address < 0x2000) {
          chrRom[chrOffset1 + (address & 0xFFF)] = value;
        }
      }
    },

    getMirrorMode(): MirrorMode {
      return mirrorMode;
    },
  };
}

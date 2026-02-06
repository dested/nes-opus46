import { MirrorMode } from '../types';
import { RomInfo } from '../rom';
import { Mapper } from './mapper';

export function createMapper0(romInfo: RomInfo): Mapper {
  const prgRom = romInfo.prgRom;
  const chrRom = romInfo.chrRom;
  const chrIsRam = romInfo.chrIsRam;
  const mirrorMode = romInfo.mirrorMode;
  const prgRam = new Uint8Array(8192); // 8KB PRG RAM at $6000-$7FFF
  const prgMask = prgRom.length - 1; // Works for both 16KB (NROM-128) and 32KB (NROM-256)

  return {
    cpuRead(address: number): number {
      if (address >= 0x8000) {
        return prgRom[(address - 0x8000) & prgMask];
      }
      if (address >= 0x6000) {
        return prgRam[address - 0x6000];
      }
      return 0;
    },

    cpuWrite(address: number, value: number): void {
      if (address >= 0x6000 && address < 0x8000) {
        prgRam[address - 0x6000] = value;
      }
      // PRG ROM is not writable
    },

    ppuRead(address: number): number {
      if (address < 0x2000) {
        return chrRom[address];
      }
      return 0;
    },

    ppuWrite(address: number, value: number): void {
      if (address < 0x2000 && chrIsRam) {
        chrRom[address] = value;
      }
    },

    getMirrorMode(): MirrorMode {
      return mirrorMode;
    },
  };
}

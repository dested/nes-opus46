import { MirrorMode } from './types';

export interface RomInfo {
  prgRom: Uint8Array;
  chrRom: Uint8Array;
  mapper: number;
  mirrorMode: MirrorMode;
  hasBatteryRam: boolean;
  chrIsRam: boolean;
}

export function parseRom(data: Uint8Array): RomInfo {
  // Validate magic number "NES\x1A"
  if (
    data[0] !== 0x4e ||
    data[1] !== 0x45 ||
    data[2] !== 0x53 ||
    data[3] !== 0x1a
  ) {
    throw new Error('Invalid iNES ROM: bad magic number');
  }

  const prgRomBanks = data[4]; // 16KB units
  const chrRomBanks = data[5]; // 8KB units
  const flags6 = data[6];
  const flags7 = data[7];

  // Mapper number: low nibble from flags6, high nibble from flags7
  const mapper = (flags6 >> 4) | (flags7 & 0xf0);

  // Mirroring
  const fourScreen = (flags6 & 0x08) !== 0;
  let mirrorMode: MirrorMode;
  if (fourScreen) {
    mirrorMode = MirrorMode.FourScreen;
  } else {
    mirrorMode = (flags6 & 0x01) !== 0 ? MirrorMode.Vertical : MirrorMode.Horizontal;
  }

  // Battery-backed RAM
  const hasBatteryRam = (flags6 & 0x02) !== 0;

  // Trainer present
  const hasTrainer = (flags6 & 0x04) !== 0;

  // Calculate offsets
  let offset = 16; // Skip header
  if (hasTrainer) {
    offset += 512; // Skip trainer
  }

  // PRG ROM
  const prgRomSize = prgRomBanks * 16384;
  const prgRom = new Uint8Array(data.buffer, data.byteOffset + offset, prgRomSize);
  offset += prgRomSize;

  // CHR ROM (or CHR RAM if 0 banks)
  const chrIsRam = chrRomBanks === 0;
  let chrRom: Uint8Array;
  if (chrIsRam) {
    chrRom = new Uint8Array(8192); // 8KB CHR RAM
  } else {
    const chrRomSize = chrRomBanks * 8192;
    chrRom = new Uint8Array(data.buffer, data.byteOffset + offset, chrRomSize);
  }

  return {
    prgRom,
    chrRom,
    mapper,
    mirrorMode,
    hasBatteryRam,
    chrIsRam,
  };
}

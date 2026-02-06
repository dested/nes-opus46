import { describe, it, expect } from 'bun:test';
import { createMapper1 } from '../mapper1';
import { createMapper } from '../mapper';
import { MirrorMode } from '../../types';
import type { RomInfo } from '../../rom';

function makeRomInfo(overrides: Partial<RomInfo> = {}): RomInfo {
  const prgSize = overrides.prgRom?.length ?? 256 * 1024; // 256KB (16 x 16KB banks)
  const chrSize = overrides.chrRom?.length ?? 128 * 1024;  // 128KB (32 x 4KB banks)
  return {
    prgRom: overrides.prgRom ?? new Uint8Array(prgSize),
    chrRom: overrides.chrRom ?? new Uint8Array(chrSize),
    mapper: 1,
    mirrorMode: overrides.mirrorMode ?? MirrorMode.Horizontal,
    hasBatteryRam: overrides.hasBatteryRam ?? false,
    chrIsRam: overrides.chrIsRam ?? false,
  };
}

function fillPrgRom(size: number): Uint8Array {
  const rom = new Uint8Array(size);
  // Fill each 16KB bank with its bank number
  for (let bank = 0; bank < size / 0x4000; bank++) {
    for (let i = 0; i < 0x4000; i++) {
      rom[bank * 0x4000 + i] = bank;
    }
  }
  return rom;
}

function fillChrRom(size: number): Uint8Array {
  const rom = new Uint8Array(size);
  // Fill each 4KB bank with its bank number
  for (let bank = 0; bank < size / 0x1000; bank++) {
    for (let i = 0; i < 0x1000; i++) {
      rom[bank * 0x1000 + i] = bank;
    }
  }
  return rom;
}

/** Write a 5-bit value to an MMC1 register via the serial port. */
function serialWrite(mapper: ReturnType<typeof createMapper1>, address: number, value: number): void {
  for (let i = 0; i < 5; i++) {
    mapper.cpuWrite(address, (value >> i) & 1);
  }
}

describe('Mapper 1 (MMC1)', () => {
  describe('createMapper factory', () => {
    it('creates mapper 1 via createMapper', () => {
      const romInfo = makeRomInfo();
      const mapper = createMapper(romInfo);
      expect(mapper).toBeDefined();
      expect(mapper.cpuRead(0x8000)).toBeDefined();
    });
  });

  describe('shift register', () => {
    it('resets shift register when bit 7 is written', () => {
      const prgRom = fillPrgRom(256 * 1024);
      const mapper = createMapper1(makeRomInfo({ prgRom }));

      // Write 2 bits, then reset
      mapper.cpuWrite(0x8000, 0x01);
      mapper.cpuWrite(0x8000, 0x00);
      mapper.cpuWrite(0x8000, 0x80); // reset

      // Now do a full 5-bit write - should work from scratch
      // PRG mode 3 (fix last), switch bank 2 at $8000
      serialWrite(mapper, 0xE000, 2);
      expect(mapper.cpuRead(0x8000)).toBe(2);
    });
  });

  describe('PRG banking', () => {
    it('defaults to last bank at $C000 (PRG mode 3)', () => {
      const prgRom = fillPrgRom(256 * 1024); // 16 banks
      const mapper = createMapper1(makeRomInfo({ prgRom }));

      // Power-on: PRG mode 3, last bank fixed at $C000
      expect(mapper.cpuRead(0xC000)).toBe(15);
    });

    it('PRG mode 3: switch $8000, fix last at $C000', () => {
      const prgRom = fillPrgRom(256 * 1024); // 16 banks
      const mapper = createMapper1(makeRomInfo({ prgRom }));

      // Control: PRG mode 3 (bits 2-3 = 11), mirroring=0
      serialWrite(mapper, 0x8000, 0x0C);

      // Switch bank 5 at $8000
      serialWrite(mapper, 0xE000, 5);

      expect(mapper.cpuRead(0x8000)).toBe(5);
      expect(mapper.cpuRead(0xC000)).toBe(15); // last bank
    });

    it('PRG mode 2: fix first at $8000, switch $C000', () => {
      const prgRom = fillPrgRom(256 * 1024);
      const mapper = createMapper1(makeRomInfo({ prgRom }));

      // Control: PRG mode 2 (bits 2-3 = 10)
      serialWrite(mapper, 0x8000, 0x08);

      // Switch bank 7 at $C000
      serialWrite(mapper, 0xE000, 7);

      expect(mapper.cpuRead(0x8000)).toBe(0);  // first bank fixed
      expect(mapper.cpuRead(0xC000)).toBe(7);
    });

    it('PRG mode 0/1: 32KB switching', () => {
      const prgRom = fillPrgRom(256 * 1024);
      const mapper = createMapper1(makeRomInfo({ prgRom }));

      // Control: PRG mode 0 (bits 2-3 = 00)
      serialWrite(mapper, 0x8000, 0x00);

      // Bank register = 4 => bank pair 2 (banks 2, 3 consecutive)
      serialWrite(mapper, 0xE000, 4);

      expect(mapper.cpuRead(0x8000)).toBe(2);
      expect(mapper.cpuRead(0xC000)).toBe(3);
    });
  });

  describe('CHR banking', () => {
    it('8KB CHR mode (chrMode=0): switch full 8KB', () => {
      const chrRom = fillChrRom(128 * 1024);
      const mapper = createMapper1(makeRomInfo({ chrRom }));

      // Control: CHR mode 0 (bit 4 = 0), PRG mode 3
      serialWrite(mapper, 0x8000, 0x0C);

      // CHR bank 0 register = 6 => 8KB bank 3 (ignores low bit)
      serialWrite(mapper, 0xA000, 6);

      expect(mapper.ppuRead(0x0000)).toBe(6);
      expect(mapper.ppuRead(0x1000)).toBe(7);
    });

    it('4KB CHR mode (chrMode=1): two separate banks', () => {
      const chrRom = fillChrRom(128 * 1024);
      const mapper = createMapper1(makeRomInfo({ chrRom }));

      // Control: CHR mode 1 (bit 4 = 1), PRG mode 3
      serialWrite(mapper, 0x8000, 0x1C);

      // CHR bank 0 = 5
      serialWrite(mapper, 0xA000, 5);
      // CHR bank 1 = 10
      serialWrite(mapper, 0xC000, 10);

      expect(mapper.ppuRead(0x0000)).toBe(5);
      expect(mapper.ppuRead(0x1000)).toBe(10);
    });

    it('writes CHR RAM when chrIsRam is true', () => {
      const mapper = createMapper1(makeRomInfo({ chrIsRam: true, chrRom: new Uint8Array(8192) }));

      mapper.ppuWrite(0x0000, 0xAB);
      expect(mapper.ppuRead(0x0000)).toBe(0xAB);

      mapper.ppuWrite(0x1000, 0xCD);
      expect(mapper.ppuRead(0x1000)).toBe(0xCD);
    });

    it('does not write CHR ROM', () => {
      const chrRom = new Uint8Array(128 * 1024);
      const mapper = createMapper1(makeRomInfo({ chrRom, chrIsRam: false }));

      mapper.ppuWrite(0x0000, 0xAB);
      expect(mapper.ppuRead(0x0000)).toBe(0);
    });
  });

  describe('mirroring', () => {
    it('switches mirroring via control register', () => {
      const mapper = createMapper1(makeRomInfo());

      // Single screen lower (bits 0-1 = 00)
      serialWrite(mapper, 0x8000, 0x0C);
      expect(mapper.getMirrorMode()).toBe(MirrorMode.SingleScreenLower);

      // Single screen upper (bits 0-1 = 01)
      serialWrite(mapper, 0x8000, 0x0D);
      expect(mapper.getMirrorMode()).toBe(MirrorMode.SingleScreenUpper);

      // Vertical (bits 0-1 = 10)
      serialWrite(mapper, 0x8000, 0x0E);
      expect(mapper.getMirrorMode()).toBe(MirrorMode.Vertical);

      // Horizontal (bits 0-1 = 11)
      serialWrite(mapper, 0x8000, 0x0F);
      expect(mapper.getMirrorMode()).toBe(MirrorMode.Horizontal);
    });
  });

  describe('PRG RAM', () => {
    it('reads and writes PRG RAM at $6000-$7FFF', () => {
      const mapper = createMapper1(makeRomInfo());

      mapper.cpuWrite(0x6000, 0x42);
      expect(mapper.cpuRead(0x6000)).toBe(0x42);

      mapper.cpuWrite(0x7FFF, 0xAB);
      expect(mapper.cpuRead(0x7FFF)).toBe(0xAB);
    });
  });

  describe('Zelda-like config', () => {
    it('works with 128KB PRG + 8KB CHR RAM (Zelda layout)', () => {
      const prgRom = fillPrgRom(128 * 1024); // 8 x 16KB banks
      const mapper = createMapper1(makeRomInfo({
        prgRom,
        chrRom: new Uint8Array(8192),
        chrIsRam: true,
      }));

      // Default: bank 0 at $8000, last bank (7) at $C000
      expect(mapper.cpuRead(0x8000)).toBe(0);
      expect(mapper.cpuRead(0xC000)).toBe(7);

      // Switch to bank 3
      serialWrite(mapper, 0xE000, 3);
      expect(mapper.cpuRead(0x8000)).toBe(3);
      expect(mapper.cpuRead(0xC000)).toBe(7);

      // CHR RAM writes work
      mapper.ppuWrite(0x0100, 0xFF);
      expect(mapper.ppuRead(0x0100)).toBe(0xFF);

      // PRG RAM (battery-backed save)
      mapper.cpuWrite(0x6000, 0x01);
      mapper.cpuWrite(0x6001, 0x02);
      expect(mapper.cpuRead(0x6000)).toBe(0x01);
      expect(mapper.cpuRead(0x6001)).toBe(0x02);
    });
  });
});

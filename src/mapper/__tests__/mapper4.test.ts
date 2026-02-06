import { describe, it, expect } from 'bun:test';
import { createMapper4 } from '../mapper4';
import { createMapper } from '../mapper';
import { MirrorMode } from '../../types';
import type { RomInfo } from '../../rom';

function makeRomInfo(overrides: Partial<RomInfo> = {}): RomInfo {
  const prgSize = overrides.prgRom?.length ?? 256 * 1024; // 256KB default (32 x 8KB banks)
  const chrSize = overrides.chrRom?.length ?? 256 * 1024; // 256KB default (256 x 1KB banks)
  return {
    prgRom: overrides.prgRom ?? new Uint8Array(prgSize),
    chrRom: overrides.chrRom ?? new Uint8Array(chrSize),
    mapper: 4,
    mirrorMode: overrides.mirrorMode ?? MirrorMode.Vertical,
    hasBatteryRam: overrides.hasBatteryRam ?? false,
    chrIsRam: overrides.chrIsRam ?? false,
  };
}

function fillPrgRom(size: number): Uint8Array {
  const rom = new Uint8Array(size);
  // Fill each 8KB bank with its bank number
  for (let bank = 0; bank < size / 0x2000; bank++) {
    for (let i = 0; i < 0x2000; i++) {
      rom[bank * 0x2000 + i] = bank;
    }
  }
  return rom;
}

function fillChrRom(size: number): Uint8Array {
  const rom = new Uint8Array(size);
  // Fill each 1KB bank with its bank number
  for (let bank = 0; bank < size / 0x400; bank++) {
    for (let i = 0; i < 0x400; i++) {
      rom[bank * 0x400 + i] = bank;
    }
  }
  return rom;
}

describe('Mapper 4 (MMC3)', () => {
  describe('createMapper factory', () => {
    it('creates mapper 4 via createMapper', () => {
      const romInfo = makeRomInfo();
      const mapper = createMapper(romInfo);
      expect(mapper).toBeDefined();
      expect(mapper.scanlineTick).toBeDefined();
      expect(mapper.irqPending).toBeDefined();
    });
  });

  describe('PRG banking', () => {
    it('defaults to last two banks at $C000 and $E000', () => {
      const prgRom = fillPrgRom(256 * 1024); // 32 banks
      const mapper = createMapper4(makeRomInfo({ prgRom }));

      // $C000 should read from bank 30 (second-to-last)
      expect(mapper.cpuRead(0xC000)).toBe(30);
      // $E000 should read from bank 31 (last)
      expect(mapper.cpuRead(0xE000)).toBe(31);
    });

    it('switches R6 at $8000 in PRG mode 0', () => {
      const prgRom = fillPrgRom(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ prgRom }));

      // Select register 6, PRG mode 0
      mapper.cpuWrite(0x8000, 0x06); // bankSelect = 6, mode 0
      mapper.cpuWrite(0x8001, 5);    // R6 = bank 5

      expect(mapper.cpuRead(0x8000)).toBe(5);
    });

    it('switches R7 at $A000', () => {
      const prgRom = fillPrgRom(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ prgRom }));

      mapper.cpuWrite(0x8000, 0x07); // select R7
      mapper.cpuWrite(0x8001, 10);   // R7 = bank 10

      expect(mapper.cpuRead(0xA000)).toBe(10);
    });

    it('PRG mode 1 swaps $8000 and $C000', () => {
      const prgRom = fillPrgRom(256 * 1024); // 32 banks
      const mapper = createMapper4(makeRomInfo({ prgRom }));

      // Set R6 = bank 5
      mapper.cpuWrite(0x8000, 0x06);
      mapper.cpuWrite(0x8001, 5);

      // Switch to PRG mode 1 (bit 6 set)
      mapper.cpuWrite(0x8000, 0x46);

      // $8000 should now be second-to-last (bank 30)
      expect(mapper.cpuRead(0x8000)).toBe(30);
      // $C000 should now be R6 (bank 5)
      expect(mapper.cpuRead(0xC000)).toBe(5);
      // $E000 is always last
      expect(mapper.cpuRead(0xE000)).toBe(31);
    });
  });

  describe('CHR banking', () => {
    it('switches 2KB banks via R0/R1 (no inversion)', () => {
      const chrRom = fillChrRom(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ chrRom }));

      // R0 = 2KB at $0000 (selects 1KB bank, ANDed with 0xFE for 2KB alignment)
      mapper.cpuWrite(0x8000, 0x00); // select R0, CHR inversion 0
      mapper.cpuWrite(0x8001, 4);    // R0 = bank 4 (aligned to 4, so $0000=4, $0400=5)

      expect(mapper.ppuRead(0x0000)).toBe(4);
      expect(mapper.ppuRead(0x0400)).toBe(5);

      // R1 = 2KB at $0800
      mapper.cpuWrite(0x8000, 0x01);
      mapper.cpuWrite(0x8001, 8);

      expect(mapper.ppuRead(0x0800)).toBe(8);
      expect(mapper.ppuRead(0x0C00)).toBe(9);
    });

    it('switches 1KB banks via R2-R5 (no inversion)', () => {
      const chrRom = fillChrRom(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ chrRom }));

      mapper.cpuWrite(0x8000, 0x02); // R2
      mapper.cpuWrite(0x8001, 20);
      mapper.cpuWrite(0x8000, 0x03); // R3
      mapper.cpuWrite(0x8001, 21);
      mapper.cpuWrite(0x8000, 0x04); // R4
      mapper.cpuWrite(0x8001, 22);
      mapper.cpuWrite(0x8000, 0x05); // R5
      mapper.cpuWrite(0x8001, 23);

      expect(mapper.ppuRead(0x1000)).toBe(20);
      expect(mapper.ppuRead(0x1400)).toBe(21);
      expect(mapper.ppuRead(0x1800)).toBe(22);
      expect(mapper.ppuRead(0x1C00)).toBe(23);
    });

    it('CHR inversion swaps 2KB and 1KB regions', () => {
      const chrRom = fillChrRom(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ chrRom }));

      // Set banks with inversion = 0
      mapper.cpuWrite(0x8000, 0x00); // R0
      mapper.cpuWrite(0x8001, 4);
      mapper.cpuWrite(0x8000, 0x02); // R2
      mapper.cpuWrite(0x8001, 20);

      // Enable CHR inversion (bit 7)
      mapper.cpuWrite(0x8000, 0x80);

      // Now R2-R5 should be at $0000-$0FFF, R0/R1 at $1000-$1FFF
      expect(mapper.ppuRead(0x0000)).toBe(20); // R2 at $0000
      expect(mapper.ppuRead(0x1000)).toBe(4);  // R0 at $1000
    });
  });

  describe('mirroring', () => {
    it('defaults to ROM header mirroring', () => {
      const mapper = createMapper4(makeRomInfo({ mirrorMode: MirrorMode.Vertical }));
      expect(mapper.getMirrorMode()).toBe(MirrorMode.Vertical);
    });

    it('switches mirroring via $A000', () => {
      const mapper = createMapper4(makeRomInfo({ mirrorMode: MirrorMode.Vertical }));

      mapper.cpuWrite(0xA000, 0x01); // Horizontal
      expect(mapper.getMirrorMode()).toBe(MirrorMode.Horizontal);

      mapper.cpuWrite(0xA000, 0x00); // Vertical
      expect(mapper.getMirrorMode()).toBe(MirrorMode.Vertical);
    });

    it('does not change FourScreen mirroring', () => {
      const mapper = createMapper4(makeRomInfo({ mirrorMode: MirrorMode.FourScreen }));

      mapper.cpuWrite(0xA000, 0x01);
      expect(mapper.getMirrorMode()).toBe(MirrorMode.FourScreen);
    });
  });

  describe('PRG RAM', () => {
    it('reads and writes PRG RAM at $6000-$7FFF', () => {
      const mapper = createMapper4(makeRomInfo());

      mapper.cpuWrite(0x6000, 0x42);
      expect(mapper.cpuRead(0x6000)).toBe(0x42);

      mapper.cpuWrite(0x7FFF, 0xAB);
      expect(mapper.cpuRead(0x7FFF)).toBe(0xAB);
    });

    it('PRG RAM protect disables access', () => {
      const mapper = createMapper4(makeRomInfo());

      mapper.cpuWrite(0x6000, 0x42);
      expect(mapper.cpuRead(0x6000)).toBe(0x42);

      // Disable PRG RAM (bit 7 = 0)
      mapper.cpuWrite(0xA001, 0x00);
      expect(mapper.cpuRead(0x6000)).toBe(0);

      // Re-enable PRG RAM (bit 7 = 1)
      mapper.cpuWrite(0xA001, 0x80);
      expect(mapper.cpuRead(0x6000)).toBe(0x42);
    });
  });

  describe('IRQ scanline counter', () => {
    it('starts with IRQ not pending', () => {
      const mapper = createMapper4(makeRomInfo());
      expect(mapper.irqPending!()).toBe(false);
    });

    it('counts down and fires IRQ when reaching 0', () => {
      const mapper = createMapper4(makeRomInfo());

      // Set IRQ latch to 3
      mapper.cpuWrite(0xC000, 3);
      // Trigger reload
      mapper.cpuWrite(0xC001, 0);
      // Enable IRQ
      mapper.cpuWrite(0xE001, 0);

      // First tick: counter reloads to 3 (was 0 or reload pending)
      mapper.scanlineTick!();
      expect(mapper.irqPending!()).toBe(false);

      // Tick 2: counter = 2
      mapper.scanlineTick!();
      expect(mapper.irqPending!()).toBe(false);

      // Tick 3: counter = 1
      mapper.scanlineTick!();
      expect(mapper.irqPending!()).toBe(false);

      // Tick 4: counter = 0, IRQ fires
      mapper.scanlineTick!();
      expect(mapper.irqPending!()).toBe(true);
    });

    it('$E000 disables and acknowledges IRQ', () => {
      const mapper = createMapper4(makeRomInfo());

      mapper.cpuWrite(0xC000, 1);
      mapper.cpuWrite(0xC001, 0);
      mapper.cpuWrite(0xE001, 0);

      mapper.scanlineTick!(); // reload to 1
      mapper.scanlineTick!(); // counter = 0, fires

      expect(mapper.irqPending!()).toBe(true);

      // $E000 disables and acknowledges
      mapper.cpuWrite(0xE000, 0);
      expect(mapper.irqPending!()).toBe(false);
    });

    it('does not fire IRQ when disabled', () => {
      const mapper = createMapper4(makeRomInfo());

      mapper.cpuWrite(0xC000, 1);
      mapper.cpuWrite(0xC001, 0);
      // Don't enable IRQ

      mapper.scanlineTick!();
      mapper.scanlineTick!();

      expect(mapper.irqPending!()).toBe(false);
    });

    it('reloads counter when reload is triggered', () => {
      const mapper = createMapper4(makeRomInfo());

      mapper.cpuWrite(0xC000, 5); // latch = 5
      mapper.cpuWrite(0xC001, 0); // trigger reload
      mapper.cpuWrite(0xE001, 0); // enable

      mapper.scanlineTick!(); // reloads to 5

      // Change latch and trigger another reload
      mapper.cpuWrite(0xC000, 2);
      mapper.cpuWrite(0xC001, 0);

      mapper.scanlineTick!(); // reloads to 2

      mapper.scanlineTick!(); // counter = 1
      mapper.scanlineTick!(); // counter = 0, fires

      expect(mapper.irqPending!()).toBe(true);
    });
  });

  describe('CHR RAM', () => {
    it('writes to CHR RAM when chrIsRam is true', () => {
      const mapper = createMapper4(makeRomInfo({ chrIsRam: true }));

      mapper.ppuWrite(0x0000, 0xAB);
      expect(mapper.ppuRead(0x0000)).toBe(0xAB);
    });

    it('does not write to CHR ROM', () => {
      const chrRom = new Uint8Array(256 * 1024);
      const mapper = createMapper4(makeRomInfo({ chrRom, chrIsRam: false }));

      mapper.ppuWrite(0x0000, 0xAB);
      expect(mapper.ppuRead(0x0000)).toBe(0); // Should remain 0
    });
  });
});

import { describe, test, expect, beforeEach } from 'bun:test';
import { parseRom, RomInfo } from '../rom';
import { createMapper0 } from '../mapper/mapper0';
import { Bus } from '../bus';
import { PPU } from '../ppu/ppu';
import { APU } from '../apu';
import { Controller } from '../controller';
import { CPU } from '../cpu/cpu';
import { MirrorMode, Button, PPU_CYCLES_PER_CPU } from '../types';

// --- ROM Parser Tests ---

describe('ROM parser', () => {
  test('parses valid iNES header correctly', () => {
    // Build a minimal iNES ROM:
    // Header (16 bytes) + 1 PRG bank (16KB) + 1 CHR bank (8KB)
    const prgSize = 16384;
    const chrSize = 8192;
    const rom = new Uint8Array(16 + prgSize + chrSize);

    // iNES magic
    rom[0] = 0x4E; // N
    rom[1] = 0x45; // E
    rom[2] = 0x53; // S
    rom[3] = 0x1A;

    rom[4] = 1;    // 1 PRG ROM bank (16KB)
    rom[5] = 1;    // 1 CHR ROM bank (8KB)
    rom[6] = 0x01; // Vertical mirroring, no battery, no trainer, mapper low nibble = 0
    rom[7] = 0x00; // mapper high nibble = 0

    // Fill PRG with pattern
    for (let i = 0; i < prgSize; i++) {
      rom[16 + i] = i & 0xFF;
    }
    // Fill CHR with pattern
    for (let i = 0; i < chrSize; i++) {
      rom[16 + prgSize + i] = (i + 0x80) & 0xFF;
    }

    const info = parseRom(rom);

    expect(info.mapper).toBe(0);
    expect(info.mirrorMode).toBe(MirrorMode.Vertical);
    expect(info.hasBatteryRam).toBe(false);
    expect(info.chrIsRam).toBe(false);
    expect(info.prgRom.length).toBe(prgSize);
    expect(info.chrRom.length).toBe(chrSize);
    expect(info.prgRom[0]).toBe(0x00);
    expect(info.prgRom[255]).toBe(0xFF);
    expect(info.chrRom[0]).toBe(0x80);
  });

  test('detects horizontal mirroring', () => {
    const rom = createMinimalRom({ flags6: 0x00 }); // bit 0 clear = horizontal
    const info = parseRom(rom);
    expect(info.mirrorMode).toBe(MirrorMode.Horizontal);
  });

  test('detects battery-backed RAM', () => {
    const rom = createMinimalRom({ flags6: 0x02 });
    const info = parseRom(rom);
    expect(info.hasBatteryRam).toBe(true);
  });

  test('detects CHR RAM when CHR ROM banks is 0', () => {
    const rom = createMinimalRom({ chrBanks: 0 });
    const info = parseRom(rom);
    expect(info.chrIsRam).toBe(true);
    expect(info.chrRom.length).toBe(8192);
  });

  test('parses mapper number from flags6 and flags7', () => {
    // Mapper 2: low nibble from flags6 = 0x20, high nibble from flags7 = 0x00
    const rom = createMinimalRom({ flags6: 0x20, flags7: 0x00 });
    const info = parseRom(rom);
    expect(info.mapper).toBe(2);
  });

  test('rejects invalid magic number', () => {
    const rom = new Uint8Array(16 + 16384 + 8192);
    rom[0] = 0x00; // bad magic
    expect(() => parseRom(rom)).toThrow('Invalid iNES ROM');
  });

  test('handles trainer correctly', () => {
    // 16 header + 512 trainer + 16384 PRG + 8192 CHR
    const prgSize = 16384;
    const chrSize = 8192;
    const rom = new Uint8Array(16 + 512 + prgSize + chrSize);
    rom[0] = 0x4E; rom[1] = 0x45; rom[2] = 0x53; rom[3] = 0x1A;
    rom[4] = 1;
    rom[5] = 1;
    rom[6] = 0x04; // trainer present
    rom[7] = 0x00;

    // Write known value at start of PRG (after trainer)
    rom[16 + 512] = 0xDE;
    rom[16 + 512 + 1] = 0xAD;

    const info = parseRom(rom);
    expect(info.prgRom[0]).toBe(0xDE);
    expect(info.prgRom[1]).toBe(0xAD);
  });
});

// --- Mapper 0 Tests ---

describe('Mapper 0 (NROM)', () => {
  test('cpuRead from PRG ROM space ($8000+)', () => {
    const romInfo = createRomInfo({ prgSize: 32768 });
    romInfo.prgRom[0] = 0xEA; // at $8000
    romInfo.prgRom[1] = 0x4C; // at $8001

    const mapper = createMapper0(romInfo);
    expect(mapper.cpuRead(0x8000)).toBe(0xEA);
    expect(mapper.cpuRead(0x8001)).toBe(0x4C);
  });

  test('cpuWrite to PRG RAM ($6000-$7FFF)', () => {
    const romInfo = createRomInfo({ prgSize: 32768 });
    const mapper = createMapper0(romInfo);

    mapper.cpuWrite(0x6000, 0x42);
    expect(mapper.cpuRead(0x6000)).toBe(0x42);

    mapper.cpuWrite(0x7FFF, 0xFF);
    expect(mapper.cpuRead(0x7FFF)).toBe(0xFF);
  });

  test('16KB ROM mirrors in $8000-$BFFF and $C000-$FFFF', () => {
    const romInfo = createRomInfo({ prgSize: 16384 }); // NROM-128
    romInfo.prgRom[0] = 0xA5;
    romInfo.prgRom[0x3FFF] = 0x5A;

    const mapper = createMapper0(romInfo);

    // $8000 and $C000 should read the same data
    expect(mapper.cpuRead(0x8000)).toBe(0xA5);
    expect(mapper.cpuRead(0xC000)).toBe(0xA5);

    // $BFFF and $FFFF should read the same data
    expect(mapper.cpuRead(0xBFFF)).toBe(0x5A);
    expect(mapper.cpuRead(0xFFFF)).toBe(0x5A);
  });

  test('CHR ROM read', () => {
    const romInfo = createRomInfo({ prgSize: 32768 });
    romInfo.chrRom[0x100] = 0xBB;

    const mapper = createMapper0(romInfo);
    expect(mapper.ppuRead(0x100)).toBe(0xBB);
  });

  test('CHR RAM write when chrIsRam', () => {
    const romInfo = createRomInfo({ prgSize: 32768, chrIsRam: true });
    const mapper = createMapper0(romInfo);

    mapper.ppuWrite(0x0500, 0xCC);
    expect(mapper.ppuRead(0x0500)).toBe(0xCC);
  });
});

// --- Bus Routing Tests ---

describe('Bus routing', () => {
  let bus: Bus;
  let ppu: PPU;

  beforeEach(() => {
    const romInfo = createRomInfo({ prgSize: 32768 });
    const mapper = createMapper0(romInfo);
    const apu = new APU();
    const ctrl1 = new Controller();
    const ctrl2 = new Controller();

    bus = new Bus(mapper, apu, ctrl1, ctrl2);
    ppu = new PPU();
    ppu.setMapper(mapper);
    bus.setPPU(ppu);
  });

  test('RAM write at $0000 readable at $0800 (mirroring)', () => {
    bus.cpuWrite(0x0000, 0xAA);
    expect(bus.cpuRead(0x0000)).toBe(0xAA);
    expect(bus.cpuRead(0x0800)).toBe(0xAA);
    expect(bus.cpuRead(0x1000)).toBe(0xAA);
    expect(bus.cpuRead(0x1800)).toBe(0xAA);
  });

  test('RAM write at $0400 mirrors correctly', () => {
    bus.cpuWrite(0x0400, 0x55);
    expect(bus.cpuRead(0x0C00)).toBe(0x55);
    expect(bus.cpuRead(0x1400)).toBe(0x55);
    expect(bus.cpuRead(0x1C00)).toBe(0x55);
  });

  test('PPU register write to $2000 goes to PPU', () => {
    // Write to PPUCTRL via bus
    bus.cpuWrite(0x2000, 0x80); // enable NMI

    // Step PPU to VBlank and check NMI fires
    stepPPUToVBlank(ppu);
    expect(ppu.nmiPending).toBe(true);
  });

  test('PPU register mirroring: $2008 maps to $2000', () => {
    bus.cpuWrite(0x2008, 0x80); // mirrors to $2000
    stepPPUToVBlank(ppu);
    expect(ppu.nmiPending).toBe(true);
  });

  test('mapper space: reads from $8000+ go to PRG ROM', () => {
    const romInfo = createRomInfo({ prgSize: 32768 });
    romInfo.prgRom[0] = 0xEA;
    const mapper = createMapper0(romInfo);
    const apu = new APU();
    const testBus = new Bus(mapper, apu, new Controller(), new Controller());
    expect(testBus.cpuRead(0x8000)).toBe(0xEA);
  });
});

// --- Controller Tests ---

describe('Controller', () => {
  test('write strobe, read buttons in correct order', () => {
    const ctrl = new Controller();

    // Set some buttons
    ctrl.setButton(Button.A, true);
    ctrl.setButton(Button.B, false);
    ctrl.setButton(Button.Select, true);
    ctrl.setButton(Button.Start, false);
    ctrl.setButton(Button.Up, true);
    ctrl.setButton(Button.Down, false);
    ctrl.setButton(Button.Left, true);
    ctrl.setButton(Button.Right, false);

    // Strobe to latch button state
    ctrl.write(1); // strobe on
    ctrl.write(0); // strobe off

    // Read buttons: A, B, Select, Start, Up, Down, Left, Right
    expect(ctrl.read()).toBe(1); // A = pressed
    expect(ctrl.read()).toBe(0); // B = not pressed
    expect(ctrl.read()).toBe(1); // Select = pressed
    expect(ctrl.read()).toBe(0); // Start = not pressed
    expect(ctrl.read()).toBe(1); // Up = pressed
    expect(ctrl.read()).toBe(0); // Down = not pressed
    expect(ctrl.read()).toBe(1); // Left = pressed
    expect(ctrl.read()).toBe(0); // Right = not pressed
  });

  test('reads return 1 after all 8 buttons read', () => {
    const ctrl = new Controller();
    ctrl.write(1);
    ctrl.write(0);

    // Read all 8 buttons
    for (let i = 0; i < 8; i++) {
      ctrl.read();
    }

    // Subsequent reads should return 1
    expect(ctrl.read()).toBe(1);
    expect(ctrl.read()).toBe(1);
  });

  test('strobe continuously reloads and returns A button', () => {
    const ctrl = new Controller();
    ctrl.setButton(Button.A, true);
    ctrl.write(1); // strobe on - stays on

    // While strobe is high, reads always return A
    expect(ctrl.read()).toBe(1);
    expect(ctrl.read()).toBe(1);
    expect(ctrl.read()).toBe(1);
  });

  test('all buttons pressed reads correctly', () => {
    const ctrl = new Controller();
    for (let i = 0; i < 8; i++) {
      ctrl.setButton(i, true);
    }
    ctrl.write(1);
    ctrl.write(0);

    for (let i = 0; i < 8; i++) {
      expect(ctrl.read()).toBe(1);
    }
  });

  test('no buttons pressed reads correctly', () => {
    const ctrl = new Controller();
    ctrl.write(1);
    ctrl.write(0);

    for (let i = 0; i < 8; i++) {
      expect(ctrl.read()).toBe(0);
    }
  });
});

// --- Full Frame Integration Test ---

describe('Full frame integration', () => {
  test('CPU + PPU + Bus + Mapper run one frame with NMI', () => {
    // Build a minimal PRG ROM (32KB)
    const prgRom = new Uint8Array(32768);
    // Reset handler at $8000
    prgRom[0] = 0x78;         // SEI
    prgRom[1] = 0xA9; prgRom[2] = 0x80;  // LDA #$80
    prgRom[3] = 0x8D; prgRom[4] = 0x00; prgRom[5] = 0x20;  // STA $2000 (enable NMI)
    prgRom[6] = 0x4C; prgRom[7] = 0x06; prgRom[8] = 0x80;  // JMP $8006 (infinite loop)
    // NMI handler - just RTI
    prgRom[9] = 0x40;  // RTI
    // Reset vector at $FFFC (offset $7FFC in PRG)
    prgRom[0x7FFC] = 0x00;  // Low byte -> $8000
    prgRom[0x7FFD] = 0x80;  // High byte
    // NMI vector at $FFFA
    prgRom[0x7FFA] = 0x09;  // Low byte -> $8009
    prgRom[0x7FFB] = 0x80;  // High byte

    const chrRom = new Uint8Array(8192);

    const romInfo: RomInfo = {
      prgRom,
      chrRom,
      mapper: 0,
      mirrorMode: MirrorMode.Horizontal,
      hasBatteryRam: false,
      chrIsRam: true,
    };

    const mapper = createMapper0(romInfo);
    const apu = new APU();
    const ctrl1 = new Controller();
    const ctrl2 = new Controller();
    const bus = new Bus(mapper, apu, ctrl1, ctrl2);

    const cpu = new CPU();
    cpu.read = (addr: number) => bus.cpuRead(addr);
    cpu.write = (addr: number, val: number) => bus.cpuWrite(addr, val);

    const ppu = new PPU();
    ppu.setMapper(mapper);
    bus.setPPU(ppu);
    bus.setDmaStallCallback((cycles: number) => cpu.stallCycles(cycles));

    // Reset the CPU (reads reset vector)
    cpu.reset();
    expect(cpu.pc).toBe(0x8000);

    // Run until frame complete
    let frameFound = false;
    let nmiTriggered = false;
    const maxCycles = 30000 * PPU_CYCLES_PER_CPU; // more than enough for one frame

    for (let i = 0; i < maxCycles; i++) {
      // Step PPU 3 times per CPU cycle
      ppu.step();

      // Check NMI
      if (ppu.nmiPending) {
        cpu.triggerNMI();
        ppu.nmiPending = false;
        nmiTriggered = true;
      }

      // Step CPU every 3 PPU cycles
      if (i % PPU_CYCLES_PER_CPU === 0) {
        cpu.step();
      }

      if (ppu.frameComplete) {
        frameFound = true;
        break;
      }
    }

    expect(frameFound).toBe(true);
    expect(nmiTriggered).toBe(true);
  });
});

// --- Helpers ---

function createMinimalRom(opts: {
  prgBanks?: number;
  chrBanks?: number;
  flags6?: number;
  flags7?: number;
} = {}): Uint8Array {
  const prgBanks = opts.prgBanks ?? 1;
  const chrBanks = opts.chrBanks ?? 1;
  const flags6 = opts.flags6 ?? 0x01;
  const flags7 = opts.flags7 ?? 0x00;

  const prgSize = prgBanks * 16384;
  const chrSize = chrBanks * 8192;
  const rom = new Uint8Array(16 + prgSize + chrSize);

  rom[0] = 0x4E;
  rom[1] = 0x45;
  rom[2] = 0x53;
  rom[3] = 0x1A;
  rom[4] = prgBanks;
  rom[5] = chrBanks;
  rom[6] = flags6;
  rom[7] = flags7;

  return rom;
}

function createRomInfo(opts: {
  prgSize?: number;
  chrIsRam?: boolean;
} = {}): RomInfo {
  const prgSize = opts.prgSize ?? 32768;
  const chrIsRam = opts.chrIsRam ?? false;

  return {
    prgRom: new Uint8Array(prgSize),
    chrRom: new Uint8Array(8192),
    mapper: 0,
    mirrorMode: MirrorMode.Vertical,
    hasBatteryRam: false,
    chrIsRam,
  };
}

function stepPPUToVBlank(ppu: PPU): void {
  const maxSteps = 262 * 341 + 10;
  for (let i = 0; i < maxSteps; i++) {
    ppu.step();
    if (ppu.frameComplete) {
      return;
    }
  }
}

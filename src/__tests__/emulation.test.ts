import { describe, test, expect } from 'bun:test';
import { CPU } from '../cpu/cpu';
import { PPU } from '../ppu/ppu';
import { APU } from '../apu';
import { Bus } from '../bus';
import { Controller } from '../controller';
import { createMapper0 } from '../mapper/mapper0';
import { MirrorMode, CYCLES_PER_FRAME, PPU_CYCLES_PER_CPU } from '../types';
import type { RomInfo } from '../rom';

/**
 * Creates a fully wired NES emulator with a synthetic test ROM.
 * The test ROM enables rendering, sets up NMI, and enters an infinite loop.
 */
function createTestNES(prgRomData?: Uint8Array, chrRomData?: Uint8Array) {
  // Build PRG ROM (32KB)
  const prgRom = prgRomData ?? new Uint8Array(32768);
  const chrRom = chrRomData ?? new Uint8Array(8192);

  if (!prgRomData) {
    // Default test program: enable rendering + NMI, loop forever
    let pc = 0; // offset in PRG (maps to $8000)

    // Reset handler ($8000):
    prgRom[pc++] = 0x78;                   // SEI
    prgRom[pc++] = 0xD8;                   // CLD

    // Wait for first VBlank
    const waitVBL1 = pc;
    prgRom[pc++] = 0x2C; prgRom[pc++] = 0x02; prgRom[pc++] = 0x20;  // BIT $2002
    prgRom[pc++] = 0x10; prgRom[pc++] = 0xFB;  // BPL waitVBL1

    // Clear RAM
    prgRom[pc++] = 0xA2; prgRom[pc++] = 0x00;  // LDX #$00
    prgRom[pc++] = 0x8A;                         // TXA
    const clearLoop = pc;
    prgRom[pc++] = 0x95; prgRom[pc++] = 0x00;  // STA $00,X
    prgRom[pc++] = 0xE8;                         // INX
    prgRom[pc++] = 0xD0; prgRom[pc++] = 0xFB;  // BNE clearLoop

    // Wait for second VBlank
    const waitVBL2 = pc;
    prgRom[pc++] = 0x2C; prgRom[pc++] = 0x02; prgRom[pc++] = 0x20;  // BIT $2002
    prgRom[pc++] = 0x10; prgRom[pc++] = 0xFB;  // BPL waitVBL2

    // Configure PPU
    prgRom[pc++] = 0xA9; prgRom[pc++] = 0x80;  // LDA #$80 (NMI enable)
    prgRom[pc++] = 0x8D; prgRom[pc++] = 0x00; prgRom[pc++] = 0x20;  // STA $2000

    prgRom[pc++] = 0xA9; prgRom[pc++] = 0x1E;  // LDA #$1E (show bg+sprites, left 8px)
    prgRom[pc++] = 0x8D; prgRom[pc++] = 0x01; prgRom[pc++] = 0x20;  // STA $2001

    // Write some palette data
    prgRom[pc++] = 0xA9; prgRom[pc++] = 0x3F;  // LDA #$3F
    prgRom[pc++] = 0x8D; prgRom[pc++] = 0x06; prgRom[pc++] = 0x20;  // STA $2006
    prgRom[pc++] = 0xA9; prgRom[pc++] = 0x00;  // LDA #$00
    prgRom[pc++] = 0x8D; prgRom[pc++] = 0x06; prgRom[pc++] = 0x20;  // STA $2006
    // Write palette entries
    const paletteData = [0x0F, 0x01, 0x21, 0x31, 0x0F, 0x06, 0x16, 0x26,
                         0x0F, 0x09, 0x19, 0x29, 0x0F, 0x02, 0x12, 0x22];
    for (const byte of paletteData) {
      prgRom[pc++] = 0xA9; prgRom[pc++] = byte;  // LDA #byte
      prgRom[pc++] = 0x8D; prgRom[pc++] = 0x07; prgRom[pc++] = 0x20;  // STA $2007
    }

    // Infinite loop
    const mainLoop = pc;
    prgRom[pc++] = 0x4C; prgRom[pc++] = (0x8000 + mainLoop) & 0xFF; prgRom[pc++] = ((0x8000 + mainLoop) >> 8) & 0xFF;

    // NMI handler - increment frame counter at $00, then RTI
    const nmiHandler = pc;
    prgRom[pc++] = 0xE6; prgRom[pc++] = 0x00;  // INC $00 (frame counter)
    prgRom[pc++] = 0x40;                         // RTI

    // Vectors at end of PRG ROM
    // NMI vector ($FFFA)
    prgRom[0x7FFA] = (0x8000 + nmiHandler) & 0xFF;
    prgRom[0x7FFB] = ((0x8000 + nmiHandler) >> 8) & 0xFF;
    // Reset vector ($FFFC)
    prgRom[0x7FFC] = 0x00;
    prgRom[0x7FFD] = 0x80;
    // IRQ vector ($FFFE)
    prgRom[0x7FFE] = 0x00;
    prgRom[0x7FFF] = 0x80;
  }

  if (!chrRomData) {
    // Write a simple tile pattern (solid tile at index 0)
    // Plane 0: all 1s
    for (let i = 0; i < 8; i++) {
      chrRom[i] = 0xFF;
    }
    // Plane 1: all 1s (color 3)
    for (let i = 8; i < 16; i++) {
      chrRom[i] = 0xFF;
    }
  }

  const romInfo: RomInfo = {
    prgRom,
    chrRom,
    mapper: 0,
    mirrorMode: MirrorMode.Horizontal,
    hasBatteryRam: false,
    chrIsRam: !chrRomData,
  };

  const mapper = createMapper0(romInfo);
  const apu = new APU();
  const controller1 = new Controller();
  const controller2 = new Controller();
  const bus = new Bus(mapper, apu, controller1, controller2);
  const cpu = new CPU();
  const ppu = new PPU();

  cpu.read = (addr: number) => bus.cpuRead(addr);
  cpu.write = (addr: number, val: number) => bus.cpuWrite(addr, val);
  ppu.setMapper(mapper);

  bus.setPPU({
    ppuRead: (reg: number) => ppu.readRegister(reg),
    ppuWrite: (reg: number, val: number) => ppu.writeRegister(reg, val),
    oamDmaWrite: (data: Uint8Array) => ppu.oamDmaWrite(data),
  });

  bus.setDmaStallCallback((cycles: number) => {
    cpu.stallCycles(cycles);
  });

  cpu.reset();

  return { cpu, ppu, bus, mapper, controller1, controller2, apu };
}

/**
 * Run one frame of emulation (CPU + PPU)
 */
function runFrame(cpu: CPU, ppu: PPU): { cpuCycles: number; nmiTriggered: boolean } {
  let cpuCyclesThisFrame = 0;
  let nmiTriggered = false;

  while (cpuCyclesThisFrame < CYCLES_PER_FRAME) {
    const cpuCycles = cpu.step();
    cpuCyclesThisFrame += cpuCycles;

    const ppuCycles = cpuCycles * PPU_CYCLES_PER_CPU;
    for (let i = 0; i < ppuCycles; i++) {
      ppu.step();

      if (ppu.nmiPending) {
        cpu.triggerNMI();
        ppu.nmiPending = false;
        nmiTriggered = true;
      }
    }

    if (ppu.frameComplete) {
      ppu.frameComplete = false;
      break;
    }
  }

  return { cpuCycles: cpuCyclesThisFrame, nmiTriggered };
}

describe('Full emulation', () => {
  test('CPU initializes from reset vector', () => {
    const { cpu } = createTestNES();
    // Reset vector at $FFFC points to $8000
    expect(cpu.pc).toBeGreaterThanOrEqual(0x8000);
  });

  test('runs multiple frames without crashing', () => {
    const { cpu, ppu } = createTestNES();

    for (let frame = 0; frame < 10; frame++) {
      const result = runFrame(cpu, ppu);
      expect(result.cpuCycles).toBeGreaterThan(0);
    }
  });

  test('NMI fires each frame after being enabled', () => {
    const { cpu, ppu } = createTestNES();

    // Run frames until NMI is enabled (first few frames are VBlank waits + setup)
    let nmiCount = 0;
    for (let frame = 0; frame < 20; frame++) {
      const result = runFrame(cpu, ppu);
      if (result.nmiTriggered) {
        nmiCount++;
      }
    }

    // After 20 frames, NMI should have fired multiple times
    expect(nmiCount).toBeGreaterThan(3);
  });

  test('frame counter increments in NMI handler', () => {
    const { cpu, ppu, bus } = createTestNES();

    // Run 20 frames
    for (let frame = 0; frame < 20; frame++) {
      runFrame(cpu, ppu);
    }

    // Read frame counter from zero page $00
    const frameCounter = bus.cpuRead(0x0000);
    expect(frameCounter).toBeGreaterThan(0);
  });

  test('frame buffer contains non-zero data after rendering', () => {
    const { cpu, ppu } = createTestNES();

    // Run enough frames for rendering to start
    for (let frame = 0; frame < 10; frame++) {
      runFrame(cpu, ppu);
    }

    // Check that frame buffer has some non-zero palette indices
    let nonZeroPixels = 0;
    for (let i = 0; i < ppu.frameBuffer.length; i++) {
      if (ppu.frameBuffer[i] !== 0) {
        nonZeroPixels++;
      }
    }

    // With palette loaded and rendering enabled, we should have some colored pixels
    expect(nonZeroPixels).toBeGreaterThan(0);
  });

  test('CPU PC does not get stuck', () => {
    const { cpu, ppu } = createTestNES();

    const pcValues = new Set<number>();

    // Run a frame
    let cyclesRun = 0;
    while (cyclesRun < CYCLES_PER_FRAME) {
      pcValues.add(cpu.pc);
      const cycles = cpu.step();
      cyclesRun += cycles;

      const ppuCycles = cycles * PPU_CYCLES_PER_CPU;
      for (let i = 0; i < ppuCycles; i++) {
        ppu.step();
        if (ppu.nmiPending) {
          cpu.triggerNMI();
          ppu.nmiPending = false;
        }
      }

      if (ppu.frameComplete) {
        ppu.frameComplete = false;
        break;
      }
    }

    // PC should visit multiple addresses (not stuck on a single instruction)
    // Note: test ROM loops on BIT $2002/BPL waiting for VBlank, so 3+ PCs is expected
    expect(pcValues.size).toBeGreaterThanOrEqual(3);
  });

  test('PPU signals frame complete', () => {
    const { cpu, ppu } = createTestNES();

    let frameCompleteCount = 0;
    let totalCycles = 0;

    while (totalCycles < CYCLES_PER_FRAME * 3) {
      const cycles = cpu.step();
      totalCycles += cycles;

      const ppuCycles = cycles * PPU_CYCLES_PER_CPU;
      for (let i = 0; i < ppuCycles; i++) {
        ppu.step();
        if (ppu.nmiPending) {
          cpu.triggerNMI();
          ppu.nmiPending = false;
        }
      }

      if (ppu.frameComplete) {
        ppu.frameComplete = false;
        frameCompleteCount++;
        if (frameCompleteCount >= 3) break;
      }
    }

    expect(frameCompleteCount).toBeGreaterThanOrEqual(3);
  });

  test('controller input is read correctly during emulation', () => {
    const { cpu, ppu, controller1, bus } = createTestNES();

    // Press the Start button
    controller1.setButton(3, true); // Start button

    // Run a frame
    runFrame(cpu, ppu);

    // Strobe controller
    bus.cpuWrite(0x4016, 1);
    bus.cpuWrite(0x4016, 0);

    // Read button states (A, B, Select, Start, Up, Down, Left, Right)
    const buttons: number[] = [];
    for (let i = 0; i < 8; i++) {
      buttons.push(bus.cpuRead(0x4016) & 1);
    }

    // Start button (index 3) should be 1
    expect(buttons[3]).toBe(1);
    // Other buttons should be 0
    expect(buttons[0]).toBe(0); // A
    expect(buttons[1]).toBe(0); // B
    expect(buttons[2]).toBe(0); // Select
  });

  test('OAM DMA works during emulation', () => {
    const { cpu, ppu, bus } = createTestNES();

    // Run a frame first
    runFrame(cpu, ppu);

    // Write sprite data to CPU RAM page $02 ($0200-$02FF)
    for (let i = 0; i < 256; i++) {
      bus.cpuWrite(0x0200 + i, i);
    }

    // Trigger OAM DMA from page $02
    bus.cpuWrite(0x4014, 0x02);

    // OAM should now contain the data
    // Read OAM via PPU register $2004 (set OAMADDR to 0 first)
    bus.cpuWrite(0x2003, 0x00);
    const firstByte = bus.cpuRead(0x2004);
    expect(firstByte).toBe(0x00); // OAM[0] should be 0

    bus.cpuWrite(0x2003, 0x04);
    const fifthByte = bus.cpuRead(0x2004);
    expect(fifthByte).toBe(0x04); // OAM[4] should be 4
  });
});

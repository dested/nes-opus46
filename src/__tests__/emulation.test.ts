import { describe, test, expect } from 'bun:test';
import { CPU } from '../cpu/cpu';
import { PPU } from '../ppu/ppu';
import { APU } from '../apu';
import { Bus } from '../bus';
import { Controller } from '../controller';
import { createMapper0 } from '../mapper/mapper0';
import { MirrorMode, PPU_CYCLES_PER_CPU, Button } from '../types';
import type { RomInfo } from '../rom';

/**
 * Full emulation integration tests - exercises the complete NES pipeline
 * over multiple frames to verify the system works end-to-end.
 */
describe('Multi-frame emulation', () => {
  function createTestSystem(opts: {
    prgRom: Uint8Array;
    chrRom?: Uint8Array;
    mirrorMode?: MirrorMode;
  }) {
    const romInfo: RomInfo = {
      prgRom: opts.prgRom,
      chrRom: opts.chrRom ?? new Uint8Array(8192),
      mapper: 0,
      mirrorMode: opts.mirrorMode ?? MirrorMode.Horizontal,
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

    cpu.reset();

    return { cpu, ppu, bus, ctrl1, ctrl2, mapper };
  }

  function runFrame(cpu: CPU, ppu: PPU): boolean {
    const maxCycles = 90000; // well over one frame of PPU cycles
    for (let i = 0; i < maxCycles; i++) {
      ppu.step();

      if (ppu.nmiPending) {
        cpu.triggerNMI();
        ppu.nmiPending = false;
      }

      if (i % PPU_CYCLES_PER_CPU === 0) {
        cpu.step();
      }

      if (ppu.frameComplete) {
        ppu.frameComplete = false;
        return true;
      }
    }
    return false;
  }

  function buildTestRom(): Uint8Array {
    const prg = new Uint8Array(32768);

    // Reset handler at $8000:
    // SEI, CLD, LDX #$FF, TXS (set up stack)
    // LDA #$80, STA $2000 (enable NMI)
    // LDA #$1E, STA $2001 (enable rendering: show BG + sprites)
    // Write palette data to $3F00 via $2006/$2007
    // OAM DMA setup: write sprite data, STA $4014
    // Infinite loop: JMP $loop
    let pc = 0;

    // -- Init --
    prg[pc++] = 0x78;                     // SEI
    prg[pc++] = 0xD8;                     // CLD
    prg[pc++] = 0xA2; prg[pc++] = 0xFF;  // LDX #$FF
    prg[pc++] = 0x9A;                     // TXS

    // Wait for first VBlank (read $2002 until bit 7 set)
    const waitVbl1 = pc;
    prg[pc++] = 0xAD; prg[pc++] = 0x02; prg[pc++] = 0x20;  // LDA $2002
    prg[pc++] = 0x10;                                         // BPL
    prg[pc++] = 0xFB & 0xFF;                                  // back to waitVbl1
    // BPL offset: from PC after BPL operand = waitVbl1 + 5, target = waitVbl1
    // offset = waitVbl1 - (waitVbl1 + 5) = -5 = 0xFB

    // Wait for second VBlank
    const waitVbl2 = pc;
    prg[pc++] = 0xAD; prg[pc++] = 0x02; prg[pc++] = 0x20;  // LDA $2002
    prg[pc++] = 0x10; prg[pc++] = 0xFB;                      // BPL -5

    // -- Write palette via $2006/$2007 --
    prg[pc++] = 0xA9; prg[pc++] = 0x3F;  // LDA #$3F
    prg[pc++] = 0x8D; prg[pc++] = 0x06; prg[pc++] = 0x20;  // STA $2006
    prg[pc++] = 0xA9; prg[pc++] = 0x00;  // LDA #$00
    prg[pc++] = 0x8D; prg[pc++] = 0x06; prg[pc++] = 0x20;  // STA $2006

    // Write 32 palette entries (4 BG palettes + 4 sprite palettes)
    const paletteData = [
      0x0F, 0x01, 0x21, 0x30,  // BG palette 0
      0x0F, 0x06, 0x16, 0x26,  // BG palette 1
      0x0F, 0x09, 0x19, 0x29,  // BG palette 2
      0x0F, 0x02, 0x12, 0x22,  // BG palette 3
      0x0F, 0x01, 0x21, 0x30,  // Sprite palette 0
      0x0F, 0x06, 0x16, 0x26,  // Sprite palette 1
      0x0F, 0x09, 0x19, 0x29,  // Sprite palette 2
      0x0F, 0x02, 0x12, 0x22,  // Sprite palette 3
    ];
    for (const byte of paletteData) {
      prg[pc++] = 0xA9; prg[pc++] = byte;                    // LDA #byte
      prg[pc++] = 0x8D; prg[pc++] = 0x07; prg[pc++] = 0x20; // STA $2007
    }

    // -- Write some nametable data (a few tiles) --
    prg[pc++] = 0xA9; prg[pc++] = 0x20;  // LDA #$20
    prg[pc++] = 0x8D; prg[pc++] = 0x06; prg[pc++] = 0x20;  // STA $2006 (hi)
    prg[pc++] = 0xA9; prg[pc++] = 0x00;  // LDA #$00
    prg[pc++] = 0x8D; prg[pc++] = 0x06; prg[pc++] = 0x20;  // STA $2006 (lo) -> $2000

    // Write tile IDs 1-16 for the first 16 tiles
    for (let i = 1; i <= 16; i++) {
      prg[pc++] = 0xA9; prg[pc++] = i;                       // LDA #i
      prg[pc++] = 0x8D; prg[pc++] = 0x07; prg[pc++] = 0x20; // STA $2007
    }

    // -- Set up sprite 0 for hit detection --
    // Write sprite data to page 2 ($0200-$02FF)
    prg[pc++] = 0xA9; prg[pc++] = 0x1E;  // LDA #$1E (Y = 30)
    prg[pc++] = 0x8D; prg[pc++] = 0x00; prg[pc++] = 0x02;  // STA $0200
    prg[pc++] = 0xA9; prg[pc++] = 0x01;  // LDA #$01 (tile = 1)
    prg[pc++] = 0x8D; prg[pc++] = 0x01; prg[pc++] = 0x02;  // STA $0201
    prg[pc++] = 0xA9; prg[pc++] = 0x00;  // LDA #$00 (attributes = 0)
    prg[pc++] = 0x8D; prg[pc++] = 0x02; prg[pc++] = 0x02;  // STA $0202
    prg[pc++] = 0xA9; prg[pc++] = 0x10;  // LDA #$10 (X = 16)
    prg[pc++] = 0x8D; prg[pc++] = 0x03; prg[pc++] = 0x02;  // STA $0203

    // OAM DMA: write $02 to $4014
    prg[pc++] = 0xA9; prg[pc++] = 0x02;  // LDA #$02
    prg[pc++] = 0x8D; prg[pc++] = 0x14; prg[pc++] = 0x40;  // STA $4014

    // -- Set scroll position (0,0) --
    prg[pc++] = 0xA9; prg[pc++] = 0x00;  // LDA #$00
    prg[pc++] = 0x8D; prg[pc++] = 0x05; prg[pc++] = 0x20;  // STA $2005 (X scroll)
    prg[pc++] = 0x8D; prg[pc++] = 0x05; prg[pc++] = 0x20;  // STA $2005 (Y scroll)

    // -- Enable rendering --
    prg[pc++] = 0xA9; prg[pc++] = 0x90;  // LDA #$90 (enable NMI, BG from pattern table 1)
    prg[pc++] = 0x8D; prg[pc++] = 0x00; prg[pc++] = 0x20;  // STA $2000
    prg[pc++] = 0xA9; prg[pc++] = 0x1E;  // LDA #$1E (show BG + sprites)
    prg[pc++] = 0x8D; prg[pc++] = 0x01; prg[pc++] = 0x20;  // STA $2001

    // -- Main loop: just read controller and wait --
    const mainLoop = pc;
    prg[pc++] = 0xA9; prg[pc++] = 0x01;  // LDA #$01
    prg[pc++] = 0x8D; prg[pc++] = 0x16; prg[pc++] = 0x40;  // STA $4016 (strobe on)
    prg[pc++] = 0xA9; prg[pc++] = 0x00;  // LDA #$00
    prg[pc++] = 0x8D; prg[pc++] = 0x16; prg[pc++] = 0x40;  // STA $4016 (strobe off)
    prg[pc++] = 0xAD; prg[pc++] = 0x16; prg[pc++] = 0x40;  // LDA $4016 (read button A)
    prg[pc++] = 0x4C;                                         // JMP mainLoop
    prg[pc++] = mainLoop & 0xFF;
    prg[pc++] = ((mainLoop + 0x8000) >> 8) & 0xFF;

    // -- NMI handler --
    const nmiHandler = pc;
    prg[pc++] = 0x48;  // PHA (save A)
    // Reset scroll on each NMI
    prg[pc++] = 0xA9; prg[pc++] = 0x00;
    prg[pc++] = 0x8D; prg[pc++] = 0x05; prg[pc++] = 0x20;  // STA $2005 (X scroll)
    prg[pc++] = 0x8D; prg[pc++] = 0x05; prg[pc++] = 0x20;  // STA $2005 (Y scroll)
    // Increment a frame counter at $00
    prg[pc++] = 0xE6; prg[pc++] = 0x00;  // INC $00
    prg[pc++] = 0x68;  // PLA (restore A)
    prg[pc++] = 0x40;  // RTI

    // Vectors
    prg[0x7FFA] = nmiHandler & 0xFF;
    prg[0x7FFB] = ((nmiHandler + 0x8000) >> 8) & 0xFF;
    prg[0x7FFC] = 0x00;  // Reset -> $8000
    prg[0x7FFD] = 0x80;
    prg[0x7FFE] = nmiHandler & 0xFF;  // IRQ -> same as NMI for simplicity
    prg[0x7FFF] = ((nmiHandler + 0x8000) >> 8) & 0xFF;

    return prg;
  }

  function buildChrRom(): Uint8Array {
    const chr = new Uint8Array(8192);
    // Create a simple pattern for tile 1 - a filled square
    // Pattern table: each tile is 16 bytes (8 bytes low plane + 8 bytes high plane)
    const tileAddr = 1 * 16; // tile 1
    for (let row = 0; row < 8; row++) {
      chr[tileAddr + row] = 0xFF;       // low plane: all pixels on
      chr[tileAddr + row + 8] = 0x00;   // high plane: all pixels off
    }
    // This gives color index 01 for all pixels of tile 1
    return chr;
  }

  test('runs 5 frames without crashing', () => {
    const { cpu, ppu, bus } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    let framesCompleted = 0;
    for (let frame = 0; frame < 5; frame++) {
      const completed = runFrame(cpu, ppu);
      if (completed) framesCompleted++;
    }

    expect(framesCompleted).toBe(5);
  });

  test('NMI fires each frame and increments frame counter', () => {
    const { cpu, ppu, bus } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run 10 frames
    for (let i = 0; i < 10; i++) {
      runFrame(cpu, ppu);
    }

    // Frame counter at $0000 should be incremented by NMI handler each frame
    // (NMI handler does INC $00)
    const frameCount = bus.cpuRead(0x0000);
    expect(frameCount).toBeGreaterThanOrEqual(7); // Startup waits for 2 VBlanks before enabling NMI
  });

  test('frame buffer has non-zero pixel data after rendering', () => {
    const { cpu, ppu } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run 3 frames to let rendering start
    for (let i = 0; i < 3; i++) {
      runFrame(cpu, ppu);
    }

    // Check that at least some pixels are non-zero in the frame buffer
    let nonZeroPixels = 0;
    for (let i = 0; i < ppu.frameBuffer.length; i++) {
      if (ppu.frameBuffer[i] !== 0) {
        nonZeroPixels++;
      }
    }

    expect(nonZeroPixels).toBeGreaterThan(0);
  });

  test('CPU PC advances and does not get stuck', () => {
    const { cpu, ppu } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run 3 frames and collect all PCs the CPU visits
    const pcValues = new Set<number>();

    for (let frame = 0; frame < 3; frame++) {
      const maxCycles = 90000;
      for (let i = 0; i < maxCycles; i++) {
        ppu.step();
        if (ppu.nmiPending) {
          cpu.triggerNMI();
          ppu.nmiPending = false;
        }
        if (i % PPU_CYCLES_PER_CPU === 0) {
          cpu.step();
          pcValues.add(cpu.pc);
        }
        if (ppu.frameComplete) {
          ppu.frameComplete = false;
          break;
        }
      }
    }

    // CPU should visit at least a few addresses (test ROM loops tightly on BIT/BPL)
    expect(pcValues.size).toBeGreaterThanOrEqual(2);
  });

  test('controller input is readable during emulation', () => {
    const { cpu, ppu, ctrl1, bus } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run 2 frames to get into main loop
    runFrame(cpu, ppu);
    runFrame(cpu, ppu);

    // Press the A button
    ctrl1.setButton(Button.A, true);

    // Strobe the controller
    bus.cpuWrite(0x4016, 1);
    bus.cpuWrite(0x4016, 0);

    // Read button A (first read after strobe)
    const buttonA = bus.cpuRead(0x4016) & 1;
    expect(buttonA).toBe(1);

    // Read button B (second read)
    const buttonB = bus.cpuRead(0x4016) & 1;
    expect(buttonB).toBe(0); // B not pressed

    // Release A and verify
    ctrl1.setButton(Button.A, false);
    bus.cpuWrite(0x4016, 1);
    bus.cpuWrite(0x4016, 0);
    const buttonAAfter = bus.cpuRead(0x4016) & 1;
    expect(buttonAAfter).toBe(0);
  });

  test('PPU registers remain accessible across frames', () => {
    const { cpu, ppu, bus } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run one frame
    runFrame(cpu, ppu);

    // PPUSTATUS should be readable (bit 7 clear since we're past VBlank clear)
    const status = bus.cpuRead(0x2002);
    // After reading, write toggle should be reset
    // We can verify by doing a PPUADDR write sequence
    bus.cpuWrite(0x2006, 0x20);  // high byte
    bus.cpuWrite(0x2006, 0x00);  // low byte
    // Writing a tile ID via PPUDATA
    bus.cpuWrite(0x2007, 0x42);
    // Read it back (buffered - need two reads)
    bus.cpuRead(0x2002); // reset toggle
    bus.cpuWrite(0x2006, 0x20);
    bus.cpuWrite(0x2006, 0x00);
    bus.cpuRead(0x2007); // primes buffer
    const readBack = bus.cpuRead(0x2007); // gets buffered value
    expect(readBack).toBe(0x42);
  });

  test('OAM DMA transfers sprite data correctly', () => {
    const { cpu, ppu, bus } = createTestSystem({
      prgRom: buildTestRom(),
      chrRom: buildChrRom(),
    });

    // Run 3 frames to ensure DMA has happened
    for (let i = 0; i < 3; i++) {
      runFrame(cpu, ppu);
    }

    // The test ROM writes sprite 0 at $0200-$0203 and then does OAM DMA from page $02
    // Sprite 0: Y=0x1E, tile=0x01, attr=0x00, X=0x10
    // After DMA, these should be in OAM
    // We can read OAM via OAMADDR ($2003) + OAMDATA ($2004)
    bus.cpuWrite(0x2003, 0x00); // OAMADDR = 0
    const sprY = bus.cpuRead(0x2004);
    // Note: reading OAMDATA during rendering can return garbage,
    // but outside rendering it should work
    expect(sprY).toBe(0x1E);
  });
});

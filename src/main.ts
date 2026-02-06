import type { KeyEvent } from '@opentui/core';
import { parseRom } from './rom';
import { createMapper } from './mapper/mapper';
import { Bus } from './bus';
import { CPU } from './cpu/cpu';
import { PPU } from './ppu/ppu';
import { APU } from './apu';
import { Controller } from './controller';
import { NESRenderer } from './renderer/renderer';
import { Button, CYCLES_PER_FRAME, PPU_CYCLES_PER_CPU } from './types';

async function main() {
  const romPath = process.argv[2];
  if (!romPath) {
    console.error('Usage: bun run src/main.ts <rom-file>');
    process.exit(1);
  }

  // Load ROM
  const romData = await Bun.file(romPath).arrayBuffer();
  const romInfo = parseRom(new Uint8Array(romData));
  console.log(`Loaded ROM: Mapper ${romInfo.mapper}, PRG: ${romInfo.prgRom.length / 1024}KB, CHR: ${romInfo.chrRom.length / 1024}KB`);

  // Create components
  const mapper = createMapper(romInfo);
  const apu = new APU();
  const controller1 = new Controller();
  const controller2 = new Controller();
  const bus = new Bus(mapper, apu, controller1, controller2);

  // Create CPU and PPU
  const cpu = new CPU();
  const ppu = new PPU();

  // Wire CPU to bus
  cpu.read = (addr: number) => bus.cpuRead(addr);
  cpu.write = (addr: number, val: number) => bus.cpuWrite(addr, val);

  // Wire PPU to mapper
  ppu.setMapper(mapper);

  // Wire bus to PPU
  bus.setPPU({
    ppuRead: (reg: number) => ppu.readRegister(reg),
    ppuWrite: (reg: number, val: number) => ppu.writeRegister(reg, val),
    oamDmaWrite: (data: Uint8Array) => ppu.oamDmaWrite(data),
  });

  // Wire DMA stall
  bus.setDmaStallCallback((cycles: number) => {
    cpu.stallCycles(cycles);
  });

  // Reset CPU
  cpu.reset();

  // Create renderer
  const nesRenderer = new NESRenderer();
  await nesRenderer.init();

  // Keyboard input with timeout-based held detection
  const keyTimestamps = new Map<string, number>();
  const KEY_HOLD_TIMEOUT = 150; // ms

  const keyMap: Record<string, Button> = {
    z: Button.A,
    x: Button.B,
    return: Button.Start,
    backspace: Button.Select,
    up: Button.Up,
    down: Button.Down,
    left: Button.Left,
    right: Button.Right,
  };

  nesRenderer.keyInput.on('keypress', (key: KeyEvent) => {
    if (key.name === 'escape') {
      nesRenderer.stop();
      return;
    }

    const button = keyMap[key.name];
    if (button !== undefined) {
      controller1.setButton(button, true);
      keyTimestamps.set(key.name, Date.now());
    }
  });

  // Clear stale key presses
  function updateKeyStates(): void {
    const now = Date.now();
    for (const [keyName, timestamp] of keyTimestamps) {
      if (now - timestamp > KEY_HOLD_TIMEOUT) {
        const button = keyMap[keyName];
        if (button !== undefined) {
          controller1.setButton(button, false);
        }
        keyTimestamps.delete(keyName);
      }
    }
  }

  // Main emulation loop
  nesRenderer.setFrameCallback(async (_deltaTime: number) => {
    updateKeyStates();

    // Run one frame of emulation (~29780 CPU cycles)
    let cpuCyclesThisFrame = 0;

    while (cpuCyclesThisFrame < CYCLES_PER_FRAME) {
      const cpuCycles = cpu.step();
      cpuCyclesThisFrame += cpuCycles;

      // Advance PPU by 3x CPU cycles
      const ppuCycles = cpuCycles * PPU_CYCLES_PER_CPU;
      for (let i = 0; i < ppuCycles; i++) {
        ppu.step();

        if (ppu.nmiPending) {
          cpu.triggerNMI();
          ppu.nmiPending = false;
        }
      }

      // Check if frame is complete
      if (ppu.frameComplete) {
        ppu.frameComplete = false;
        nesRenderer.renderFrame(ppu.frameBuffer);
        break;
      }
    }
  });

  // Start rendering
  nesRenderer.start();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

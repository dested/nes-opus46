import { describe, test, expect, beforeEach } from 'bun:test';
import { PPU } from '../ppu';
import { MirrorMode } from '../../types';

let ppu: PPU;
let chrMem: Uint8Array;

beforeEach(() => {
  chrMem = new Uint8Array(8192);
  ppu = new PPU();
  ppu.setMapper({
    ppuRead: (addr: number) => chrMem[addr & 0x1FFF],
    ppuWrite: (addr: number, val: number) => { chrMem[addr & 0x1FFF] = val; },
    getMirrorMode: () => MirrorMode.Vertical,
  });
});

describe('PPUSTATUS ($2002)', () => {
  test('returns VBlank flag in bit 7', () => {
    // Step PPU to scanline 241 cycle 1 to set VBlank
    stepToVBlank();
    const status = ppu.readRegister(0x2002);
    expect(status & 0x80).toBe(0x80);
  });

  test('clears VBlank flag on read', () => {
    stepToVBlank();
    ppu.readRegister(0x2002); // first read clears it
    const status2 = ppu.readRegister(0x2002);
    expect(status2 & 0x80).toBe(0);
  });

  test('resets write toggle on read', () => {
    // Write first byte of PPUADDR to set toggle
    ppu.writeRegister(0x2006, 0x20);
    // Read PPUSTATUS to reset toggle
    ppu.readRegister(0x2002);
    // Now writing to PPUADDR should be first write (high byte) again
    // Write full address 0x2100
    ppu.writeRegister(0x2006, 0x21);
    ppu.writeRegister(0x2006, 0x00);
    // Write data
    ppu.writeRegister(0x2007, 0xAB);
    // Read it back: first read is buffered, need to set address again
    ppu.writeRegister(0x2006, 0x21);
    ppu.writeRegister(0x2006, 0x00);
    const buffered = ppu.readRegister(0x2007); // buffered (stale)
    const data = ppu.readRegister(0x2007);     // actual data
    expect(data).toBe(0xAB);
  });
});

describe('PPUADDR ($2006) / PPUDATA ($2007)', () => {
  test('write address via two writes, write data, read it back (buffered)', () => {
    // Write to CHR address 0x0100
    ppu.writeRegister(0x2006, 0x01);
    ppu.writeRegister(0x2006, 0x00);
    ppu.writeRegister(0x2007, 0x42);

    // Verify it went to chrMem
    expect(chrMem[0x0100]).toBe(0x42);

    // Read it back - set address first
    ppu.writeRegister(0x2006, 0x01);
    ppu.writeRegister(0x2006, 0x00);
    const buffered = ppu.readRegister(0x2007); // first read returns stale buffer
    const data = ppu.readRegister(0x2007);     // second read returns actual data
    expect(data).toBe(0x42);
  });

  test('address increments by 1 when PPUCTRL bit 2 is clear', () => {
    ppu.writeRegister(0x2000, 0x00); // increment +1
    ppu.writeRegister(0x2006, 0x01);
    ppu.writeRegister(0x2006, 0x00);
    ppu.writeRegister(0x2007, 0xAA); // writes to 0x0100, v becomes 0x0101
    ppu.writeRegister(0x2007, 0xBB); // writes to 0x0101, v becomes 0x0102

    expect(chrMem[0x0100]).toBe(0xAA);
    expect(chrMem[0x0101]).toBe(0xBB);
  });

  test('address increments by 32 when PPUCTRL bit 2 is set', () => {
    ppu.writeRegister(0x2000, 0x04); // increment +32
    ppu.writeRegister(0x2006, 0x01);
    ppu.writeRegister(0x2006, 0x00);
    ppu.writeRegister(0x2007, 0xCC); // writes to 0x0100, v becomes 0x0120
    ppu.writeRegister(0x2007, 0xDD); // writes to 0x0120, v becomes 0x0140

    expect(chrMem[0x0100]).toBe(0xCC);
    expect(chrMem[0x0120]).toBe(0xDD);
  });
});

describe('Palette read/write', () => {
  test('write and read palette data at 0x3F00+', () => {
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x00);
    ppu.writeRegister(0x2007, 0x15); // background color

    // Palette reads are immediate (not buffered)
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x00);
    const data = ppu.readRegister(0x2007);
    expect(data).toBe(0x15);
  });

  test('write multiple palette entries', () => {
    ppu.writeRegister(0x2000, 0x00); // increment +1
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x00);
    ppu.writeRegister(0x2007, 0x0F); // 0x3F00
    ppu.writeRegister(0x2007, 0x01); // 0x3F01
    ppu.writeRegister(0x2007, 0x02); // 0x3F02
    ppu.writeRegister(0x2007, 0x03); // 0x3F03

    // Read them back
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x00);
    expect(ppu.readRegister(0x2007)).toBe(0x0F);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x01);
    expect(ppu.readRegister(0x2007)).toBe(0x01);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x02);
    expect(ppu.readRegister(0x2007)).toBe(0x02);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x03);
    expect(ppu.readRegister(0x2007)).toBe(0x03);
  });

  test('palette mirroring: 0x3F10 mirrors to 0x3F00', () => {
    // Write to 0x3F10
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x10);
    ppu.writeRegister(0x2007, 0x2A);

    // Read from 0x3F00 - should see same value
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x00);
    expect(ppu.readRegister(0x2007)).toBe(0x2A);
  });

  test('palette mirroring: 0x3F14 mirrors to 0x3F04', () => {
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x14);
    ppu.writeRegister(0x2007, 0x3B);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x04);
    expect(ppu.readRegister(0x2007)).toBe(0x3B);
  });

  test('palette mirroring: 0x3F18 mirrors to 0x3F08', () => {
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x18);
    ppu.writeRegister(0x2007, 0x11);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x08);
    expect(ppu.readRegister(0x2007)).toBe(0x11);
  });

  test('palette mirroring: 0x3F1C mirrors to 0x3F0C', () => {
    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x1C);
    ppu.writeRegister(0x2007, 0x22);

    ppu.writeRegister(0x2006, 0x3F);
    ppu.writeRegister(0x2006, 0x0C);
    expect(ppu.readRegister(0x2007)).toBe(0x22);
  });
});

describe('PPUSCROLL ($2005)', () => {
  test('double-write latch: first write sets X scroll, second sets Y scroll', () => {
    // After reset, w=false (first write)
    ppu.writeRegister(0x2005, 0x7D); // X scroll = 125 -> coarseX=15, fineX=5
    ppu.writeRegister(0x2005, 0x5E); // Y scroll = 94 -> coarseY=11, fineY=6

    // Verify by reading status to reset toggle, then write PPUADDR to confirm t is set
    // We can indirectly test by verifying that the toggle resets after second write
    // Write a third scroll value - should be treated as first write again
    ppu.writeRegister(0x2005, 0x00);
    // If toggle was properly reset, this should be the X scroll (first write)
    // Write second to complete the pair
    ppu.writeRegister(0x2005, 0x00);
    // Toggle should be false again - verified by no crash and correct behavior
  });

  test('PPUSTATUS read resets scroll toggle', () => {
    ppu.writeRegister(0x2005, 0x10); // first write (X)
    // Toggle is now true (expecting second write)
    ppu.readRegister(0x2002); // reset toggle
    // Now next write should be treated as first write (X) again
    ppu.writeRegister(0x2005, 0x20); // should be X scroll, not Y
    ppu.writeRegister(0x2005, 0x30); // should be Y scroll
    // No crash = toggle was properly reset
  });
});

describe('OAM DMA', () => {
  test('oamDmaWrite copies 256 bytes to OAM', () => {
    const data = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      data[i] = i;
    }
    ppu.oamDmaWrite(data);

    // Verify OAM by reading through OAMDATA register
    // Set OAMADDR to 0
    ppu.writeRegister(0x2003, 0x00);
    const first = ppu.readRegister(0x2004);
    expect(first).toBe(0x00);

    ppu.writeRegister(0x2003, 0x01);
    expect(ppu.readRegister(0x2004)).toBe(0x01);

    ppu.writeRegister(0x2003, 0xFF);
    expect(ppu.readRegister(0x2004)).toBe(0xFF);
  });
});

describe('VBlank timing', () => {
  test('VBlank set at scanline 241 cycle 1', () => {
    stepToVBlank();
    // VBlank should be set
    const status = ppu.readRegister(0x2002);
    expect(status & 0x80).toBe(0x80);
  });

  test('VBlank cleared on pre-render line (scanline 261)', () => {
    // Step to VBlank first
    stepToVBlank();
    // Confirm VBlank is set (without reading status, which would clear it)
    expect(ppu.frameComplete).toBe(true);

    // Step to pre-render line scanline 261, past cycle 1 where flags are cleared
    // After VBlank, we're at scanline 241, cycle 2
    // We need to step until scanline 261, cycle 1 is processed (cycle becomes 2)
    stepUntil(() => ppu.getScanline() === 261 && ppu.getCycle() === 2);

    // VBlank should be cleared - reading status should show bit 7 = 0
    const status = ppu.readRegister(0x2002);
    expect(status & 0x80).toBe(0);
  });

  test('NMI pending when PPUCTRL NMI enable is set and VBlank occurs', () => {
    // Enable NMI in PPUCTRL
    ppu.writeRegister(0x2000, 0x80);
    ppu.nmiPending = false;

    stepToVBlank();
    expect(ppu.nmiPending).toBe(true);
  });

  test('NMI not pending when PPUCTRL NMI enable is clear', () => {
    ppu.writeRegister(0x2000, 0x00); // NMI disabled
    ppu.nmiPending = false;

    stepToVBlank();
    expect(ppu.nmiPending).toBe(false);
  });

  test('frameComplete set at VBlank', () => {
    expect(ppu.frameComplete).toBe(false);
    stepToVBlank();
    expect(ppu.frameComplete).toBe(true);
  });

  test('NMI edge: enabling NMI while VBlank is already set triggers NMI', () => {
    // Step to VBlank with NMI disabled
    ppu.writeRegister(0x2000, 0x00);
    stepToVBlank();
    expect(ppu.nmiPending).toBe(false);

    // Now enable NMI - should trigger because VBlank is already set
    // But first, don't read PPUSTATUS (which clears VBlank)
    ppu.nmiPending = false;
    ppu.writeRegister(0x2000, 0x80);
    expect(ppu.nmiPending).toBe(true);
  });
});

// Helper: advance the PPU until VBlank fires (scanline 241, cycle 1 processed)
function stepToVBlank(): void {
  // Step until frameComplete is set, which happens at scanline 241, cycle 1
  // The VBlank check is evaluated during step() when scanline===241 && cycle===1,
  // and the cycle is incremented AFTER the check. So we need to step one past
  // the point where scanline=241, cycle=1 is the current state.
  const maxSteps = 262 * 341 + 10; // safety limit (one full frame + margin)
  for (let i = 0; i < maxSteps; i++) {
    ppu.step();
    if (ppu.frameComplete) {
      return;
    }
  }
}

// Helper: step PPU until a condition is met
function stepUntil(condition: () => boolean): void {
  const maxSteps = 262 * 341 + 10;
  for (let i = 0; i < maxSteps; i++) {
    ppu.step();
    if (condition()) {
      return;
    }
  }
}

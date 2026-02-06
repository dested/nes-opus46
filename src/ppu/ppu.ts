import { MirrorMode } from '../types';
import type { Mapper } from '../mapper/mapper';

export interface PPUMapper {
  ppuRead(addr: number): number;
  ppuWrite(addr: number, value: number): void;
  getMirrorMode(): MirrorMode;
  scanlineTick?(): void;
}

export class PPU {
  // VRAM and memory
  private vram: Uint8Array = new Uint8Array(2048);
  private paletteRam: Uint8Array = new Uint8Array(32);
  private oam: Uint8Array = new Uint8Array(256);
  private secondaryOam: Uint8Array = new Uint8Array(32);

  // Output
  public frameBuffer: Uint8Array = new Uint8Array(256 * 240);
  public frameComplete: boolean = false;
  public nmiPending: boolean = false;

  // Timing
  private scanline: number = 0;
  private cycle: number = 0;
  private oddFrame: boolean = false;

  // Registers
  private ppuCtrl: number = 0;
  private ppuMask: number = 0;
  private ppuStatus: number = 0;
  private oamAddr: number = 0;

  // Loopy scroll registers
  private v: number = 0;
  private t: number = 0;
  private x: number = 0;
  private w: boolean = false;

  // Internal data buffer for PPUDATA reads
  private dataBuffer: number = 0;

  // Internal latch (last value written to any PPU register)
  private latch: number = 0;

  // Background rendering shift registers
  private bgShiftPatternLo: number = 0;
  private bgShiftPatternHi: number = 0;
  private bgShiftAttribLo: number = 0;
  private bgShiftAttribHi: number = 0;

  // Background tile fetch data
  private bgNextTileId: number = 0;
  private bgNextTileAttrib: number = 0;
  private bgNextTileLsb: number = 0;
  private bgNextTileMsb: number = 0;

  // Sprite rendering
  private spriteCount: number = 0;
  private spritePositions: Uint8Array = new Uint8Array(8);
  private spriteAttributes: Uint8Array = new Uint8Array(8);
  private spriteIndices: Uint8Array = new Uint8Array(8);
  private spritePatternsLo: Uint8Array = new Uint8Array(8);
  private spritePatternsHi: Uint8Array = new Uint8Array(8);

  private sprite0HitPossible: boolean = false;
  private sprite0Rendering: boolean = false;

  // Mapper for CHR reads
  private mapper: PPUMapper | null = null;

  // A12 tracking for MMC3 scanline counter
  private lastA12: number = 0;

  // Mirror lookup tables (pre-computed)
  private static readonly MIRROR_LOOKUP: Record<number, number[]> = {
    [MirrorMode.Horizontal]: [0, 0, 1, 1],
    [MirrorMode.Vertical]: [0, 1, 0, 1],
    [MirrorMode.SingleScreenLower]: [0, 0, 0, 0],
    [MirrorMode.SingleScreenUpper]: [1, 1, 1, 1],
    [MirrorMode.FourScreen]: [0, 1, 2, 3],
  };

  public setMapper(mapper: PPUMapper): void {
    this.mapper = mapper;
  }

  // --- BusDevice interface (called by Bus) ---

  public ppuRead(register: number): number {
    return this.readRegister(register);
  }

  public ppuWrite(register: number, value: number): void {
    this.writeRegister(register, value);
  }

  // --- Register Read/Write ---

  public readRegister(register: number): number {
    switch (register) {
      case 0x2000: // PPUCTRL - write only
        return this.latch;
      case 0x2001: // PPUMASK - write only
        return this.latch;
      case 0x2002: // PPUSTATUS
        return this.readStatus();
      case 0x2003: // OAMADDR - write only
        return this.latch;
      case 0x2004: // OAMDATA
        return this.readOamData();
      case 0x2005: // PPUSCROLL - write only
        return this.latch;
      case 0x2006: // PPUADDR - write only
        return this.latch;
      case 0x2007: // PPUDATA
        return this.readData();
      default:
        return 0;
    }
  }

  public writeRegister(register: number, value: number): void {
    this.latch = value;

    switch (register) {
      case 0x2000:
        this.writeCtrl(value);
        break;
      case 0x2001:
        this.writeMask(value);
        break;
      case 0x2002:
        // Read-only
        break;
      case 0x2003:
        this.writeOamAddr(value);
        break;
      case 0x2004:
        this.writeOamData(value);
        break;
      case 0x2005:
        this.writeScroll(value);
        break;
      case 0x2006:
        this.writeAddr(value);
        break;
      case 0x2007:
        this.writeData(value);
        break;
    }
  }

  public oamDmaWrite(data: Uint8Array): void {
    for (let i = 0; i < 256; i++) {
      this.oam[(this.oamAddr + i) & 0xFF] = data[i];
    }
  }

  // --- Register implementations ---

  private writeCtrl(value: number): void {
    const prevNmi = this.ppuCtrl & 0x80;
    this.ppuCtrl = value;
    // Update t bits 10-11 with nametable select
    this.t = (this.t & 0xF3FF) | ((value & 0x03) << 10);
    // NMI edge: if enabling NMI and VBlank is already set, trigger NMI
    if (!(prevNmi) && (value & 0x80) && (this.ppuStatus & 0x80)) {
      this.nmiPending = true;
    }
  }

  private writeMask(value: number): void {
    this.ppuMask = value;
  }

  private readStatus(): number {
    const result = (this.ppuStatus & 0xE0) | (this.latch & 0x1F);
    this.ppuStatus &= ~0x80; // Clear VBlank
    this.w = false;           // Reset write toggle
    return result;
  }

  private writeOamAddr(value: number): void {
    this.oamAddr = value;
  }

  private readOamData(): number {
    return this.oam[this.oamAddr];
  }

  private writeOamData(value: number): void {
    this.oam[this.oamAddr] = value;
    this.oamAddr = (this.oamAddr + 1) & 0xFF;
  }

  private writeScroll(value: number): void {
    if (!this.w) {
      // First write: X scroll
      this.t = (this.t & 0xFFE0) | (value >> 3);
      this.x = value & 0x07;
      this.w = true;
    } else {
      // Second write: Y scroll
      this.t = (this.t & 0x8C1F) | ((value & 0x07) << 12) | ((value & 0xF8) << 2);
      this.w = false;
    }
  }

  private writeAddr(value: number): void {
    if (!this.w) {
      // First write: high byte
      this.t = (this.t & 0x00FF) | ((value & 0x3F) << 8);
      this.w = true;
    } else {
      // Second write: low byte
      this.t = (this.t & 0xFF00) | value;
      this.v = this.t;
      this.w = false;
    }
  }

  private readData(): number {
    let data = this.ppuReadInternal(this.v);
    if ((this.v & 0x3FFF) < 0x3F00) {
      // Buffered read for non-palette
      const buffered = this.dataBuffer;
      this.dataBuffer = data;
      data = buffered;
    } else {
      // Palette read is immediate, but buffer gets the nametable "underneath"
      this.dataBuffer = this.ppuReadInternal(this.v - 0x1000);
    }
    this.v = (this.v + ((this.ppuCtrl & 0x04) ? 32 : 1)) & 0x7FFF;
    return data;
  }

  private writeData(value: number): void {
    this.ppuWriteInternal(this.v, value);
    this.v = (this.v + ((this.ppuCtrl & 0x04) ? 32 : 1)) & 0x7FFF;
  }

  // --- PPU internal memory access ---

  private mirrorAddress(address: number): number {
    const addr = address & 0x0FFF;
    const table = (addr >> 10) & 3;
    const offset = addr & 0x3FF;
    const mirrorMode = this.mapper!.getMirrorMode();
    const lookup = PPU.MIRROR_LOOKUP[mirrorMode];
    return lookup[table] * 0x400 + offset;
  }

  private paletteIndex(address: number): number {
    let index = address & 0x1F;
    // Mirrors: $3F10/$3F14/$3F18/$3F1C -> $3F00/$3F04/$3F08/$3F0C
    if (index >= 16 && (index & 0x03) === 0) {
      index -= 16;
    }
    return index;
  }

  private ppuReadInternal(address: number): number {
    const addr = address & 0x3FFF;
    if (addr < 0x2000) {
      const a12 = (addr >> 12) & 1;
      if (a12 && !this.lastA12) {
        this.mapper!.scanlineTick?.();
      }
      this.lastA12 = a12;
      return this.mapper!.ppuRead(addr);
    } else if (addr < 0x3F00) {
      return this.vram[this.mirrorAddress(addr)];
    } else {
      return this.paletteRam[this.paletteIndex(addr)];
    }
  }

  private ppuWriteInternal(address: number, value: number): void {
    const addr = address & 0x3FFF;
    if (addr < 0x2000) {
      this.mapper!.ppuWrite(addr, value);
    } else if (addr < 0x3F00) {
      this.vram[this.mirrorAddress(addr)] = value;
    } else {
      this.paletteRam[this.paletteIndex(addr)] = value;
    }
  }

  // --- Scroll register helpers ---

  private incrementX(): void {
    if ((this.v & 0x001F) === 31) {
      this.v &= ~0x001F;
      this.v ^= 0x0400;
    } else {
      this.v++;
    }
  }

  private incrementY(): void {
    if ((this.v & 0x7000) !== 0x7000) {
      this.v += 0x1000;
    } else {
      this.v &= ~0x7000;
      let coarseY = (this.v & 0x03E0) >> 5;
      if (coarseY === 29) {
        coarseY = 0;
        this.v ^= 0x0800;
      } else if (coarseY === 31) {
        coarseY = 0;
      } else {
        coarseY++;
      }
      this.v = (this.v & ~0x03E0) | (coarseY << 5);
    }
  }

  // --- Background shift register operations ---

  private updateShifters(): void {
    this.bgShiftPatternLo <<= 1;
    this.bgShiftPatternHi <<= 1;
    this.bgShiftAttribLo <<= 1;
    this.bgShiftAttribHi <<= 1;
  }

  private loadBackgroundShifters(): void {
    this.bgShiftPatternLo = (this.bgShiftPatternLo & 0xFF00) | this.bgNextTileLsb;
    this.bgShiftPatternHi = (this.bgShiftPatternHi & 0xFF00) | this.bgNextTileMsb;
    this.bgShiftAttribLo = (this.bgShiftAttribLo & 0xFF00) | ((this.bgNextTileAttrib & 0x01) ? 0xFF : 0x00);
    this.bgShiftAttribHi = (this.bgShiftAttribHi & 0xFF00) | ((this.bgNextTileAttrib & 0x02) ? 0xFF : 0x00);
  }

  // --- Sprite evaluation ---

  private evaluateSprites(): void {
    this.spriteCount = 0;
    this.sprite0HitPossible = false;
    this.sprite0Rendering = false;

    const spriteHeight = (this.ppuCtrl & 0x20) ? 16 : 8;

    for (let i = 0; i < 64 && this.spriteCount < 8; i++) {
      const y = this.oam[i * 4];
      const diff = this.scanline - y;

      if (diff >= 0 && diff < spriteHeight) {
        if (i === 0) {
          this.sprite0HitPossible = true;
        }

        this.spriteIndices[this.spriteCount] = i;
        this.secondaryOam[this.spriteCount * 4] = this.oam[i * 4];
        this.secondaryOam[this.spriteCount * 4 + 1] = this.oam[i * 4 + 1];
        this.secondaryOam[this.spriteCount * 4 + 2] = this.oam[i * 4 + 2];
        this.secondaryOam[this.spriteCount * 4 + 3] = this.oam[i * 4 + 3];
        this.spriteCount++;
      }
    }

    // Sprite overflow (simplified - real NES has a hardware bug)
    if (this.spriteCount >= 8) {
      for (let i = 0; i < 64; i++) {
        const y = this.oam[i * 4];
        const diff = this.scanline - y;
        if (diff >= 0 && diff < spriteHeight) {
          // Check if this sprite was already counted
          let found = false;
          for (let j = 0; j < this.spriteCount; j++) {
            if (this.spriteIndices[j] === i) {
              found = true;
              break;
            }
          }
          if (!found) {
            this.ppuStatus |= 0x20;
            break;
          }
        }
      }
    }
  }

  // --- Sprite pattern fetch ---

  private loadSpritesForScanline(): void {
    const spriteHeight = (this.ppuCtrl & 0x20) ? 16 : 8;

    for (let i = 0; i < this.spriteCount; i++) {
      const spriteY = this.secondaryOam[i * 4];
      const tileIndex = this.secondaryOam[i * 4 + 1];
      const attributes = this.secondaryOam[i * 4 + 2];
      const spriteX = this.secondaryOam[i * 4 + 3];

      this.spritePositions[i] = spriteX;
      this.spriteAttributes[i] = attributes;

      if (i === 0 && this.sprite0HitPossible) {
        this.sprite0Rendering = true;
      }

      let row = this.scanline - spriteY;
      const flipV = (attributes & 0x80) !== 0;
      const flipH = (attributes & 0x40) !== 0;

      let patternAddr: number;

      if (spriteHeight === 8) {
        if (flipV) row = 7 - row;
        const spritePatternTable = (this.ppuCtrl & 0x08) ? 0x1000 : 0x0000;
        patternAddr = spritePatternTable + tileIndex * 16 + row;
      } else {
        // 8x16 sprites
        if (flipV) row = 15 - row;
        const table = (tileIndex & 0x01) ? 0x1000 : 0x0000;
        const tile = tileIndex & 0xFE;
        if (row < 8) {
          patternAddr = table + tile * 16 + row;
        } else {
          patternAddr = table + (tile + 1) * 16 + (row - 8);
        }
      }

      let lo = this.ppuReadInternal(patternAddr);
      let hi = this.ppuReadInternal(patternAddr + 8);

      if (flipH) {
        lo = this.reverseByte(lo);
        hi = this.reverseByte(hi);
      }

      this.spritePatternsLo[i] = lo;
      this.spritePatternsHi[i] = hi;
    }
  }

  private reverseByte(b: number): number {
    b = ((b & 0xF0) >> 4) | ((b & 0x0F) << 4);
    b = ((b & 0xCC) >> 2) | ((b & 0x33) << 2);
    b = ((b & 0xAA) >> 1) | ((b & 0x55) << 1);
    return b;
  }

  // --- Pixel rendering ---

  private renderPixel(): void {
    const pixelX = this.cycle - 1;

    // Background pixel
    let bgPixel = 0;
    let bgPalette = 0;

    if (this.ppuMask & 0x08) {
      if ((this.ppuMask & 0x02) || pixelX >= 8) {
        const mux = 0x8000 >> this.x;
        const p0 = (this.bgShiftPatternLo & mux) ? 1 : 0;
        const p1 = (this.bgShiftPatternHi & mux) ? 1 : 0;
        bgPixel = (p1 << 1) | p0;

        const a0 = (this.bgShiftAttribLo & mux) ? 1 : 0;
        const a1 = (this.bgShiftAttribHi & mux) ? 1 : 0;
        bgPalette = (a1 << 1) | a0;
      }
    }

    // Sprite pixel
    let sprPixel = 0;
    let sprPalette = 0;
    let sprPriority = false;
    let spriteZero = false;

    if (this.ppuMask & 0x10) {
      if ((this.ppuMask & 0x04) || pixelX >= 8) {
        for (let i = 0; i < this.spriteCount; i++) {
          const offset = pixelX - this.spritePositions[i];
          if (offset >= 0 && offset < 8) {
            const bit = 7 - offset;
            const p0 = (this.spritePatternsLo[i] >> bit) & 1;
            const p1 = (this.spritePatternsHi[i] >> bit) & 1;
            const pixel = (p1 << 1) | p0;

            if (pixel !== 0) {
              sprPixel = pixel;
              sprPalette = (this.spriteAttributes[i] & 0x03) + 4;
              sprPriority = (this.spriteAttributes[i] & 0x20) !== 0;
              spriteZero = i === 0 && this.sprite0Rendering;
              break;
            }
          }
        }
      }
    }

    // Sprite 0 hit detection
    if (spriteZero && bgPixel !== 0 && sprPixel !== 0 && pixelX !== 255) {
      if ((this.ppuMask & 0x18) === 0x18) {
        if (!((this.ppuMask & 0x06) !== 0x06 && pixelX < 8)) {
          this.ppuStatus |= 0x40;
        }
      }
    }

    // Priority multiplexer
    let paletteIndex: number;
    if (bgPixel === 0 && sprPixel === 0) {
      paletteIndex = 0;
    } else if (bgPixel === 0 && sprPixel !== 0) {
      paletteIndex = sprPalette * 4 + sprPixel;
    } else if (bgPixel !== 0 && sprPixel === 0) {
      paletteIndex = bgPalette * 4 + bgPixel;
    } else {
      if (sprPriority) {
        paletteIndex = bgPalette * 4 + bgPixel;
      } else {
        paletteIndex = sprPalette * 4 + sprPixel;
      }
    }

    const colorIndex = this.paletteRam[this.paletteIndex(0x3F00 + paletteIndex)] & 0x3F;
    this.frameBuffer[this.scanline * 256 + pixelX] = colorIndex;
  }

  // --- Main tick function ---

  public step(): void {
    const renderingEnabled = (this.ppuMask & 0x18) !== 0;
    const preLine = this.scanline === 261;
    const visibleLine = this.scanline < 240;
    const renderLine = preLine || visibleLine;
    const visibleCycle = this.cycle >= 1 && this.cycle <= 256;
    const preFetchCycle = this.cycle >= 321 && this.cycle <= 336;
    const fetchCycle = visibleCycle || preFetchCycle;

    if (renderingEnabled) {
      // BACKGROUND RENDERING
      if (renderLine && fetchCycle) {
        this.updateShifters();

        switch ((this.cycle - 1) % 8) {
          case 0: // Nametable byte
            this.loadBackgroundShifters();
            this.bgNextTileId = this.ppuReadInternal(0x2000 | (this.v & 0x0FFF));
            break;
          case 2: { // Attribute byte
            const attribAddr = 0x23C0 | (this.v & 0x0C00) | ((this.v >> 4) & 0x38) | ((this.v >> 2) & 0x07);
            let attribData = this.ppuReadInternal(attribAddr);
            if ((this.v >> 5) & 0x02) attribData >>= 4;
            if (this.v & 0x02) attribData >>= 2;
            this.bgNextTileAttrib = attribData & 0x03;
            break;
          }
          case 4: { // Pattern table low byte
            const bgPatternTable = (this.ppuCtrl & 0x10) ? 0x1000 : 0x0000;
            const fineY = (this.v >> 12) & 0x07;
            this.bgNextTileLsb = this.ppuReadInternal(bgPatternTable + this.bgNextTileId * 16 + fineY);
            break;
          }
          case 6: { // Pattern table high byte
            const bgPatternTable = (this.ppuCtrl & 0x10) ? 0x1000 : 0x0000;
            const fineY = (this.v >> 12) & 0x07;
            this.bgNextTileMsb = this.ppuReadInternal(bgPatternTable + this.bgNextTileId * 16 + fineY + 8);
            break;
          }
          case 7: // Increment horizontal v
            this.incrementX();
            break;
        }
      }

      if (renderLine && this.cycle === 256) {
        this.incrementY();
      }

      if (renderLine && this.cycle === 257) {
        this.loadBackgroundShifters();
        // Copy horizontal bits from t to v
        this.v = (this.v & ~0x041F) | (this.t & 0x041F);
      }

      if (preLine && this.cycle >= 280 && this.cycle <= 304) {
        // Copy vertical bits from t to v
        this.v = (this.v & ~0x7BE0) | (this.t & 0x7BE0);
      }

      // SPRITE EVALUATION
      if (this.cycle === 257 && visibleLine) {
        this.evaluateSprites();
      }

      // SPRITE PATTERN FETCH
      if (this.cycle === 321 && visibleLine) {
        this.loadSpritesForScanline();
      }
    }

    // PIXEL OUTPUT
    if (visibleLine && visibleCycle && renderingEnabled) {
      this.renderPixel();
    } else if (visibleLine && visibleCycle) {
      // When rendering disabled, output background color
      this.frameBuffer[this.scanline * 256 + (this.cycle - 1)] = this.paletteRam[0];
    }

    // VBLANK
    if (this.scanline === 241 && this.cycle === 1) {
      this.ppuStatus |= 0x80;
      if (this.ppuCtrl & 0x80) {
        this.nmiPending = true;
      }
      this.frameComplete = true;
    }

    // PRE-RENDER LINE CLEAR
    if (preLine && this.cycle === 1) {
      this.ppuStatus &= ~0x80;
      this.ppuStatus &= ~0x40;
      this.ppuStatus &= ~0x20;
      this.nmiPending = false;
    }

    // Advance cycle/scanline
    this.cycle++;
    if (this.cycle > 340) {
      this.cycle = 0;
      this.scanline++;
      if (this.scanline > 261) {
        this.scanline = 0;
        this.oddFrame = !this.oddFrame;
        this.frameComplete = false;
      }
    }

    // Odd frame skip: on odd frames with rendering enabled, skip the idle tick
    // at (0,0) by jumping from (339, 261) to (0, 0)
    if (preLine && this.cycle === 340 && this.oddFrame && renderingEnabled) {
      this.cycle = 0;
      this.scanline = 0;
      this.oddFrame = !this.oddFrame;
    }
  }

  // --- Debug / state access ---

  public getScanline(): number {
    return this.scanline;
  }

  public getCycle(): number {
    return this.cycle;
  }
}

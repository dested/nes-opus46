export enum Button {
  A = 0,
  B = 1,
  Select = 2,
  Start = 3,
  Up = 4,
  Down = 5,
  Left = 6,
  Right = 7,
}

export enum MirrorMode {
  Horizontal = 0,
  Vertical = 1,
  SingleScreenLower = 2,
  SingleScreenUpper = 3,
  FourScreen = 4,
}

// NTSC timing constants
export const CPU_FREQUENCY = 1789773; // Hz
export const PPU_CYCLES_PER_CPU = 3;
export const SCANLINES_PER_FRAME = 262;
export const CYCLES_PER_SCANLINE = 341;
export const CYCLES_PER_FRAME = 29780.5; // CPU cycles per frame
export const NES_WIDTH = 256;
export const NES_HEIGHT = 240;

export const StatusFlag = {
  Carry: 0x01,
  Zero: 0x02,
  InterruptDisable: 0x04,
  Decimal: 0x08,
  Break: 0x10,
  Unused: 0x20,
  Overflow: 0x40,
  Negative: 0x80,
} as const;

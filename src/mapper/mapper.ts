import { MirrorMode } from '../types';
import { RomInfo } from '../rom';
import { createMapper0 } from './mapper0';

export interface Mapper {
  cpuRead(address: number): number;
  cpuWrite(address: number, value: number): void;
  ppuRead(address: number): number;
  ppuWrite(address: number, value: number): void;
  getMirrorMode(): MirrorMode;
}

export function createMapper(romInfo: RomInfo): Mapper {
  switch (romInfo.mapper) {
    case 0:
      return createMapper0(romInfo);
    default:
      throw new Error(`Unsupported mapper: ${romInfo.mapper}`);
  }
}

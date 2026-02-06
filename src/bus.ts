import { Mapper } from './mapper/mapper';
import { APU } from './apu';
import { Controller } from './controller';

export interface BusDevice {
  ppuRead(register: number): number;
  ppuWrite(register: number, value: number): void;
  oamDmaWrite(data: Uint8Array): void;
}

export class Bus {
  private ram: Uint8Array = new Uint8Array(2048);
  private mapper: Mapper;
  private apu: APU;
  private controller1: Controller;
  private controller2: Controller;
  private ppuDevice: BusDevice | null = null;
  private onDmaStall: ((cycles: number) => void) | null = null;

  constructor(mapper: Mapper, apu: APU, controller1: Controller, controller2: Controller) {
    this.mapper = mapper;
    this.apu = apu;
    this.controller1 = controller1;
    this.controller2 = controller2;
  }

  setPPU(ppu: BusDevice): void {
    this.ppuDevice = ppu;
  }

  setDmaStallCallback(cb: (cycles: number) => void): void {
    this.onDmaStall = cb;
  }

  cpuRead(address: number): number {
    address &= 0xffff;

    // Internal RAM ($0000-$1FFF), 2KB mirrored
    if (address < 0x2000) {
      return this.ram[address & 0x07ff];
    }

    // PPU registers ($2000-$3FFF), 8 registers mirrored
    if (address < 0x4000) {
      if (this.ppuDevice) {
        return this.ppuDevice.ppuRead(0x2000 + (address & 0x0007));
      }
      return 0;
    }

    // APU and I/O registers ($4000-$401F)
    if (address < 0x4020) {
      if (address === 0x4015) {
        return this.apu.read(address);
      }
      if (address === 0x4016) {
        return this.controller1.read();
      }
      if (address === 0x4017) {
        return this.controller2.read();
      }
      return 0;
    }

    // Cartridge/mapper space ($4020-$FFFF)
    return this.mapper.cpuRead(address);
  }

  cpuWrite(address: number, value: number): void {
    address &= 0xffff;

    // Internal RAM ($0000-$1FFF), 2KB mirrored
    if (address < 0x2000) {
      this.ram[address & 0x07ff] = value;
      return;
    }

    // PPU registers ($2000-$3FFF), 8 registers mirrored
    if (address < 0x4000) {
      if (this.ppuDevice) {
        this.ppuDevice.ppuWrite(0x2000 + (address & 0x0007), value);
      }
      return;
    }

    // APU and I/O registers ($4000-$401F)
    if (address < 0x4020) {
      // OAM DMA
      if (address === 0x4014) {
        this.performOamDma(value);
        return;
      }

      // Controller strobe
      if (address === 0x4016) {
        this.controller1.write(value);
        this.controller2.write(value);
        return;
      }

      // APU registers ($4000-$4013, $4015, $4017)
      if (address <= 0x4013 || address === 0x4015 || address === 0x4017) {
        this.apu.write(address, value);
        return;
      }

      return;
    }

    // Cartridge/mapper space ($4020-$FFFF)
    this.mapper.cpuWrite(address, value);
  }

  private performOamDma(page: number): void {
    const baseAddress = page << 8;
    const dmaData = new Uint8Array(256);

    for (let i = 0; i < 256; i++) {
      dmaData[i] = this.cpuRead(baseAddress + i);
    }

    if (this.ppuDevice) {
      this.ppuDevice.oamDmaWrite(dmaData);
    }

    // DMA takes 513 CPU cycles (or 514 on odd cycles, but we use 513 as baseline)
    if (this.onDmaStall) {
      this.onDmaStall(513);
    }
  }
}

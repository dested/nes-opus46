import { createCliRenderer, RGBA, FrameBufferRenderable } from '@opentui/core';
import type { CliRenderer, KeyHandler } from '@opentui/core';
import { nesPalette } from '../ppu/palette';
import { NES_WIDTH, NES_HEIGHT } from '../types';

export class NESRenderer {
  private renderer: CliRenderer | null = null;
  private frameBufferRenderable: FrameBufferRenderable | null = null;
  private paletteRGBA: RGBA[] = [];
  private scale: number = 1;
  private bufferW: number = 0;
  private bufferH: number = 0;

  get keyInput(): KeyHandler {
    return this.renderer!.keyInput;
  }

  async init(): Promise<void> {
    // Pre-compute RGBA palette from NES colors
    this.paletteRGBA = nesPalette.map(([r, g, b]) => RGBA.fromInts(r, g, b));

    this.renderer = await createCliRenderer({
      targetFps: 60,
      exitOnCtrlC: true,
      useMouse: false,
    });

    // Calculate scaling to fit terminal
    const termW = this.renderer.terminalWidth;
    const termH = this.renderer.terminalHeight;

    // Each cell is 1 char wide, half-block gives 2 vertical pixels per cell
    const scaleX = Math.max(1, Math.floor(termW / NES_WIDTH));
    const scaleY = Math.max(1, Math.floor((termH * 2) / NES_HEIGHT));
    this.scale = Math.min(scaleX, scaleY);

    this.bufferW = Math.min(termW, NES_WIDTH * this.scale);
    this.bufferH = Math.min(termH, Math.ceil((NES_HEIGHT * this.scale) / 2));

    const offsetX = Math.floor((termW - this.bufferW) / 2);
    const offsetY = Math.floor((termH - this.bufferH) / 2);

    this.frameBufferRenderable = new FrameBufferRenderable(this.renderer, {
      id: 'nes-display',
      width: this.bufferW,
      height: this.bufferH,
      position: 'absolute',
      left: offsetX,
      top: offsetY,
    });

    this.renderer.root.add(this.frameBufferRenderable);
  }

  renderFrame(pixelBuffer: Uint8Array): void {
    if (!this.frameBufferRenderable) return;
    const fb = this.frameBufferRenderable.frameBuffer;

    for (let ty = 0; ty < this.bufferH; ty++) {
      for (let tx = 0; tx < this.bufferW; tx++) {
        // Map terminal cell to NES pixel coordinates
        const nesTopY = Math.min(Math.floor((ty * 2) / this.scale), NES_HEIGHT - 1);
        const nesTopX = Math.min(Math.floor(tx / this.scale), NES_WIDTH - 1);
        const nesBotY = Math.min(Math.floor((ty * 2 + 1) / this.scale), NES_HEIGHT - 1);

        const topIdx = nesTopY * NES_WIDTH + nesTopX;
        const botIdx = nesBotY * NES_WIDTH + nesTopX;

        const topColor = this.paletteRGBA[pixelBuffer[topIdx] & 0x3F] || this.paletteRGBA[0];
        const botColor = this.paletteRGBA[pixelBuffer[botIdx] & 0x3F] || this.paletteRGBA[0];

        // Upper half-block: fg = top pixel, bg = bottom pixel
        fb.setCell(tx, ty, '\u2580', topColor, botColor);
      }
    }
  }

  setFrameCallback(cb: (deltaTime: number) => Promise<void> | void): void {
    this.renderer?.setFrameCallback(async (dt: number) => {
      await cb(dt);
    });
  }

  start(): void {
    this.renderer?.start();
  }

  stop(): void {
    this.renderer?.destroy();
  }
}

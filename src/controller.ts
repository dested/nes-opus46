import { Button } from './types';

export class Controller {
  private buttons: boolean[] = new Array(8).fill(false);
  private shiftRegister: number = 0;
  private strobe: boolean = false;

  setButton(button: Button, pressed: boolean): void {
    this.buttons[button] = pressed;
  }

  write(value: number): void {
    this.strobe = (value & 1) !== 0;
    if (this.strobe) {
      this.reloadShiftRegister();
    }
  }

  read(): number {
    if (this.strobe) {
      // While strobe is high, continuously reload and return button A state
      this.reloadShiftRegister();
      return this.shiftRegister & 1;
    }

    const result = this.shiftRegister & 1;
    this.shiftRegister >>= 1;
    // After all 8 bits are read, subsequent reads return 1
    this.shiftRegister |= 0x80;
    return result;
  }

  private reloadShiftRegister(): void {
    this.shiftRegister = 0;
    for (let i = 0; i < 8; i++) {
      if (this.buttons[i]) {
        this.shiftRegister |= (1 << i);
      }
    }
  }
}

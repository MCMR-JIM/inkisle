export interface PressureSample { x: number; y: number; time: number; pressure?: number }

/** Input-only state: screen-space speed must never depend on the camera zoom. */
export class PressureSampler {
  value: number;
  private speed = 0;

  constructor(private device: string, private previous: PressureSample) {
    this.value = device === 'pen' ? pressureValue(previous.pressure) : .65;
  }

  next(sample: PressureSample): number {
    const elapsed = sample.time - this.previous.time;
    if (!(elapsed > 0)) return this.value;
    let target: number;
    if (this.device === 'pen') target = pressureValue(sample.pressure);
    else {
      const speed = Math.hypot(sample.x - this.previous.x, sample.y - this.previous.y) / elapsed;
      this.speed += (Math.min(6, speed) - this.speed) * (1 - Math.exp(-elapsed / 35));
      target = .18 + .72 / (1 + this.speed / .65);
    }
    this.value += (target - this.value) * (1 - Math.exp(-elapsed / (this.device === 'pen' ? 10 : 24)));
    this.previous = sample;
    return this.value;
  }
}

export function pressureValue(value: number | undefined): number {
  return value === undefined || !Number.isFinite(value) ? .5 : Math.max(0, Math.min(1, value));
}

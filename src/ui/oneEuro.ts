/**
 * One Euro filter (Casiez, Roussel & Vogel, CHI 2012): smooths hard when the
 * signal barely moves (steady aim) and lightly when it moves fast (no lag).
 * Tuning: lower `minCutoff` for less jitter at rest, raise `beta` for less lag
 * in quick moves. https://cristal.univ-lille.fr/~casiez/1euro
 */
export class OneEuro {
  private x: number | null = null
  private dx = 0
  private t = 0

  constructor(
    private minCutoff = 1,
    private beta = 0.007,
    private dCutoff = 1,
  ) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff)
    return 1 / (1 + tau / dt)
  }

  filter(value: number, timeMs: number): number {
    if (this.x === null) {
      this.x = value
      this.t = timeMs
      return value
    }
    const dt = Math.max(1e-3, (timeMs - this.t) / 1000)
    this.t = timeMs
    const rawDx = (value - this.x) / dt
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += OneEuro.alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

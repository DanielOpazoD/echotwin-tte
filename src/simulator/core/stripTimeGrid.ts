/**
 * Display time is independent of work performed in a render step. Columns cover contiguous cells;
 * their timestamps are cell centres. No catch-up debt may be painted using the present timestamp.
 */
export class StripTimeGrid {
  private startS: number | undefined;
  private written = 0;

  reset(): void {
    this.startS = undefined;
    this.written = 0;
  }

  advance(timeS: number, dtS: number, columnsPerSecond: number): number[] {
    this.startS ??= timeS - dtS;
    const due = Math.floor((timeS - this.startS) * columnsPerSecond + 1e-8);
    const times: number[] = [];
    while (this.written < due) times.push(this.startS + (this.written++ + 0.5) / columnsPerSecond);
    return times;
  }
}

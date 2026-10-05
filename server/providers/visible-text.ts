/** A transport safeguard for local runtimes that leave explicit thinking tags in content.
 * It cannot identify untagged reasoning. Keep the runtime's native thinking parser enabled.
 * Pending tag prefixes are bounded; incomplete hidden blocks remain private at EOF.
 */
export class VisibleText {
  private pending = '';
  private hidden = false;
  push(delta: string): string {
    this.pending += delta;
    let visible = '';
    while (this.pending) {
      const marker = this.hidden ? '</think>' : '<think>';
      const at = this.pending.indexOf(marker);
      if (at >= 0) {
        if (!this.hidden) visible += this.pending.slice(0, at);
        this.pending = this.pending.slice(at + marker.length);
        this.hidden = !this.hidden;
        continue;
      }
      let retained = 0;
      for (let length = 1; length < marker.length; length++) {
        if (this.pending.endsWith(marker.slice(0, length))) retained = length;
      }
      if (!this.hidden) visible += this.pending.slice(0, this.pending.length - retained);
      this.pending = retained ? this.pending.slice(-retained) : '';
      break;
    }
    return visible;
  }
  finish(): string {
    const tail = this.hidden ? '' : this.pending;
    this.pending = '';
    return tail;
  }
}

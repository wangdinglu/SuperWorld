/**
 * Knocking on a private space: the visitor waits at the door until the owner (who must be inside)
 * lets them in or says no. Admitted visitors get a pass for 10 minutes. Single-process, in memory.
 */
interface Waiting {
  name: string;
  resolve(allowed: boolean): void;
}

const PASS_MS = 10 * 60_000;

export class Knocks {
  private readonly waiting = new Map<string, Map<string, Waiting>>();
  private readonly passes = new Map<string, number>();
  private readonly ringers = new Map<string, (userId: string, name: string) => void>();

  /** The space's room registers how to tell its owner about a knock. Returns an unregister function. */
  onKnock(placeId: string, ring: (userId: string, name: string) => void): () => void {
    this.ringers.set(placeId, ring);
    return () => {
      if (this.ringers.get(placeId) === ring) this.ringers.delete(placeId);
    };
  }

  hasPass(placeId: string, userId: string, now = Date.now()): boolean {
    return (this.passes.get(`${placeId}|${userId}`) ?? 0) > now;
  }

  /** Waits for the owner's answer. Resolves false if the owner isn't there or doesn't answer in time. */
  knock(placeId: string, userId: string, name: string, timeoutMs = 60_000): Promise<boolean> {
    const ring = this.ringers.get(placeId);
    if (!ring) return Promise.resolve(false);
    return new Promise((resolve) => {
      const queue = this.waiting.get(placeId) ?? new Map<string, Waiting>();
      this.waiting.set(placeId, queue);
      const timer = setTimeout(() => this.answer(placeId, userId, false), timeoutMs);
      queue.set(userId, {
        name,
        resolve: (allowed) => {
          clearTimeout(timer);
          resolve(allowed);
        },
      });
      ring(userId, name);
    });
  }

  answer(placeId: string, userId: string, allowed: boolean, now = Date.now()): void {
    const entry = this.waiting.get(placeId)?.get(userId);
    if (!entry) return;
    this.waiting.get(placeId)!.delete(userId);
    if (allowed) this.passes.set(`${placeId}|${userId}`, now + PASS_MS);
    entry.resolve(allowed);
  }
}

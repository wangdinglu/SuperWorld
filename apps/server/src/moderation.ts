/**
 * Phase 1 safety basics: a small word filter and per-client rate limits.
 * Real classifiers arrive with publishing moderation in Phase 3.
 */
const BLOCKED = [
  "fuck",
  "shit",
  "cunt",
  "nigger",
  "faggot",
  "retard",
  "bitch",
  "whore",
  "slut",
  "rape",
];
const pattern = new RegExp(`\\b(${BLOCKED.join("|")})\\w*`, "gi");

export function maskText(text: string): string {
  return text.replace(pattern, (word) => "*".repeat(word.length));
}

/** Allows `limit` events per `windowMs` per key. */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  forget(key: string): void {
    this.hits.delete(key);
  }
}

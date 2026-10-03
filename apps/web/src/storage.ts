/** Per-device conveniences only (name, colour, token). Everything must work without storage. */
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`superworld:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem(`superworld:${key}`, JSON.stringify(value));
  } catch {
    // Private mode or storage blocked: fine, we just don't remember.
  }
}

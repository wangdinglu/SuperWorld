/** Nearby-only updates: which avatars each client should receive. */
export const INTEREST = {
  /** Grid cell size in metres. A client sees its own cell and the eight around it. */
  cell: 24,
  /** Most avatars sent to one client, nearest first. */
  maxVisible: 40,
} as const;

export interface Positioned {
  x: number;
  z: number;
}

/** Ids of the avatars `viewer` should see, nearest first, always including itself. */
export function visibleFor<T extends Positioned>(viewerId: string, all: Map<string, T>): string[] {
  const me = all.get(viewerId);
  if (!me) return [];
  const cx = Math.floor(me.x / INTEREST.cell);
  const cz = Math.floor(me.z / INTEREST.cell);
  const near: { id: string; d: number }[] = [];
  for (const [id, p] of all) {
    if (id === viewerId) continue;
    if (Math.abs(Math.floor(p.x / INTEREST.cell) - cx) > 1) continue;
    if (Math.abs(Math.floor(p.z / INTEREST.cell) - cz) > 1) continue;
    near.push({ id, d: (p.x - me.x) ** 2 + (p.z - me.z) ** 2 });
  }
  near.sort((a, b) => a.d - b.d);
  return [viewerId, ...near.slice(0, INTEREST.maxVisible - 1).map((n) => n.id)];
}

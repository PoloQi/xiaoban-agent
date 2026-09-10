export const ACTIVITY_TARGET_OPTIONS = [5, 10, 15] as const;

export const ACTIVITY_ENCOURAGEMENTS = [
  "一步一步来，今天的你已经在行动。",
  "不用和别人比，按自己的节奏走就好。",
  "坚持这一小会儿，也是在照顾自己。",
  "你愿意开始，就已经很勇敢了。",
] as const;

export function chooseEncouragement(random = Math.random): string {
  const index = Math.floor(random() * ACTIVITY_ENCOURAGEMENTS.length);
  return ACTIVITY_ENCOURAGEMENTS[Math.min(index, ACTIVITY_ENCOURAGEMENTS.length - 1)]!;
}

export function parseCustomTarget(value: string, maximum = 120): number | null {
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > maximum) return null;
  return minutes;
}

export function formatRemainingSeconds(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, "0")}:${String(safeSeconds % 60).padStart(2, "0")}`;
}

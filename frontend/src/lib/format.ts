import type { EventCategory, Role } from './types';

const pad = (n: number, w = 2) => String(Math.floor(n)).padStart(w, '0');

export function toDate(v: string | number | Date | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 24h local clock, e.g. "10:24:45". */
export function clock(v: string | number | Date | null | undefined, withMs = false): string {
  const d = toDate(v);
  if (!d) return '—';
  const base = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  return withMs ? `${base}.${pad(d.getMilliseconds(), 3)}` : base;
}

export function dateTime(v: string | number | Date | null | undefined): string {
  const d = toDate(v);
  if (!d) return '—';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${clock(d)}`;
}

/** Seconds → "1:02:03" / "2:03". */
export function duration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds) || totalSeconds < 0) return '—';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Relative "12s ago", "5m ago", "3h ago", "2d ago". */
export function ago(v: string | number | Date | null | undefined, now: number = Date.now()): string {
  const d = toDate(v);
  if (!d) return 'never';
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Countdown until a future timestamp, "in 12s" / "now". */
export function until(v: string | null | undefined, now: number = Date.now()): string | null {
  const d = toDate(v);
  if (!d) return null;
  const s = Math.round((d.getTime() - now) / 1000);
  if (s <= 0) return 'now';
  if (s < 60) return `in ${s}s`;
  return `in ${Math.floor(s / 60)}m ${pad(s % 60)}s`;
}

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : digits)} ${units[i]}`;
}

export function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  return `${n.toFixed(digits)}%`;
}

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  speech: 'Human speech',
  barking: 'Barking',
  alarm_siren: 'Alarm / siren',
  glass_break: 'Glass breaking',
  gunshot_like: 'Gunshot-like',
  distress: 'Scream / distress',
  vehicle: 'Vehicle',
  knock: 'Knocking',
  other: 'Other sound',
};

export function categoryLabel(c: string): string {
  return (CATEGORY_LABEL as Record<string, string>)[c] ?? c;
}

export function channelLabel(slot: number, name?: string | null): string {
  const tag = `CH${pad(slot)}`;
  return name ? `${tag} – ${name}` : tag;
}

const RANK: Record<Role, number> = { viewer: 0, operator: 1, admin: 2 };
export function hasRole(userRole: Role | undefined, needed: Role): boolean {
  if (!userRole) return false;
  return RANK[userRole] >= RANK[needed];
}

export function roleHint(needed: Role): string {
  return `Requires the ${needed} role`;
}

/** Date → value for <input type="datetime-local">. */
export function toLocalInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromLocalInput(v: string): string | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

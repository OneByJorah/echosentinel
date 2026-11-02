import { describe, expect, it } from 'vitest';
import { ago, bytes, channelLabel, duration, hasRole, until } from './format';

describe('format', () => {
  it('formats durations', () => {
    expect(duration(0)).toBe('0:00');
    expect(duration(65)).toBe('1:05');
    expect(duration(3723)).toBe('1:02:03');
    expect(duration(null)).toBe('—');
  });
  it('formats relative times', () => {
    const now = Date.parse('2026-11-02T10:00:00Z');
    expect(ago('2026-11-02T09:59:50Z', now)).toBe('10s ago');
    expect(ago('2026-11-02T09:55:00Z', now)).toBe('5m ago');
    expect(ago(null, now)).toBe('never');
    expect(until('2026-11-02T10:00:12Z', now)).toBe('in 12s');
    expect(until('2026-11-02T09:00:00Z', now)).toBe('now');
  });
  it('formats bytes', () => {
    expect(bytes(512)).toBe('512 B');
    expect(bytes(1536)).toBe('1.5 KB');
    expect(bytes(4 * 1024 ** 4, 0)).toBe('4 TB');
  });
  it('labels channels and checks roles', () => {
    expect(channelLabel(1, 'Main Audio')).toBe('CH01 – Main Audio');
    expect(hasRole('operator', 'viewer')).toBe(true);
    expect(hasRole('viewer', 'operator')).toBe(false);
    expect(hasRole(undefined, 'viewer')).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { decodeS16LE, peakAbs } from './pcm';

describe('pcm', () => {
  it('decodes signed 16-bit little endian', () => {
    const buf = new ArrayBuffer(8);
    const v = new DataView(buf);
    v.setInt16(0, 0, true);
    v.setInt16(2, 16384, true);
    v.setInt16(4, -32768, true);
    v.setInt16(6, 32767, true);
    const out = decodeS16LE(buf);
    expect(Array.from(out)).toEqual([0, 0.5, -1, 32767 / 32768]);
  });
  it('ignores a trailing odd byte', () => expect(decodeS16LE(new ArrayBuffer(5)).length).toBe(2));
  it('computes absolute peak', () => expect(peakAbs(new Float32Array([0.1, -0.7, 0.3]))).toBeCloseTo(0.7));
});

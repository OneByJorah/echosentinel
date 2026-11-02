import { describe, expect, it } from 'vitest';
import { redact } from './redact';

describe('redact', () => {
  it('masks emails', () => expect(redact('mail me at jo.doe+x@example.org now')).toBe('mail me at [email] now'));
  it('masks phone numbers', () => {
    expect(redact('call 340-555-0199 tonight')).toBe('call [phone] tonight');
    expect(redact('call +1 (340) 555 0199')).toContain('[phone]');
  });
  it('masks remaining digits', () => expect(redact('gate code 4821')).toBe('gate code ••••'));
  it('leaves plain text alone', () => expect(redact('keep an eye on the front')).toBe('keep an eye on the front'));
});

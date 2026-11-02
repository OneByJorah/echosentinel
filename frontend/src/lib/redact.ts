// Client-side, display-only redaction of likely PII in transcript text.
// Order matters: emails first, then phone numbers, then any remaining digits.

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// Phone-like: optional +country, 7+ digits with common separators.
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{3,4}[\s.-]?\d{3,4}(?:[\s.-]?\d{2,4})?/g;
const DIGIT = /\d/g;

export function redact(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 7 ? '[phone]' : m))
    .replace(DIGIT, '•');
}

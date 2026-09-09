import {
  buildNudgeMessage,
  buildWhatsAppUrl,
  normalizePhoneForWhatsApp,
  sanitizePhoneForWhatsApp,
} from '../src/utils/nudgeMessage';

describe('buildNudgeMessage', () => {
  test('formats a whole-number amount without decimals', () => {
    expect(buildNudgeMessage('Rahul', 500, 'Pizza Place')).toBe(
      'Hey Rahul, you owe me ₹500 for Pizza Place. Please pay via UPI!'
    );
  });

  test('formats a fractional amount to two decimals', () => {
    expect(buildNudgeMessage('Priya', 33.5, 'Cab Split')).toBe(
      'Hey Priya, you owe me ₹33.50 for Cab Split. Please pay via UPI!'
    );
  });
});

describe('sanitizePhoneForWhatsApp', () => {
  test('strips spaces, dashes, and parens, keeping a leading +', () => {
    expect(sanitizePhoneForWhatsApp('+91 98765-43210')).toBe('+919876543210');
  });

  test('strips parens around an area code', () => {
    expect(sanitizePhoneForWhatsApp('(987) 654-3210')).toBe('9876543210');
  });
});

describe('normalizePhoneForWhatsApp', () => {
  test('prefixes a bare 10-digit Indian mobile number with 91', () => {
    expect(normalizePhoneForWhatsApp('98765 43210')).toBe('919876543210');
  });

  test('strips a leading 0 before prefixing', () => {
    expect(normalizePhoneForWhatsApp('09876543210')).toBe('919876543210');
  });

  test('leaves a number that already carries a country code alone', () => {
    expect(normalizePhoneForWhatsApp('+91 98765 43210')).toBe('919876543210');
  });

  test('does not guess at a number of an unexpected length', () => {
    expect(normalizePhoneForWhatsApp('12345')).toBe('12345');
  });
});

describe('buildWhatsAppUrl', () => {
  test('builds a wa.me click-to-chat link when a phone is on file', () => {
    const url = buildWhatsAppUrl('Hey there', '98765 43210');
    expect(url).toBe('https://wa.me/919876543210?text=Hey%20there');
  });

  test('falls back to the contact picker when no phone is on file', () => {
    expect(buildWhatsAppUrl('Hey there', null)).toBe('whatsapp://send?text=Hey%20there');
  });

  test('falls back to the contact picker when phone is undefined', () => {
    expect(buildWhatsAppUrl('Hey there')).toBe('whatsapp://send?text=Hey%20there');
  });
});

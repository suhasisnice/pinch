import { buildNudgeMessage, buildWhatsAppUrl, sanitizePhoneForWhatsApp } from '../src/utils/nudgeMessage';

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

describe('buildWhatsAppUrl', () => {
  test('includes the phone param when a phone is given', () => {
    const url = buildWhatsAppUrl('Hey there', '+91 98765-43210');
    expect(url).toBe('whatsapp://send?phone=+919876543210&text=Hey%20there');
  });

  test('omits the phone param when no phone is on file, letting WhatsApp pick the recipient', () => {
    const url = buildWhatsAppUrl('Hey there', null);
    expect(url).toBe('whatsapp://send?text=Hey%20there');
  });

  test('omits the phone param when phone is undefined', () => {
    const url = buildWhatsAppUrl('Hey there');
    expect(url).toBe('whatsapp://send?text=Hey%20there');
  });
});

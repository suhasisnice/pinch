import {
  ACCEPT_THRESHOLD,
  buildDedupKey,
  isLikelyBankSender,
  parseMessage,
} from '../src/services/parserService';

describe('real bank SMS formats', () => {
  const cases: Array<{ bank: string; text: string; amount: number; merchant: string }> = [
    {
      bank: 'HDFC',
      text: 'Rs.700.00 spent on HDFC Bank Card x1234 at OLIVE CAFE on 08-09-26. Not you? Call 18002586161',
      amount: 700,
      merchant: 'Olive Cafe',
    },
    {
      bank: 'ICICI',
      text: 'ICICI Bank Acct XX123 debited for Rs 340.00 on 08-Sep-26; SWIGGY credited. UPI:412345678901',
      amount: 340,
      merchant: 'Swiggy',
    },
    {
      bank: 'SBI',
      text: 'Dear Customer, Rs.250 debited from A/c XX1234 on 08/09/26 to VPA zomato@ybl. Ref 512345678901 -SBI',
      amount: 250,
      merchant: 'Zomato',
    },
    {
      bank: 'Axis',
      text: 'INR 1240 debited A/c no. XX5678 08-09-26 20:31:45 UPI/P2M/612345678/TOIT BREWPUB',
      amount: 1240,
      merchant: 'Toit Brewpub',
    },
  ];

  for (const testCase of cases) {
    it(`parses a ${testCase.bank} debit`, () => {
      const parsed = parseMessage(testCase.text, 'VM-HDFCBK');
      expect(parsed).not.toBeNull();
      expect(parsed?.amount).toBe(testCase.amount);
      expect(parsed?.direction).toBe('DEBIT');
      expect(parsed?.counterparty).toBe(testCase.merchant);
    });
  }

  it('parses a credit and names the sender', () => {
    const parsed = parseMessage(
      'Rs.175 credited to A/c XX1234 on 08-09-26 from RAHUL SHARMA. Ref 812345678901',
      'AD-ICICIB'
    );
    expect(parsed?.direction).toBe('CREDIT');
    expect(parsed?.amount).toBe(175);
    expect(parsed?.counterparty).toBe('Rahul Sharma');
  });

  it('reads a debit as a debit even when the message also says credited', () => {
    // "Acct debited ... ; MERCHANT credited" contains both verbs. Your account
    // is the subject, so this is money leaving.
    const parsed = parseMessage('ICICI Bank Acct XX123 debited for Rs 340.00; SWIGGY credited.');
    expect(parsed?.direction).toBe('DEBIT');
  });

  it('handles amounts with comma grouping and paise', () => {
    const parsed = parseMessage('Rs.12,499.50 spent on Card x1234 at CROMA on 08-09-26');
    expect(parsed?.amount).toBe(12499.5);
  });

  it('handles a trailing currency token', () => {
    const parsed = parseMessage('Your account XX9012 is debited 450 INR at BIG BAZAAR');
    expect(parsed?.amount).toBe(450);
  });
});

describe('messages that must not become transactions', () => {
  const rejects = [
    ['an OTP', '723418 is your OTP for a txn of Rs.5000 at AMAZON. Do not share it with anyone.'],
    ['a scheduled debit', 'Rs.499 will be debited from your A/c on 12-09-26 for Netflix.'],
    ['a failed payment', 'Your payment of Rs.700 to OLIVE CAFE has failed.'],
    ['a declined card', 'Txn of Rs.2000 at CROMA declined due to insufficient balance.'],
    ['a balance enquiry', 'Available balance in A/c XX1234 is Rs.4,320.50 as on 08-09-26.'],
    ['a collect request', 'RAHUL has requested money Rs.500 via UPI. Collect request expires soon.'],
    ['a promo', 'Get cashback of Rs.500! Apply now for a personal loan. Click here.'],
    ['a bill reminder', 'Your credit card bill of Rs.8,400 is due on 15-09-26. Min amount due Rs.420.'],
  ];

  for (const [label, text] of rejects) {
    it(`rejects ${label}`, () => {
      expect(parseMessage(text)).toBeNull();
    });
  }

  it('rejects a message with no money verb', () => {
    expect(parseMessage('Rs.700 OLIVE CAFE 08-09-26')).toBeNull();
  });

  it('rejects a message with no amount', () => {
    expect(parseMessage('Your account was debited at OLIVE CAFE')).toBeNull();
  });

  it('rejects empty and trivial input', () => {
    expect(parseMessage('')).toBeNull();
    expect(parseMessage('hi')).toBeNull();
  });
});

describe('confidence', () => {
  it('trusts a fully-specified message from a bank sender', () => {
    const parsed = parseMessage(
      'Rs.340 debited from A/c XX1234 at SWIGGY. Ref 412345678901',
      'VM-HDFCBK'
    );
    expect(parsed!.confidence).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it('holds back a vague message for review', () => {
    // Names an account, so it is a real debit — but with no merchant, no
    // reference and an unknown sender it is not confident enough to post.
    const parsed = parseMessage('Rs.340 debited from A/c XX1234');
    expect(parsed).not.toBeNull();
    expect(parsed!.confidence).toBeLessThan(ACCEPT_THRESHOLD);
  });

  it('never exceeds 1', () => {
    const parsed = parseMessage(
      'Rs.340.00 spent on HDFC Bank Card x1234 at SWIGGY on 08-09-26. UPI Ref 412345678901',
      'VM-HDFCBK'
    );
    expect(parsed!.confidence).toBeLessThanOrEqual(1);
  });

  it('trusts an unambiguous notification even with no account number or reference', () => {
    // A notification never carries either — that is simply not how a
    // payment app words its own notifications — so scoring it against
    // SMS-shaped evidence it structurally cannot have used to cap even a
    // perfectly clear message under the accept threshold.
    const parsed = parseMessage('Bacchi sent 229 to you', null, { source: 'NOTIFICATION' });
    expect(parsed!.confidence).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it('still holds back a vague notification with no named counterparty', () => {
    // The fix credits a notification's package-allowlist trust — it does
    // not blindly accept every notification regardless of how little the
    // message itself actually says.
    const parsed = parseMessage('credited by 229', null, { source: 'NOTIFICATION' });
    expect(parsed).not.toBeNull();
    expect(parsed!.confidence).toBeLessThan(ACCEPT_THRESHOLD);
  });
});

describe('sender recognition', () => {
  it('recognises bank sender IDs', () => {
    expect(isLikelyBankSender('VM-HDFCBK')).toBe(true);
    expect(isLikelyBankSender('AD-ICICIB')).toBe(true);
    expect(isLikelyBankSender('JD-SBIINB')).toBe(true);
    expect(isLikelyBankSender('BZ-PAYTMB')).toBe(true);
  });

  it('does not recognise a personal number', () => {
    expect(isLikelyBankSender('+919876543210')).toBe(false);
    expect(isLikelyBankSender(null)).toBe(false);
  });
});

describe('dedup keys', () => {
  it('uses the bank reference when there is one', () => {
    const key = buildDedupKey({ amount: 340, reference: 'abc123456', direction: 'DEBIT' });
    expect(key).toBe('ref:ABC123456');
  });

  // The same payment reported by SMS and by the notification listener must
  // collapse to one transaction, and they word the merchant differently.
  it('matches the same payment across two sources via the reference', () => {
    const fromSms = buildDedupKey({ amount: 340, reference: '412345678901', direction: 'DEBIT' });
    const fromNotification = buildDedupKey({
      amount: 340,
      reference: '412345678901',
      direction: 'DEBIT',
    });
    expect(fromSms).toBe(fromNotification);
  });

  it('buckets by time when no reference is available', () => {
    const at = new Date('2026-09-09T12:00:00.000Z');
    const soonAfter = new Date('2026-09-09T12:00:30.000Z');
    const key = buildDedupKey({ amount: 340, reference: null, direction: 'DEBIT' }, at);
    const nearby = buildDedupKey({ amount: 340, reference: null, direction: 'DEBIT' }, soonAfter);
    expect(key).toBe(nearby);
  });

  it('separates genuinely different payments of the same amount', () => {
    const morning = new Date('2026-09-09T09:00:00.000Z');
    const evening = new Date('2026-09-09T19:00:00.000Z');
    const a = buildDedupKey({ amount: 340, reference: null, direction: 'DEBIT' }, morning);
    const b = buildDedupKey({ amount: 340, reference: null, direction: 'DEBIT' }, evening);
    expect(a).not.toBe(b);
  });

  it('separates a debit from a credit of the same amount', () => {
    const at = new Date('2026-09-09T12:00:00.000Z');
    const debit = buildDedupKey({ amount: 340, reference: null, direction: 'DEBIT' }, at);
    const credit = buildDedupKey({ amount: 340, reference: null, direction: 'CREDIT' }, at);
    expect(debit).not.toBe(credit);
  });
});

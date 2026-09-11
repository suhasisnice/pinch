import { detectPaymentMethod } from '../src/services/parserService';

describe('detectPaymentMethod', () => {
  it('recognises UPI from the rail marker', () => {
    expect(
      detectPaymentMethod('Rs.250 debited from A/c XX1234 to VPA zomato@ybl. Ref 512345678901')
    ).toBe('UPI');
    expect(detectPaymentMethod('INR 1240 debited A/c no. XX5678 UPI/P2M/612345678/TOIT BREWPUB')).toBe(
      'UPI'
    );
  });

  it('recognises a card transaction', () => {
    expect(
      detectPaymentMethod('Rs.700.00 spent on HDFC Bank Card x1234 at OLIVE CAFE on 08-09-26')
    ).toBe('CARD');
    expect(detectPaymentMethod('Txn of Rs.2000 at CROMA on Card ending 5678 declined')).toBe('CARD');
  });

  it('recognises an ATM withdrawal, reusing the same pattern classifyNonSpend uses', () => {
    expect(detectPaymentMethod('Rs 2000 withdrawn at ATM XX1234 on 08-09-26')).toBe('ATM');
  });

  it('recognises the named bank rails', () => {
    expect(detectPaymentMethod('Rs 50000 credited via NEFT to A/c XX1234 from EMPLOYER LTD')).toBe(
      'NEFT'
    );
    expect(detectPaymentMethod('Rs 5000 transferred via IMPS to A/c XX5678')).toBe('IMPS');
    expect(detectPaymentMethod('Rs 100000 credited via RTGS Ref 812345678901')).toBe('RTGS');
  });

  it('recognises net banking', () => {
    expect(detectPaymentMethod('Rs 8400 paid via Net Banking to CREDIT CARD BILL')).toBe('NETBANKING');
  });

  it('falls back to UNKNOWN rather than guessing', () => {
    expect(detectPaymentMethod('Rs 500 credited to your account from RAHUL SHARMA')).toBe('UNKNOWN');
    expect(detectPaymentMethod(null)).toBe('UNKNOWN');
    expect(detectPaymentMethod(undefined)).toBe('UNKNOWN');
  });

  it('prefers the more specific rail marker over a coincidental UPI mention', () => {
    // A rail transfer that also happens to be routed through a UPI handle is
    // rare in practice, but IMPS/NEFT/RTGS are unambiguous bank-rail names
    // that should win over the generic UPI marker when both are present.
    expect(detectPaymentMethod('Rs 5000 transferred via IMPS to VPA rahul@upi')).toBe('IMPS');
  });
});

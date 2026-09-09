import { parseCreditSms, parseDebitSms } from '../parserService';

describe('parseDebitSms', () => {
  it('parses the canonical "spent at ... via UPI" format', () => {
    expect(parseDebitSms('Rs. 700 spent at Olive Cafe via UPI')).toEqual({
      amount: 700,
      merchant: 'Olive Cafe',
    });
  });

  it('handles comma-separated thousands and decimals', () => {
    expect(
      parseDebitSms('INR 1,250.50 spent on Amazon Pay via UPI')
    ).toEqual({ amount: 1250.5, merchant: 'Amazon Pay' });
  });

  it('handles a "debited ... spent at" bank format ending in a period', () => {
    expect(
      parseDebitSms(
        'Rs 500 debited from A/c XX1234 on 05-Sep-26 spent at Big Bazaar.'
      )
    ).toEqual({ amount: 500, merchant: 'Big Bazaar' });
  });

  it('is case-insensitive', () => {
    expect(parseDebitSms('rs.99 spent at chai point via upi')).toEqual({
      amount: 99,
      merchant: 'Chai Point',
    });
  });

  it('handles merchant names with punctuation', () => {
    expect(
      parseDebitSms("Rs 250 spent at McDonald's via UPI")
    ).toEqual({ amount: 250, merchant: "McDonald's" });
  });

  it('handles large comma-formatted amounts without decimals', () => {
    expect(
      parseDebitSms('Rs 10,000 spent at Reliance Digital via UPI')
    ).toEqual({ amount: 10000, merchant: 'Reliance Digital' });
  });

  it('returns null for unrelated SMS text', () => {
    expect(
      parseDebitSms('Your OTP for login is 482913. Do not share it.')
    ).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseDebitSms('')).toBeNull();
  });
});

describe('parseCreditSms', () => {
  it('parses the canonical "Received Rs. X from Y via UPI" format', () => {
    expect(parseCreditSms('Received Rs. 175 from Rahul via UPI')).toEqual({
      amount: 175,
      sender: 'Rahul',
    });
  });

  it('handles the "credited ... from" bank format', () => {
    expect(
      parseCreditSms(
        'Rs 2,000 credited to your account from Priya Sharma via UPI'
      )
    ).toEqual({ amount: 2000, sender: 'Priya Sharma' });
  });

  it('handles multi-word sender names ending in a period', () => {
    expect(
      parseCreditSms('Received Rs. 500 from Arjun Mehta.')
    ).toEqual({ amount: 500, sender: 'Arjun Mehta' });
  });

  it('is case-insensitive', () => {
    expect(parseCreditSms('received rs.50 from asha via upi')).toEqual({
      amount: 50,
      sender: 'Asha',
    });
  });

  it('returns null for unrelated SMS text', () => {
    expect(
      parseCreditSms('Your account balance as of today is Rs. 5,000.')
    ).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseCreditSms('')).toBeNull();
  });

  it('does not mistake a debit SMS for a credit SMS', () => {
    expect(parseCreditSms('Rs. 700 spent at Olive Cafe via UPI')).toBeNull();
  });
});

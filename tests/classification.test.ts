import { classifyNonSpend, removesFromSpending } from '../src/math/classification';

const debit = (rawText: string, merchant = 'Unknown') =>
  ({ direction: 'DEBIT' as const, merchant, rawText });

describe('wallet top-ups', () => {
  it('recognises money added to a wallet', () => {
    expect(
      classifyNonSpend(debit('Rs 500 debited from A/c XX1234 and added to your Paytm Wallet'))
    ).toBe('WALLET_TOPUP');
  });

  it('recognises a PhonePe top-up', () => {
    expect(
      classifyNonSpend(debit('INR 1000 debited A/c XX1234 - PhonePe wallet top-up'))
    ).toBe('WALLET_TOPUP');
  });

  it('does NOT treat paying a shop through a wallet as a top-up', () => {
    // The important negative. A brand name alone means nothing — most PhonePe
    // messages are ordinary purchases, and cancelling those would erase real
    // spending.
    expect(
      classifyNonSpend(debit('Rs 240 debited from A/c XX1234 to BLINKIT via PhonePe UPI'))
    ).toBeNull();
  });

  it('does not fire on a wallet name with no loading language', () => {
    expect(classifyNonSpend(debit('Rs 99 paid to Paytm Movies from A/c XX1234'))).toBeNull();
  });
});

describe('credit card bills', () => {
  it('recognises a card bill payment', () => {
    expect(
      classifyNonSpend(debit('Rs 8,420 debited from A/c XX1234 towards Credit Card Payment'))
    ).toBe('CARD_BILL');
  });

  it('recognises CRED, which exists only to pay card bills', () => {
    expect(classifyNonSpend(debit('Rs 4500 debited A/c XX1234 to CRED'))).toBe('CARD_BILL');
  });

  it('leaves an ordinary card purchase alone', () => {
    expect(
      classifyNonSpend(debit('Rs.700 spent on HDFC Bank Card x1234 at OLIVE CAFE'))
    ).toBeNull();
  });
});

describe('cash withdrawals', () => {
  it('recognises an ATM withdrawal', () => {
    expect(classifyNonSpend(debit('Rs 2000 withdrawn at ATM from A/c XX1234'))).toBe(
      'CASH_WITHDRAWAL'
    );
  });

  it('keeps counting as spending, unlike the others', () => {
    // Cash spends silently. Removing the withdrawal would make the month look
    // cheaper than it was, and under-reporting is the worse error.
    expect(removesFromSpending('CASH_WITHDRAWAL')).toBe(false);
    expect(removesFromSpending('WALLET_TOPUP')).toBe(true);
    expect(removesFromSpending('CARD_BILL')).toBe(true);
  });
});

describe('everything else', () => {
  it('leaves an ordinary purchase alone', () => {
    expect(
      classifyNonSpend(debit('Rs.250 debited from A/c XX1234 to VPA zomato@ybl'))
    ).toBeNull();
  });

  it('never classifies a credit', () => {
    expect(
      classifyNonSpend({
        direction: 'CREDIT',
        merchant: 'Paytm',
        rawText: 'Rs 500 credited to your Paytm Wallet',
      })
    ).toBeNull();
  });
});

// Phase 9: an investment contribution/withdrawal is never auto-detected —
// classifyNonSpend has no pattern for it, on either direction — so it is
// only ever set by hand. removesFromSpending must still say yes for it on
// both sides: a contribution is not spending, and a withdrawal is not income.
describe('investments (manual only)', () => {
  it('is never auto-detected by classifyNonSpend', () => {
    expect(classifyNonSpend(debit('Rs.5000 debited from A/c XX1234 to ZERODHA'))).toBeNull();
    expect(
      classifyNonSpend({ direction: 'CREDIT', merchant: 'Zerodha', rawText: 'Rs.5000 credited' })
    ).toBeNull();
  });

  it('removes from spending on both directions once set', () => {
    expect(removesFromSpending('INVESTMENT')).toBe(true);
  });
});

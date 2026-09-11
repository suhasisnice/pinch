import { isReversalCredit, parseMessage } from '../src/services/parserService';

describe('money that came back', () => {
  const reversals: Array<[string, string]> = [
    [
      'failed UPI reversed',
      'Rs 250 debited from A/c XX1234 on 09-09-26 has been reversed and credited back to your account. Ref 512345678901',
    ],
    [
      'merchant refund',
      'INR 899 refunded to your A/c XX1234 for order cancellation by MYNTRA on 09-Sep-26',
    ],
    [
      'cancelled order',
      'Your cancelled order refund of Rs 340 has been credited to your A/c XX1234',
    ],
  ];

  it.each(reversals)('parses %s as a credit', (_label, body) => {
    const parsed = parseMessage(body, 'VM-HDFCBK');

    expect(parsed).not.toBeNull();
    expect(parsed?.direction).toBe('CREDIT');
    expect(parsed?.isRefund).toBe(true);
  });

  it('reads "Rs 250 debited ... reversed" as money arriving, not leaving', () => {
    // The sentence names a debit, and the reject list would previously have
    // thrown the whole message away on the word "reversed" — leaving the
    // original debit standing as spending that had in fact been undone.
    const parsed = parseMessage(
      'Rs 250 debited from A/c XX1234 has been reversed and credited back to your account',
      'VM-HDFCBK'
    );

    expect(parsed?.direction).toBe('CREDIT');
    expect(parsed?.amount).toBe(250);
  });

  it('reads a failure with a promised future refund as FAILED, not as a refund arriving now', () => {
    // "Will be refunded" is a promise, not an arrival — crediting it now would
    // book money the account has not received. It is not silently dropped
    // either: a failed payment is still worth keeping, just as a debit that
    // never completed rather than as income.
    const parsed = parseMessage(
      'Your payment of Rs 500 from A/c XX1234 has failed. The amount will be refunded within 3 working days',
      'VM-HDFCBK'
    );
    expect(parsed?.status).toBe('FAILED');
    expect(parsed?.direction).toBe('DEBIT');
    expect(parsed?.isRefund).toBe(false);
  });

  it('does not treat an ordinary purchase as a refund', () => {
    const parsed = parseMessage(
      'Rs.250 debited from A/c XX1234 to VPA zomato@ybl. Ref 512345678901',
      'VM-HDFCBK'
    );
    expect(parsed?.isRefund).toBe(false);
    expect(parsed?.direction).toBe('DEBIT');
  });
});

describe('isReversalCredit', () => {
  it('needs both a reversal word and evidence it actually arrived', () => {
    expect(isReversalCredit('payment failed, refund will be processed')).toBe(false);
    expect(isReversalCredit('amount reversed and credited back to your account')).toBe(true);
  });
});

import { parseMessage } from '../src/services/parserService';

/**
 * Real-world Indian bank and UPI SMS shapes, gathered because the hand-built
 * fixtures elsewhere were all in a small family of phrasings the parser
 * already handled well, while the messages people's phones actually receive
 * missed almost half the time — mostly SBI and HDFC, the two biggest banks.
 * A miss here is not a cosmetic bug: it is a debit that never gets counted,
 * which is how "safe to spend" ends up too high all month.
 */
describe('parseMessage against real bank/UPI phrasings', () => {
  const cases: Array<{
    label: string;
    text: string;
    amount: number;
    direction: 'DEBIT' | 'CREDIT';
    counterparty?: string;
  }> = [
    {
      label: 'SBI UPI debit with no currency symbol',
      text: 'Dear UPI user A/C X1234 debited by 150.0 on date 08Sep25 trf to ZOMATO Refno 123456789012 -SBI',
      amount: 150,
      direction: 'DEBIT',
      counterparty: 'Zomato',
    },
    {
      label: 'SBI UPI credit with no currency symbol',
      text: 'Dear UPI user A/C X1234 credited by 500.0 on date 08Sep25 by RAHUL Refno 123456789013 -SBI',
      amount: 500,
      direction: 'CREDIT',
      counterparty: 'Rahul',
    },
    {
      label: 'HDFC "Sent Rs.X From ... To Y" debit',
      text: 'Sent Rs.500.00 From HDFC Bank A/C x1234 To ZOMATO On 08/09/25 Ref 123456789012 Not You? Call 18002586161',
      amount: 500,
      direction: 'DEBIT',
      counterparty: 'Zomato',
    },
    {
      label: 'HDFC debit that quotes the balance afterwards',
      text: 'Rs.500.00 debited from A/c XX1234 on 08-09-25 to OLIVE CAFE. Avl Bal Rs.4,500.00 -HDFC Bank',
      amount: 500,
      direction: 'DEBIT',
      counterparty: 'Olive Cafe',
    },
    {
      label: 'ICICI debit that quotes "Available Balance"',
      text: 'INR 250.00 debited from A/c XX5678 on 08-Sep-25. Available Balance is INR 12,340.50. -ICICI Bank',
      amount: 250,
      direction: 'DEBIT',
    },
    {
      label: 'Paytm wallet debit, payee followed by "from Paytm A/c"',
      text: 'Rs 45 paid to Chai Point from Paytm A/c XX1234 Ref 445566778899',
      amount: 45,
      direction: 'DEBIT',
      counterparty: 'Chai Point',
    },
    {
      label: 'GPay-style debit to a VPA, payee followed by "from A/c"',
      text: 'You paid Rs.220 to swiggy@ybl from A/c XX1234 on 08 Sep. UPI Ref 112233445566',
      amount: 220,
      direction: 'DEBIT',
      counterparty: 'Swiggy',
    },
    {
      label: 'Federal Bank\'s "debited ... towards X"',
      text: 'Rs 60.00 has been debited from your A/c XX1234 towards ZEPTO on 08-09-2025. Bal: Rs 3,200',
      amount: 60,
      direction: 'DEBIT',
      counterparty: 'Zepto',
    },
  ];

  it.each(cases)('$label', ({ text, amount, direction, counterparty }) => {
    const parsed = parseMessage(text, 'VM-HDFCBK', { source: 'SMS' });
    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(amount);
    expect(parsed?.direction).toBe(direction);
    if (counterparty) expect(parsed?.counterparty).toBe(counterparty);
  });

  it('still rejects a credit alert\'s "to your account" clause as the payee', () => {
    // Regression guard: the bare "to X" fallback added for the cases above
    // must not swallow "credited to your account XX1234" before the message
    // reaches the clause that actually names who sent the money.
    const parsed = parseMessage(
      'Rs 2,000 credited to your account XX1234 from Priya Sharma via UPI',
      'VM-HDFCBK',
      { source: 'SMS' }
    );
    expect(parsed?.counterparty).toBe('Priya Sharma');
  });
});

/**
 * Money arriving, phrased as a sentence about the sender.
 *
 * These exist because loosening the debit verb from "sent to" to a bare
 * "sent" — done to catch HDFC's "Sent Rs.500 From A/C x1234 To ZOMATO" —
 * also swallowed every incoming payment, which uses the same word for the
 * opposite direction. A received ₹230 was booked as ₹230 spent, and the
 * counterparty came out as "You".
 */
describe('payment-app notifications for money received', () => {
  const inbound: Array<{ label: string; text: string; amount: number; counterparty?: string }> = [
    {
      label: 'sender named first, with an emoji in the display name',
      text: 'Piggy 🐷 sent ₹230 to you.',
      amount: 230,
      counterparty: 'Piggy',
    },
    {
      label: 'plain sender, no emoji',
      text: 'Rahul sent ₹500 to you',
      amount: 500,
      counterparty: 'Rahul',
    },
    {
      label: 'paid you, rather than sent to you',
      text: 'Priya Sharma paid you ₹1,200',
      amount: 1200,
      counterparty: 'Priya Sharma',
    },
    {
      label: 'arriving in your account rather than to you',
      text: 'Amit sent ₹340 to your account',
      amount: 340,
      counterparty: 'Amit',
    },
  ];

  it.each(inbound)('$label reads as money in', ({ text, amount, counterparty }) => {
    const parsed = parseMessage(text, null, { source: 'NOTIFICATION' });
    expect(parsed).not.toBeNull();
    expect(parsed?.direction).toBe('CREDIT');
    expect(parsed?.amount).toBe(amount);
    if (counterparty) expect(parsed?.counterparty).toBe(counterparty);
  });

  it('never reads the recipient as a merchant called You', () => {
    const parsed = parseMessage('Piggy sent ₹230 to you.', null, { source: 'NOTIFICATION' });
    expect(parsed?.counterparty).not.toBe('You');
  });

  it('still reads an outgoing payment worded with the same verb as money out', () => {
    // The case the bare "sent" was loosened for in the first place.
    const parsed = parseMessage(
      'Sent Rs.500.00 From HDFC Bank A/C x1234 To ZOMATO On 08/09/25 Ref 123456789012',
      'VM-HDFCBK',
      { source: 'SMS' }
    );
    expect(parsed?.direction).toBe('DEBIT');
    expect(parsed?.counterparty).toBe('Zomato');
  });

  it('still reads "You paid X" as money out, not a sender called You', () => {
    const parsed = parseMessage(
      'You paid Rs.220 to swiggy@ybl from A/c XX1234 on 08 Sep. UPI Ref 112233445566',
      'VM-HDFCBK',
      { source: 'SMS' }
    );
    expect(parsed?.direction).toBe('DEBIT');
    expect(parsed?.counterparty).toBe('Swiggy');
  });
});

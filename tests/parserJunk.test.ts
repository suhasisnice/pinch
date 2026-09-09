import { parseMessage } from '../src/services/parserService';

/**
 * Promotional SMS are the dominant source of invented transactions.
 *
 * Every message below quotes a rupee amount in a sentence shaped almost
 * exactly like a bank debit alert, which is why a naive parse turns them into
 * spending the user never did. Each must be rejected outright rather than
 * queued for review - a review inbox with fifty voucher blasts in it is just
 * a different kind of broken.
 */
describe('junk rejection', () => {
  const junk: Array<[string, string]> = [
    ['voucher blast', 'Congratulations! You have a Rs 500 voucher waiting. Shop now at bit.ly/xyz'],
    ['coupon', 'Use promo code SAVE50 and get Rs.200 off on your next order. T&C apply'],
    ['cashback bait', 'Get Rs 100 cashback on your first UPI payment. Offer valid till 30 Sep'],
    ['rummy', 'Play rummy now and win Rs 10,000 daily! Download the app and get Rs 50 bonus'],
    ['teen patti', 'Teen Patti Gold: Deposit Rs 100 and get Rs 500 bonus instantly'],
    ['fantasy cricket', 'Join Dream11 today. Rs 5000 prize pool. Register now and play'],
    ['betting', 'Casino bonus of Rs 2000 credited. Play now to claim. www.example.com'],
    ['loan marketing', 'You are pre-approved for a personal loan of Rs 5,00,000. Apply now!'],
    ['credit card marketing', 'Get a credit limit of Rs 2,00,000. Free for lifetime. Click to apply'],
    ['CTC marketing', 'Flat 40% discount this weekend only. Hurry! Call us on toll free 1800123456'],
    ['referral', 'Refer a friend and earn upto Rs 1000. Invite now'],
    ['scratch card', 'You won a scratch card worth Rs 250! Claim before it expires'],
    ['unsubscribe footer', 'Sale is live. Save Rs 300 on orders above Rs 999. Reply STOP to unsubscribe'],
    ['link', 'Your reward of Rs 150 is ready. Visit https://example.com/claim to redeem'],
  ];

  it.each(junk)('rejects %s', (_label, body) => {
    expect(parseMessage(body, 'AD-PROMO')).toBeNull();
  });
});

/**
 * The other half of the contract: tightening the junk filters must not start
 * swallowing real bank alerts. These are the shapes the app exists to read.
 */
describe('real transactions still parse', () => {
  const real: Array<[string, string, string, number]> = [
    [
      'HDFC card spend',
      'Rs.450.00 spent on HDFC Bank Card x1234 at OLIVE CAFE on 08-09-26. Not you? Call 18002586161',
      'VM-HDFCBK',
      450,
    ],
    [
      'ICICI UPI debit',
      'INR 250.00 debited from A/c XX8765 on 08-Sep-26 to VPA swiggy@ybl. UPI Ref 512345678901',
      'AD-ICICIB',
      250,
    ],
    [
      'SBI transfer',
      'Rs 1200 debited from A/c X9876 and credited to BLINKIT on 07-09-26. Ref 998877',
      'JD-SBIINB',
      1200,
    ],
  ];

  it.each(real)('parses %s', (_label, body, sender, amount) => {
    const parsed = parseMessage(body, sender);
    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(amount);
    expect(parsed?.direction).toBe('DEBIT');
  });
});

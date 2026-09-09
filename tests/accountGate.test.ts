import { parseMessage } from '../src/services/parserService';

/**
 * The structural gate: an SMS counts only if it says money moved in or out of
 * *your* account.
 *
 * Reject-lists are whack-a-mole — every new scam app writes a new sentence.
 * This tests the opposite property: a bank telling you money moved always
 * names the account it moved from ("A/c XX1234", "Card ending 5678"), and a
 * promotion never does, because it is not about your account at all. That
 * holds for spam nobody has written yet.
 */
describe('an SMS must name your account', () => {
  const accepted: Array<[string, string]> = [
    ['A/c prefix', 'Rs.250 debited from A/c XX1234 on 08/09/26 to VPA zomato@ybl. Ref 512345678901'],
    ['A/c no. form', 'INR 1240 debited A/c no. XX5678 08-09-26 UPI/P2M/612345678/TOIT BREWPUB'],
    ['card x-form', 'Rs.700.00 spent on HDFC Bank Card x1234 at OLIVE CAFE on 08-09-26'],
    ['acct form', 'ICICI Bank Acct XX123 debited for Rs 340.00 on 08-Sep-26; SWIGGY credited'],
    ['ending form', 'Rs 500 spent on card ending 4321 at DECATHLON on 09-09-26'],
    ['bare masked', 'Rs 320 debited XXXX7788 at BLINKIT on 09-09-26'],
    ['credit in', 'Rs 5,000 credited to A/c XX1234 from MOM via UPI on 01-09-26'],
  ];

  it.each(accepted)('accepts %s', (_label, body) => {
    const parsed = parseMessage(body, 'VM-HDFCBK');
    expect(parsed).not.toBeNull();
  });

  const rejected: Array<[string, string]> = [
    // Each of these has a rupee amount and a debit/credit verb, and would
    // have parsed cleanly before. None of them is about your account.
    ['voucher credited to wallet', 'Rs 500 credited as reward! Shop now and spend it before 30 Sep'],
    ['game balance', 'Rs 1000 credited to your game wallet. Play and win more!'],
    ['generic debit claim', 'Rs.340 debited'],
    ['offer phrased as spend', 'Spend Rs 2000 and get Rs 300 back this weekend'],
    ['cashback credited', 'Congrats! Rs 150 has been credited as cashback'],
  ];

  it.each(rejected)('rejects %s', (_label, body) => {
    expect(parseMessage(body, 'AD-PROMO')).toBeNull();
  });
});

/**
 * Notifications are held to a different standard on purpose: they already
 * passed a package allowlist, so they came from GPay or a bank's own app.
 * Requiring an account number there would throw away most UPI activity,
 * because payment apps word their notifications casually.
 */
describe('notifications are trusted by their source instead', () => {
  it('accepts a UPI notification that names no account', () => {
    const parsed = parseMessage(
      '₹95 paid to Chai Point using UPI. UPI transaction ID 712345678901',
      null,
      { source: 'NOTIFICATION' }
    );

    expect(parsed).not.toBeNull();
    expect(parsed?.amount).toBe(95);
    expect(parsed?.counterparty).toBe('Chai Point');
  });

  it('still rejects promotional content arriving as a notification', () => {
    expect(
      parseMessage('You won Rs 10,000! Play rummy now', null, { source: 'NOTIFICATION' })
    ).toBeNull();
  });

  it('holds the same message to the stricter rule when it arrives as SMS', () => {
    const body = '₹95 paid to Chai Point using UPI. UPI transaction ID 712345678901';
    expect(parseMessage(body, 'VM-HDFCBK', { source: 'SMS' })).toBeNull();
  });
});

import { categorise, CategoriserKnowledge, findVpa, readPayee } from '../src/math/categoriser';
import { BRANDS, CATEGORIES, KEYWORDS, SUBCATEGORIES, isSubcategoryOf } from '../src/math/categoryTaxonomy';

const EMPTY: CategoriserKnowledge = { rules: [], weights: {} };

function cat(merchant: string, rawText?: string, knowledge: CategoriserKnowledge = EMPTY) {
  const d = categorise({ merchant, rawText }, knowledge);
  return d ? { category: d.category, sub: d.subcategory, source: d.source, basis: d.basis } : null;
}

describe('the substring bugs the old rules had (docs/AUDIT.md §6.8)', () => {
  it('does not read Motorola as a cab ride', () => {
    expect(cat('MOTOROLA MOBILITY')?.category).not.toBe('Transport');
  });

  it('does not read Coca Cola as a cab ride', () => {
    expect(cat('Coca Cola Beverages')).toBeNull();
  });

  it('files Barista as a café, not a bar', () => {
    expect(cat('Barista Lavazza')).toMatchObject({ category: 'Food', sub: 'Cafés & chai' });
  });

  it('files JioMart as groceries, not a phone recharge', () => {
    expect(cat('JIOMART')).toMatchObject({ category: 'Groceries' });
    expect(cat('Jio Prepaid Recharge')).toMatchObject({ category: 'Bills', sub: 'Mobile recharge' });
  });

  it('tells BookMyShow from a book shop', () => {
    expect(cat('BookMyShow')).toMatchObject({ category: 'Outing', sub: 'Movies' });
    expect(cat('Sapna Book House')).toMatchObject({ category: 'Academics', sub: 'Books & stationery' });
  });

  it('still knows Ola on its own', () => {
    expect(cat('OLA')).toMatchObject({ category: 'Transport', sub: 'Cabs & autos', source: 'SURE' });
    expect(cat('Ola Cabs')).toMatchObject({ category: 'Transport' });
  });
});

describe('brands', () => {
  it('prefers the longest brand, so Instamart is groceries and Swiggy is food', () => {
    expect(cat('Swiggy')).toMatchObject({ category: 'Food', sub: 'Delivery', source: 'SURE' });
    expect(cat('Swiggy Instamart')).toMatchObject({ category: 'Groceries', sub: 'Quick delivery' });
    expect(cat('swiggyinstamart')).toMatchObject({ category: 'Groceries' });
    expect(cat('Amazon Fresh')).toMatchObject({ category: 'Groceries' });
    expect(cat('Amazon Prime')).toMatchObject({ category: 'Subscriptions', sub: 'Streaming' });
    expect(cat('AMAZON SELLER SERVICES')).toMatchObject({ category: 'Shopping', sub: 'Online' });
  });

  it('reads a run-together name as a handle writes it', () => {
    expect(cat('Zomatoonline')).toMatchObject({ category: 'Food' });
  });

  it('uses the VPA handle when the name on the message is unhelpful', () => {
    const raw = 'Rs.349 debited from A/c XX1234 to VPA zomato.order@hdfcbank. UPI Ref 6123';
    expect(cat('ZOMATO ORDER', raw)).toMatchObject({ category: 'Food', sub: 'Delivery' });
    const raw2 = 'Paid Rs.120 to bluetokai.blr@icici on 12-09 UPI Ref 1';
    expect(cat('Payment', raw2)).toMatchObject({ category: 'Food', sub: 'Cafés & chai' });
  });

  it('offers an ambiguous brand only as a guess', () => {
    expect(cat('Apollo')).toMatchObject({ category: 'Health', source: 'GUESS' });
    expect(cat('Apollo Pharmacy')).toMatchObject({ category: 'Health', sub: 'Pharmacy', source: 'SURE' });
  });

  it('lets a clear keyword beat an ambiguous brand', () => {
    expect(cat('Apollo Tyres')?.category).toBe('Transport');
  });
});

describe('keywords', () => {
  it('applies a strong, unopposed shop word with certainty', () => {
    expect(cat('Sri Venkateshwara Xerox')).toMatchObject({ category: 'Academics', sub: 'Print & xerox', source: 'SURE' });
    expect(cat('Green Leaf Unisex Salon')).toMatchObject({ category: 'Personal care', source: 'SURE' });
    expect(cat('Lakshmi Medicals')).toMatchObject({ category: 'Health', sub: 'Pharmacy', source: 'SURE' });
    expect(cat('Iyengar Bakery')).toMatchObject({ category: 'Food', sub: 'Snacks & sweets', source: 'SURE' });
  });

  it('offers a weak one as a guess', () => {
    expect(cat('Hotel Empire')).toMatchObject({ category: 'Food', source: 'GUESS' });
  });

  it('offers a guess when two strong words disagree, led by the first one', () => {
    expect(cat('Sri Sai Medical & General Stores')).toMatchObject({ category: 'Health', source: 'GUESS' });
  });

  it('knows the three new categories', () => {
    expect(cat('IRCTC')).toMatchObject({ category: 'Travel', sub: 'Trains' });
    expect(cat('OYO Rooms')).toMatchObject({ category: 'Travel', sub: 'Stays' });
    expect(cat('Blinkit')).toMatchObject({ category: 'Groceries', sub: 'Quick delivery' });
    expect(cat('Cult Fit')).toMatchObject({ category: 'Personal care', sub: 'Gym & fitness' });
  });

  it('leaves a name with nothing recognisable blank', () => {
    expect(cat('XYZ9182')).toBeNull();
    expect(cat('Sai Enterprises')).toMatchObject({ source: 'GUESS' });
  });
});

describe('people', () => {
  it('never categorises a person from the words in their name', () => {
    expect(cat('Ramesh Kumar')).toBeNull();
    expect(readPayee({ merchant: 'Ramesh Kumar' }, EMPTY).kind).toBe('PERSON');
  });

  it('treats a phone-number handle as a person', () => {
    const raw = 'Rs.60 debited to 9876543210@ybl UPI Ref 1';
    expect(readPayee({ merchant: '9876543210', rawText: raw }, EMPTY).kind).toBe('PERSON');
    expect(cat('9876543210', raw)).toBeNull();
  });

  it('treats a P2A transfer as a person and a P2M one as a shop', () => {
    expect(readPayee({ merchant: 'Sharma', rawText: 'UPI/P2A/61234/Sharma' }, EMPTY).kind).toBe('PERSON');
    expect(readPayee({ merchant: 'Sharma', rawText: 'UPI/P2M/61234/Sharma' }, EMPTY).kind).toBe('MERCHANT');
  });

  it('treats a merchant QR as a shop even when it carries a person\'s name', () => {
    const raw = 'Paid Rs.40 to paytmqr281005050101abc@paytm (RAMESH KUMAR)';
    expect(readPayee({ merchant: 'RAMESH KUMAR', rawText: raw }, EMPTY).kind).toBe('MERCHANT');
  });

  it('treats a contact as a person', () => {
    expect(readPayee({ merchant: 'Chintu' }, { ...EMPTY, people: ['Chintu'] }).kind).toBe('PERSON');
  });

  it('knows a shop from a person by the name words', () => {
    expect(readPayee({ merchant: 'Bhukkad Adda' }, EMPTY).kind).not.toBe('PERSON');
  });

  it('remembers one person without touching another with the same surname', () => {
    const knowledge: CategoriserKnowledge = {
      ...EMPTY,
      rules: [{ pattern: 'name:ramesh kumar', category: 'Food', subcategory: 'Cafés & chai', isPayee: true }],
    };
    expect(cat('RAMESH KUMAR', undefined, knowledge)).toMatchObject({ category: 'Food', source: 'USER' });
    expect(cat('Suresh Kumar', undefined, knowledge)).toBeNull();
  });

  it('matches a person by their UPI handle when the name is written differently', () => {
    const knowledge: CategoriserKnowledge = {
      ...EMPTY,
      rules: [{ pattern: 'vpa:ramesh.k@okaxis', category: 'Groceries', subcategory: 'Kirana', isPayee: true }],
    };
    const raw = 'Rs.120 sent to ramesh.k@okaxis UPI Ref 9';
    expect(cat('RAMESH K', raw, knowledge)).toMatchObject({ category: 'Groceries', sub: 'Kirana' });
  });

  it('offers a shop word on a person-paid shop only as a guess', () => {
    const raw = 'Rs.20 to 9876543210@ybl UPI/P2A';
    expect(cat('Raju Tea Stall', raw)).toMatchObject({ category: 'Food', source: 'GUESS' });
  });
});

describe('what the user taught', () => {
  it('wins over a brand', () => {
    const knowledge: CategoriserKnowledge = {
      ...EMPTY,
      rules: [{ pattern: 'amazon', category: 'Groceries', subcategory: null, isPayee: false }],
    };
    expect(cat('Amazon', undefined, knowledge)).toMatchObject({ category: 'Groceries', source: 'USER' });
  });

  it('matches a shop rule on whole words only', () => {
    const knowledge: CategoriserKnowledge = {
      ...EMPTY,
      rules: [{ pattern: 'corner', category: 'Food', subcategory: null, isPayee: false }],
    };
    expect(cat('Cornerstone Books', undefined, knowledge)?.source).not.toBe('USER');
  });

  it('lets a taught word beat a generic keyword', () => {
    const knowledge: CategoriserKnowledge = {
      ...EMPTY,
      // "mess" is a Food keyword, but this user's "mess" is their hostel fee.
      weights: { Rent: { mess: 10, hostel: 5 }, Food: { cafe: 3 } },
    };
    expect(cat('Block C Mess', undefined, knowledge)).toMatchObject({ category: 'Rent', basis: 'words' });
  });
});

describe('findVpa', () => {
  it('prefers the handle that matches the payee over the user\'s own', () => {
    const raw = 'From me@okhdfc to swiggy@icici Rs 200';
    expect(findVpa('Swiggy', raw)).toBe('swiggy@icici');
  });

  it('ignores email addresses', () => {
    expect(findVpa('X', 'write to care@gmail.com')).toBeNull();
  });
});

describe('the taxonomy itself', () => {
  it('only ever files a brand or keyword under a sub-category of its own category', () => {
    for (const entry of [...BRANDS, ...KEYWORDS]) {
      if (entry.sub === null) continue;
      expect(isSubcategoryOf(entry.category, entry.sub)).toBe(true);
    }
  });

  it('has sub-categories for every category but Other', () => {
    for (const c of CATEGORIES) {
      if (c === 'Other') continue;
      expect(SUBCATEGORIES[c].length).toBeGreaterThan(0);
    }
  });
});

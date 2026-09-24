/**
 * Works out what a payment was for, from what the bank said about it.
 *
 * Pure: everything it knows arrives as arguments (what the user has taught
 * it, the learned word weights, who their contacts are), so it can be tested
 * without a database and run on every capture without being felt.
 *
 * The cascade, first hit wins:
 *
 *   1. Learned — something this user taught it. Per payee for a person, per
 *      shop for a merchant. Always certain.
 *   2. Brand — a name from the curated dictionary (categoryTaxonomy.ts),
 *      matched on whole words, the compacted name, and the VPA handle.
 *   3. Keyword — a generic word that gives the place away ("pharmacy",
 *      "xerox"), certain when strong and unopposed, a guess otherwise.
 *   4. Words — the naive-Bayes classifier over what corrections have taught.
 *   5. Nothing: left blank. A wrong category silently applied is worse than
 *      a blank, because it has to be noticed before it can be fixed.
 *
 * People are the special case. A payment to "Ramesh Kumar" says nothing
 * about what was bought, and learning from the words in it would teach
 * "kumar" to mean Food for every Kumar afterwards. So a person is only ever
 * categorised from what this user said about that exact person.
 */
import { BRANDS, Brand, KEYWORDS, Keyword, NAME_WORDS, isSubcategoryOf } from './categoryTaxonomy';
import { classifyTokens, sameMerchant, tokenize, TokenWeights } from './merchantClassifier';

/** How a category came to be on a transaction. */
export type CategorySource = 'USER' | 'SURE' | 'GUESS';

export type PayeeKind = 'PERSON' | 'MERCHANT' | 'UNKNOWN';

/** One thing the user taught: a MerchantRules row. */
export interface LearnedRule {
  pattern: string;
  category: string;
  subcategory: string | null;
  /** A per-person rule, keyed `vpa:<handle>` or `name:<name>`, matched exactly. */
  isPayee: boolean;
}

export interface CategoriserKnowledge {
  rules: readonly LearnedRule[];
  weights: TokenWeights;
  /** Contact names and aliases — anyone in here is a person, not a shop. */
  people?: readonly string[];
}

export interface CategoriseInput {
  merchant: string;
  rawText?: string | null;
}

export interface Payee {
  kind: PayeeKind;
  /** The UPI handle this payment went to, lowercased, when the message named one. */
  vpa: string | null;
  /** The keys a per-person rule for this payee is stored under, most specific first. */
  keys: string[];
}

export interface CategoryDecision {
  category: string;
  subcategory: string | null;
  source: CategorySource;
  basis: 'learned' | 'brand' | 'keyword' | 'words';
  payee: Payee;
}

/**
 * Word-classifier posterior at or above which its answer is applied as
 * certain. Between CLASSIFY_THRESHOLD (0.55) and this, it is offered as a
 * guess.
 */
export const SURE_THRESHOLD = 0.8;

/**
 * A token weight at or above this has had at least one real correction
 * behind it: seeds are written at 3 and a correction adds 5 (see
 * CORRECTION_WEIGHT in db/repos/capture.ts).
 */
const TAUGHT_WEIGHT = 5;

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

interface Text {
  tokens: string[];
  /** Every token run together — how a VPA handle writes "swiggyinstamart". */
  compact: string;
}

export function normaliseName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function readText(text: string): Text {
  const tokens = normaliseName(text).split(' ').filter(Boolean);
  return { tokens, compact: tokens.join('') };
}

function phraseAt(phrase: string[], tokens: string[]): number {
  if (phrase.length === 0 || phrase.length > tokens.length) return -1;
  outer: for (let i = 0; i + phrase.length <= tokens.length; i += 1) {
    for (let j = 0; j < phrase.length; j += 1) {
      if (tokens[i + j] !== phrase[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Whether a dictionary name appears in the text, on whole words.
 *
 * Three ways in, each deliberately bounded: as a run of whole words; as the
 * start of one run-together word, for names of five letters or more
 * ("zomatoonline"); and anywhere inside the compacted text, for names of
 * seven or more ("swiggyinstamart"). Short names get whole words only — that
 * is what keeps "ola" out of Motorola and "jio" out of JioMart.
 */
function nameIn(name: string, text: Text): boolean {
  const phrase = name.split(' ');
  if (phraseAt(phrase, text.tokens) >= 0) return true;
  const compact = phrase.join('');
  if (compact.length >= 5 && text.tokens.some((t) => t.length > compact.length && t.startsWith(compact))) {
    return true;
  }
  return compact.length >= 7 && text.compact.includes(compact);
}

// ---------------------------------------------------------------------------
// The payee
// ---------------------------------------------------------------------------

const EMAIL_HOSTS = new Set(['gmail', 'yahoo', 'outlook', 'hotmail', 'rediffmail', 'icloud']);

/**
 * The UPI handle this payment went to, if the message named one.
 *
 * The merchant string has already had its "@ybl" stripped by the parser, so
 * this goes back to the raw text. A message can name two handles (yours and
 * theirs), so prefer the one whose user part matches the merchant.
 */
export function findVpa(merchant: string, rawText: string | null | undefined): string | null {
  if (!rawText) return null;
  const found: string[] = [];
  const pattern = /([a-z0-9][a-z0-9._-]{1,63})@([a-z][a-z0-9]{1,31})\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(rawText)) !== null) {
    if (EMAIL_HOSTS.has(match[2].toLowerCase())) continue;
    found.push(`${match[1]}@${match[2]}`.toLowerCase());
  }
  if (found.length === 0) return null;

  const want = readText(merchant).compact;
  if (want) {
    const hit = found.find((vpa) => {
      const user = readText(vpa.split('@')[0]).compact;
      return user === want || user.startsWith(want) || want.startsWith(user);
    });
    if (hit) return hit;
  }
  return found.length === 1 ? found[0] : null;
}

/**
 * Handle prefixes that only a merchant's QR or payment gateway ever issues:
 * Paytm and PhonePe business QRs, BharatPe, Razorpay, Cashfree, PayU and so
 * on. A payment to one of these went to a shop even when the name on it is
 * the shopkeeper's own.
 */
const MERCHANT_HANDLE =
  /^(?:paytmqr|paytm-|q\d{5,}|bharatpe|gpay-\d|bqr|mab\.|yespay|ezetap|pinelabs|razorpay|rzp|rzpy|cf\.|cashfree|payu|billdesk|merchant|ipay|pos\.|mswipe|getepay|instantpay|jiopay)/i;

/**
 * Words that appear in a shop's name but in nobody's, beyond the dictionary
 * words: enough to tell "Sai Enterprises" from "Sai Kumar".
 */
const BUSINESS_WORDS = new Set([
  'enterprises', 'enterprise', 'traders', 'trading', 'agency', 'agencies', 'stores', 'store',
  'shop', 'centre', 'center', 'corner', 'point', 'house', 'world', 'hub', 'zone', 'mart',
  'pvt', 'ltd', 'limited', 'llp', 'co', 'company', 'india', 'services', 'solutions',
  'retail', 'industries', 'associates', 'brothers', 'bros', 'sons', 'group', 'international',
  'online', 'technologies', 'systems', 'ventures', 'studio', 'studios', 'labs', 'official',
]);

/**
 * A name made only of plain words, with a given name or surname among them
 * and nothing a business would call itself. Needing a real name word is what
 * keeps "Bhukkad Adda" a restaurant while "Ramesh Kumar" is a person.
 */
function looksLikePersonName(text: Text): boolean {
  if (text.tokens.length < 1 || text.tokens.length > 4) return false;
  if (!text.tokens.every((t) => /^[a-z]{1,14}$/.test(t) && !BUSINESS_WORDS.has(t))) return false;
  return text.tokens.some((t) => NAME_WORDS.has(t));
}

function isKnownPerson(merchant: string, people: readonly string[] | undefined): boolean {
  if (!people || people.length === 0) return false;
  return people.some((person) => person.trim() && sameMerchant(person, merchant));
}

function payeeKeys(merchant: string, vpa: string | null): string[] {
  const keys: string[] = [];
  if (vpa) keys.push(`vpa:${vpa}`);
  const name = normaliseName(merchant);
  if (name) keys.push(`name:${name}`);
  return keys;
}

// ---------------------------------------------------------------------------
// Each stage
// ---------------------------------------------------------------------------

interface Hit {
  category: string;
  subcategory: string | null;
  source: CategorySource;
}

function learnedHit(
  merchant: string,
  text: Text,
  payee: Payee,
  rules: readonly LearnedRule[]
): Hit | null {
  // A rule taught for this exact person wins outright.
  for (const key of payee.keys) {
    const rule = rules.find((r) => r.isPayee && r.pattern === key);
    if (rule) return { category: rule.category, subcategory: rule.subcategory, source: 'USER' };
  }

  // Then a shop rule — the longest one that matches, so a correction for
  // "Swiggy Instamart" outranks one for plain "Swiggy". A person only ever
  // matches a shop rule written as their exact name (an older correction,
  // from before per-person rules existed), never as a word inside it.
  let best: LearnedRule | null = null;
  for (const rule of rules) {
    if (rule.isPayee) continue;
    const pattern = readText(rule.pattern);
    if (pattern.compact.length === 0) continue;
    const matches =
      sameMerchant(rule.pattern, merchant) ||
      (payee.kind !== 'PERSON' &&
        pattern.compact.length >= 4 &&
        phraseAt(pattern.tokens, text.tokens) >= 0);
    if (matches && (!best || rule.pattern.length > best.pattern.length)) best = rule;
  }
  return best ? { category: best.category, subcategory: best.subcategory, source: 'USER' } : null;
}

function brandHit(texts: Text[]): { brand: Brand; length: number } | null {
  let best: { brand: Brand; length: number } | null = null;
  for (const brand of BRANDS) {
    for (const name of brand.names) {
      const length = name.replace(/ /g, '').length;
      if (best && length <= best.length) continue;
      if (texts.some((t) => nameIn(name, t))) best = { brand, length };
    }
  }
  return best;
}

function keywordHit(text: Text): Hit | null {
  const byCategory = new Map<
    string,
    { score: number; strong: boolean; sub: string | null; subScore: number; first: number }
  >();

  for (const keyword of KEYWORDS) {
    let at = -1;
    for (const word of keyword.words) {
      const i = phraseAt(word.split(' '), text.tokens);
      if (i >= 0 && (at < 0 || i < at)) at = i;
    }
    if (at < 0) continue;
    addKeyword(byCategory, keyword, at);
  }
  if (byCategory.size === 0) return null;

  // Highest score wins; on a tie, the word nearest the front of the name —
  // "Sri Sai Medical & General Stores" is a chemist that also sells biscuits.
  const ranked = [...byCategory.entries()].sort(
    (a, b) => b[1].score - a[1].score || a[1].first - b[1].first
  );
  const [category, top] = ranked[0];
  const opposed = ranked.slice(1).some(([, other]) => other.strong || other.score >= top.score);
  return {
    category,
    subcategory: top.sub,
    source: top.strong && !opposed ? 'SURE' : 'GUESS',
  };
}

function addKeyword(
  into: Map<string, { score: number; strong: boolean; sub: string | null; subScore: number; first: number }>,
  keyword: Keyword,
  at: number
): void {
  const points = keyword.strong ? 2 : 1;
  const entry = into.get(keyword.category) ?? {
    score: 0,
    strong: false,
    sub: null,
    subScore: 0,
    first: at,
  };
  entry.score += points;
  entry.strong = entry.strong || keyword.strong;
  entry.first = Math.min(entry.first, at);
  if (keyword.sub && points > entry.subScore) {
    entry.sub = keyword.sub;
    entry.subScore = points;
  }
  into.set(keyword.category, entry);
}

function wordsHit(tokens: string[], weights: TokenWeights): (Hit & { taught: boolean }) | null {
  const result = classifyTokens(tokens, weights);
  if (!result) return null;
  const taught = tokens.some((t) => (weights[result.category]?.[t] ?? 0) >= TAUGHT_WEIGHT);
  return {
    category: result.category,
    subcategory: null,
    source: result.confidence >= SURE_THRESHOLD ? 'SURE' : 'GUESS',
    taught,
  };
}

// ---------------------------------------------------------------------------
// The whole thing
// ---------------------------------------------------------------------------

/**
 * Who a payment went to, as far as the message says. Exported because
 * learning needs the same answer: a correction for a person is stored
 * against that person, never spread across the words in their name.
 */
export function readPayee(input: CategoriseInput, knowledge: Pick<CategoriserKnowledge, 'people' | 'weights'>): Payee {
  const merchant = input.merchant.trim();
  const vpa = findVpa(merchant, input.rawText);
  const keys = payeeKeys(merchant, vpa);
  const text = readText(merchant);
  const texts = vpaText(vpa) ? [text, vpaText(vpa)!] : [text];

  const raw = input.rawText ?? '';
  const vpaUser = vpa ? vpa.split('@')[0] : null;

  if (brandHit(texts)) return { kind: 'MERCHANT', vpa, keys };
  if (/\bP2M\b/i.test(raw) || (vpaUser && MERCHANT_HANDLE.test(vpaUser))) {
    return { kind: 'MERCHANT', vpa, keys };
  }
  if (isKnownPerson(merchant, knowledge.people)) return { kind: 'PERSON', vpa, keys };
  if (/\bP2A\b/i.test(raw)) return { kind: 'PERSON', vpa, keys };
  if (vpaUser && /^(?:\+?91)?[6-9]\d{9}(?:-\d)?$/.test(vpaUser)) return { kind: 'PERSON', vpa, keys };
  if (/^\+?[\d\s]{10,14}$/.test(merchant)) return { kind: 'PERSON', vpa, keys };

  if (keywordHit(text)) return { kind: 'MERCHANT', vpa, keys };
  if (text.tokens.some((t) => BUSINESS_WORDS.has(t))) return { kind: 'MERCHANT', vpa, keys };
  if (looksLikePersonName(text) && !classifyTokens(tokenize(merchant), knowledge.weights)) {
    return { kind: 'PERSON', vpa, keys };
  }
  return { kind: 'UNKNOWN', vpa, keys };
}

/** The handle's user part as words, unless it is only digits or a QR code. */
function vpaText(vpa: string | null): Text | null {
  if (!vpa) return null;
  const user = vpa.split('@')[0];
  if (/^\d+$/.test(user) || MERCHANT_HANDLE.test(user)) return null;
  return readText(user);
}

export function categorise(input: CategoriseInput, knowledge: CategoriserKnowledge): CategoryDecision | null {
  const merchant = input.merchant.trim();
  if (!merchant) return null;

  const payee = readPayee(input, knowledge);
  const text = readText(merchant);
  const handle = vpaText(payee.vpa);
  const texts = handle ? [text, handle] : [text];

  const decide = (hit: Hit, basis: CategoryDecision['basis']): CategoryDecision => ({
    category: hit.category,
    subcategory: isSubcategoryOf(hit.category, hit.subcategory) ? hit.subcategory : null,
    source: hit.source,
    basis,
    payee,
  });

  const learned = learnedHit(merchant, text, payee, knowledge.rules);
  if (learned) return decide(learned, 'learned');

  const brand = brandHit(texts);
  if (brand && !brand.brand.guess) {
    return decide({ category: brand.brand.category, subcategory: brand.brand.sub, source: 'SURE' }, 'brand');
  }

  const keyword = keywordHit(text) ?? (handle ? keywordHit(handle) : null);

  if (payee.kind === 'PERSON') {
    // A shopkeeper taking payment on their own number: a strong shop word in
    // the name is still worth offering, but only as a guess.
    return keyword ? decide({ ...keyword, source: 'GUESS' }, 'keyword') : null;
  }

  const words = wordsHit([...tokenize(merchant), ...(handle ? tokenize(handle.tokens.join(' ')) : [])], knowledge.weights);

  // What this user taught beats a generic dictionary word.
  if (words && words.taught && words.source === 'SURE') return decide(words, 'words');
  if (keyword) return decide(keyword, 'keyword');
  if (brand) {
    return decide({ category: brand.brand.category, subcategory: brand.brand.sub, source: 'GUESS' }, 'brand');
  }
  if (words) return decide(words, 'words');
  return null;
}

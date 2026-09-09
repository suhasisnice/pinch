/**
 * A merchant name the app has never seen, scored against categories by the
 * words in it rather than by an exact match.
 *
 * This exists because the exact-match table (MerchantRules) starts empty on
 * every fresh install: nothing has taught it "Zomato is Food" yet, so every
 * transaction sits Uncategorised until corrected by hand, one merchant at a
 * time. A brand-new restaurant with "CAFE" in its name should not have to
 * wait for that — the word alone is most of the signal a human uses too.
 *
 * The method is multinomial Naive Bayes over token counts, computed with
 * plain arithmetic on small integers. Deliberately not a trained model or a
 * call to anything off-device: this runs in well under a millisecond and
 * needs no network, so it can sit directly in the capture path without
 * being felt.
 */

/**
 * Words that appear in merchant names for structural reasons — a company
 * suffix, a marketplace's own boilerplate — and carry no information about
 * what was bought. Stripped before scoring so they cannot dilute a real
 * signal word or, worse, get learned as if they meant something.
 */
const STOPWORDS = new Set([
  'pvt', 'ltd', 'limited', 'private', 'india', 'indian', 'the', 'and', 'of',
  'in', 'on', 'is', 'for', 'to', 'a', 'an', 'store', 'stores', 'online',
  'shop', 'shopping', 'services', 'service', 'technologies', 'technology',
  'tech', 'solutions', 'company', 'co', 'corp', 'corporation', 'inc',
  'com', 'www', 'http', 'https', 'app', 'apps', 'payment', 'payments',
  'pay', 'upi',
]);

/** Splits a merchant name into the words worth scoring. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 2 && !STOPWORDS.has(word));
}

/** Per-category token counts, as stored: weights[category][token] = count. */
export type TokenWeights = Record<string, Record<string, number>>;

export interface ClassifyResult {
  category: string;
  /** Posterior probability of the winning category, 0..1. */
  confidence: number;
}

/**
 * A parse at or above this posterior is trusted enough to apply automatically.
 * Below it, the guess is thrown away rather than surfaced — a wrong category
 * silently applied is worse than staying Uncategorised, because the wrong
 * one has to be noticed before it can be fixed, and the right one never
 * does not.
 */
export const CLASSIFY_THRESHOLD = 0.55;

/**
 * Scores a tokenised merchant name against every category's learned
 * vocabulary and returns the most likely one, or null when there is no
 * signal to go on at all.
 *
 * "No signal" is deliberately its own case rather than falling out of the
 * arithmetic: a merchant whose every token is unknown everywhere would
 * otherwise still get assigned to whichever category happens to have the
 * biggest seed vocabulary, which is a coincidence of the priors and not a
 * classification of anything.
 */
export function classifyTokens(tokens: string[], weights: TokenWeights): ClassifyResult | null {
  const categories = Object.keys(weights);
  if (categories.length === 0 || tokens.length === 0) return null;

  const vocabulary = new Set<string>();
  const totalPerCategory: Record<string, number> = {};
  let grandTotal = 0;

  for (const category of categories) {
    let total = 0;
    for (const [token, count] of Object.entries(weights[category])) {
      vocabulary.add(token);
      total += count;
    }
    totalPerCategory[category] = total;
    grandTotal += total;
  }

  if (grandTotal === 0) return null;

  // A token that has never been seen under any category, by any user, is not
  // evidence for anything. Requiring at least one recognised token keeps a
  // merchant like "XYZ9182 Retail" from being scored on its stopword-stripped
  // remainder alone.
  const hasAnySignal = tokens.some((token) =>
    categories.some((category) => (weights[category][token] ?? 0) > 0)
  );
  if (!hasAnySignal) return null;

  // Only tokens the vocabulary has an opinion about at all take part in the
  // likelihood. A token nobody has ever seen under any category is not
  // "weak evidence for every category" — it is no evidence, and Laplace
  // smoothing's usual per-class denominator would treat it as the former,
  // subtly favouring whichever category happens to have the smallest total
  // vocabulary regardless of what the merchant's other, informative words
  // say. Dropping it keeps the comparison to the words that actually mean
  // something.
  const informativeTokens = tokens.filter((token) => vocabulary.has(token));

  const vocabSize = vocabulary.size;
  const logScores: Record<string, number> = {};

  for (const category of categories) {
    // Prior: how much of everything ever seen belongs to this category.
    let score = Math.log(totalPerCategory[category] / grandTotal);
    // Likelihood: Laplace-smoothed so a token this category hasn't seen
    // (but some other category has) costs something small rather than
    // zeroing the category out on one miss.
    for (const token of informativeTokens) {
      const count = weights[category][token] ?? 0;
      score += Math.log(count + 1) - Math.log(totalPerCategory[category] + vocabSize);
    }
    logScores[category] = score;
  }

  let winner = categories[0];
  for (const category of categories) {
    if (logScores[category] > logScores[winner]) winner = category;
  }

  // A winner that none of the input's own tokens actually appeared under is
  // winning on prior alone — a popular category, not a matched one.
  const winnerHasOwnEvidence = tokens.some((token) => (weights[winner][token] ?? 0) > 0);
  if (!winnerHasOwnEvidence) return null;

  // Softmax over the log-scores turns them into a genuine posterior
  // probability, shifted by the max first so the exponentials stay in range.
  const maxScore = Math.max(...Object.values(logScores));
  let denominator = 0;
  for (const category of categories) denominator += Math.exp(logScores[category] - maxScore);
  const confidence = Math.exp(logScores[winner] - maxScore) / denominator;

  if (confidence < CLASSIFY_THRESHOLD) return null;

  return { category: winner, confidence };
}

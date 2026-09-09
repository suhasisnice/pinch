import { classifyTokens, tokenize, TokenWeights } from '../src/math/merchantClassifier';

const WEIGHTS: TokenWeights = {
  Food: { zomato: 20, swiggy: 20, cafe: 10, restaurant: 8, biryani: 5, pizza: 6 },
  Transport: { uber: 20, ola: 20, metro: 8, fuel: 5, petrol: 5 },
  Shopping: { amazon: 20, flipkart: 20, myntra: 10, mart: 6 },
  Subscriptions: { netflix: 20, spotify: 20, gym: 8 },
};

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric characters', () => {
    expect(tokenize('ZOMATO ONLINE ORDERING PVT LTD')).toEqual(['zomato', 'ordering']);
  });

  it('drops stopwords and single-character fragments', () => {
    expect(tokenize('Cafe & Co. - A')).toEqual(['cafe']);
  });

  it('splits a VPA-shaped name on the @ handle', () => {
    expect(tokenize('swiggy@ybl')).toEqual(['swiggy', 'ybl']);
  });
});

describe('classifyTokens', () => {
  it('picks the category whose vocabulary the tokens actually matched', () => {
    const result = classifyTokens(tokenize('Olive Cafe'), WEIGHTS);
    expect(result?.category).toBe('Food');
    expect(result?.confidence).toBeGreaterThan(0.55);
  });

  it('generalises to a merchant it has never seen by name, via a shared word', () => {
    // "Truffles" is nowhere in the seed data; "Cafe" is.
    const result = classifyTokens(tokenize('Truffles Artisan Cafe'), WEIGHTS);
    expect(result?.category).toBe('Food');
  });

  it('returns null when no token in the merchant is known to any category', () => {
    expect(classifyTokens(tokenize('XYZ9182 Retail Enterprises'), WEIGHTS)).toBeNull();
  });

  it('returns null for an empty token list', () => {
    expect(classifyTokens([], WEIGHTS)).toBeNull();
  });

  it('returns null when the weights table itself is empty', () => {
    expect(classifyTokens(tokenize('Zomato'), {})).toBeNull();
  });

  it('does not let a strong prior alone decide the answer', () => {
    // A category with a much larger seed vocabulary should not out-vote a
    // category that the tokens actually belong to.
    const skewed: TokenWeights = {
      Food: { zomato: 5 },
      Shopping: { amazon: 1000, flipkart: 1000, myntra: 1000, mart: 1000 },
    };
    const result = classifyTokens(tokenize('Zomato'), skewed);
    expect(result?.category).toBe('Food');
  });

  it('separates two categories that share one common word', () => {
    // "mart" alone should not be enough to override a strong, specific hit.
    const result = classifyTokens(tokenize('Big Bazaar Mart'), WEIGHTS);
    expect(result?.category).toBe('Shopping');
  });

  it('is case-insensitive and ignores punctuation noise', () => {
    const a = classifyTokens(tokenize('UBER *TRIP 8817'), WEIGHTS);
    const b = classifyTokens(tokenize('uber trip 8817'), WEIGHTS);
    expect(a?.category).toBe('Transport');
    expect(a?.category).toBe(b?.category);
  });
});

'use strict';

const { lexrankSummarize } = require('./lexrank');

describe('lexrankSummarize', () => {
  // Deterministic corpus with clearly different topics for diversity selection.
  const corpus = [
    'The quick brown fox jumps over the lazy dog in the park.',
    'A lazy dog sleeps under the old oak tree near the river.',
    'The stock market crashed after unexpected economic news today.',
    'Investors panicked as the economic downturn spread across global markets.',
    'Python is a popular programming language used for machine learning.',
    'Machine learning algorithms require large datasets for training models.',
    'The weather forecast predicts heavy rain and thunderstorms tomorrow.',
    'Heavy rain caused flooding in several downtown streets last night.',
    'The chef prepared a delicious Italian pasta dish for dinner.',
    'Italian cuisine is famous for its fresh ingredients and bold flavors.',
    'The soccer team won the championship after a thrilling final match.',
    'Basketball players train rigorously during the off season every year.',
    'Quantum computers may revolutionize cryptography and drug discovery soon.',
    'Space exploration missions to Mars are planned for the next decade.',
    'Classical music concerts attract audiences of all ages worldwide.',
    'Jazz musicians often improvise solos during live performances on stage.',
    'The ancient castle overlooked the valley from the top of the hill.',
    'Archaeologists discovered pottery fragments dating back two thousand years.',
    'Electric vehicles are becoming more affordable and widely available now.',
    'Solar energy panels generate clean electricity from sunlight every day.',
  ];

  test('returns all sentences when n >= length', () => {
    const input = ['Hello world.', 'Goodbye world.', 'Foo bar baz.'];
    const result = lexrankSummarize(input, 10);
    expect(result).toEqual(input);
    // Should be a copy, not the same reference
    expect(result).not.toBe(input);
  });

  test('returns exactly n sentences when n < length', () => {
    const result = lexrankSummarize(corpus, 5);
    expect(result).toHaveLength(5);
    // Every returned sentence must come from the corpus
    for (const s of result) {
      expect(corpus).toContain(s);
    }
  });

  test('returns sentences in original order', () => {
    const result = lexrankSummarize(corpus, 8);
    const indices = result.map((s) => corpus.indexOf(s));
    // Indices must be strictly ascending
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThan(indices[i - 1]);
    }
  });

  test('applies boosts to favor specific sentences', () => {
    // Boost the last sentence heavily
    const boosts = new Array(corpus.length).fill(1.0);
    boosts[corpus.length - 1] = 100.0;

    const result = lexrankSummarize(corpus, 5, 0.1, boosts);
    // The heavily boosted sentence should be selected
    expect(result).toContain(corpus[corpus.length - 1]);
  });

  test('speaker balance post-pass adds underrepresented speakers', () => {
    // Build 20 sentences: 18 from speaker A, 2 from speaker B.
    // Without balance, speaker B may get 0 selections.
    const speakerLabels = corpus.map((_, i) => (i < 18 ? 'A' : 'B'));

    // Select 8 sentences.  min_rep = max(2, floor(8/4)) = 2
    const result = lexrankSummarize(corpus, 8, 0.1, null, speakerLabels);

    // Count speaker B sentences in result
    const bSentences = new Set(corpus.slice(18));
    const bCount = result.filter((s) => bSentences.has(s)).length;
    expect(bCount).toBeGreaterThanOrEqual(2);
  });

  test('single sentence input', () => {
    const input = ['Only one sentence here.'];
    const result = lexrankSummarize(input, 5);
    expect(result).toEqual(input);
  });

  test('empty input', () => {
    const result = lexrankSummarize([], 5);
    expect(result).toEqual([]);
  });

  test('handles sentences with no shared vocabulary', () => {
    const disjoint = [
      'alpha beta gamma',
      'delta epsilon zeta',
      'eta theta iota',
      'kappa lambda mu',
      'nu xi omicron',
    ];
    const result = lexrankSummarize(disjoint, 3);
    expect(result).toHaveLength(3);
    for (const s of result) {
      expect(disjoint).toContain(s);
    }
  });
});

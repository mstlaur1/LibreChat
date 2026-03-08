'use strict';

const WORD_RE = /[a-z0-9]+/g;

function tokenize(text) {
  return text.toLowerCase().match(WORD_RE) || [];
}

/**
 * LexRank extractive summarization with MMR diversity.
 *
 * @param {string[]} sentences
 * @param {number}   [nSentences=15]
 * @param {number}   [threshold=0.1]
 * @param {number[]|null} [boosts=null]       Per-sentence multipliers.
 * @param {string[]|null} [speakerLabels=null] Speaker tag per sentence.
 * @returns {string[]} Selected sentences in original order.
 */
function lexrankSummarize(sentences, nSentences = 15, threshold = 0.1, boosts = null, speakerLabels = null) {
  if (sentences.length <= nSentences) {
    return sentences.slice();
  }

  const nDocs = sentences.length;

  // --- TF and document frequency ---
  const docFreq = new Map();
  const tfVectors = [];

  for (let s = 0; s < nDocs; s++) {
    const words = tokenize(sentences[s]);
    const tf = new Map();
    const seen = new Set();
    for (const w of words) {
      tf.set(w, (tf.get(w) || 0) + 1);
      seen.add(w);
    }
    tfVectors.push(tf);
    for (const w of seen) {
      docFreq.set(w, (docFreq.get(w) || 0) + 1);
    }
  }

  // --- IDF ---
  const idf = new Map();
  for (const [word, df] of docFreq) {
    idf.set(word, Math.log(nDocs / (1 + df)));
  }

  // --- TF-IDF vectors and norms ---
  const tfidf = [];
  const norms = [];

  for (const tf of tfVectors) {
    const vec = new Map();
    let sumSq = 0;
    for (const [w, count] of tf) {
      const val = count * (idf.get(w) || 0);
      vec.set(w, val);
      sumSq += val * val;
    }
    tfidf.push(vec);
    norms.push(Math.sqrt(sumSq) || 1.0);
  }

  // --- Sparse adjacency (cosine similarity above threshold) ---
  const adj = Array.from({ length: nDocs }, () => []);

  for (let i = 0; i < nDocs; i++) {
    for (let j = i + 1; j < nDocs; j++) {
      let dot = 0;
      for (const [w, vi] of tfidf[i]) {
        const vj = tfidf[j].get(w);
        if (vj !== undefined) {
          dot += vi * vj;
        }
      }
      const sim = dot / (norms[i] * norms[j]);
      if (sim > threshold) {
        adj[i].push([j, sim]);
        adj[j].push([i, sim]);
      }
    }
  }

  // --- Power iteration (LexRank centrality) ---
  const damping = 0.85;
  let scores = new Array(nDocs).fill(1.0 / nDocs);

  for (let iter = 0; iter < 20; iter++) {
    const newScores = new Array(nDocs).fill((1 - damping) / nDocs);
    for (let i = 0; i < nDocs; i++) {
      const neighbors = adj[i];
      if (neighbors.length === 0) {
        continue;
      }
      let totalWeight = 0;
      for (let k = 0; k < neighbors.length; k++) {
        totalWeight += neighbors[k][1];
      }
      for (let k = 0; k < neighbors.length; k++) {
        const [j, w] = neighbors[k];
        newScores[j] += damping * scores[i] * (w / totalWeight);
      }
    }
    scores = newScores;
  }

  // --- Apply external boosts ---
  if (boosts) {
    for (let i = 0; i < nDocs; i++) {
      scores[i] *= boosts[i];
    }
  }

  // --- Cosine helper ---
  function cosine(i, j) {
    let dot = 0;
    for (const [w, vi] of tfidf[i]) {
      const vj = tfidf[j].get(w);
      if (vj !== undefined) {
        dot += vi * vj;
      }
    }
    return dot / (norms[i] * norms[j]);
  }

  // --- MMR selection ---
  const lambda = 0.5;
  const selected = [];
  const candidates = new Set(Array.from({ length: nDocs }, (_, i) => i));

  for (let round = 0; round < nSentences; round++) {
    if (candidates.size === 0) {
      break;
    }
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const i of candidates) {
      let redundancy = 0;
      for (const j of selected) {
        const c = cosine(i, j);
        if (c > redundancy) {
          redundancy = c;
        }
      }
      const mmr = lambda * scores[i] - (1 - lambda) * redundancy;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = i;
      }
    }
    selected.push(bestIdx);
    candidates.delete(bestIdx);
  }

  // --- Speaker balance post-pass ---
  if (speakerLabels) {
    const selectedSet = new Set(selected);
    const speakers = new Set(speakerLabels);

    if (speakers.size >= 2) {
      const minRep = Math.max(2, Math.floor(selected.length / 4));

      for (const speaker of speakers) {
        let count = 0;
        for (const i of selected) {
          if (speakerLabels[i] === speaker) {
            count++;
          }
        }
        if (count < minRep) {
          const candidatesForSpeaker = [];
          for (let i = 0; i < nDocs; i++) {
            if (!selectedSet.has(i) && speakerLabels[i] === speaker) {
              candidatesForSpeaker.push([scores[i], i]);
            }
          }
          candidatesForSpeaker.sort((a, b) => b[0] - a[0]);
          const toAdd = Math.min(candidatesForSpeaker.length, minRep - count);
          for (let k = 0; k < toAdd; k++) {
            const idx = candidatesForSpeaker[k][1];
            selected.push(idx);
            selectedSet.add(idx);
          }
        }
      }
    }
  }

  // --- Return in original order ---
  selected.sort((a, b) => a - b);
  return selected.map((i) => sentences[i]);
}

module.exports = { lexrankSummarize };

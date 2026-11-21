// The computer opponent. It stands in for net.js's link: the page talks to it
// exactly as it would to a guest's browser, and it answers with the same
// messages (its own commitment, scores for your guesses, its guesses at your
// code, and its code at the end), so the round itself runs unchanged.
import * as Rules from './rules.js';

// How each level picks its next guess.
//   easy:   a code that fits every score so far, counting only the right-place pegs
//   medium: usually a code that fits every score so far, sometimes one that fits only the latest
//   hard:   of the codes that fit, the one that leaves the fewest in the worst case
export const LEVELS = {
  easy: { name: 'Easy', exactOnly: true },
  medium: { name: 'Medium', hunch: 0.25 },
  hard: { name: 'Hard', hunch: 0, minimax: true },
};

/** Same shape as openLink() in net.js. */
export function openBot({ level, on }) {
  const skill = LEVELS[level] ?? LEVELS.medium;
  let round = null;
  let timer = 0;
  let closed = false;

  const reply = (message) => { if (!closed) on.message?.(message); };
  const later = (fn, ms) => setTimeout(() => { if (!closed) fn(); }, ms);

  async function newRound({ id, level: key }) {
    clearTimeout(timer);
    const lv = Rules.LEVELS[key];
    const secret = Rules.randomCode(lv);
    const salt = Rules.newSalt();
    round = { id, lv, secret, salt, theirs: [], mine: [], ready: false, theirReady: false, over: false };
    const commit = await Rules.commitTo(secret, salt);
    if (round?.id !== id) return;
    // Pretend to pick colors for a moment.
    timer = later(() => {
      round.ready = true;
      reply({ t: 'ready', id, commit });
      guessSoon();
    }, 1200 + Math.random() * 1200);
  }

  function guessSoon() {
    if (!round || round.over || !round.ready || !round.theirReady) return;
    clearTimeout(timer);
    const { mine, lv } = round;
    if (mine.length >= lv.rows || mine.some((g) => !g.result)) return;
    if (mine.at(-1)?.result.exact === lv.pegs) return;
    timer = later(() => {
      if (!round || round.over) return;
      const guess = nextGuess(round.mine, round.lv, skill);
      round.mine.push({ guess, result: null });
      reply({ t: 'guess', id: round.id, n: round.mine.length, guess });
    }, 2500 + Math.random() * 3500);
  }

  setTimeout(() => { if (!closed) on.open?.(); }, 0);

  return {
    connected: true,
    send(message) {
      if (message?.t === 'round') return newRound(message);
      if (!round || message?.id !== round.id) return;
      switch (message.t) {
        case 'ready':
          round.theirReady = true;
          return guessSoon();
        case 'guess': {
          if (!Rules.validCode(message.guess, round.lv)) return;
          if (message.n === round.theirs.length + 1) round.theirs.push(Rules.score(message.guess, round.secret));
          const result = round.theirs[message.n - 1];
          if (result) later(() => reply({ t: 'score', id: message.id, n: message.n, ...result }), 300);
          return;
        }
        case 'score': {
          const mine = round.mine[message.n - 1];
          if (!mine || mine.result) return;
          mine.result = { exact: message.exact, close: message.close };
          return guessSoon();
        }
        case 'reveal':
          // The round is over: stop guessing and show our code too.
          if (round.over) return;
          round.over = true;
          clearTimeout(timer);
          return reply({ t: 'reveal', id: round.id, secret: round.secret, salt: round.salt });
      }
    },
    setMedia() {},
    close() {
      closed = true;
      clearTimeout(timer);
    },
  };
}

// ── Choosing a guess ─────────────────────────────────────────────────────────

/** Every code for this level, as arrays of color numbers. */
function allCodes(lv) {
  const codes = [];
  const total = lv.colors ** lv.pegs;
  for (let n = 0; n < total; n++) {
    const code = [];
    for (let k = 0, rest = n; k < lv.pegs; k++, rest = Math.floor(rest / lv.colors)) code.push(rest % lv.colors);
    codes.push(code);
  }
  return codes;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const same = (a, b) => a.exact === b.exact && a.close === b.close;

function nextGuess(history, lv, skill) {
  const scored = history.filter((g) => g.result);
  if (!scored.length) return opening(lv);
  const asked = new Set(scored.map((g) => g.guess.join()));
  const unasked = allCodes(lv).filter((code) => !asked.has(code.join()));
  const fits = unasked.filter((code) => scored.every((g) => {
    const r = Rules.score(g.guess, code);
    return skill.exactOnly ? r.exact === g.result.exact : same(r, g.result);
  }));
  // A hunch: a code that fits only the latest score. Never on the last try.
  if (fits.length > 1 && history.length < lv.rows - 1 && Math.random() < (skill.hunch ?? 0)) {
    const last = scored.at(-1);
    const near = unasked.filter((code) => same(Rules.score(last.guess, code), last.result));
    if (near.length) return pick(near);
  }
  if (!fits.length) return pick(unasked);
  if (!skill.minimax || fits.length === 1 || fits.length > 1500) return pick(fits);

  // The guess (among those that could be right) whose worst score leaves the fewest codes.
  let best = Infinity;
  let picks = [];
  for (const guess of fits) {
    const buckets = new Map();
    let worst = 0;
    for (const code of fits) {
      const r = Rules.score(guess, code);
      const key = r.exact * 10 + r.close;
      const n = (buckets.get(key) ?? 0) + 1;
      buckets.set(key, n);
      if (n > worst) worst = n;
      if (worst > best) break;
    }
    if (worst < best) { best = worst; picks = [guess]; }
    else if (worst === best) picks.push(guess);
  }
  return pick(picks);
}

/** A good first guess: two colors in pairs (like red-red-blue-blue), shuffled. */
function opening(lv) {
  const [a, b, c] = [...Array(lv.colors).keys()].sort(() => Math.random() - 0.5);
  const pattern = lv.pegs === 5 ? [a, a, b, b, c] : [a, a, b, b];
  return pattern.sort(() => Math.random() - 0.5);
}

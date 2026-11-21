// The rules of Code, a code-breaking game for two. Each player hides a code of
// colored pegs; both then race to crack the other's. Every guess is scored with
// "exact" pegs (right color, right place) and "close" pegs (right color, wrong
// place). Whoever cracks their opponent's code in fewer tries wins.
//
// A code never leaves its owner's browser until the round is over. Instead each
// player first sends a commitment (a hash of the code and a random salt), scores
// the other's guesses itself, and reveals the code at the end, so the other side
// can check that every score it was given was honest.

export const LEVELS = {
  classic: { name: 'Classic', pegs: 4, colors: 6, rows: 10 },
  tricky: { name: 'Tricky', pegs: 4, colors: 8, rows: 10 },
  fiendish: { name: 'Fiendish', pegs: 5, colors: 8, rows: 12 },
};

export const COLOR_NAMES = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Pink', 'White'];

/** Score a guess against a code. */
export function score(guess, code) {
  let exact = 0;
  const left = {};
  const wanted = {};
  guess.forEach((peg, i) => {
    if (peg === code[i]) exact++;
    else {
      left[code[i]] = (left[code[i]] ?? 0) + 1;
      wanted[peg] = (wanted[peg] ?? 0) + 1;
    }
  });
  let close = 0;
  for (const [peg, n] of Object.entries(wanted)) close += Math.min(n, left[peg] ?? 0);
  return { exact, close };
}

/** Whether `code` is a well-formed code for this level. */
export const validCode = (code, level) => Array.isArray(code) && code.length === level.pegs
  && code.every((peg) => Number.isInteger(peg) && peg >= 0 && peg < level.colors);

export function randomCode(level) {
  return [...crypto.getRandomValues(new Uint8Array(level.pegs))].map((n) => n % level.colors);
}

export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/** The commitment to a code: a SHA-256 of the code and its salt, in hex. */
export async function commitTo(code, salt) {
  const bytes = new TextEncoder().encode(`${code.join(',')}:${salt}`);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

/**
 * Who has won, once it can be known.
 * Each side is { tries, solved, quit }: tries scored so far, whether the last one
 * cracked the code, and whether they gave up.
 * Returns null while undecided, else { winner: 'a' | 'b' | null }.
 */
export function outcome(a, b, rows) {
  if (a.quit || b.quit) return { winner: a.quit && b.quit ? null : a.quit ? 'b' : 'a' };
  const done = (p) => p.solved || p.tries >= rows;
  if (a.solved && b.solved) return { winner: a.tries < b.tries ? 'a' : b.tries < a.tries ? 'b' : null };
  // One has cracked it: the other wins only by doing it in fewer tries, and can't once they've used as many.
  if (a.solved) return done(b) || b.tries >= a.tries ? { winner: 'a' } : null;
  if (b.solved) return done(a) || a.tries >= b.tries ? { winner: 'b' } : null;
  return done(a) && done(b) ? { winner: null } : null;
}

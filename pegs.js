// Building blocks for drawing MM: code pegs, the little scoring pegs, and rows.
import { COLOR_NAMES } from './rules.js';

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? '' });

/** A code peg of color `c` (0–7), or an empty hole for null. */
export function peg(c) {
  const p = el('span', c === null || c === undefined ? 'peg empty' : 'peg');
  if (c !== null && c !== undefined) {
    p.dataset.c = c;
    p.setAttribute('aria-label', COLOR_NAMES[c]);
  }
  p.setAttribute('role', 'img');
  if (c === null || c === undefined) p.setAttribute('aria-label', 'Empty');
  return p;
}

/** The scoring pegs for a guess: exact ones first, then close ones, then holes. */
export function keys(n, result) {
  const box = el('span', 'keys');
  box.dataset.n = n;
  for (let i = 0; i < n; i++) {
    const kind = !result ? '' : i < result.exact ? 'exact' : i < result.exact + result.close ? 'close' : '';
    box.append(el('i', kind));
  }
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', !result
    ? 'Not scored yet'
    : `${result.exact} exact, ${result.close} close`);
  return box;
}

/**
 * One row of the board.
 * guess: array of colors (null for an empty slot); result: { exact, close } or null.
 */
export function row({ number, guess, result, pegs, current = false, cursor = -1, solved = false }) {
  const li = el('li', `row${current ? ' current' : ''}${solved ? ' solved' : ''}`);
  li.append(el('span', 'row-no', String(number)));
  const holes = el('span', 'holes');
  for (let i = 0; i < pegs; i++) {
    holes.append(current ? slot(guess?.[i] ?? null, i, i === cursor) : peg(guess?.[i] ?? null));
  }
  li.append(holes, keys(pegs, result));
  return li;
}

/** A slot of the row being filled in: a button that picks that slot. */
export function slot(c, index, cursor) {
  const b = el('button', `peg slot${c === null ? ' empty' : ''}${cursor ? ' cursor' : ''}`);
  b.type = 'button';
  b.dataset.slot = index;
  if (c !== null) b.dataset.c = c;
  b.setAttribute('aria-label', `Peg ${index + 1}: ${c === null ? 'empty' : COLOR_NAMES[c]}`);
  return b;
}

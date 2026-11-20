// MM: the page logic. rules.js knows the game, pegs.js draws, net.js connects;
// this file runs the lobby, the rounds, chat, video and settings.
import * as Rules from './rules.js';
import { peg, keys, row, slot } from './pegs.js';
import { openLink, newCode, cleanCode } from './net.js';

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TITLE = document.title;

// ── Look ─────────────────────────────────────────────────────────────────────
const THEMES = {
  Carnival: { tray: '#3a2a78', pegs: ['#ff4f5e', '#ff9f1c', '#ffd23f', '#2ec27e', '#3d8bff', '#a66cff', '#ff70c4', '#f6f1e7'] },
  Classic: { tray: '#6b4226', pegs: ['#d7263d', '#f46036', '#f9c80e', '#1b998b', '#2e86de', '#5f0f40', '#ff8fab', '#fdfdfd'] },
  Lagoon: { tray: '#0f5e6e', pegs: ['#ff6b6b', '#ffa94d', '#ffe066', '#69db7c', '#4dabf7', '#b197fc', '#f783ac', '#f1f3f5'] },
  Midnight: { tray: '#1b1d2e', pegs: ['#ef233c', '#fb8500', '#ffd60a', '#06d6a0', '#48cae4', '#9d4edd', '#ff5ca8', '#e9ecef'] },
};

function loadLook() {
  try {
    const saved = JSON.parse(localStorage.getItem('mm-look'));
    if (saved && THEMES[saved.theme]) return { theme: saved.theme, symbols: Boolean(saved.symbols) };
  } catch {}
  return { theme: 'Carnival', symbols: false };
}

function themeVars(theme, style) {
  style.setProperty('--tray', theme.tray);
  theme.pegs.forEach((color, i) => style.setProperty(`--c${i}`, color));
}

let look = loadLook();

function applyLook(save = false) {
  themeVars(THEMES[look.theme], document.documentElement.style);
  document.documentElement.classList.toggle('symbols', look.symbols);
  $('symbols').checked = look.symbols;
  for (const button of $('theme-list').children) button.setAttribute('aria-pressed', String(button.dataset.theme === look.theme));
  if (save) try { localStorage.setItem('mm-look', JSON.stringify(look)); } catch {}
}

for (const [name, theme] of Object.entries(THEMES)) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'theme';
  button.dataset.theme = name;
  themeVars(theme, button.style);
  const swatch = document.createElement('span');
  swatch.className = 'theme-swatch';
  swatch.setAttribute('aria-hidden', 'true');
  for (const c of [0, 2, 3, 4]) swatch.append(Object.assign(document.createElement('i'), { style: `background: var(--c${c})` }));
  button.append(swatch, name);
  button.addEventListener('click', () => { look.theme = name; applyLook(true); });
  $('theme-list').append(button);
}
$('symbols').addEventListener('change', () => { look.symbols = $('symbols').checked; applyLook(true); });
applyLook();

for (const dots of document.querySelectorAll('.level-dots')) {
  const n = Number(dots.dataset.n);
  for (let c = 0; c < n; c++) dots.append(peg(c));
}

// ── State ────────────────────────────────────────────────────────────────────
let link = null;          // the connection, or null
let host = false;
let code = '';
let levelKey = 'classic';
let round = null;         // see newRound()
let peerHere = false;
let celebrated = false;
let score = { me: 0, them: 0 };
let draft = [];           // the row being filled in: colors or null
let cursor = 0;           // the slot the next color goes in
let peeking = false;      // the game-over card is tucked away to look at the board

const level = () => Rules.LEVELS[round?.level ?? levelKey];

function newRound(id, key) {
  return {
    id,
    level: key,
    secret: null, salt: null, commit: null,   // ours, once locked in
    theirCommit: null,
    mine: [],             // our guesses: { guess, result: { exact, close } | null }
    theirs: [],           // theirs at our code: { guess, result }
    quit: { me: false, them: false },
    reveal: null,         // their code, once the round is over: { secret, honest }
    result: null,         // { winner: 'me' | 'them' | null }
  };
}

const roundKey = () => `mm-round-${code}`;
function saveRound() {
  try { sessionStorage.setItem(roundKey(), JSON.stringify(round)); } catch {}
}
function loadRound(id) {
  try {
    const saved = JSON.parse(sessionStorage.getItem(roundKey()));
    if (saved?.id === id && Rules.LEVELS[saved.level]) return saved;
  } catch {}
  return null;
}

function resetDraft() {
  draft = Array(level().pegs).fill(null);
  cursor = 0;
}

// ── The lobby's demo: a game of guesses on a hidden code ─────────────────────
const DEMO_CODE = [4, 0, 2, 2];
const DEMO_GUESSES = [[0, 0, 1, 1], [2, 2, 3, 3], [4, 2, 0, 5], [4, 0, 2, 2]];
let demoStep = 0;
function drawDemo() {
  const shown = Math.min(demoStep, DEMO_GUESSES.length);
  const solved = shown === DEMO_GUESSES.length;
  const hidden = document.createElement('div');
  hidden.className = 'hidden-code';
  for (const c of DEMO_CODE) hidden.append(solved ? peg(c) : Object.assign(peg(null), { className: 'peg shield' }));
  const rows = document.createElement('ol');
  rows.className = 'rows';
  for (let i = 0; i < 6; i++) {
    const guess = DEMO_GUESSES[i];
    const visible = i < shown;
    rows.append(row({
      number: i + 1, pegs: 4,
      guess: visible ? guess : null,
      result: visible ? Rules.score(guess, DEMO_CODE) : null,
      solved: visible && i === DEMO_GUESSES.length - 1,
    }));
  }
  $('preview').replaceChildren(hidden, rows);
}
drawDemo();
const calm = matchMedia('(prefers-reduced-motion: reduce)');
setInterval(() => {
  if ($('lobby').hidden || document.hidden || calm.matches) return;
  demoStep = demoStep > DEMO_GUESSES.length + 2 ? 0 : demoStep + 1;
  drawDemo();
}, 1300);

// ── Toast ────────────────────────────────────────────────────────────────────
const toastEl = $('toast');
const nativePopover = 'showPopover' in toastEl;
if (!nativePopover) toastEl.removeAttribute('popover');
let toastTimer = 0;
function toast(message) {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  if (nativePopover) {
    if (toastEl.matches(':popover-open')) toastEl.hidePopover();
    toastEl.showPopover();                       // re-showing lifts it above any open dialog
  } else {
    toastEl.classList.add('show');
  }
  toastTimer = setTimeout(() => {
    if (nativePopover) toastEl.hidePopover();
    else toastEl.classList.remove('show');
  }, 3800);
}

// ── Lobby ────────────────────────────────────────────────────────────────────
function setLobby(state, error = '') {
  $('setup').hidden = state !== 'idle';
  $('invite').hidden = state !== 'waiting';
  $('joining').hidden = state !== 'joining' && state !== 'opening';
  $('joining').lastChild.textContent = state === 'opening' ? 'Setting up your game…' : 'Joining the game…';
  $('lobby-error').hidden = !error;
  $('lobby-error').textContent = error;
  if (state === 'waiting') {
    $('code-text').textContent = code;
    const { name, pegs, colors } = Rules.LEVELS[levelKey];
    $('waiting-text').textContent = `${name}: ${pegs} pegs, ${colors} colors. Waiting for them to join…`;
  }
}

function show(screen) {
  $('lobby').hidden = screen !== 'lobby';
  $('game').hidden = screen !== 'game';
}

const inviteLink = () => `${location.origin}${location.pathname}#${code}`;

const PROBLEMS = {
  noroom: 'No game found with that code. Check it and try again.',
  full: 'That game already has two players.',
  network: 'Couldn’t reach the connection service. Check your internet and try again.',
  browser: 'This browser can’t make peer-to-peer connections.',
  lost: 'The connection dropped before the game started.',
  left: 'The other player left.',
  unreachable: 'Couldn’t connect to the other player. Try again, or try a different network or browser.',
};

function connect() {
  if (!round) setLobby(host ? 'opening' : 'joining');
  // Ignore callbacks from a connection we have already replaced or dropped.
  const guard = (fn) => (...args) => { if (link === current) fn(...args); };
  const current = openLink({
    code,
    host,
    on: {
      waiting: guard(() => { if (!round) setLobby('waiting'); }),
      open: guard(onPeer),
      message: guard(onMessage),
      peerLeft: guard(onPeerLeft),
      remoteStream: guard(showRemote),
      ended: guard(onEnded),
    },
  });
  link = current;
  if (localStream) link.setMedia(localStream);
}

function onPeer() {
  peerHere = true;
  if ($('lost').open) $('lost').close();
  if (!host) return;                    // the host's first message tells a guest what to show
  if (round) {
    sendRound(false);
    resend();
    toast('Your opponent is back.');
    render();
  } else {
    startRound();
  }
}

function onPeerLeft() {
  peerHere = false;
  toast('Your opponent disconnected.');
  render();
}

function onEnded(reason) {
  link = null;
  peerHere = false;
  if (reason === 'taken' && host && !round) {
    code = newCode();                   // someone else has that code; quietly pick another
    return connect();
  }
  if (!round) return toLobby(PROBLEMS[reason] ?? PROBLEMS.network);
  if (reason === 'left') {
    toast('Your opponent left the game.');
    return toLobby();
  }
  $('lost-text').textContent = host
    ? 'The connection service dropped. Rejoin to keep this game open for your opponent.'
    : reason === 'noroom'
      ? 'Couldn’t find the game. Your opponent may have left.'
      : 'The link to your opponent dropped. The game is still there if they are.';
  render();
  if (!$('lost').open) $('lost').showModal();
}

function toLobby(error = '') {
  link?.close();
  link = null;
  try { sessionStorage.removeItem(roundKey()); } catch {}
  round = null;
  peerHere = false;
  score = { me: 0, them: 0 };
  stopMedia();
  showRemote(null);
  $('chat-log').replaceChildren();
  $('chat-empty').hidden = false;
  for (const id of ['lost', 'leave', 'quit-ask']) if ($(id).open) $(id).close();
  if (location.hash) history.replaceState(null, '', location.pathname);
  document.title = TITLE;
  show('lobby');
  setLobby('idle', error);
}

$('start-form').addEventListener('submit', (event) => {
  event.preventDefault();
  host = true;
  levelKey = new FormData(event.target).get('level');
  if (!Rules.LEVELS[levelKey]) levelKey = 'classic';
  try { localStorage.setItem('mm-level', levelKey); } catch {}
  code = newCode();
  connect();
});
try {
  const saved = localStorage.getItem('mm-level');
  const input = document.querySelector(`input[name="level"][value="${saved}"]`);
  if (input) input.checked = true;
} catch {}

function join(text) {
  const wanted = cleanCode(text);
  if (wanted.length !== 7) return setLobby('idle', 'A game code looks like abc-def.');
  host = false;
  code = wanted;
  history.replaceState(null, '', `#${code}`);
  connect();
}

$('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  join($('join-code').value);
});

$('cancel-wait').addEventListener('click', () => toLobby());
$('leave-yes').addEventListener('click', () => toLobby());
$('lost-quit').addEventListener('click', () => toLobby());
$('lost-rejoin').addEventListener('click', () => {
  $('lost').close();
  connect();
});
$('lost').addEventListener('cancel', (event) => event.preventDefault());

if (navigator.share) {
  $('share-btn').hidden = false;
  $('share-btn').addEventListener('click', () => {
    navigator.share({ title: 'MM', text: 'Can you crack my code?', url: inviteLink() }).catch(() => {});
  });
}

// Tell the other player when this tab goes away for good.
addEventListener('pagehide', (event) => { if (!event.persisted) link?.close(); });

// ── Rounds ───────────────────────────────────────────────────────────────────
const send = (message) => link?.send(message);
const sendRound = (fresh) => send({ t: 'round', id: round.id, level: round.level, fresh, score: { you: score.them, them: score.me } });

/** Host only: start a new round at the chosen level. */
function startRound() {
  round = newRound(crypto.randomUUID(), levelKey);
  saveRound();
  sendRound(true);
  begin();
}

/** Put the round on screen. */
function begin() {
  celebrated = false;
  peeking = false;
  resetDraft();
  $('confetti').replaceChildren();
  show('game');
  render();
}

/** Send everything the other side should have heard from us this round. Safe to repeat. */
function resend() {
  if (!round) return;
  if (round.commit) send({ t: 'ready', id: round.id, commit: round.commit });
  round.mine.forEach(({ guess }, i) => send({ t: 'guess', id: round.id, n: i + 1, guess }));
  if (round.quit.me) send({ t: 'quit', id: round.id });
  if (round.result) send({ t: 'reveal', id: round.id, secret: round.secret, salt: round.salt });
}

const phase = () => {
  if (!round) return 'none';
  if (round.result) return 'over';
  if (!round.commit) return 'make';
  if (!round.theirCommit) return 'wait';
  return 'play';
};

const side = (list, quit) => {
  const scored = list.filter((g) => g.result);
  const last = scored.at(-1);
  return { tries: scored.length, solved: Boolean(last && last.result.exact === level().pegs), quit };
};
const meSide = () => side(round.mine, round.quit.me);
const themSide = () => side(round.theirs, round.quit.them);

const canGuess = () => {
  if (phase() !== 'play') return false;
  const me = meSide();
  return !me.solved && !round.quit.me && round.mine.length < level().rows && round.mine.every((g) => g.result);
};

/** See whether the round is decided, and wrap it up if so. */
function settle() {
  if (!round || round.result) return;
  const decided = Rules.outcome(meSide(), themSide(), level().rows);
  if (!decided) return;
  round.result = { winner: decided.winner === 'a' ? 'me' : decided.winner === 'b' ? 'them' : null };
  if (round.result.winner === 'me') score.me++;
  else if (round.result.winner === 'them') score.them++;
  send({ t: 'reveal', id: round.id, secret: round.secret, salt: round.salt });
  saveRound();
}

// ── Making a code, and guessing ──────────────────────────────────────────────
function place(color) {
  const making = phase() === 'make';
  if (!making && !canGuess()) return;
  if (color >= level().colors) return;
  draft[cursor] = color;
  const next = draft.findIndex((c, i) => c === null && i > cursor);
  const first = draft.indexOf(null);
  cursor = next >= 0 ? next : first >= 0 ? first : Math.min(cursor + 1, draft.length - 1);
  render();
}

function clearOne() {
  if (phase() !== 'make' && !canGuess()) return;
  // Clear the slot under the cursor, or the last filled one.
  if (draft[cursor] === null) {
    const filled = draft.findLastIndex((c) => c !== null);
    if (filled < 0) return;
    cursor = filled;
  }
  draft[cursor] = null;
  render();
}

function pickSlot(i) {
  if (cursor === i && draft[i] !== null) draft[i] = null;   // a second tap empties it
  cursor = i;
  render();
}

async function lockIn() {
  if (phase() !== 'make' || draft.includes(null)) return;
  const secret = [...draft];
  const salt = Rules.newSalt();
  const commit = await Rules.commitTo(secret, salt);
  if (phase() !== 'make') return;
  Object.assign(round, { secret, salt, commit });
  saveRound();
  send({ t: 'ready', id: round.id, commit });
  resetDraft();
  render();
}

function check() {
  if (!canGuess() || draft.includes(null)) return;
  const guess = [...draft];
  round.mine.push({ guess, result: null });
  saveRound();
  send({ t: 'guess', id: round.id, n: round.mine.length, guess });
  resetDraft();
  render();
}

$('btn-go').addEventListener('click', () => (phase() === 'make' ? lockIn() : check()));
$('btn-clear').addEventListener('click', clearOne);
$('btn-random').addEventListener('click', () => {
  if (phase() !== 'make') return;
  draft = Rules.randomCode(level());
  cursor = 0;
  render();
});
$('palette').addEventListener('click', (event) => {
  const button = event.target.closest('[data-c]');
  if (button) place(Number(button.dataset.c));
});
for (const id of ['rows', 'make-slots']) {
  $(id).addEventListener('click', (event) => {
    const button = event.target.closest('.slot');
    if (button) pickSlot(Number(button.dataset.slot));
  });
}

// Keyboard: 1–8 for colors, Backspace, arrows, Enter.
addEventListener('keydown', (event) => {
  if ($('game').hidden || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.target.closest?.('input, textarea, dialog')) return;
  if (phase() !== 'make' && !canGuess()) return;
  if (/^[1-8]$/.test(event.key)) place(Number(event.key) - 1);
  else if (event.key === 'Backspace' || event.key === 'Delete') clearOne();
  else if (event.key === 'ArrowLeft') { cursor = Math.max(0, cursor - 1); render(); }
  else if (event.key === 'ArrowRight') { cursor = Math.min(draft.length - 1, cursor + 1); render(); }
  else if (event.key === 'Enter' && !event.target.closest('button')) $('btn-go').click();
  else return;
  event.preventDefault();
});

$('quit-yes').addEventListener('click', () => {
  $('quit-ask').close();
  if (!round || round.result || phase() === 'make') return;
  round.quit.me = true;
  send({ t: 'quit', id: round.id });
  settle();
  saveRound();
  render();
});

/** Host only: a new round at the same level. */
function rematch() {
  levelKey = round.level;
  startRound();
}

$('again').addEventListener('click', () => {
  if (!round?.result) return;
  if (host) return peerHere ? rematch() : toast('Your opponent isn’t connected.');
  send({ t: 'again' });
  toast('Asked your opponent’s browser for a new round…');
});

$('peek').addEventListener('click', () => {
  peeking = !peeking;
  render();
});

// ── Drawing ──────────────────────────────────────────────────────────────────
function render() {
  if (!round) return;
  const lv = level();
  const ph = phase();
  const me = meSide();
  const them = themSide();
  const guessing = canGuess();

  // Their code: shields until revealed.
  $('their-code').replaceChildren(...Array.from({ length: lv.pegs }, (_, i) => (round.reveal
    ? Object.assign(peg(round.reveal.secret[i]), { style: `--i: ${i}` })
    : Object.assign(peg(null), { className: 'peg shield', ariaLabel: 'Hidden' }))));
  $('their-code').classList.toggle('open', Boolean(round.reveal));

  // Our guesses, with the one being filled in.
  const rows = [];
  for (let i = 0; i < lv.rows; i++) {
    const done = round.mine[i];
    const current = guessing && i === round.mine.length;
    rows.push(row({
      number: i + 1,
      pegs: lv.pegs,
      guess: done ? done.guess : current ? draft : null,
      result: done?.result ?? null,
      current,
      cursor,
      solved: Boolean(done?.result && done.result.exact === lv.pegs),
    }));
    if (done && !done.result) rows.at(-1).classList.add('pending');
  }
  $('rows').replaceChildren(...rows);
  $('tray').classList.toggle('dim', ph === 'make' || ph === 'wait');
  $('tray').style.setProperty('--pegs', lv.pegs);
  $('rows').querySelector('.current')?.scrollIntoView({ block: 'nearest' });

  // The composer: making a code, or guessing.
  const making = ph === 'make';
  $('composer').hidden = !(making || guessing);
  $('make-slots').hidden = !making;
  if (making) $('make-slots').replaceChildren(...draft.map((c, i) => slot(c, i, i === cursor)));
  $('composer-title').textContent = making ? 'Make your secret code' : `Guess ${round.mine.length + 1} of ${lv.rows}`;
  $('btn-random').hidden = !making;
  $('btn-go').textContent = making ? 'Lock it in 🔒' : 'Check';
  $('btn-go').disabled = draft.includes(null);
  $('palette').replaceChildren(...Array.from({ length: lv.colors }, (_, c) => {
    const button = peg(c);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.c = c;
    b.setAttribute('aria-label', `${Rules.COLOR_NAMES[c]} (${c + 1})`);
    b.append(button);
    return b;
  }));

  // Our code and their guesses at it.
  $('my-code').replaceChildren(...Array.from({ length: lv.pegs }, (_, i) => peg(round.secret?.[i] ?? null)));
  $('their-rows').replaceChildren(...round.theirs.map((g, i) => row({
    number: i + 1, pegs: lv.pegs, guess: g.guess, result: g.result, solved: g.result.exact === lv.pegs,
  })));
  $('their-empty').hidden = round.theirs.length > 0;

  // Seats.
  const wins = (n) => (score.me || score.them ? `${n} win${n === 1 ? '' : 's'}` : '');
  $('wins-me').textContent = wins(score.me);
  $('wins-them').textContent = wins(score.them);
  $('their-tries').textContent = !round.theirCommit
    ? 'making a code…'
    : !round.commit ? 'code locked in 🔒'
    : them.solved ? `cracked it in ${them.tries} 🔓` : them.quit ? 'gave up' : `${round.theirs.length} of ${lv.rows} tries`;
  $('seat-me').classList.toggle('turn', guessing || making);

  let status = '';
  if (ph === 'over') status = 'Round over.';
  else if (making) status = 'Pick a color for each peg. They won’t see it.';
  else if (ph === 'wait') status = 'Code locked in. Waiting for them to make theirs…';
  else if (me.solved) status = `You cracked it in ${me.tries}! Waiting to see if they can do better…`;
  else if (round.mine.length >= lv.rows && round.mine.every((g) => g.result)) status = 'Out of tries. Waiting for them…';
  else if (!guessing) status = 'Checking…';
  else if (!round.mine.length) status = 'Crack their code! Fill a row and press Check.';
  else status = 'Your guess.';
  $('status').textContent = status;
  document.title = guessing || making ? `Your move · ${TITLE}` : TITLE;
  $('quit').hidden = !(ph === 'play' || ph === 'wait') || round.quit.me;

  $('link-state').dataset.state = peerHere ? 'on' : 'off';
  $('link-text').textContent = peerHere ? 'Connected' : host ? `Away. They can rejoin with ${code}` : 'Disconnected';

  $('over').hidden = ph !== 'over';
  $('over').classList.toggle('tucked', peeking);
  $('peek').textContent = peeking ? 'Show the result' : 'See the board';
  if (ph === 'over') {
    if ($('quit-ask').open) $('quit-ask').close();
    celebrate();
  }
}

function celebrate() {
  const { winner } = round.result;
  const me = meSide();
  const them = themSide();
  const won = winner === 'me';
  const tries = (n) => `${n} ${n === 1 ? 'try' : 'tries'}`;
  if (round.quit.me && !round.quit.them) {
    $('over-title').textContent = 'You gave up';
    $('over-sub').textContent = 'Your opponent takes the round.';
  } else if (round.quit.them && !round.quit.me) {
    $('over-title').textContent = 'You win! 🎉';
    $('over-sub').textContent = 'Your opponent gave up.';
  } else if (won) {
    $('over-title').textContent = `Cracked it in ${tries(me.tries)}! 🎉`;
    $('over-sub').textContent = them.solved ? `They needed ${tries(them.tries)}.`
      : them.tries >= level().rows ? 'They couldn’t crack yours.'
      : `They hadn’t cracked yours after ${tries(them.tries)}.`;
  } else if (winner === 'them') {
    $('over-title').textContent = them.solved ? `They cracked it in ${tries(them.tries)}` : 'They win this one';
    $('over-sub').textContent = me.solved ? `You needed ${tries(me.tries)}. So close!`
      : `You hadn’t cracked theirs yet. Fancy another round?`;
  } else {
    $('over-title').textContent = 'It’s a draw 🤝';
    $('over-sub').textContent = me.solved ? `You both needed ${tries(me.tries)}.` : 'Neither code got cracked.';
  }
  if (round.reveal && !round.reveal.honest) {
    $('over-sub').textContent += ' ⚠️ Their code doesn’t match the scores they gave.';
  }
  if (celebrated) return;
  celebrated = true;
  const confetti = $('confetti');
  confetti.replaceChildren();
  if (!won) return;
  for (let n = 0; n < 48; n++) {
    const bit = document.createElement('i');
    bit.style.setProperty('--left', `${Math.random() * 100}%`);
    bit.style.setProperty('--delay', `${Math.random() * 0.9}s`);
    bit.style.setProperty('--spin', `${(Math.random() - 0.5) * 900}deg`);
    bit.style.background = `var(--c${n % 8})`;
    confetti.append(bit);
  }
}

// ── Messages from the other player ───────────────────────────────────────────
const sameRound = (message) => round && message.id === round.id;

async function onMessage(message) {
  switch (message?.t) {
    case 'round':
      return theirRound(message);
    case 'again':
      return host && round?.result ? rematch() : undefined;
    case 'broken':
      // The guest lost its code (say, a different browser); start over.
      if (host && round) { toast('Your opponent lost their code, so here’s a fresh round.'); rematch(); }
      return;
    case 'chat':
      return addChat('them', String(message.text ?? '').slice(0, 500));
  }
  if (!sameRound(message)) return;
  const lv = level();
  switch (message.t) {
    case 'ready':
      if (typeof message.commit !== 'string' || !/^[0-9a-f]{64}$/.test(message.commit)) return;
      if (!round.theirCommit) {
        round.theirCommit = message.commit;
        if (round.commit) toast('They’ve locked in their code. Go!');
      }
      break;
    case 'guess': {
      if (!round.secret || !Rules.validCode(message.guess, lv)) return;
      const n = message.n;
      if (n === round.theirs.length + 1 && n <= lv.rows && !themSide().solved && !round.quit.them) {
        round.theirs.push({ guess: message.guess, result: Rules.score(message.guess, round.secret) });
      }
      const known = round.theirs[n - 1];
      if (known) send({ t: 'score', id: round.id, n, ...known.result });
      break;
    }
    case 'score': {
      const mine = round.mine[message.n - 1];
      const ok = (v) => Number.isInteger(v) && v >= 0 && v <= lv.pegs;
      if (!mine || mine.result || !ok(message.exact) || !ok(message.close) || message.exact + message.close > lv.pegs) return;
      mine.result = { exact: message.exact, close: message.close };
      if (mine.result.exact === lv.pegs) toast('🔓 You cracked it!');
      break;
    }
    case 'quit':
      round.quit.them = true;
      break;
    case 'reveal': {
      if (round.reveal || !Rules.validCode(message.secret, lv) || typeof message.salt !== 'string') return;
      const matches = round.theirCommit && (await Rules.commitTo(message.secret, message.salt)) === round.theirCommit;
      const fair = round.mine.every(({ guess, result }) => {
        if (!result) return true;
        const real = Rules.score(guess, message.secret);
        return real.exact === result.exact && real.close === result.close;
      });
      round.reveal = { secret: message.secret, honest: Boolean(matches && fair) };
      break;
    }
    default:
      return;
  }
  settle();
  saveRound();
  render();
}

/** The host says which round we're in. */
function theirRound(message) {
  if (host || !Rules.LEVELS[message.level] || typeof message.id !== 'string') return;
  const ok = (n) => Number.isInteger(n) && n >= 0 && n < 1e6;
  if (message.score && ok(message.score.you) && ok(message.score.them)) score = { me: message.score.you, them: message.score.them };
  if (round?.id !== message.id) {
    const restored = message.fresh ? null : loadRound(message.id);
    if (!message.fresh && !restored) return send({ t: 'broken' });
    round = restored ?? newRound(message.id, message.level);
    saveRound();
    begin();
  } else {
    render();
  }
  resend();
}

// ── Chat ─────────────────────────────────────────────────────────────────────
let chatVisible = true;
new IntersectionObserver(([entry]) => { chatVisible = entry.isIntersecting; }).observe($('chat-form'));

function addChat(who, text) {
  if (!text.trim()) return;
  const log = $('chat-log');
  const item = document.createElement('li');
  item.className = who;
  const label = document.createElement('span');
  label.className = 'visually-hidden';
  label.textContent = who === 'me' ? 'You: ' : 'Opponent: ';
  item.append(label, text);
  log.append(item);
  log.scrollTop = log.scrollHeight;
  $('chat-empty').hidden = true;
  if (who === 'them' && !chatVisible) toast(`💬 ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
}

$('chat-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('chat-input');
  const text = input.value.trim();
  if (!text) return;
  if (!link?.connected) return toast('Your opponent isn’t connected right now.');
  send({ t: 'chat', text });
  addChat('me', text);
  input.value = '';
});

// ── Camera and microphone ────────────────────────────────────────────────────
const want = { cam: false, mic: false };
let localStream = null;
let mediaJob = Promise.resolve();

async function syncMedia() {
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  if (want.cam || want.mic) {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        video: want.cam ? { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } : false,
        audio: want.mic,
      });
    } catch {
      want.cam = want.mic = false;
      toast('Couldn’t use your camera or microphone. Check this site’s permissions.');
    }
  }
  if (!round && localStream) {           // left the game while the browser was asking
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
    want.cam = want.mic = false;
  }
  $('video-me').srcObject = want.cam ? localStream : null;
  $('videos').dataset.me = want.cam ? 'cam' : want.mic ? 'mic' : 'off';
  $('btn-cam').setAttribute('aria-pressed', String(want.cam));
  $('btn-mic').setAttribute('aria-pressed', String(want.mic));
  link?.setMedia(localStream);
}

function stopMedia() {
  want.cam = want.mic = false;
  mediaJob = mediaJob.then(syncMedia);
}

for (const kind of ['cam', 'mic']) {
  $(`btn-${kind}`).addEventListener('click', () => {
    want[kind] = !want[kind];
    mediaJob = mediaJob.then(syncMedia);   // one change at a time, in order
  });
}

function showRemote(stream) {
  const video = $('video-them');
  video.srcObject = stream;
  $('videos').dataset.them = !stream ? 'off' : stream.getVideoTracks().length ? 'cam' : 'mic';
  if (stream) video.play().catch(() => toast('Tap the video to hear your opponent.'));
}
$('video-them').addEventListener('click', (event) => event.target.play().catch(() => {}));

// ── Dialogs ──────────────────────────────────────────────────────────────────
// Closing animates in CSS where the browser can transition out of the top
// layer. Elsewhere, play the exit by hand before really closing.
let displayTransitions;
function canAnimateExit() {
  if (displayTransitions === undefined) {
    displayTransitions = false;
    if (CSS.supports?.('transition-behavior', 'allow-discrete')) {
      const probe = document.createElement('div');
      probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
      document.body.append(probe);
      void getComputedStyle(probe).display;
      probe.style.display = 'none';
      displayTransitions = getComputedStyle(probe).display === 'block';
      probe.remove();
    }
  }
  return displayTransitions && CSS.supports?.('overlay', 'auto');
}

async function closeDialog(dialog) {
  if (!canAnimateExit()) {
    dialog.setAttribute('data-closing', '');
    const running = dialog.getAnimations({ subtree: true });
    if (running.length) {
      await Promise.race([Promise.allSettled(running.map((a) => a.finished)), sleep(2000)]);
    }
    if (!dialog.hasAttribute('data-closing')) return;
    dialog.removeAttribute('data-closing');
  }
  dialog.close();
}

for (const dialog of document.querySelectorAll('dialog')) {
  if (dialog.id === 'lost') continue;            // must be answered, not dismissed
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDialog(dialog);
  });
  for (const button of dialog.querySelectorAll('[data-close]')) {
    button.addEventListener('click', () => closeDialog(dialog));
  }
}

// Click-outside-to-close where `closedby` isn't supported yet.
if (!('closedBy' in HTMLDialogElement.prototype)) {
  const outside = (e, dialog) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  for (const dialog of document.querySelectorAll('dialog[closedby="any"]')) {
    let pressedOutside = false;
    dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e, dialog); });
    dialog.addEventListener('pointerup', (e) => { if (pressedOutside && outside(e, dialog)) closeDialog(dialog); });
  }
}

// ── Copy buttons ─────────────────────────────────────────────────────────────
const copyTimers = new WeakMap();
let lastCopyMessage = '';

async function copy(button, command) {
  const text = command === '--copy-link' ? inviteLink() : code;
  let ok = true;
  try { await navigator.clipboard.writeText(text); } catch { ok = false; }
  const tip = button.nextElementSibling;
  clearTimeout(copyTimers.get(button));
  button.removeAttribute('data-copied');
  button.removeAttribute('data-failed');
  tip.textContent = '';
  void button.offsetWidth;
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '');
  let message = ok ? 'Copied' : 'Copy failed';
  if (message === lastCopyMessage) message += ' ';   // so screen readers repeat it
  lastCopyMessage = message;
  requestAnimationFrame(() => { tip.textContent = message; });
  copyTimers.set(button, setTimeout(() => {
    button.removeAttribute('data-copied');
    button.removeAttribute('data-failed');
    tip.textContent = '';
  }, 2000));
}

if ('CommandEvent' in window) {
  // `command` events don't bubble, so listen in the capture phase.
  document.addEventListener('command', (event) => {
    if (event.command.startsWith('--copy')) copy(event.source, event.command);
  }, true);
} else {
  // Older browsers: do by hand what the command/commandfor attributes declare.
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command]');
    if (!button) return;
    const command = button.getAttribute('command');
    if (command.startsWith('--copy')) copy(button, command);
    if (command === 'show-modal') document.getElementById(button.getAttribute('commandfor'))?.showModal();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────────
setLobby('idle');
// Opening an invite link in a tab that already has MM open only changes the hash.
addEventListener('hashchange', () => {
  if (!round && !link && location.hash.length > 1) join(location.hash);
});
if (location.hash.length > 1) {
  $('join-code').value = cleanCode(location.hash);
  join(location.hash);
}

// ── Appearance: System, Light or Dark, saved in this browser. The choice is written
// to <meta name="color-scheme">, which the stylesheet follows. ──
{
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  for (const input of document.querySelectorAll('input[name="scheme"]')) {
    input.checked = input.value === schemeMeta.content;
    input.addEventListener('change', () => {
      schemeMeta.content = input.value;
      try {
        if (input.value === 'light dark') localStorage.removeItem('mm-scheme');
        else localStorage.setItem('mm-scheme', input.value);
      } catch { /* the choice still applies for this visit */ }
    });
  }
}

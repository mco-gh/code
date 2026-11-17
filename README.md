# MM

A peer-to-peer code-breaking race for two, played in the browser at [mco.dev/mm](https://mco.dev/mm/).

Each player hides a secret row of colored pegs, then both race to crack the other's code. Every guess is scored with exact pegs (right color, right place) and close pegs (right color, wrong place). Fewest tries wins.

It is a static app with no build step: open `index.html` from any web server. The two players connect directly to each other using [PeerJS](https://peerjs.com/) (vendored in `vendor/`).

- `rules.js`: scoring, levels, the code commitment and who has won
- `pegs.js`: draws pegs, scoring pegs and rows
- `net.js`, `ice.js`: the link between the two browsers
- `app.js`: the lobby, rounds, rematches and score, chat, video and settings

## Fair play

A code never leaves its owner's browser while a round is on. Each browser scores the
other player's guesses against its own code. Before guessing starts, each sends a
SHA-256 commitment of its code and a random salt; at the end each reveals its code
and salt, and the other browser checks them against the commitment and every score it
was given. A mismatch is shown on the result card.

Each player's round (including their code) is kept in `sessionStorage`, so a guest can
reload mid-round and carry on.

This repo is mounted in [mco-gh/mco.dev](https://github.com/mco-gh/mco.dev) as a git submodule at `static/mm`. After pushing a change here, update the submodule pointer there to publish it:

```bash
cd mco.dev
git submodule update --remote static/mm
git commit -am "Update mm"
git push
```

## Install on a phone

The app is an installable web app: `manifest.webmanifest` describes it, and `sw.js`
is a network-first service worker, so it is always current when online and still
opens offline. Nothing needs bumping on release. The icons in `icons/` are rendered
from the SVG sources by `bash build/icons/render.sh` (needs Google Chrome).

## Connecting through firewalls

Two browsers usually connect directly, with help from a public STUN server. When they
can't (mobile data, strict routers, browsers that block local connections), a TURN
relay carries the traffic. `ice.js` fetches short-lived relay credentials from
`/api/turn`, a Netlify Function in the mco.dev repo that asks Cloudflare for them;
if that isn't available it falls back to STUN only. If no route forms within 20
seconds, the app says so instead of waiting forever.

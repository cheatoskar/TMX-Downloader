# Submission notes — 1.7.1 (Chrome) / 2.7.1 (Firefox)

Everything a store form asks for, written once so the two submissions say the
same thing. Copy from here into the dashboard; the reviewer-facing detail lives
in `SOURCE-README.md`.

## What changed since 1.6.0 / 2.6.0

Two features, each adding exactly one host beyond the five exchanges.

1. **100% TMX project status** on `/tracksearch`, `/trackpacksearch` and
   `/trackshow`: a badge saying whether the map is still unfinished for the
   community 100% project and what it is worth, or who finished it. Read from
   a public endpoint on `100tmx.com` with no cookies attached.
2. **Replay bridge** (off by default): uploads the replay you just drove to
   TMX, from this browser, with the session you are already signed in with.
   The game mod offers the file on `127.0.0.1`; the extension uploads it.
   Switched on from the toolbar popup or from a card this adds to the
   exchange’s own `/replayupload` page, which is where somebody already is
   when they have a replay to upload.

## Permission justifications

Paste these into the Chrome dashboard's per-permission boxes.

**`storage`** — Two values: whether the replay bridge is enabled, which the
user sets, and the pairing key the game mod released after the user pressed
Allow inside the game. Nothing else is stored, and neither value leaves the
browser except the key, which is sent only to the mod on 127.0.0.1 to identify
this extension to it.

**`alarms`** — The replay bridge holds a long-poll to the local game mod. When
the browser suspends the service worker, a one-minute alarm restarts it.
Without it the bridge silently stops working after the worker is evicted.

**`https://100tmx.com/*`** — One read-only GET to `/api/public/maps`, once per
page of TMX search results, sending the numeric track ids already visible on
that page. It returns whether each map is still unfinished for the 100% TMX
project and what it is worth, which is what the badges show. Sent with
`credentials: 'omit'`: there is no account and no cookie involved, and the same
data is public on that site's own pages.

**`http://127.0.0.1/*`** — Only used while the user has switched the replay
bridge on. The 100% TMX game mod (open source,
https://github.com/cheatoskar/100-TMX-Bingo-Plugin) runs inside the user's
TrackMania and opens a loopback-only socket, guarded by a random key it
generates. The extension asks for that key; the mod releases it only after the
user presses "Allow" on the panel inside the game. It then long-polls for a
replay the user has just finished, fetches that file, and uploads it to the
exchange. This is a connection to a program on the user's own machine; no
remote host is involved and nothing is contacted while the bridge is off.

**The five `*.exchange` / `*.tm-exchange.com` hosts** — unchanged: reading
track data and downloading the files the user asked for, plus, when the bridge
is on, posting their replay to the exchange's own upload endpoint with their
existing session.

## Why the upload works this way (the question a reviewer will ask)

TrackMania Exchange has no upload API. `POST /api/replays/upload` authenticates
with the site's session cookie and requires an antiforgery token that the site
mints for a page on its own origin. So a desktop program cannot upload on a
player's behalf without being handed their password — which this deliberately
never asks for. The browser already has the session; the file is what it lacks.
The bridge moves the file, not the credential:

- no password is requested, entered or stored anywhere
- no cookie is read, copied or forwarded
- the only thing that leaves the machine is a replay the user just drove, going
  to the site they are signed in to, immediately after they drove it
- it is off until switched on, and the mod releases its key only after the
  user presses Allow on the panel inside the game

## Data disclosure

- Chrome: no user data is collected. Nothing is sold or transferred; there is
  no analytics, no identifier and no backend belonging to this extension.
- Firefox: the manifest declares `data_collection_permissions: { required:
  ["none"] }`. **Check this against the current policy before submitting** —
  the extension transmits a replay file to TMX at the user's action, and
  whether AMO wants that declared under a category has changed before. It is
  a user-initiated upload to the site they are on, not collection by us.

## Testing it without the game

The project-status badges need nothing: open any `/tracksearch` on an exchange
and rows should carry `OPEN · <score>` or `DONE`.

The bridge needs the mod. To exercise the extension side alone, serve the two
endpoints it uses from anything on `127.0.0.1:27311`:

- `GET /v1/ping` → `{"ok":true,"mod":"test"}` (no key; this is discovery)
- `POST /v1/pair` → `{"ok":true,"key":"whatever"}` (no key; the real mod only
  answers this after the player pressed Allow in the game)
- `GET /v1/next?wait=25` → `{"ok":true,"upload":{"id":"1","site":"tmnf","trackId":1,"mapName":"x","fileName":"x.Replay.Gbx"}}`
- `GET /v1/file?id=1` → the bytes of any `.Replay.Gbx`
- `POST /v1/result` → `{"ok":true}`

Every request carries `X-TMX-Key`; the mod refuses anything else with 401.

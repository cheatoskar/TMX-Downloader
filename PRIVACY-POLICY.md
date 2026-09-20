# Privacy Policy — TMX Universal Track Downloader

**Last updated: 20 September 2026** (extension 1.7.1 for Chrome, 2.7.1 for Firefox)

The short version: nothing about you is collected, stored or sold. There is no
account, no analytics, no tracking, and no server of ours that ever learns who
you are. Everything below is about which machines the extension talks to, and
why.

## What it does with your data

**Nothing is collected.** The extension has no backend of its own, records no
identifiers, and sends nothing anywhere except the requests described below —
each of which belongs to a feature you used.

Two things are remembered, in your browser's own extension storage, and never
leave it:

| Stored | Why |
|---|---|
| Whether the replay bridge is switched on | So it stays as you left it |
| The pairing key the game mod released to you | So the bridge can prove it is you asking the mod for a file |

Uninstalling the extension deletes both. Neither is ever sent to anybody but
the game mod on your own machine.

## Which hosts it talks to, and when

**The five TM-Exchange sites** (`tmnf.exchange`, `tmuf.exchange`,
`original.tm-exchange.com`, `sunrise.tm-exchange.com`,
`nations.tm-exchange.com`) — the sites you are already on. Used to fetch the
tracks, replays and metadata you asked to download and, when the replay bridge
is on, to upload a replay you just drove. Those requests carry your existing
TMX session cookie, because they *are* your session: the upload is you
uploading, from your own browser, to the site you are signed in to. The
extension never reads, copies or stores that session, and never sends it
anywhere else.

**`100tmx.com`** — the 100% TMX project's public status endpoint
(`/api/public/maps`), asked once per page of search results so the badges can
say whether those maps are still unfinished and what they are worth. The
request contains the track ids already visible on the page and nothing else:
no cookies are sent (`credentials: 'omit'`), no account is involved, and the
same answer is public on that website to anybody who visits it.

**`127.0.0.1` — your own machine, and only while the replay bridge is on.**
The 100% TMX game mod, running inside your TrackMania, offers the replay you
just finished; the extension collects it and uploads it. This is a loopback
connection to a program on your own PC. Nothing is contacted at all while the
bridge is off.

## The replay bridge, spelled out

It exists because TMX has no upload API: uploading needs a signed-in session on
the exchange, and only your browser has one. So the game hands the file to the
browser, rather than anybody handing a password to the game.

- Your TMX password is never asked for, never entered anywhere and never
  stored — not by the extension, not by the game mod, not by any server.
- The only thing that moves is a `.Replay.Gbx` you just drove, offered by the
  mod after a finish, uploaded to the exchange that map is on.
- It is off until you switch it on and allow it inside the game, and off again
  the moment you switch it off. The mod releases its key only after somebody
  presses Allow on the panel there.
- Nobody but you and TMX sees the file. The 100% TMX website is not part of the
  upload and is not told about it.

## Permissions

| Permission | What it is for |
|---|---|
| Host access to the five TM-Exchange sites | Reading track data, downloading the files you asked for, and uploading your own replay when the bridge is on |
| Host access to `100tmx.com` | The public project-status endpoint behind the badges |
| Host access to `http://127.0.0.1/*` | Collecting a finished replay from the game mod on your own machine, only while the bridge is on |
| `storage` | The two settings in the table above |
| `alarms` | Reconnecting the bridge after the browser has put the extension to sleep |

No third-party services, no tracking, no analytics, no advertising. No data is
sold or shared with anyone.

## Source

All of this is verifiable: the extension ships unminified and the full source
is at <https://github.com/cheatoskar/TMX-Downloader>. Questions or a problem:
open an issue there.

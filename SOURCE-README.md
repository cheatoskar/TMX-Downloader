# Source code — TMX Universal Track Downloader (Firefox)

Public repository: https://github.com/cheatoskar/TMX-Downloader

## There is no build step

The submitted `.zip` is these files, zipped. Nothing is transpiled, bundled or
minified by us. Every file we wrote ships exactly as written, unminified and
commented.

To reproduce the submitted package from this archive:

```bash
cd TMX-Downloader2.1Mozi
zip -r -X ../TMX-Downloader-<version>-firefox.zip \
    manifest.json background.js bridge.js beta-notice.js content.js \
    trackpack.js trackshow.js users.js exclusions-data.js exclusions.js \
    project.js upload-page.js popup.html popup.js \
    chart.min.js jszip.min.js styles.css icons/
```

`manifest.json` must sit at the root of the archive.

## Third-party libraries (unmodified, hash-verified)

Both are the official release builds, byte-for-byte. A previous submission
shipped copies that had been re-saved on Windows, which converted the line
endings to CRLF and dropped the trailing newline — the content was unchanged
but the files no longer matched the originals. That is fixed: the files below
are now exact copies, and their SHA-256 sums are given so you can confirm it
without downloading anything twice.

| File | Library | Version | Licence | SHA-256 |
|---|---|---|---|---|
| `chart.min.js` | Chart.js | 3.9.1 | MIT | `fbc45926e6b46845a0f905552a0e0b1331049bff1115ecf94dbe0904d895e710` |
| `jszip.min.js` | JSZip | 3.10.1 | MIT | `acc7e41455a80765b5fd9c7ee1b8078a6d160bbbca455aeae854de65c947d59e` |

Official sources — `dist/chart.min.js` and `dist/jszip.min.js` inside these
tarballs:

```bash
curl -sL https://registry.npmjs.org/chart.js/-/chart.js-3.9.1.tgz | tar -xzO package/dist/chart.min.js | sha256sum
curl -sL https://registry.npmjs.org/jszip/-/jszip-3.10.1.tgz     | tar -xzO package/dist/jszip.min.js  | sha256sum
```

Both are stable releases, published by the upstream maintainers. Neither was
taken from a third-party CDN.

Note: the validator flags `The Function constructor is eval` at
`jszip.min.js` line 13. That is inside the `setimmediate` polyfill bundled in
the official JSZip distribution
(`"function" != typeof e && (e = new Function("" + e))`). It is only reachable
if a string is passed to `setImmediate`, which JSZip never does. It is present
in the upstream release and we have not altered it — the hash above proves the
file is unmodified.

## What is new in 1.7.0 / 2.7.0: two hosts beyond the exchanges

Everything before this version spoke only to the five TM-Exchange sites. Two
features add one host each, and both are listed here rather than left for a
reviewer to find.

### `100tmx.com` — project status on TMX's own pages (`project.js`)

The 100% TMX project tracks which maps on each exchange have never been
finished. `project.js` asks its public endpoint
`https://100tmx.com/api/public/maps?site=<exchange>&ids=<ids>` once per page of
search results and puts a small badge on each row: still open and what it is
worth, or already finished and by whom.

- **Read-only, and public.** The same answer is on that website's own pages for
  anybody to see. No account exists on it for this extension to use.
- **No credentials.** The request is made by the background script with
  `credentials: 'omit'`, so no cookie for that domain is attached even if the
  user happens to have one.
- **What is sent:** the numeric track ids already visible on the page, and
  nothing else. No URL, no search terms, no identifier, no browsing history.
- The site being unreachable costs the page nothing: no badge appears.

### `127.0.0.1` — the replay bridge (`bridge.js`, `popup.html`, `popup.js`)

**Off by default. Nothing is listened to, connected to or sent until the user
switches it on and pastes a key.**

TMX has no upload API. `POST /api/replays/upload` is authenticated with the
site's own session cookie and carries an antiforgery token minted for a page on
the exchange's origin, so the only thing that can upload a replay for a player
is something already signed in as them — a browser. The 100% TMX game mod runs
inside TrackMania and has the file; it cannot upload it, and asking players for
a TMX password so that it could would be the wrong answer to the problem.

So the mod offers the file on loopback and this extension uploads it:

1. The mod (open source: https://github.com/cheatoskar/100-TMX-Bingo-Plugin)
   opens a socket bound to `127.0.0.1` only, guarded by a random key it
   generates. The user switches the bridge on here - in the toolbar popup, or
   with the button this adds to the exchange's own `/replayupload` page - and
   the extension asks the mod for that key. The mod does not hand it over on
   asking: it puts "A browser wants to connect - Allow / No" on the panel in
   the game, and only a person pressing Allow there releases it. Nothing is
   typed or copied, and the secret still never leaves the machine without a
   deliberate act.
2. `bridge.js` long-polls `http://127.0.0.1:2731x/v1/next`. When a replay is
   waiting it fetches the bytes from the mod, reads the antiforgery token from
   the exchange's own `/replayupload` page, and posts the file to that
   exchange's upload endpoint with the user's existing session — exactly the
   request the page's own Submit button makes.
3. The outcome is posted back to the mod so the in-game overlay can show it.

What this does **not** do: it stores no credential of any kind, reads no cookie,
touches no file the mod did not offer, contacts no server of ours, and sends
nothing to any third party. The only data that leaves the machine is the replay
file itself, going to the exchange the user is signed in to, at the moment they
finished driving it. `storage` holds two values (the on/off switch and the
pairing key) and `alarms` restarts the connection after the browser has
suspended the worker.

## No request monitoring, no data collection

Earlier versions replaced `window.fetch` to record the URLs the page requested.
That was reviewed as monitoring the user's network activity, and the finding was
correct: patching `fetch` observes every request a page makes, not only the one
we need. **All of it has been removed.** There is no `window.fetch` assignment,
no `XMLHttpRequest.prototype` patching and no injected `<script>` anywhere in
this add-on.

The extension needs one thing: the search the user is currently looking at, so a
download returns exactly those tracks rather than a guess reconstructed from the
address bar. It now reads that from the **Resource Timing API**
(`performance.getEntriesByType('resource')`), a standard read-only browser API
listing resources the page has already loaded. See `findApiUrlFromTimings` and
`watchApiUrl` in `content.js` and `trackpack.js`.

Nothing is hooked and no request is observed while it happens. The add-on
collects nothing about the user and transmits nothing to its developer, which
is what `data_collection_permissions: { "required": ["none"] }` in the
manifest declares. The two hosts described in the section above are the
exceptions to "no data leaves the browser", and both are the user’s own
action: a list of track ids to a public read-only endpoint, and a replay they
just drove going to the exchange they are signed in to.

## Generated file: `exclusions-data.js`

This is the only generated file, and it contains **data, not logic** — a plain
object literal a reviewer can read directly.

The 100% TMX Project maintains a community-curated list of TrackMania maps that
cannot honestly count towards 100% (author time set with a cheat or a TAS,
unreachable finish, invalid file, duplicate UID). The list lives in a public
Google Sheet, one tab per exchange. The extension shows a warning badge on those
maps.

`tools/build-exclusions.mjs` fetches that sheet and writes `exclusions-data.js`
into the extension folder:

```bash
node tools/build-exclusions.mjs      # requires Node 18+ for global fetch
```

No dependencies, no package.json, no network access at runtime.

**We bake the list in on purpose.** Fetching it live would mean requesting a
host permission for `docs.google.com` and making a network call on every page
load. The whole list is about 1,000 entries, so shipping a snapshot avoids both.
The extension makes no request for this data at any time.

The sheet is edited by the community, so re-running the script later produces a
newer snapshot rather than a byte-identical file. The snapshot date is recorded
in the `generatedAt` field at the top of the generated file, and the sheet it
came from is linked in the `source` field beside it.

Sheet (publicly readable):
https://docs.google.com/spreadsheets/d/1fqmzFGPIFBlJuxlwnPJSh1nCTTxqWXtHtvP5OUxE4Ow/edit

## What the extension does

Bulk-downloads TrackMania tracks (`.gbx`) from the five TM-Exchange sites, as
individual files or one ZIP, with optional metadata and ID lists. It also adds
statistics views to track and user pages, and the exclusion warnings described
above.

Network requests are made only to the five TM-Exchange hosts listed in the
manifest, only for the tracks and metadata the user asked for, and only through
the background script. All work happens in the browser against the site the
user is already on.

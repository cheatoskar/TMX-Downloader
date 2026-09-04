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
    manifest.json background.js beta-notice.js content.js trackpack.js \
    trackshow.js users.js exclusions-data.js exclusions.js \
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

Nothing is hooked, no request is observed while it happens, and no data leaves
the browser. The add-on collects, stores and transmits nothing, which is what
`data_collection_permissions: { "required": ["none"] }` in the manifest
declares.

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

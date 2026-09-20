# What to change in the Chrome dashboard for 1.7.1

Ready to paste. The reviewer-facing technical detail is in `SOURCE-README.md`,
the per-permission wording in `STORE-NOTES.md`; this is the listing itself.

---

## 1. Package

Upload `TMX-Downloader2.1/TMX-Downloader-1.7.1-chrome.zip`.

The live version is **1.5.0**, so 1.7.1 is a valid step up. (1.6.0 and 1.7.0
were built here and never submitted.)

## 2. Description — replace the whole text with this

```
TMX Downloader – Bulk TrackMania Track Downloads & Advanced TMX Tools

TMX Downloader lets you bulk-download tracks from all major TM-Exchange sites — fast, organized, and fully customizable. Originally built for the 100% TMX Project, it has evolved into a powerful toolkit for players, builders, and data fans who want more control over TMX.

Download tracks (GBX) individually or as ZIPs, shuffle or sample randomly, export metadata, analyze replay stats, see at a glance which maps the 100% TMX Project still needs, and let the game upload your replays for you.

⭐ Key Features

🚀 Bulk Track Downloads
– Works across TMNF-X, TMUF-X, TMO-X, TMS-X, and TMN-X
– Download all search results or limit to any number
– Shuffle order or perform true random sampling
– Skip the first N results for offset-based fetching
– Export metadata JSON per track or as global metadata.json
– Save as individual GBX files or a single ZIP archive
– Reliable pagination for thousands of results

🏁 100% TMX Project Status (new)
– A badge on every search result and track page: still unfinished for the community 100% project, and what it is worth
– Or who finished it first, and when
– An amber badge when somebody is driving that map right now
– Read from a public endpoint on 100tmx.com with no account and no cookies

📤 Replay Bridge (new, optional, off by default)
– Finish a map with the 100% TMX game mod running and your replay is uploaded to TMX automatically
– The upload happens in this browser, with the session you are already signed in with
– Your TMX password is never requested or stored — not by the extension, not by the mod, not by any server
– Connect it from the toolbar popup or straight from the TMX upload page, then confirm once inside the game

⚠️ Cheated-Map Warnings
– Maps on the community exclusion list are flagged in search results and on track pages
– Labelled by reason: cheated author time, unfinishable, invalid file, duplicate UID
– Bundled with the extension, so no extra requests and no extra permissions

📈 Enhanced Track Pages (/trackshow)
– Replay statistics: mean, median, WR distribution, outliers
– Time distribution histogram
– Custom Quality Score and Hype Meter with trend sparkline
– Tools menu: Download All Replays, Export Full Metadata, and more

👤 Enhanced User Pages (/usershow and /usersearch)
– Player and Builder scores with detailed breakdowns
– Activity status such as “Elite Player” or “Recently Active”
– User leaderboards on search pages
– One-click user metadata export

🎯 Smart, Friendly Interface
– Download button integrated into the TMX Filters dropdown
– Clean modal with real-time status updates
– Animated progress bar with a drifting tire emoji
– Cancel downloads anytime and keep a partial ZIP

⚙️ Performance and Privacy
– Up to 10 concurrent downloads without overloading servers
– Graceful skipping of failed tracks
– No accounts, no analytics, no telemetry, no data collection
– Uses a bundled JSZip library (MIT)
– Full source, unminified: github.com/cheatoskar/TMX-Downloader

🧭 How to Use

1. Perform a search on a supported TM-Exchange site

2. Open Filters and click “Download Tracks”

3. Configure your options (shuffle, count, metadata, ZIP)

4. Press Start Download

🖥️ Browser Support
– Chrome, Edge, Opera (Manifest V3)
– Firefox version available (WebExtensions)

💬 Community & Support
Questions, bugs, ideas? Join the 100% TMX-Community:
Discord: https://discord.gg/HRShWnzpK3
GitHub issues welcome.

Built with ❤️ for the TrackMania community.
```

## 3. Permissions — four boxes that were not there before

Chrome asks for a justification per permission. Paste from `STORE-NOTES.md`:
`storage`, `alarms`, `https://100tmx.com/*`, `http://127.0.0.1/*`. The last one
is the one a reviewer will read properly, so it is the one written at length.

## 4. Privacy tab

- **Single purpose**: "Tools for TrackMania Exchange: bulk downloading tracks
  and showing extra information about them on the TMX websites."
- **Data usage**: tick **nothing**. No data is collected. Confirm the three
  certifications (not sold, not used for unrelated purposes, not used for
  creditworthiness).
- **Privacy policy URL**: point it at the updated policy —
  `https://github.com/cheatoskar/TMX-Downloader/blob/main/PRIVACY-POLICY.md`
  (rewritten for this version; the old one still described permissions that
  were removed two releases ago).

## 5. Screenshots

The existing ones still describe the extension. Two worth adding if the
review asks for more, both in `Screenshots/`: a search page with the new
badges, and the card on the upload page.

## 6. What a reviewer is most likely to ask

**"Why does an extension need to talk to localhost?"** The answer is in
`STORE-NOTES.md` and in `SOURCE-README.md`, and it is short: TMX has no upload
API, its upload endpoint is authenticated by the site's session cookie, so the
only thing that can upload a replay for a player is their own browser. The
game hands the file over on loopback; the browser does the upload. No
credential moves, and it is off until the user switches it on and confirms
inside the game.

Worth answering *before* they ask by putting one line in the "notes to
reviewer" box pointing at those two files.

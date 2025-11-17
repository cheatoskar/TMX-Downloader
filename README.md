# 🚀 TMX Downloader
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-blue?logo=google-chrome)](https://chromewebstore.google.com/detail/hplkjclpiopmjlpejpgkoobghlpbjopp)
[![Opera Add-ons](https://img.shields.io/badge/Opera-Add--ons-red?logo=opera)](https://addons.opera.com/de/extensions/details/DEIN-SLUG/)
[![Mozilla Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox-browser)](https://addons.mozilla.org/de/firefox/addon/DEIN-ADDON-ID/)
[![Made with JavaScript](https://img.shields.io/badge/Made_with-JavaScript-orange?style=flat&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

**TMX Downloader** is a powerful Chrome extension that supercharges your TrackMania workflow! Originally created to support the [100% TMX Project](https://tmnf.exchange/threadshow/11550542)—a community initiative to legitimately finish every map on TM-Exchange without cheated author times (e.g., no external tools or removed validations)—this tool makes bulk downloading search results effortless. Seamlessly download tracks from popular TM-Exchange sites as GBX files—individually or bundled into a ZIP archive. With smart pagination, random shuffling and metadata export.



Beyond downloading, the extension enhances track and user pages with advanced statistics, hype meters, and activity insights—making TMX browsing more data-driven and fun.

## ✨ Features
- **Multi-Exchange Support**: Works across 5 major TM-Exchange platforms:
  - [TMNF-X](https://tmnf.exchange) (TrackMania Nations Forever)
  - [TMUF-X](https://tmuf.exchange) (TrackMania United Forever)
  - [TMO-X](https://original.tm-exchange.com) (Original TrackMania)
  - [TMS-X](https://sunrise.tm-exchange.com) (TrackMania Sunrise)
  - [TMN-X](https://nations.tm-exchange.com) (TrackMania Nations)
- **Smart Search Integration**: Automatically detects your current search query's API endpoint—no manual URL tweaking required.
- **Flexible Download Options**:
  - Download **all results** or limit to a specific number (e.g., top 50).
  - **Shuffle tracks** for a random order within your search.
  - **True random selection** from the full result set (fetches everything first, then picks randomly).
  - Skip tracks with a **start position** (e.g., begin from result #100).
  - Include **JSON metadata** files for each track (uploader, name, ID, etc.).
  - Output as **individual GBX files** or a **single ZIP archive** (with optional global metadata.json).
- **User-Friendly UI**:
  - Clean button in the Filters dropdown—no cluttering the page.
  - Modal popup with checkboxes, inputs, and real-time status updates.
  - **Animated Progress Bar**: Tire emoji "drives" forward, leaving skid marks for every milestone. (Because downloads should be fun! 🏁)
- **Performance & Reliability**:
  - **Pagination Handling**: Fetches all pages automatically (up to 1000 per page) to get complete results.
  - **Concurrent Downloads**: Up to 10 parallel fetches for speed without overwhelming servers.
  - **Abort Anytime**: Cancel mid-download and get a partial ZIP if needed.
  - **Error-Resilient**: Skips failed tracks and logs issues to console.
- **Privacy-First**: No data collection, no external dependencies beyond JSZip (bundled).
- **Track Page Enhancements** (on `/trackshow` pages):
  - **Statistics Card**: Displays replay stats (total, WR, average/median times, std. deviation), time distribution chart, and custom quality score (based on awards, comments, replay activity, and competitive bonuses).
  - **Hype Meter**: 0-100 score gauging track popularity with time-weighted activity, age multipliers, and trend sparkline (e.g., "Exploding 🚀" for surging maps).
  - **Tools Dropdown**: Quick actions like "Download All Replays" (ZIP) or "Export Metadata" (JSON).
- **User Page Enhancements** (on `/usershow` pages):
  - **Statistics Card**: Dual scores—Player Score (replays/awards focus) and Builder Score (tracks/packs focus)—with breakdowns and tooltips.
  - **Activity Status**: Badges like "Elite Player" or "Recently Active" based on leaderboard position, recent uploads/replays, and days since last activity.
  - **User Search Leaderboards** (on `/usersearch`): Top 5 lists for builders (tracks), awarded users, and players (replays), plus per-user metadata download buttons.


## 🛠️ Installation

TMX Downloader is a Chrome extension—easy to install and sideload for testing.

### Step 1: Download the Extension
1. Download the ZIP file. And Unzip it upon download.  

2. Ensure the folder contains:
   - `manifest.json` (defines permissions for content scripts, background, and JSZip)
   - `background.js` (handles early fetch interception)
   - `content.js` (the core script—see source below)
   - `jszip.min.js` (bundled ZIP library)
   - Optional: Icons and CSS for polish.

### Step 2: Load in Chrome
1. Open Chrome and go to `chrome://extensions/`.
2. Enable **Developer mode** (toggle in top-right).
3. Click **Load unpacked** and select the extension folder.
4. 🎉 The extension icon appears—pin it to your toolbar for quick access.

> **Note:** Requires permissions for `https://*.tm-exchange.com/*`, `https://tmnf.exchange/*`, etc. (Defined in manifest.json). No internet access needed beyond the sites themselves.

### Updates
- Reload the extension in `chrome://extensions/` after code changes.
- For production: Submit to Chrome Web Store (coming soon!).

## 📖 Usage Guide

1. **Install & Navigate**:
   - Load the extension (see above).
   - Head to a supported TM-Exchange site (e.g., [tmnf.exchange](https://tmnf.exchange)).
   - Perform a search: Enter filters (author, style, etc.) and hit **Search** or **Apply Filters**.
   - Wait for results to load—TMX Downloader auto-detects the API query.

2. **Launch Downloader**:
   - Open the **Filters** dropdown (top-right usually).
   - Spot the **DOWNLOADER** section with a red **Download Tracks** button.
   - Click it! A modal pops up with all options.

3. **Configure Your Download**:
   | Option | Description | Default |
   |--------|-------------|---------|
   | **Shuffle Tracks** | Randomize order of the first N results (quick & easy). | ☐ Off |
   | **Random Selection** | Fetch *all* results, then pick N at random (true variety!). | ☐ Off |
   | **Number of Tracks** | How many to grab (empty = all). | Empty (All) |
   | **Start Position** | Skip the first N (e.g., 50 to start mid-list). | 0 |
   | **Create ZIP** | Bundle into one file (recommended for bulk). | ☑ On |
   | **Include Metadata** | Add .json files with track details. | ☐ Off |

   > **Quick Start:** Leave defaults, enter `100` tracks, check ZIP, and hit **Start Download**.

4. **Download & Monitor**:
   - Click **Start Download**—watch the magic!
   - Cancel anytime with **Stop** (saves partial ZIP).
   - Files land in your Downloads folder: e.g., `TMNF-X_Tracks_2025-11-15T11-30-00.zip`.

5. **Troubleshooting**:
   - **"Perform search" error?** Results haven't loaded—refresh and search again.
   - **Slow fetches?** Large result sets (1000+) take time; be patient or limit count.
   - Console logs: Press F12 > Console for debug info (e.g., `[TMX] ...`).

### Example Workflow
- Search for "Stadium SpeedFun" on TMNF-X (500 results).
- Set: 50 tracks, Shuffle ☑, ZIP ☑, Metadata ☑.
- Download: Gets a shuffled ZIP with 50 GBX + 50 JSON files + metadata.json.
- Unzip and import into TrackMania away! 🏆

### Downloader Core Functions
| Function | Description | Technical Details | Usage Notes |
|----------|-------------|-------------------|-------------|
| **API URL Capture** | Automatically grabs the search API endpoint from the page. | Uses DOM attributes (`data-tmx-api-url`), window properties (`__tmx_lastApiUrl`), and background script interception. Falls back to stored state. | Triggers on search load; status shows "Search loaded (X tracks)". |
| **Pagination Fetching** | Retrieves all results across pages. | Sets `count=1000`, loops with `after=lastTrackId` until `More=false` or empty results. Proxy fetches via background to bypass CORS. | Handles up to thousands of tracks; logs progress in console. |
| **Concurrent GBX Downloads** | Parallel track file fetching. | Up to 10 simultaneous binary fetches via `proxyFetchBinary` (base64 to Blob conversion). | Speeds up bulk ops; errors skipped with console logs. |
| **ZIP Packaging** | Bundles files with JSZip. | Creates exchange folders (e.g., `TMNF-X/track.gbx`), adds optional JSON metadata and global `_all_metadata.json`. | Generates timestamped ZIP (e.g., `TMNF-X_Tracks_2025-11-15T11-30-00.zip`); partial saves on abort. |
| **Randomization Options** | Shuffle or true random selection. | `shuffleArray` for quick shuffle; full fetch + slice for random. Priority: Shuffle > Random. | Shuffle: O(1) on first N; Random: Fetches all first (slower for large sets). |
| **Multi-Exchange Mode** | Searches/downloads across platforms. | Replicates current params on other APIs; processes sequentially with progress updates. | Enable checkbox, select exchanges; ZIP named `Best_of_All_TMX_...`. |
| **Progress Animation** | Visual feedback with tire & skid marks. | DOM updates: Tire positioned via `% * width`; skid marks at milestones (random offset, cleanup >50). | Fun UX; resets on cancel/complete. |
| **Statistics Post-Download** | View fetched track stats. | Processes `lastFetchedTracks` for by-exchange/authors/awards/env; pie/bar charts via Chart.js. | "View Stats" button enabled post-download; modal with charts. |

### Track Page Enhancements (`/trackshow`)
| Function | Description | Technical Details | Usage Notes |
|----------|-------------|-------------------|-------------|
| **Replay Statistics** | Core metrics on replays. | Fetches all via `/replays?trackId=...&count=1000` (paginated); calculates mean/median/stdDev, filters 3σ outliers. | Card below Replays; includes time range and outlier count. |
| **Time Distribution Chart** | Histogram of replay times. | Dynamic buckets (10-15, nice intervals like 50ms); focuses on WR to 95th percentile. | Bar chart via Chart.js; tooltip shows bucket ranges. |
| **Quality Score** | 0-10000 track rating. | Weighted: Awards (60pts), comments (10pts), log(replays)*500, competitive bonus (AT/WR ratio), diversity (stdDev/100, max 500). | Circle gauge; breakdown with tooltips (no TrackValue per request). |
| **Hype Meter** | Popularity gauge with trend. | Time windows (48h-∞) with weights/decay; velocity multiplier; age boost (3x new →1x); anti-spam filter. | 0-100 circle; sparkline (hourly/daily/etc. buckets); labels like "Growing 📈". |
| **Replay Download** | Bulk GBX export. | Fetches `/recordgbx/{id}` for all; ZIP via JSZip. | Tools dropdown; confirms count first. |
| **Metadata Export** | JSON dump of track data. | Full API fields (times, uploader, WR, etc.); fallback scraping if API fails. | Tools dropdown; filename `{TrackName}_metadata.json`. |

### User Page Enhancements (`/usershow` & `/usersearch`)
| Function | Description | Technical Details | Usage Notes |
|----------|-------------|-------------------|-------------|
| **Player/Builder Scores** | Dual 0-10000 ratings. | Player: Replays (0.5pt max 5000), awards given (2pt), etc. Builder: Tracks (50pt max 5000), awards received (10pt), etc. | Separate circles/gauges; breakdowns with tooltips. |
| **Activity Status** | Badge based on recency/leaderboard. | Merges LB (`/leaderboards?username=...`), latest track/replay dates; tiers: Elite (top20) to Inactive (>365d). | Color-coded card; shows position/score/delta/days ago. |
| **User Leaderboards** | Top 5 lists on search. | Sorts fetched `/users` list by Tracks/Awards/Replays. | Card above table; links to user pages. |
| **Metadata Download** | Per-user JSON export. | Full fields (tracks, awards, LB stats); buttons in search table. | Click icon; filename `{Name}_metadata.json`. |

## ❓ FAQ & Help
Common questions, troubleshooting, and tips. For deeper issues, check console logs (`[TMX]` prefix) or open a GitHub issue.

### General
| Question | Answer |
|----------|--------|
| **What permissions does it need?** | Host permissions for TM-Exchange domains (for API/fetch); storage for state. No cross-origin issues via background proxy. |
| **Is it safe/privacy-friendly?** | Yes—no data sent externally, all local. Bundled libs (JSZip/Chart.js) don't phone home. |
| **Supported browsers?** | Chrome/Edge/Opera (manifest v3); Firefox via WebExtensions (AMO submission pending). |
| **Why no React/Vue?** | Vanilla JS for lightweight, no-build setup—easy to hack/extend. |

### Downloader-Specific
| Question | Answer |
|----------|--------|
| **Downloads fail mid-way?** | Check console for CORS/API errors. Reduce concurrency (edit `CONCURRENT_DOWNLOADS=5` in code); retry failed tracks manually. Partial ZIP saves on cancel. |
| **"No API URL" error?** | Search must load results first. Refresh page, apply filters, wait 2s. Multi-mode needs valid current search. |
| **Slow on large searches?** | Pagination fetches 1000/page; limit `Number of Tracks` for <5000 total. Servers throttle—space out sessions. |
| **ZIP too big/unzips wrong?** | GBX files are binary; use 7-Zip/WinRAR. Metadata JSONs are readable in any editor. |
| **Random not truly random?** | It fetches all first (memory-intensive for 10k+), then shuffles. Use Shuffle for quick approx. |

### Track/User Enhancements
| Question | Answer |
|----------|--------|
| **Charts not loading?** | Chart.js loads dynamically; refresh page. Fallback: Console shows raw stats. Disable adblockers if CDN-blocked (uses extension bundle). |
| **Hype score seems off?** | Time-weighted (recent > old); new maps get boost. Calc: 4pts/replay * weights + awards/comments. View breakdown in console. |
| **Activity "Inactive" but user active?** | Based on last upload/replay (via API). LB delta for freshness. >365d = inactive; tweak thresholds in code. |
| **No stats on user/track?** | API fallback to page scraping. If fails, check F12 Network tab for 403/404. Report unsupported exchanges. |
| **Tools dropdown missing?** | Wait for page load (SPA delay). Refresh; ensure on `/trackshow` or `/usershow`. |

### Advanced Tips
- **Customize Scores**: Edit `calculateCustomScore`/`calculateHypeScore` in `content.js`—e.g., re-add TrackValue weight.
- **Debug Mode**: Add `console.log` in functions; reload extension.
- **Contribute**: Fork, test on all exchanges, PR with comments. See [Guidelines](#guidelines).
- **Limits**: API respects `count=1000`; no infinite loops. For 100k+ replays, paginate manually.

## 📸 Screenshots

### Filters Dropdown Integration
![Filters UI](https://github.com/cheatoskar/TMX-Downloader/blob/main/Screenshots/View.png)
*(Button appears seamlessly below "FILTERS" header.)*

### Download Modal
![Modal](https://github.com/cheatoskar/TMX-Downloader/blob/main/Screenshots/Modal.png)
*(Options, progress bar with tire 🏁, and buttons.)*

### Stats Modal
![Modal](https://github.com/cheatoskar/TMX-Downloader/blob/main/Screenshots/Stats.png)

## 🔍 How It Works (Under the Hood)

- **API Capture**: Intercepts fetch requests (via background script) to grab the exact search API URL (e.g., `/api/tracks?author=xyz&count=1000`).
- **Pagination**: Loops through `after=lastTrackId` until all results are fetched.
- **Downloads**: Performs parallel GBX fetches from /trackgbx/{id}, packaged with JSZip. The script downloads up to 10 maps concurrently, achieving download speeds up to 10× faster than v1.0.
- **UI Magic**: MutationObserver watches for dropdowns/modals; CSS classes match site themes.
- **Fun Factor**: Custom progress with DOM animations—tire position = (percent / 100) * width, skid marks at milestones.

Full source in `content.js`—heavily commented for easy hacking!

Issues? Open a ticket with site + steps to repro. Ideas? Discussions welcome.

**Guidelines**:
- Keep it vanilla JS (no frameworks).
- Test on all supported exchanges.
- Add console logs with `[TMX]` prefix.

## 📄 License

This project is MIT licensed. See [LICENSE](LICENSE) for details.

**Built with ❤️ for the TrackMania community.** Questions? Hit me up on Discord (@cheatoskar), join the originating Discord: https://discord.gg/HRShWnzpK3 or open an issue. 

---

*Last updated: November 15, 2025* | *Version: 1.0.0*

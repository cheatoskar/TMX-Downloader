# 🚀 TMX Downloader
[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Available-blue?logo=google-chrome)](https://chromewebstore.google.com/detail/hplkjclpiopmjlpejpgkoobghlpbjopp)
[![Opera Add-ons](https://img.shields.io/badge/Opera-Add--ons-red?logo=opera)](https://addons.opera.com/de/extensions/details/DEIN-SLUG/)
[![Mozilla Add-on](https://img.shields.io/badge/Firefox-Add--on-orange?logo=firefox-browser)](https://addons.mozilla.org/de/firefox/addon/DEIN-ADDON-ID/)
[![Made with JavaScript](https://img.shields.io/badge/Made_with-JavaScript-orange?style=flat&logo=javascript)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)

**TMX Downloader** is a powerful Chrome extension that supercharges your TrackMania workflow! Originally created to support the [100% TMX Project](https://tmnf.exchange/threadshow/11550542)—a community initiative to legitimately finish every map on TM-Exchange without cheated author times (e.g., no external tools or removed validations)—this tool makes bulk downloading search results effortless. Seamlessly download tracks from popular TM-Exchange sites as GBX files—individually or bundled into a ZIP archive. With smart pagination, random shuffling and metadata export.



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

/**
 * Regenerate the bundled cheated-map list from the 100% TMX community sheet.
 *
 *   node tools/build-exclusions.mjs
 *
 * The sheet stays the source of truth. This bakes a snapshot into both
 * extension builds as a plain content script, so the extension needs no
 * network access and no host permission for docs.google.com. Re-run it
 * before cutting a release.
 */
import { writeFileSync } from "node:fs";

const SHEET_ID = "1fqmzFGPIFBlJuxlwnPJSh1nCTTxqWXtHtvP5OUxE4Ow";

// One tab per exchange, keyed by the hostname the extension actually runs on.
const TABS = {
  "tmnf.exchange": 605781157,
  "tmuf.exchange": 2132753700,
  "nations.tm-exchange.com": 38022687,
  "sunrise.tm-exchange.com": 1438334892,
  "original.tm-exchange.com": 1739598690,
};

// A cross-exchange tab listing maps hidden or removed from TMX.
const HIDDEN_TAB = 1351358020;
const HIDDEN_SHEET_TO_HOST = {
  TMNF: "tmnf.exchange",
  TMUF: "tmuf.exchange",
  TMN: "nations.tm-exchange.com",
  TMS: "sunrise.tm-exchange.com",
  TMO: "original.tm-exchange.com",
};

const csvUrl = (gid) =>
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${gid}`;

/** Minimal RFC 4180 reader - the sheet quotes multi-line comment cells. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch !== "\r") field += ch;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchCsv(gid) {
  const res = await fetch(csvUrl(gid), {
    headers: { Accept: "text/csv" },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching tab ${gid}`);
  const text = await res.text();
  // A sheet that is not shared returns an HTML sign-in page with status 200.
  if (text.trimStart().startsWith("<")) {
    throw new Error(`Tab ${gid} did not return CSV - is the sheet still shared with "anyone with the link"?`);
  }
  return text;
}

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();

/** Per-exchange tab: Category | TrackID | link | Finishable? | Rationale | Comment */
function parseTab(text) {
  const out = new Map();
  for (const row of parseCsv(text)) {
    const raw = clean(row[1]);
    if (!/^\d+$/.test(raw) || out.has(raw)) continue;
    out.set(raw, {
      c: clean(row[0]) || "Unspecified",
      f: clean(row[3]),
      r: clean(row[4]),
      n: clean(row[5]),
    });
  }
  return out;
}

/** Hidden-tracks tab: Original Sheet | Category | TrackID | link | ... | Comment */
function parseHidden(text) {
  const out = [];
  for (const row of parseCsv(text)) {
    const raw = clean(row[2]);
    if (!/^\d+$/.test(raw)) continue;
    const host = HIDDEN_SHEET_TO_HOST[clean(row[0]).toUpperCase()];
    if (!host) continue;
    out.push({
      host,
      id: raw,
      entry: { c: clean(row[1]) || "Hidden", f: "", r: "Hidden or removed from the exchange", n: clean(row[5]) },
    });
  }
  return out;
}

let hidden = [];
try {
  hidden = parseHidden(await fetchCsv(HIDDEN_TAB));
  console.log(`hidden-tracks tab: ${hidden.length} entries`);
} catch (err) {
  console.warn(`hidden-tracks tab unavailable: ${err.message}`);
}

const sites = {};
let total = 0;
for (const [host, gid] of Object.entries(TABS)) {
  const map = parseTab(await fetchCsv(gid));
  // A map can appear on both its own tab and the hidden tab; the tab wins.
  for (const h of hidden.filter((x) => x.host === host)) {
    if (!map.has(h.id)) map.set(h.id, h.entry);
  }
  sites[host] = Object.fromEntries([...map].sort((a, b) => Number(a[0]) - Number(b[0])));
  total += map.size;
  console.log(`${host.padEnd(26)} ${String(map.size).padStart(5)} excluded maps`);
}

const payload = {
  generatedAt: new Date().toISOString().slice(0, 10),
  source: `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit`,
  sites,
};

const banner = `/**
 * Community cheated / excluded map list for the 100% TMX Project.
 *
 * GENERATED FILE - do not edit by hand.
 * Regenerate with:  node tools/build-exclusions.mjs
 *
 * Source of truth is the community sheet linked below; this is a snapshot
 * baked into the extension so no remote request and no extra host permission
 * is needed. Snapshot taken ${payload.generatedAt}, ${total} maps.
 */
`;

const body = `${banner}window.TMX_EXCLUSION_DATA = ${JSON.stringify(payload, null, 0)};\n`;

for (const dir of ["TMX-Downloader2.1", "TMX-Downloader2.1Mozi"]) {
  const out = `${dir}/exclusions-data.js`;
  writeFileSync(out, body, "utf8");
  console.log(`wrote ${out} (${(body.length / 1024).toFixed(1)} KB)`);
}
console.log(`\ntotal ${total} excluded maps across ${Object.keys(TABS).length} exchanges`);

// ============================================================================
// 100% TMX PROJECT STATUS
//
// The exchange knows whether a map has replays. It does not know whether the
// 100% TMX project still wants it, what it is worth, who got the credit, or
// that somebody is driving it right now - and those are the questions somebody
// browsing /tracksearch for something to finish is actually asking.
//
// So one request per page of results to 100tmx.com's public endpoint, and:
//   - /tracksearch, /trackpacksearch: a badge on every row
//   - /trackshow/{id}:                a line above the track card
//
// Read-only, unauthenticated, and the same numbers the website shows to
// anybody. The request goes through the background worker like every other
// one here, with credentials omitted - there is no account involved and none
// should be sent.
//
// Separate from exclusions.js on purpose: that list is a bundled snapshot with
// no network at all, this is live state that changes hourly. Sharing a file
// would mean one of the two behaving unlike its comment.
// ============================================================================
(function () {
    'use strict';

    const API = 'https://100tmx.com';

    // The five exchanges, by the hostname they are served on.
    const SITES = {
        'tmnf.exchange': { id: 'tmnf', short: 'TMNF' },
        'tmuf.exchange': { id: 'tmuf', short: 'TMUF' },
        'original.tm-exchange.com': { id: 'tmo', short: 'TMO' },
        'sunrise.tm-exchange.com': { id: 'tms', short: 'TMS' },
        'nations.tm-exchange.com': { id: 'tmn', short: 'TMN' },
    };

    const SITE = SITES[window.location.hostname];
    if (!SITE) return;

    /** The endpoint's own cap. Asking for more would silently lose the tail. */
    const MAX_IDS = 200;

    // Answers for this page load. A search page rewrites its rows in place
    // when a filter changes, and most of the ids come back unchanged - asking
    // again for maps already answered would be one request per keystroke.
    const known = new Map();
    const asked = new Set();
    let overview = null;
    let inFlight = false;

    // ------------------------------------------------------------------
    // Talking to the site
    // ------------------------------------------------------------------

    // `browser.runtime.sendMessage` is promise-based and `chrome.runtime`'s
    // takes a callback; the callback form works on both, and a missing
    // runtime (an orphaned content script after an update) must reject
    // rather than hang.
    function ask(url) {
        return new Promise((resolve, reject) => {
            if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
                reject(new Error('extension runtime unavailable'));
                return;
            }
            chrome.runtime.sendMessage({ action: 'fetchProject', url }, (res) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    reject(new Error(err.message));
                    return;
                }
                if (!res || !res.success) {
                    reject(new Error((res && res.error) || 'no answer'));
                    return;
                }
                resolve(res.data);
            });
        });
    }

    async function load(ids) {
        const wanted = ids.filter((id) => !asked.has(id)).slice(0, MAX_IDS);
        if (wanted.length === 0) return false;
        wanted.forEach((id) => asked.add(id));

        try {
            const data = await ask(API + '/api/public/maps?site=' + SITE.id + '&ids=' + wanted.join(','));
            if (!data || !data.ok) return false;
            overview = data.overview || null;
            // A map the project has never seen - uploaded in the last hour,
            // usually - is simply absent from the answer, and absent is the
            // honest thing to show rather than a badge guessing at it.
            for (const [id, status] of Object.entries(data.maps || {})) known.set(String(id), status);
            return true;
        } catch (err) {
            // The site being down must cost the page nothing: no badge, no
            // error in the user's face, and the ids stay marked as asked so a
            // MutationObserver storm cannot turn one outage into a hundred
            // requests.
            console.debug('[TMX] 100% project status unavailable:', err.message);
            return false;
        }
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    function trackIdFromHref(href) {
        const m = String(href || '').match(/\/trackshow\/(\d+)/);
        return m ? m[1] : null;
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** TMX names carry $-codes for colour and style; none of them are wanted here. */
    function stripTmxName(name) {
        return String(name == null ? '' : name)
            .replace(/\$[0-9a-fA-F]{3}/g, '')
            .replace(/\$[wnoisgtzWNOISGTZ]/g, '')
            .replace(/\$\$/g, '$')
            .trim();
    }

    function dayOf(iso) {
        const s = String(iso || '');
        return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
    }

    /** The badge for one map: what it is, and what it is worth if it is still going. */
    function badgeFor(status) {
        if (status.excluded) return { label: 'SKIPPED', tone: 'neutral', title: 'On the community exclusion list, so it counts for nobody.' };
        if (status.open) {
            return {
                label: 'OPEN · ' + status.score,
                tone: 'open',
                title: 'Nobody has uploaded a replay for this map. Worth ' + status.score + ' for the 100% TMX project.',
            };
        }
        const who = stripTmxName(status.finishedBy);
        const day = dayOf(status.finishedAt);
        return {
            label: 'DONE',
            tone: 'done',
            title: who
                ? 'Finished by ' + who + (day ? ' on ' + day : '') + '.'
                : 'Already finished' + (day ? ' on ' + day : '') + '.',
        };
    }

    function decorateSearchResults(root) {
        const links = (root || document).querySelectorAll('a[href*="/trackshow/"]');
        const missing = [];

        links.forEach((link) => {
            const id = trackIdFromHref(link.getAttribute('href'));
            if (!id) return;
            const status = known.get(id);
            if (!status) {
                if (!asked.has(id)) missing.push(id);
                return;
            }
            if (link.dataset.tmxP100 === '1') return;
            link.dataset.tmxP100 = '1';

            const info = badgeFor(status);
            const badge = document.createElement('span');
            badge.className = 'tmx-p100-badge tmx-p100-' + info.tone;
            badge.textContent = info.label;
            badge.title = '100% TMX — ' + info.title;
            badge.setAttribute('role', 'img');
            badge.setAttribute('aria-label', '100% TMX: ' + info.title);
            link.insertAdjacentElement('afterend', badge);

            if (status.playing > 0) {
                const here = document.createElement('span');
                here.className = 'tmx-p100-badge tmx-p100-here';
                here.textContent = status.playing === 1 ? 'BEING PLAYED' : status.playing + ' PLAYING';
                here.title = 'Somebody has marked this map as the one they are driving right now. '
                    + 'It is a courtesy signal, not a reservation.';
                badge.insertAdjacentElement('afterend', here);
            }
        });

        return missing;
    }

    function decorateTrackPage() {
        const id = trackIdFromHref(window.location.pathname);
        if (!id) return [];
        const status = known.get(id);
        if (!status) return asked.has(id) ? [] : [id];

        const existing = document.getElementById('tmx-p100-banner');
        if (existing) return [];

        const info = badgeFor(status);
        const link = API + '/' + SITE.id + '/map/' + id;

        let headline;
        if (status.excluded) {
            headline = 'This map is on the community exclusion list';
        } else if (status.open) {
            headline = 'Still open — nobody has finished this one';
        } else {
            const who = stripTmxName(status.finishedBy);
            headline = who ? 'Finished by ' + escapeHtml(who) : 'Already finished';
        }

        const bits = [];
        if (status.open && !status.excluded) bits.push('Worth <strong>' + status.score + '</strong> to whoever gets the first replay.');
        if (!status.open) {
            const day = dayOf(status.finishedAt);
            if (day) bits.push('First replay on ' + day + '.');
        }
        if (status.playing > 0) {
            bits.push(status.playing === 1
                ? '<strong>Somebody is driving it right now.</strong>'
                : '<strong>' + status.playing + ' players are driving it right now.</strong>');
        }
        if (overview) {
            bits.push(SITE.short + ' is ' + overview.percent.toFixed(2) + '% done, '
                + overview.remaining.toLocaleString('en-GB') + ' maps left.');
        }

        const banner = document.createElement('div');
        banner.id = 'tmx-p100-banner';
        banner.className = 'tmx-p100-banner tmx-p100-' + info.tone;
        banner.innerHTML =
            '<div class="tmx-p100-banner-head">' +
                '<span class="tmx-p100-badge tmx-p100-' + info.tone + '">' + escapeHtml(info.label) + '</span>' +
                '<strong>' + headline + '</strong>' +
            '</div>' +
            '<p class="tmx-p100-banner-blurb">' + bits.join(' ') + '</p>' +
            '<div class="tmx-p100-banner-foot">' +
                'Credit goes to the first replay uploaded here, and nothing else. ' +
                '<a href="' + link + '" target="_blank" rel="noopener noreferrer">Open on 100tmx.com</a>' +
            '</div>';

        const card = Array.from(document.querySelectorAll('.card')).find((c) => c.querySelector('.card-header'));
        if (card && card.parentNode) card.parentNode.insertBefore(banner, card);
        else document.body.insertBefore(banner, document.body.firstChild);

        return [];
    }

    // ------------------------------------------------------------------
    // Two passes: find what is on the page, ask once, then draw
    // ------------------------------------------------------------------
    async function run() {
        if (inFlight) return;
        let missing = [];
        try {
            if (/\/trackshow\/\d+/.test(window.location.pathname)) missing = missing.concat(decorateTrackPage());
            missing = missing.concat(decorateSearchResults(document));
        } catch (err) {
            console.error('[TMX] 100% project status failed:', err);
            return;
        }
        if (missing.length === 0) return;

        inFlight = true;
        try {
            if (await load(missing)) {
                // Draw what just arrived. Never recurses further: everything
                // in `missing` is now either in `known` or in `asked`.
                if (/\/trackshow\/\d+/.test(window.location.pathname)) decorateTrackPage();
                decorateSearchResults(document);
            }
        } finally {
            inFlight = false;
        }
    }

    void run();

    // The result table is replaced wholesale when a filter changes, so keep
    // watching, and coalesce a burst of mutations into one pass.
    let pending = null;
    const observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            void run();
        }, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });
})();

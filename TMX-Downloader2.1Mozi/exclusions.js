// ============================================================================
// COMMUNITY EXCLUSION WARNINGS
//
// The 100% TMX Project keeps a community-maintained sheet of maps that cannot
// honestly count towards 100%: the author time was set with a cheat or a TAS,
// the finish block is unreachable, the file is invalid, or two uploads share a
// UID. `exclusions-data.js` is a snapshot of that sheet, bundled with the
// extension, so this needs no network request and no extra host permission.
//
// It surfaces in two places:
//   - /tracksearch results: a badge on every affected row
//   - /trackshow/{id}:      a banner above the track card
// ============================================================================
(function () {
    'use strict';

    const DATA = window.TMX_EXCLUSION_DATA;
    if (!DATA || !DATA.sites) {
        console.warn('[TMX] Exclusion data missing - warnings disabled.');
        return;
    }

    const MAPS = DATA.sites[window.location.hostname] || null;
    if (!MAPS) return;

    // Each sheet category means something different. "Cheated AT" is a real
    // accusation; "UID Clash" just means two uploads share an identifier. Keep
    // them visually distinct so a badge informs rather than alarms.
    const CATEGORIES = {
        'Cheated AT': {
            label: 'CHEATED AT',
            tone: 'danger',
            blurb: 'The author time is believed to be set with a cheat or a TAS.',
        },
        'Unfinishable': {
            label: 'UNFINISHABLE',
            tone: 'danger',
            blurb: 'The map cannot be finished as uploaded.',
        },
        'Invalid File': {
            label: 'INVALID FILE',
            tone: 'warn',
            blurb: 'The track file itself is broken or will not load correctly.',
        },
        'UID Clash': {
            label: 'UID CLASH',
            tone: 'neutral',
            blurb: 'Another upload shares this UID, so it cannot be counted separately.',
        },
        'Non-Race Focus': {
            label: 'NON-RACE',
            tone: 'info',
            blurb: 'This map is not a race - it is a stunt, puzzle or press-forward map.',
        },
        'Other': {
            label: 'EXCLUDED',
            tone: 'warn',
            blurb: 'Excluded from the 100% count.',
        },
    };

    const FALLBACK = { label: 'EXCLUDED', tone: 'warn', blurb: 'Excluded from the 100% count.' };
    const meta = (category) => CATEGORIES[category] || FALLBACK;

    const lookup = (trackId) => MAPS[String(trackId)] || null;

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

    /** A full sentence explaining why a map is listed, for tooltips and banners. */
    function describe(entry) {
        const parts = [meta(entry.c).blurb];
        if (entry.r && entry.r !== 'Other') parts.push(entry.r + '.');
        if (entry.n) parts.push('Note: ' + entry.n);
        if (entry.f === 'Uncertain') parts.push('Whether it is theoretically finishable is still uncertain.');
        else if (entry.f === 'No') parts.push('It is not considered theoretically finishable.');
        return parts.join(' ');
    }

    // ------------------------------------------------------------------
    // Search results - one badge per affected row
    // ------------------------------------------------------------------
    function decorateSearchResults(root) {
        const links = (root || document).querySelectorAll('a[href*="/trackshow/"]');
        links.forEach((link) => {
            if (link.dataset.tmxExclChecked === '1') return;
            link.dataset.tmxExclChecked = '1';

            const id = trackIdFromHref(link.getAttribute('href'));
            if (!id) return;
            const entry = lookup(id);
            if (!entry) return;

            const info = meta(entry.c);
            const badge = document.createElement('span');
            badge.className = 'tmx-excl-badge tmx-excl-' + info.tone;
            badge.textContent = info.label;
            badge.title = 'Excluded from the 100% TMX count — ' + entry.c + '\n\n' + describe(entry);
            badge.setAttribute('role', 'img');
            badge.setAttribute('aria-label', 'Excluded from the 100% count: ' + entry.c);

            link.insertAdjacentElement('afterend', badge);

            const row = link.closest('tr');
            if (row) row.classList.add('tmx-excl-row');
        });
    }

    // ------------------------------------------------------------------
    // Track page - a banner above the track card
    // ------------------------------------------------------------------
    function decorateTrackPage() {
        const id = trackIdFromHref(window.location.pathname);
        if (!id || document.getElementById('tmx-excl-banner')) return;
        const entry = lookup(id);
        if (!entry) return;

        const info = meta(entry.c);
        const rows = [];
        const addRow = (key, value) => {
            if (!value) return;
            rows.push(
                '<div class="tmx-excl-banner-row"><span class="tmx-excl-key">' + key +
                '</span><span>' + escapeHtml(value) + '</span></div>'
            );
        };
        addRow('Reason', entry.c);
        addRow('Detail', entry.r);
        addRow('Finishable', entry.f);
        addRow('Note', entry.n);

        const banner = document.createElement('div');
        banner.id = 'tmx-excl-banner';
        banner.className = 'tmx-excl-banner tmx-excl-' + info.tone;
        banner.innerHTML =
            '<div class="tmx-excl-banner-head">' +
                '<span class="tmx-excl-badge tmx-excl-' + info.tone + '">' + info.label + '</span>' +
                '<strong>This map does not count towards 100%</strong>' +
            '</div>' +
            '<p class="tmx-excl-banner-blurb">' + escapeHtml(describe(entry)) + '</p>' +
            '<div class="tmx-excl-banner-grid">' + rows.join('') + '</div>' +
            '<div class="tmx-excl-banner-foot">' +
                'Listed on the community exclusion sheet (snapshot ' + escapeHtml(DATA.generatedAt) + '). ' +
                '<a href="' + escapeHtml(DATA.source) + '" target="_blank" rel="noopener noreferrer">Open the sheet</a>' +
            '</div>';

        // Above the track info card when we can find it, otherwise at the top of
        // the document - either way it lands before the fold.
        const card = Array.from(document.querySelectorAll('.card'))
            .find((c) => c.querySelector('.card-header'));
        if (card && card.parentNode) card.parentNode.insertBefore(banner, card);
        else document.body.insertBefore(banner, document.body.firstChild);
    }

    function run() {
        try {
            if (/\/trackshow\/\d+/.test(window.location.pathname)) decorateTrackPage();
            decorateSearchResults(document);
        } catch (err) {
            console.error('[TMX] Exclusion warnings failed:', err);
        }
    }

    run();

    // Search results are replaced in place when filters change, so keep
    // watching. Coalesce bursts of mutations into a single pass.
    let pending = null;
    const observer = new MutationObserver(() => {
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            run();
        }, 120);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    console.log('[TMX] Exclusion warnings active (' + Object.keys(MAPS).length +
        ' maps listed for ' + window.location.hostname + ').');
})();

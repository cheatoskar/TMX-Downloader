// ============================================================================
// THE REPLAY BRIDGE, ON THE PAGE IT IS ABOUT
//
// /replayupload is where somebody ends up when they have a replay to upload -
// which is exactly the moment to say "the game can do this for you", and the
// only page where that offer is obviously relevant rather than an
// advertisement.
//
// So a card at the top of the upload page: connect the game, see whether it is
// connected, and see what the last upload did. Everything it shows comes from
// the background worker, which owns the state; this is a window onto it, the
// same as the toolbar popup.
// ============================================================================
(function () {
    'use strict';

    const api = typeof browser !== 'undefined' ? browser : chrome;
    if (document.getElementById('tmx-bridge-card')) return;

    function send(message) {
        return new Promise((resolve) => {
            try {
                api.runtime.sendMessage(message, (res) => {
                    void api.runtime.lastError;
                    resolve(res || null);
                });
            } catch (err) {
                resolve(null);
            }
        });
    }

    const card = document.createElement('div');
    card.id = 'tmx-bridge-card';
    card.className = 'tmx-bridge-card';
    card.innerHTML =
        '<div class="tmx-bridge-head">' +
            '<span class="tmx-bridge-dot" id="tmx-bridge-dot"></span>' +
            '<strong>Upload straight from the game</strong>' +
        '</div>' +
        '<p class="tmx-bridge-blurb" id="tmx-bridge-blurb">' +
            'Finish a map with the 100% TMX mod running and the replay is uploaded here for you, ' +
            'signed in as you in this browser. Nothing is stored and no password is ever asked for.' +
        '</p>' +
        '<div class="tmx-bridge-actions">' +
            '<button type="button" class="tmx-bridge-btn" id="tmx-bridge-connect">Connect the game</button>' +
            '<a class="tmx-bridge-link" href="https://100tmx.com/link" target="_blank" rel="noopener noreferrer">' +
                'What is this?</a>' +
        '</div>' +
        '<p class="tmx-bridge-note" id="tmx-bridge-note"></p>';

    function place() {
        // Above the upload form's own card when it can be found, otherwise at
        // the top of the main column - either way it lands before the fold and
        // before the file picker it is offering to replace.
        const anchor = document.querySelector('.card') || document.querySelector('main') || document.body;
        if (anchor.parentNode && anchor !== document.body) anchor.parentNode.insertBefore(card, anchor);
        else anchor.insertBefore(card, anchor.firstChild);
    }
    place();

    const dot = document.getElementById('tmx-bridge-dot');
    const note = document.getElementById('tmx-bridge-note');
    const blurb = document.getElementById('tmx-bridge-blurb');
    const connect = document.getElementById('tmx-bridge-connect');

    function ago(at) {
        const mins = Math.round((Date.now() - at) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        const hours = Math.round(mins / 60);
        return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }

    function render(status) {
        if (!status) {
            note.textContent = '';
            return;
        }

        const connected = status.enabled && status.port && status.hasKey;
        dot.className = 'tmx-bridge-dot' + (connected ? ' on' : status.enabled ? ' waiting' : '');

        connect.textContent = status.enabled ? (connected ? 'Connected' : 'Connecting…') : 'Connect the game';
        connect.disabled = status.enabled;

        if (connected) {
            blurb.textContent =
                'The game is connected. Finish a map the project still wants and the replay lands here by itself.';
        }

        const bits = [];
        if (status.enabled && status.note) bits.push(status.note);
        if (status.last) {
            bits.push((status.last.ok ? '✓ ' : '× ') + status.last.map + ' — ' + status.last.detail +
                ' (' + ago(status.last.at) + ')');
        }
        note.textContent = bits.join(' · ');
        note.className = 'tmx-bridge-note' + (status.last && !status.last.ok ? ' bad' : '');
    }

    async function refresh() {
        const res = await send({ action: 'bridgeStatus' });
        render(res && res.success ? res.data : null);
    }

    connect.addEventListener('click', async () => {
        connect.disabled = true;
        await send({ action: 'bridgeSet', enabled: true });
        // The game shows "A browser wants to connect - Allow / No"; the poll
        // below is what notices that it was allowed.
        note.textContent = 'Now press F9 in TrackMania and choose Allow.';
        await refresh();
    });

    void refresh();
    setInterval(refresh, 2000);
})();

// The bridge's only piece of UI: a switch, a key, and what is going on.
//
// Everything it shows comes from the background worker, which owns the state -
// the popup is closed most of the time and must never be the thing that
// remembers anything.
'use strict';

(function () {
    const api = typeof browser !== 'undefined' ? browser : chrome;

    const enabled = document.getElementById('enabled');
    const dot = document.getElementById('dot');
    const note = document.getElementById('note');
    const last = document.getElementById('last');

    function send(message) {
        return new Promise((resolve) => {
            api.runtime.sendMessage(message, (res) => {
                void api.runtime.lastError;
                resolve(res || null);
            });
        });
    }

    function ago(at) {
        const mins = Math.round((Date.now() - at) / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        const hours = Math.round(mins / 60);
        return hours + (hours === 1 ? ' hour ago' : ' hours ago');
    }

    function render(status) {
        if (!status) {
            note.textContent = 'the extension is still waking up';
            return;
        }
        enabled.checked = status.enabled;

        dot.className = 'dot';
        if (status.enabled && status.port && status.hasKey) dot.classList.add('on');
        else if (status.enabled) dot.classList.add('warn');
        note.textContent = status.note || '';

        if (status.last) {
            last.classList.remove('hidden');
            last.className = 'note ' + (status.last.ok ? 'last-ok' : 'last-bad');
            last.textContent = status.last.map + ' — ' + status.last.detail + ' (' + ago(status.last.at) + ')';
        } else {
            last.classList.add('hidden');
        }
    }

    async function refresh() {
        const res = await send({ action: 'bridgeStatus' });
        render(res && res.success ? res.data : null);
    }

    enabled.addEventListener('change', async () => {
        await send({ action: 'bridgeSet', enabled: enabled.checked });
        await refresh();
    });

    void refresh();
    // While the popup is open, keep it honest: finding the game takes a moment
    // and "not running" turning into "connected" is the thing being waited for.
    setInterval(refresh, 2000);
})();

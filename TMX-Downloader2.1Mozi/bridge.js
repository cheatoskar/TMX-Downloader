// ============================================================================
// THE REPLAY BRIDGE
//
// TrackMania saves a replay when you finish. Getting it onto TMX means finding
// the map again, opening the upload page and dragging a file - five steps at
// the exact moment somebody wants to drive the next map, which is why so many
// runs never get uploaded at all.
//
// TMX has no upload API. `POST /api/replays/upload` is authenticated by the
// site's own session cookie and carries an antiforgery token minted for a page
// on the exchange's origin, so the only thing that can upload for a player is
// something already signed in as them - a browser. That is this extension, and
// it is the entire reason this code lives here rather than in the game mod:
//
//   * the 100% TMX game mod offers the replay on 127.0.0.1, to a caller
//     holding a key the mod itself printed
//   * this reads it, uploads it from the exchange's own origin with the
//     player's own session, and posts the outcome back so the overlay can say
//     what happened
//
// No password, no token and no session is stored by the mod, by this
// extension or by anybody's server. The login stays in the browser, where it
// already was.
//
// Off until the player switches it on. Pairing is then automatic: this asks
// the mod for a key, the mod puts "A browser wants to connect - Allow / No"
// on the panel in the game, and hands it over once somebody has said yes.
// Nothing to copy, nothing to type, and the secret still never leaves the
// machine without a deliberate human act.
// ============================================================================
'use strict';

const TMXB = (function () {
    const api = typeof browser !== 'undefined' ? browser : chrome;

    // The mod's port, and the four it falls back to when something else has
    // taken the first. Probed in this order; the same list is in bridge.cpp.
    const PORTS = [27311, 27312, 27313, 27314, 27315];

    const ORIGINS = {
        tmnf: 'https://tmnf.exchange',
        tmuf: 'https://tmuf.exchange',
        tmo: 'https://original.tm-exchange.com',
        tms: 'https://sunrise.tm-exchange.com',
        tmn: 'https://nations.tm-exchange.com',
    };

    /** How long the mod is asked to hold the connection open. */
    const WAIT_SECONDS = 25;

    const state = {
        enabled: false,
        key: '',
        port: null,
        /** The mod's version, once it has said hello. */
        mod: null,
        /** Why nothing is happening, in words a person can act on. */
        note: 'off',
        last: null,
        running: false,
    };

    // ---------------------------------------------------------------- storage

    function read() {
        return new Promise((resolve) => {
            api.storage.local.get(['bridgeEnabled', 'bridgeKey', 'bridgeLast'], (got) => {
                resolve(got || {});
            });
        });
    }

    function write(values) {
        return new Promise((resolve) => api.storage.local.set(values, resolve));
    }

    // ------------------------------------------------------------ the mod

    async function call(port, path, options) {
        const opts = Object.assign({ cache: 'no-store' }, options || {});
        opts.headers = Object.assign({ 'X-TMX-Key': state.key }, opts.headers || {});
        return fetch('http://127.0.0.1:' + port + path, opts);
    }

    /**
     * Which port the mod is on, if it is running at all.
     *
     * Re-probed whenever a call fails rather than cached forever: the game is
     * started and stopped far more often than this extension is, and a port
     * remembered from the last session is the most common way a bridge looks
     * broken.
     *
     * `/v1/ping` needs no key, on purpose: finding the mod and being allowed
     * to talk to it are two different questions, and the answer to the first
     * one is what makes pairing possible without anybody typing anything.
     */
    async function findPort() {
        if (state.port !== null) return state.port;
        for (const port of PORTS) {
            try {
                const res = await fetch('http://127.0.0.1:' + port + '/v1/ping', { cache: 'no-store' });
                if (!res.ok) continue;
                const hello = await res.json();
                if (!hello || !hello.ok) continue;
                state.port = port;
                state.mod = hello.mod || null;
                return port;
            } catch (err) {
                // Connection refused is the ordinary answer when TrackMania is
                // not running. Not worth a line in the console every 25 s.
            }
        }
        state.note = 'the game is not running, or the bridge is off in the mod (F9)';
        return null;
    }

    /**
     * Ask the game to let us in.
     *
     * The mod holds a key it generated itself. Rather than making somebody
     * copy it out of one window and into another, we ask for it: the mod puts
     * "A browser wants to connect - Allow / No" on the panel, and hands the
     * key over once somebody has said yes in the game. Nothing is weaker for
     * it - the secret still never leaves the machine, and it still takes a
     * deliberate human act to give it out - and there is nothing to type.
     *
     * The same shape as the device code the website uses to link a machine,
     * with the confirming end in the game instead of the browser.
     */
    async function requestPairing(port) {
        try {
            const res = await fetch('http://127.0.0.1:' + port + '/v1/pair', { method: 'POST', cache: 'no-store' });
            const data = await res.json();
            if (data && data.key) {
                state.key = data.key;
                await write({ bridgeKey: state.key });
                state.note = 'connected to the game' + (state.mod ? ' (mod ' + state.mod + ')' : '');
                return true;
            }
            state.note = 'waiting for you to allow it in the game - press F9';
        } catch (err) {
            state.port = null;
            state.note = 'the game went away while connecting';
        }
        return false;
    }

    // ------------------------------------------------------------ uploading

    /**
     * The antiforgery token, from the upload page itself.
     *
     * TMX puts it on `document.body[data-antiforgery]` and checks it against a
     * cookie for the same origin. Fetching the page is also how we find out
     * whether the player is signed in at all: signed out, there is no token on
     * it, and saying so is far more useful than a 400 from the upload.
     */
    async function antiforgeryToken(origin) {
        const res = await fetch(origin + '/replayupload', { credentials: 'include', cache: 'no-store' });
        if (!res.ok) throw new Error('the exchange did not answer (' + res.status + ')');
        const html = await res.text();
        const m = html.match(/data-antiforgery="([^"]+)"/i);
        if (!m) throw new Error('sign in to TMX in this browser first');
        return m[1];
    }

    async function upload(port, job) {
        const origin = ORIGINS[job.site];
        if (!origin) throw new Error('unknown exchange ' + job.site);

        const fileRes = await call(port, '/v1/file?id=' + encodeURIComponent(job.id));
        if (!fileRes.ok) throw new Error('the mod would not hand the replay over');
        const blob = await fileRes.blob();

        const token = await antiforgeryToken(origin);

        const form = new FormData();
        // The page's own script posts the part as `file` and the token
        // alongside it; matching that exactly is the whole contract.
        form.append('file', blob, job.fileName || 'replay.Replay.Gbx');
        form.append('__RequestVerificationToken', token);

        const res = await fetch(origin + '/api/replays/upload', {
            method: 'POST',
            body: form,
            credentials: 'include',
        });

        let payload = null;
        try {
            payload = await res.json();
        } catch (err) {
            payload = null;
        }

        if (payload && payload.Track) {
            return { ok: true, detail: 'Uploaded to ' + (payload.Track.TrackName || 'TMX') + '.' };
        }
        // TMX refuses a replay slower than your own record, and that is the
        // ordinary answer on a map you have already beaten - a fact, not a
        // failure, and reported as one.
        const detail = (payload && payload.detail) || ('TMX answered ' + res.status);
        return { ok: false, detail };
    }

    // --------------------------------------------------------------- the loop

    async function tick() {
        if (state.running || !state.enabled) return;
        state.running = true;
        try {
            for (;;) {
                if (!state.enabled) break;

                const port = await findPort();
                if (port === null) break;

                // No key yet: ask for one and wait for the player to allow it
                // in the game. Polled rather than long-polled, because the
                // answer comes from a human pressing a button, not from a map
                // being finished.
                if (!state.key) {
                    const got = await requestPairing(port);
                    if (!got) {
                        await new Promise((resolve) => setTimeout(resolve, 2000));
                        continue;
                    }
                }

                let job = null;
                try {
                    // A long poll: the request is held open by the mod until
                    // there is a replay or the time is up. It is also what
                    // keeps this worker alive - a pending fetch counts as
                    // activity, so there is no timer to keep warm.
                    const res = await call(port, '/v1/next?wait=' + WAIT_SECONDS);
                    if (res.status === 401) {
                        // The mod generated a new key - the ini was deleted, or
                        // this is a different machine. Throw ours away and pair
                        // again rather than sitting here refused for ever.
                        state.key = '';
                        await write({ bridgeKey: '' });
                        state.note = 'reconnecting to the game';
                        continue;
                    }
                    state.note = 'connected to the game' + (state.mod ? ' (mod ' + state.mod + ')' : '');
                    const data = await res.json();
                    job = data && data.upload;
                } catch (err) {
                    // The game closed while we were parked on it. Find it again
                    // next time rather than hammering a port that is gone.
                    state.port = null;
                    state.note = 'the game went away';
                    break;
                }

                if (!job) continue;

                let outcome;
                try {
                    outcome = await upload(port, job);
                } catch (err) {
                    outcome = { ok: false, detail: err.message };
                }

                state.last = {
                    at: Date.now(),
                    map: job.mapName || ('track ' + job.trackId),
                    site: job.site,
                    ok: outcome.ok,
                    detail: outcome.detail,
                };
                await write({ bridgeLast: state.last });

                try {
                    await call(port, '/v1/result', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id: job.id, ok: outcome.ok, detail: outcome.detail }),
                    });
                } catch (err) {
                    // The result is a courtesy to the overlay. Losing it must
                    // not lose the upload that already happened.
                }
            }
        } finally {
            state.running = false;
        }
    }

    // A minute is the floor for an alarm, and it is only a safety net: while
    // the game is running the long poll keeps this awake by itself. This is
    // what starts things again after the worker has been asleep.
    function arm() {
        if (!api.alarms) return;
        api.alarms.create('tmx-bridge', { periodInMinutes: 1 });
    }

    async function init() {
        const got = await read();
        state.enabled = got.bridgeEnabled === true;
        state.key = got.bridgeKey || '';
        state.last = got.bridgeLast || null;
        if (!state.enabled) state.note = 'off';
        else state.note = 'looking for the game';
        arm();
        void tick();
    }

    if (api.alarms && api.alarms.onAlarm) {
        api.alarms.onAlarm.addListener((alarm) => {
            if (alarm.name === 'tmx-bridge') void tick();
        });
    }
    if (api.runtime.onStartup) api.runtime.onStartup.addListener(() => void init());
    if (api.runtime.onInstalled) api.runtime.onInstalled.addListener(() => void init());

    // The popup talks to this, and so does the first load of the worker.
    api.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'bridgeStatus') {
            sendResponse({
                success: true,
                data: {
                    enabled: state.enabled,
                    hasKey: state.key.length > 0,
                    port: state.port,
                    mod: state.mod,
                    note: state.note,
                    last: state.last,
                },
            });
            // Asking for the status is also a good moment to make sure the
            // loop is running: the popup is opened exactly when somebody
            // wonders why nothing is happening.
            void tick();
            return true;
        }

        if (request && request.action === 'bridgeSet') {
            (async () => {
                if (typeof request.enabled === 'boolean') state.enabled = request.enabled;
                if (typeof request.key === 'string') state.key = request.key.trim();
                state.port = null;
                state.note = state.enabled ? 'looking for the game' : 'off';
                await write({ bridgeEnabled: state.enabled, bridgeKey: state.key });
                sendResponse({ success: true });
                void tick();
            })();
            return true;
        }

        return undefined;
    });

    void init();

    return { tick };
})();

// ============================================================================
// The search URL this page used is read from the Resource Timing API when it is
// needed (see findApiUrlFromTimings). Nothing is hooked and no script is
// injected into the page.
// ============================================================================

// ============================================================================
// PART 2: SCRIPT - Runs after DOM is ready
// ============================================================================
(function() {
    'use strict';
    
    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================
    const TMX_STATE = {
        lastApiUrl: null,
        hasCapturedUrl: false,
        isInitialized: false,
        dropdownWatcher: null,
        currentExchange: null,
        uiCheckInterval: null,
        progress: { current: 0, total: 0 },
        abortController: null,
        isFetchingCount: false
    };

    let CACHED_TRACK_DATA = null;

    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    const EXCHANGES = {
        'tmnf.exchange': {
            name: 'TMNF-X',
            apiBase: 'https://tmnf.exchange/api/tracks',
            trackpackApiBase: 'https://tmnf.exchange/api/trackpacks'
        },
        'tmuf.exchange': {
            name: 'TMUF-X',
            apiBase: 'https://tmuf.exchange/api/tracks',
            trackpackApiBase: 'https://tmuf.exchange/api/trackpacks'
        },
        'original.tm-exchange.com': {
            name: 'TMO-X',
            apiBase: 'https://original.tm-exchange.com/api/tracks',
            trackpackApiBase: 'https://original.tm-exchange.com/api/trackpacks'
        },
        'sunrise.tm-exchange.com': {
            name: 'TMS-X',
            apiBase: 'https://sunrise.tm-exchange.com/api/tracks',
            trackpackApiBase: 'https://sunrise.tm-exchange.com/api/trackpacks'
        },
        'nations.tm-exchange.com': {
            name: 'TMN-X',
            apiBase: 'https://nations.tm-exchange.com/api/tracks',
            trackpackApiBase: 'https://nations.tm-exchange.com/api/trackpacks'
        }
    };

    // 🆕 Proxy helpers
    async function proxyFetchJson(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({action: 'fetchApi', url}, (res) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else if (res.success) {
            resolve(res.data);
        } else {
            reject(new Error(res.error));
        }
        });
    });
    }

    async function proxyFetchBinary(url) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({action: 'fetchBinary', url}, (res) => {
        if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
        } else if (res.success) {
            try {
            const binaryString = atob(res.base64);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                bytes[i] = binaryString.charCodeAt(i);
            }
            const blob = new Blob([bytes.buffer], {type: 'application/octet-stream'});
            resolve(blob);
            } catch (e) {
            reject(e);
            }
        } else {
            reject(new Error(res.error));
        }
        });
    });
    }

    // ============================================================================
    // CORE API URL RETRIEVAL
    // ============================================================================
    function getCurrentExchange() {
        if (TMX_STATE.currentExchange) return TMX_STATE.currentExchange;
        const hostname = window.location.hostname;
        TMX_STATE.currentExchange = EXCHANGES[hostname];
        if (!TMX_STATE.currentExchange) {
            console.error('[TMX] Unsupported hostname:', hostname);
        }
        return TMX_STATE.currentExchange;
    }

    function getSelectedExchanges() {
        const multiMode = document.getElementById('multiExchangeMode')?.checked;
        
        if (!multiMode) {
            // Single exchange mode - return current exchange only
            const current = getCurrentExchange();
            return current ? [current] : [];
        }
        
        // Multi-exchange mode - get selected exchanges
        const checkboxes = document.querySelectorAll('.exchange-checkbox:checked');
        const selected = [];
        
        checkboxes.forEach(checkbox => {
            const hostname = checkbox.value;
            if (EXCHANGES[hostname]) {
                selected.push(EXCHANGES[hostname]);
            }
        });
        
        return selected;
    }

    // ------------------------------------------------------------------
    // Finding the search the page itself ran
    //
    // Earlier versions replaced window.fetch to record request URLs. Mozilla
    // reviewed that as monitoring the user's network activity, which needs an
    // explicit consent flow, and they were right to: patching fetch observes
    // every request the page makes, not just the one we care about.
    //
    // Resource Timing gives us the same answer without any of that. It is a
    // standard, read-only browser API listing resources the page has already
    // loaded. Nothing is hooked, nothing is injected into the page, no request
    // is observed as it happens, and no data leaves the browser - we simply
    // look up the search URL this page already used so a download can reuse it
    // verbatim instead of guessing it from the address bar.
    // ------------------------------------------------------------------
    function findApiUrlFromTimings(fragment) {
        let entries;
        try {
            entries = performance.getEntriesByType('resource');
        } catch (e) {
            return null;
        }
        if (!entries || !entries.length) return null;

        // Most recent match wins: the newest search is the current one.
        for (let i = entries.length - 1; i >= 0; i--) {
            const name = entries[i] && entries[i].name;
            if (typeof name === 'string' && name.indexOf(fragment) !== -1) return name;
        }
        return null;
    }

    /**
     * Calls `onFound` whenever the page loads a new URL containing `fragment`.
     * PerformanceObserver is the passive counterpart to the lookup above.
     */
    function watchApiUrl(fragment, onFound) {
        if (typeof PerformanceObserver === 'undefined') return;
        try {
            const observer = new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (entry && typeof entry.name === 'string' && entry.name.indexOf(fragment) !== -1) {
                        onFound(entry.name);
                        return;
                    }
                }
            });
            observer.observe({ type: 'resource', buffered: false });
        } catch (e) {
            console.debug('[TMX] Resource timing observer unavailable:', e);
        }
    }

    function getApiUrlSafe() {
        // METHOD 1: the search this page already ran, via Resource Timing.
        const timedUrl = findApiUrlFromTimings('/api/tracks');
        if (timedUrl) {
            try {
                new URL(timedUrl);
                TMX_STATE.lastApiUrl = timedUrl;
                TMX_STATE.hasCapturedUrl = true;
                return timedUrl;
            } catch (e) {
                console.error('[TMX] Invalid timing URL:', timedUrl);
            }
        }
        
        // METHOD 3: Fallback to internal state
        if (TMX_STATE.hasCapturedUrl && TMX_STATE.lastApiUrl) {
            try {
                new URL(TMX_STATE.lastApiUrl);
                return TMX_STATE.lastApiUrl;
            } catch (e) {
                console.error('[TMX] Invalid stored URL:', TMX_STATE.lastApiUrl);
                TMX_STATE.hasCapturedUrl = false;
                TMX_STATE.lastApiUrl = null;
            }
        }
        
        return null;
    }

    function sanitizeFilename(filename) {
        return filename.replace(/[<>:"/\\|?*]/g, '_');
    }

    function generateZipName(exchangeName) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${sanitizeFilename(exchangeName)}_Tracks_${timestamp}.zip`;
    }

    function loadJSZip() {
      // JSZip is bundled with this extension (jszip.min.js, declared in the
      // manifest's content_scripts) and is already present in this world.
      // Nothing is fetched from a remote origin.
      return window.JSZip
          ? Promise.resolve()
          : Promise.reject(new Error('Bundled JSZip library failed to load'));
    }

    // ============================================================================
    // UI FUNCTIONS
    // ============================================================================
    TMX_STATE.realCount = null;

    async function fetchRealCount() {
        const apiUrl = getApiUrlSafe();
        if (!apiUrl) return '0';
        
        try {
            const urlObj = new URL(apiUrl);
            urlObj.searchParams.set('count', '1000');
            
            // 🆕 IMPORTANT: Fetch and store in cache
            const abortController = new AbortController();
            CACHED_TRACK_DATA = await fetchAllTracks(urlObj.toString(), 1000, abortController.signal);
            
            const count = CACHED_TRACK_DATA.length;
            const more = count >= 1000; // If we got exactly 1000, there might be more
            
            console.log(`[TMX] 📊 Fetched and cached ${count} tracks for counter`);
            
            return more ? '1000+' : count.toString();
        } catch (e) {
            console.error('[TMX] Error fetching real count:', e);
            CACHED_TRACK_DATA = null; // Clear on error
            return 'Error';
        }
    }
    async function updateStatus(loading = false) {
        const status = document.getElementById('tmx-status');
        
        if (!status) return;
        const apiUrl = getApiUrlSafe();
        
        // Remove all state classes first
        status.classList.remove('loading', 'ready', 'error');
        if (loading || TMX_STATE.isFetchingCount) {
            status.textContent = '⏳ Loading...';
            status.classList.add('loading');
            return;
        }
        
        if (apiUrl) {
            // Trigger fetch if theres no have a real count yet
            if (!TMX_STATE.realCount && !TMX_STATE.isFetchingCount) {
                TMX_STATE.isFetchingCount = true;
                status.textContent = '⏳ Getting track count...';
                status.classList.add('loading');
                
                fetchRealCount().then(displayCount => {
                    TMX_STATE.realCount = displayCount;
                    TMX_STATE.isFetchingCount = false;
                    updateStatus();
                }).catch(() => {
                    TMX_STATE.realCount = 'Error';
                    TMX_STATE.isFetchingCount = false;
                    updateStatus();
                });
                return;
            }
            
            // Use real count if available
            let displayCount = TMX_STATE.realCount || '0';
            if (displayCount === 'Error') displayCount = '0';
            
            // Fallback parsing if still no real count
            if (displayCount === '0' && !TMX_STATE.realCount) {
                try {
                    const urlObj = new URL(apiUrl);
                    const countParam = parseInt(urlObj.searchParams.get('count'), 10) || 0;
                    displayCount = countParam > 1000 ? '1000+' : countParam.toString();
                } catch (e) {
                    console.error('[TMX] Error parsing count from URL');
                    displayCount = '0';
                }
            }
            
            // Update UI
            status.textContent = `Search loaded (${displayCount} tracks)`;
            status.classList.add('ready');
        } else {
            status.textContent = '❌ Perform search';
            status.classList.add('error');
        }
    }

   function createUI(dropdown) {
        // Remove old UI if exists
        const oldUI = document.getElementById('tmx-download-filter');
        if (oldUI) {
            oldUI.remove();
        }
        
        // Verify correct dropdown
        const filterHeader = dropdown.querySelector('.filterselector-header');
        if (!filterHeader || !filterHeader.textContent.includes('FILTERS')) {
            console.log('[TMX] Skipping UI creation - not the filter dropdown');
            return;
        }
        
        console.log('[TMX] 🎯 Creating UI in filter dropdown');
        
        const downloadFilter = document.createElement('div');
        downloadFilter.id = 'tmx-download-filter';
        
        const label = document.createElement('span');
        label.className = 'tmx-section-label';
        label.textContent = 'DOWNLOADER';
        
        const btnContainer = document.createElement('div');
        btnContainer.className = 'tmx-btn-container';
        
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'tmx-downloader-btn';
        downloadBtn.innerHTML = 'Download Tracks';
 
        const status = document.createElement('div');
        status.id = 'tmx-status';
        status.className = 'error';
        status.textContent = '❌ Perform search';
                
        btnContainer.appendChild(downloadBtn);        
        downloadFilter.appendChild(label);
        downloadFilter.appendChild(btnContainer);
        downloadFilter.appendChild(status);
        
        // Insert after header
        if (filterHeader.nextSibling) {
            dropdown.insertBefore(downloadFilter, filterHeader.nextSibling);
        } else {
            dropdown.appendChild(downloadFilter);
        }
        
        // Button click handler
        downloadBtn.addEventListener('click', () => {
            const apiUrl = getApiUrlSafe();
            console.log('[TMX] Button clicked, current URL:', apiUrl);
            
            if (!apiUrl) {
                alert('❌ No API URL found!\n\nPlease perform a search first and wait for results to load.');
                return;
            }
            
            const modal = document.getElementById('tmx-modal');
            if (modal) {
                modal.style.display = 'flex';
                updateStatus();
            } else {
                console.error('[TMX] Modal not found!');
            }
        });
        
        console.log('[TMX] ✅ UI created successfully');
        updateStatus();
        
        return { downloadBtn, status };
    }

    /**
     * Keeps the redesigned controls and the original checkboxes in step, and
     * keeps one plain-English sentence at the top of the modal describing what
     * "Start download" is actually going to do.
     *
     * The old UI exposed "Shuffle track order" and "Random selection" as two
     * independent checkboxes that were not independent at all - shuffle won,
     * and a footnote had to explain it. They are one three-way choice now.
     */
    function wireModalControls(modal) {
        const $ = (id) => modal.querySelector('#' + id);
        const radio = (name) => modal.querySelector(`input[name="${name}"]:checked`)?.value;

        const countField = $('tmxCountField');
        const trackCount = $('trackCount');
        const startIndex = $('startIndex');
        const createZip = $('createZip');
        const shuffleTracks = $('shuffleTracks');
        const randomSelection = $('randomSelection');
        const createIdTxt = $('createIdTxt');
        const idListOnly = $('idListOnly');
        const idOnlyRow = $('tmxIdOnlyRow');
        const includeMetadata = $('includeMetadata');
        const summary = $('tmxSummaryText');
        const orderHint = $('tmxOrderHint');

        const ORDER_HINTS = {
            default: 'Tracks arrive in the order your search returned them.',
            shuffle: 'Takes the same tracks, then mixes up the order they download in.',
            random: 'Loads every result first, then picks your number at random from the whole set.',
        };

        function sync() {
            const amount = radio('tmxAmount');
            const order = radio('tmxOrder');
            const format = radio('tmxFormat');

            // "A set number" is the only mode where a count makes sense.
            const limited = amount === 'limit';
            trackCount.disabled = !limited;
            countField.classList.toggle('tmx-dl-field-off', !limited);
            if (!limited) trackCount.value = '';

            // A random sample has to know how many to pick.
            const randomNeedsCount = order === 'random' && !limited;

            // Mirror onto the checkboxes handleDownload still reads.
            shuffleTracks.checked = order === 'shuffle';
            randomSelection.checked = order === 'random';
            createZip.checked = format === 'zip';

            // "ID list only" is meaningless without an ID list.
            const wantsIds = createIdTxt.checked;
            idListOnly.disabled = !wantsIds;
            if (!wantsIds) idListOnly.checked = false;
            idOnlyRow.classList.toggle('tmx-check-off', !wantsIds);

            orderHint.textContent = randomNeedsCount
                ? 'Pick "A set number" above to say how many to sample.'
                : ORDER_HINTS[order];
            orderHint.classList.toggle('tmx-dl-hint-warn', randomNeedsCount);

            summary.textContent = describeRun({
                amount,
                order,
                format,
                count: parseInt(trackCount.value, 10) || null,
                skip: parseInt(startIndex.value, 10) || 0,
                metadata: includeMetadata.checked,
                idList: wantsIds,
                idOnly: idListOnly.checked,
                multi: $('multiExchangeMode').checked,
                exchanges: modal.querySelectorAll('.exchange-checkbox:checked').length,
            });
        }

        function describeRun(o) {
            if (o.idOnly) {
                const what = o.amount === 'limit' && o.count ? `${o.count.toLocaleString()} track IDs` : 'every matching track ID';
                return `No map files — just a .txt listing ${what}.`;
            }

            const n = o.amount === 'limit' && o.count ? o.count.toLocaleString() + ' tracks' : 'every track your search returns';
            const picked =
                o.order === 'random' ? `${n}, sampled at random from the full result set` :
                o.order === 'shuffle' ? `${n}, in a shuffled order` : n;

            const parts = [`${picked[0].toUpperCase()}${picked.slice(1)}`];
            parts.push(o.format === 'zip' ? 'as one ZIP file' : 'as separate .gbx files');
            if (o.skip > 0) parts.push(`skipping the first ${o.skip.toLocaleString()}`);
            if (o.multi) parts.push(`across ${o.exchanges} exchange${o.exchanges === 1 ? '' : 's'}`);

            const extras = [];
            if (o.metadata) extras.push('metadata JSON');
            if (o.idList) extras.push('an ID list');

            let text = parts.join(', ');
            if (extras.length) text += `, plus ${extras.join(' and ')}`;
            return text + '.';
        }

        modal.addEventListener('change', sync);
        modal.addEventListener('input', sync);
        sync();
    }

    function createModal() {
        // Remove old modal if exists
        const oldModal = document.getElementById('tmx-modal');
        if (oldModal) {
            oldModal.remove();
        }
        
        const exchange = getCurrentExchange();
        if (!exchange) {
            console.error('[TMX] No exchange configured');
            return;
        }
        
        const modal = document.createElement('div');
        modal.id = 'tmx-modal';
        modal.className = 'tmx-modal';
        
        // The visible controls are radio groups; `handleDownload` still reads
        // the original checkboxes, so those live on as hidden mirrors that the
        // radios drive. That keeps the download logic untouched.
        modal.innerHTML = `
            <div class="tmx-modal-content tmx-dl">
                <header class="tmx-dl-head">
                    <div class="tmx-dl-title">
                        <h2>Download tracks</h2>
                        <p class="tmx-dl-sub" id="exchange-name">${exchange.name}</p>
                    </div>
                    <button type="button" class="tmx-dl-x" id="tmxCloseModal" aria-label="Close">&times;</button>
                </header>

                <div class="tmx-dl-body">
                    <!-- Always says, in one sentence, what pressing the button will do. -->
                    <div class="tmx-dl-summary">
                        <span class="tmx-dl-summary-icon" aria-hidden="true">&#8681;</span>
                        <p id="tmxSummaryText">Every track your search returns, as one ZIP file.</p>
                    </div>

                    <section class="tmx-dl-section">
                        <h3>How many</h3>
                        <div class="tmx-seg" role="radiogroup" aria-label="How many tracks">
                            <label><input type="radio" name="tmxAmount" value="all" checked><span>All results</span></label>
                            <label><input type="radio" name="tmxAmount" value="limit"><span>A set number</span></label>
                        </div>
                        <div class="tmx-dl-fields">
                            <label class="tmx-dl-field tmx-dl-field-off" id="tmxCountField">
                                <span>How many tracks</span>
                                <input type="number" id="trackCount" min="1" placeholder="50" disabled>
                            </label>
                            <label class="tmx-dl-field">
                                <span>Skip the first</span>
                                <input type="number" id="startIndex" min="0" value="0">
                            </label>
                        </div>
                    </section>

                    <section class="tmx-dl-section">
                        <h3>Order</h3>
                        <div class="tmx-seg tmx-seg-3" role="radiogroup" aria-label="Track order">
                            <label><input type="radio" name="tmxOrder" value="default" checked><span>Search order</span></label>
                            <label><input type="radio" name="tmxOrder" value="shuffle"><span>Shuffled</span></label>
                            <label><input type="radio" name="tmxOrder" value="random"><span>Random sample</span></label>
                        </div>
                        <p class="tmx-dl-hint" id="tmxOrderHint">Tracks arrive in the order your search returned them.</p>
                    </section>

                    <section class="tmx-dl-section">
                        <h3>Output</h3>
                        <div class="tmx-seg" role="radiogroup" aria-label="Output format">
                            <label><input type="radio" name="tmxFormat" value="zip" checked><span>One ZIP file</span></label>
                            <label><input type="radio" name="tmxFormat" value="files"><span>Separate files</span></label>
                        </div>
                        <div class="tmx-dl-checks">
                            <label class="tmx-check">
                                <input type="checkbox" id="includeMetadata">
                                <span><strong>Include metadata</strong><small>A JSON file describing every track.</small></span>
                            </label>
                            <label class="tmx-check">
                                <input type="checkbox" id="createIdTxt">
                                <span><strong>Include an ID list</strong><small>A plain .txt listing every track ID.</small></span>
                            </label>
                            <label class="tmx-check tmx-check-sub tmx-check-off" id="tmxIdOnlyRow">
                                <input type="checkbox" id="idListOnly" disabled>
                                <span><strong>ID list only</strong><small>Skip the .gbx files entirely and just save the list.</small></span>
                            </label>
                        </div>
                    </section>

                    <details class="tmx-dl-adv" id="tmxAdvanced">
                        <summary>Search more than one exchange</summary>
                        <div class="tmx-dl-adv-body">
                            <label class="tmx-check">
                                <input type="checkbox" id="multiExchangeMode">
                                <span><strong>Multi-exchange mode</strong><small>Run the same search on several TMX sites and merge the results.</small></span>
                            </label>
                            <div id="exchangeSelector" class="tmx-dl-exchanges">
                                <label class="tmx-check tmx-check-tight"><input type="checkbox" class="exchange-checkbox" value="tmnf.exchange" checked><span><strong>TMNF-X</strong><small>Nations Forever</small></span></label>
                                <label class="tmx-check tmx-check-tight"><input type="checkbox" class="exchange-checkbox" value="tmuf.exchange" checked><span><strong>TMUF-X</strong><small>United Forever</small></span></label>
                                <label class="tmx-check tmx-check-tight"><input type="checkbox" class="exchange-checkbox" value="original.tm-exchange.com" checked><span><strong>TMO-X</strong><small>Original</small></span></label>
                                <label class="tmx-check tmx-check-tight"><input type="checkbox" class="exchange-checkbox" value="sunrise.tm-exchange.com" checked><span><strong>TMS-X</strong><small>Sunrise</small></span></label>
                                <label class="tmx-check tmx-check-tight"><input type="checkbox" class="exchange-checkbox" value="nations.tm-exchange.com" checked><span><strong>TMN-X</strong><small>Nations</small></span></label>
                            </div>
                        </div>
                    </details>

                    <section class="tmx-dl-section tmx-dl-progress-wrap" id="tmxProgressWrap" hidden>
                        <h3>Progress</h3>
                        <div class="tmx-progress" id="progressContainer">
                            <div id="progressBar" class="tmx-progress-bar">0%</div>
                            <div class="tmx-progress-tire" id="progressTire">&#127937;</div>
                            <div class="tmx-skid-container" id="skidContainer"></div>
                        </div>
                        <p class="tmx-dl-hint" id="progressText">Ready to download</p>
                    </section>

                    <!-- Mirrors of the old checkboxes, driven by the controls above. -->
                    <input type="checkbox" id="createZip" class="tmx-dl-mirror" checked tabindex="-1" aria-hidden="true">
                    <input type="checkbox" id="shuffleTracks" class="tmx-dl-mirror" tabindex="-1" aria-hidden="true">
                    <input type="checkbox" id="randomSelection" class="tmx-dl-mirror" tabindex="-1" aria-hidden="true">
                </div>

                <footer class="tmx-dl-foot">
                    <button type="button" id="viewStatistics" class="tmx-btn tmx-btn-ghost">&#128202; Statistics</button>
                    <div class="tmx-dl-foot-actions">
                        <button type="button" id="cancelDownload" class="tmx-btn tmx-btn-secondary">Close</button>
                        <button type="button" id="startDownload" class="tmx-btn">Start download</button>
                    </div>
                </footer>
            </div>
        `;

        document.body.appendChild(modal);

        wireModalControls(modal);
        
        // Event listeners
        modal.querySelector('#tmxCloseModal').addEventListener('click', handleCancel);
        document.getElementById('startDownload').addEventListener('click', handleDownload);
        document.getElementById('cancelDownload').addEventListener('click', handleCancel);
        document.getElementById('viewStatistics').addEventListener('click', async () => {
            // Create and show stats modal
            await createStatisticsModal();
            const statsModal = document.getElementById('tmx-stats-modal');
            statsModal.style.display = 'flex';
            
            // Fetch and analyze data
            const stats = await fetchAndAnalyzeAllTracks();
            
            if (stats) {
                // Hide loading, show content
                document.getElementById('statsLoading').style.display = 'none';
                document.getElementById('statsContent').style.display = 'block';
                
                // Render all charts
                renderStatisticsCharts(stats);
            } else {
                statsModal.style.display = 'none';
            }
        });


        document.getElementById('multiExchangeMode').addEventListener('change', (e) => {
            const selector = document.getElementById('exchangeSelector');
            selector.style.display = e.target.checked ? 'block' : 'none';
            
            // Update progress text
            const progressText = document.getElementById('progressText');
            if (e.target.checked) {
                progressText.textContent = 'Ready to download from multiple exchanges';
            } else {
                progressText.textContent = 'Ready to download';
            }
        });
        
        // Close on backdrop click (only when not downloading)
        modal.addEventListener('click', (e) => {
            if (e.target === modal && !TMX_STATE.abortController) {
                modal.style.display = 'none';
            }
        });
        
        console.log('[TMX] ✅ Modal created and attached');
        return modal;
    }

    // ============================================================================
// STATISTICS MODAL
// ============================================================================

async function createStatisticsModal() {
    // Remove old stats modal if exists
    const oldStatsModal = document.getElementById('tmx-stats-modal');
    if (oldStatsModal) {
        oldStatsModal.remove();
    }
    
    const statsModal = document.createElement('div');
    statsModal.id = 'tmx-stats-modal';
    statsModal.className = 'tmx-modal tmx-stats-modal';
    
    statsModal.innerHTML = `
        <div class="tmx-stats-modal-content">
            <div class="tmx-stats-header">
                <h2>📊 Track Statistics & Analytics</h2>
                <button id="closeStatsModal" class="tmx-close-btn">✕</button>
            </div>
            
            <div id="statsLoading" class="tmx-stats-loading">
                <div class="tmx-spinner"></div>
                <p>Analyzing tracks...</p>
            </div>
            
            <div id="statsContent" style="display: none;">
                <!-- Summary Cards -->
                <div class="tmx-stats-summary">
                    <div class="tmx-stat-card">
                        <div class="tmx-stat-icon">🏁</div>
                        <div class="tmx-stat-value" id="totalTracks">0</div>
                        <div class="tmx-stat-label">Total Tracks</div>
                    </div>
                    <div class="tmx-stat-card">
                        <div class="tmx-stat-icon">👤</div>
                        <div class="tmx-stat-value" id="totalAuthors">0</div>
                        <div class="tmx-stat-label">Unique Authors</div>
                    </div>
                    <div class="tmx-stat-card">
                        <div class="tmx-stat-icon">⭐</div>
                        <div class="tmx-stat-value" id="avgAward">0.0</div>
                        <div class="tmx-stat-label">Avg Awards</div>
                    </div>
                    <div class="tmx-stat-card">
                        <div class="tmx-stat-icon">🏆</div>
                        <div class="tmx-stat-value" id="topRated">-</div>
                        <div class="tmx-stat-label">Top Rated Track</div>
                    </div>
                </div>
                
                <!-- Tabs -->
                <div class="tmx-stats-tabs">
                    <button class="tmx-stats-tab active" data-tab="overview">Overview</button>
                    <button class="tmx-stats-tab" data-tab="authors">Top Authors</button>
                    <button class="tmx-stats-tab" data-tab="awards">Awards Analysis</button>
                    <button class="tmx-stats-tab" data-tab="difficulty">Difficulty</button>
                    <button class="tmx-stats-tab" data-tab="timeline">Timeline</button>
                    <button class="tmx-stats-tab" data-tab="environments">Tags</button>
                </div>
                
                <!-- Tab Content -->
                <div class="tmx-stats-panels">
                    <!-- Overview Tab -->
                    <div class="tmx-stats-panel active" data-panel="overview">
                        <div class="tmx-chart-container">
                            <h3>📈 Award Distribution</h3>
                            <canvas id="awardDistChart"></canvas>
                        </div>
                        <div class="tmx-chart-container">
                            <h3>📊 Track length (TMX length buckets)</h3>
                            <canvas id="lengthDistChart"></canvas>
                        </div>
                    </div>
                    
                    <!-- Top Authors Tab -->
                    <div class="tmx-stats-panel" data-panel="authors">
                        <div class="tmx-chart-container">
                            <h3>👥 Top 15 Track Authors</h3>
                            <canvas id="authorsChart"></canvas>
                        </div>
                        <div class="tmx-top-authors-list" id="authorsList"></div>
                    </div>
                    
                    <!-- Awards Analysis Tab -->
                    <div class="tmx-stats-panel" data-panel="awards">
                        <div class="tmx-chart-container">
                            <h3>⭐ Uploads and average awards by year</h3>
                            <canvas id="awardsScatterChart"></canvas>
                        </div>
                        <div class="tmx-chart-container">
                            <h3>🏆 Most Awarded Tracks</h3>
                            <div id="mostAwardedList"></div>
                        </div>
                    </div>
                    
                    <!-- Difficulty Tab -->
                    <div class="tmx-stats-panel" data-panel="difficulty">
                        <div class="tmx-chart-container">
                            <h3>🎯 Difficulty Distribution</h3>
                            <canvas id="difficultyChart"></canvas>
                        </div>
                        <div class="tmx-stats-grid">
                            <div class="tmx-stat-box">
                                <h4>Beginner Tracks</h4>
                                <p id="beginnerCount">0</p>
                            </div>
                            <div class="tmx-stat-box">
                                <h4>Intermediate Tracks</h4>
                                <p id="intermediateCount">0</p>
                            </div>
                            <div class="tmx-stat-box">
                                <h4>Expert Tracks</h4>
                                <p id="expertCount">0</p>
                            </div>
                            <div class="tmx-stat-box">
                                <h4>Lunatic Tracks</h4>
                                <p id="lunaticCount">0</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Timeline Tab -->
                    <div class="tmx-stats-panel" data-panel="timeline">
                        <div class="tmx-chart-container">
                            <h3>📅 Upload Timeline</h3>
                            <canvas id="timelineChart"></canvas>
                        </div>
                        <div class="tmx-stats-grid">
                            <div class="tmx-stat-box">
                                <h4>Oldest Track</h4>
                                <p id="oldestTrack">-</p>
                            </div>
                            <div class="tmx-stat-box">
                                <h4>Newest Track</h4>
                                <p id="newestTrack">-</p>
                            </div>
                        </div>
                    </div>
                    
                    <!-- Environments Tab -->
                    <div class="tmx-stats-panel" data-panel="environments">
                        <div class="tmx-chart-container">
                            <h3>🏷️ Tag frequency</h3>
                            <canvas id="environmentChart"></canvas>
                        </div>
                    </div>
                </div>
                
                <!-- Export Options -->
                <div class="tmx-stats-footer">
                    <button id="exportStatsCSV" class="tmx-btn tmx-btn-secondary">
                        📄 Export as CSV
                    </button>
                    <button id="exportStatsJSON" class="tmx-btn tmx-btn-secondary">
                        💾 Export as JSON
                    </button>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(statsModal);
    
    // Event listeners
    document.getElementById('closeStatsModal').addEventListener('click', () => {
        statsModal.style.display = 'none';
    });
    
    // Tab switching
    const tabs = statsModal.querySelectorAll('.tmx-stats-tab');
    const panels = statsModal.querySelectorAll('.tmx-stats-panel');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetPanel = tab.dataset.tab;
            
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            
            tab.classList.add('active');
            document.querySelector(`[data-panel="${targetPanel}"]`).classList.add('active');
        });
    });
    
    // Export buttons
    document.getElementById('exportStatsCSV').addEventListener('click', exportStatisticsCSV);
    document.getElementById('exportStatsJSON').addEventListener('click', exportStatisticsJSON);
    
    // Close on backdrop click
    statsModal.addEventListener('click', (e) => {
        if (e.target === statsModal) {
            statsModal.style.display = 'none';
        }
    });
    
    return statsModal;
}

// ============================================================================
// STATISTICS DATA PROCESSING
// ============================================================================

async function fetchAndAnalyzeAllTracks() {
    const apiUrl = getApiUrlSafe();
    if (!apiUrl) {
        alert('❌ No API URL found! Please perform a search first.');
        return null;
    }
    
    try {
        let tracks = [];
        
        // 🆕 Reuse cached data if available
        if (CACHED_TRACK_DATA && CACHED_TRACK_DATA.length > 0) {
            console.log(`[TMX] 📦 Using ${CACHED_TRACK_DATA.length} cached tracks`);
            tracks = [...CACHED_TRACK_DATA]; // Copy the array
            
            // 🆕 Check if we need to fetch MORE tracks
            // If cache has exactly 1000 tracks, there might be more
            if (tracks.length >= 1000) {
                console.log('[TMX] 🔄 Fetching remaining tracks beyond cached 1000...');
                
                const lastCachedId = tracks[tracks.length - 1].TrackId;
                const urlObj = new URL(apiUrl);
                urlObj.searchParams.set('after', lastCachedId.toString());
                urlObj.searchParams.set('count', '1000');
                
                const abortController = new AbortController();
                const remainingTracks = await fetchAllTracks(
                    urlObj.toString(), 
                    Infinity, 
                    abortController.signal
                );
                
                console.log(`[TMX] 📊 Fetched ${remainingTracks.length} additional tracks`);
                tracks = [...tracks, ...remainingTracks];
                
                // Update the cache with ALL tracks
                CACHED_TRACK_DATA = tracks;
            }
        } else {
            // 🆕 No cache - fetch everything
            console.log('[TMX] 🔄 No cache found, fetching all tracks...');
            const abortController = new AbortController();
            tracks = await fetchAllTracks(apiUrl, Infinity, abortController.signal);
            
            // Store in cache for future use
            CACHED_TRACK_DATA = tracks;
            console.log(`[TMX] 📦 Cached ${tracks.length} tracks`);
        }
        
        if (tracks.length === 0) {
            alert('❌ No tracks found in current search!');
            return null;
        }
        
        console.log(`[TMX] 📊 Analyzing ${tracks.length} total tracks`);
        
        // Process statistics (rest of your code remains the same)
        const stats = {
            totalTracks: tracks.length,
            tracks: tracks,
            
            // Author analysis
            authors: {},
            totalAuthors: 0,
            topAuthors: [],
            
            // Awards analysis
            totalAwards: 0,
            avgAward: 0,
            awardDistribution: {},
            topRatedTracks: [],
            
            // Difficulty analysis
            difficultyCount: {
                'Beginner': 0,
                'Intermediate': 0,
                'Expert': 0,
                'Lunatic': 0,
                'Unknown': 0
            },
            
            // Length analysis
            avgLength: 0,
            lengthBuckets: {},
            
            // Timeline analysis
            uploadDates: [],
            oldestTrack: null,
            newestTrack: null,
            
            // Tag analysis
            tagCounts: {},
            taggedTracks: 0
        };
        
    // Upper edge in seconds of each TMX length bucket, used only to place a
    // track that arrives without a `Length` value.
    const TMX_BUCKET_EDGES = [20, 37, 51, 66, 81, 96, 111, 130, 155, 186, 216, 255, 330];

        // Process each track
        tracks.forEach(track => {
            // Author stats
            const authorName = track.Uploader?.Name || 'Unknown';
            if (!stats.authors[authorName]) {
                stats.authors[authorName] = {
                    name: authorName,
                    trackCount: 0,
                    totalAwards: 0,
                    tracks: []
                };
            }
            stats.authors[authorName].trackCount++;
            stats.authors[authorName].totalAwards += track.Awards || 0;
            stats.authors[authorName].tracks.push(track.TrackName);
            
            // Award stats
            const awards = track.Awards || 0;
            stats.totalAwards += awards;
            stats.awardDistribution[awards] = (stats.awardDistribution[awards] || 0) + 1;
            
            // Difficulty stats
            const difficultyMap = {
                1: 'Beginner',
                2: 'Intermediate',
                3: 'Expert',
                4: 'Lunatic'
            };
            const difficultyNum = track.Difficulty;
            const difficultyString = difficultyMap[difficultyNum] || 'Unknown';
            
            if (stats.difficultyCount.hasOwnProperty(difficultyString)) {
                stats.difficultyCount[difficultyString]++;
            } else {
                stats.difficultyCount['Unknown']++;
            }
            
            // Length stats. TMX's own bucket (`Length`, 0-13) is the only
            // trustworthy signal - the catalogue's AuthorTime holds negatives,
            // INT_MIN, INT_MAX and multi-day values. Fall back to the author
            // time only when the bucket is missing, and only if it is sane.
            let bucket = track.Length;
            if (!Number.isInteger(bucket) || bucket < 0 || bucket > 13) {
                const secs = Math.round((track.AuthorTime || 0) / 1000);
                bucket = (secs > 0 && secs < 36000)
                    ? TMX_BUCKET_EDGES.findIndex((edge) => secs <= edge)
                    : -1;
                if (bucket === -1) bucket = (secs > 0 && secs < 36000) ? 13 : null;
            }
            if (bucket !== null) {
                stats.lengthBuckets[bucket] = (stats.lengthBuckets[bucket] || 0) + 1;
            }
            
            // Timeline stats
            if (track.UploadedAt) {
                const date = new Date(track.UploadedAt);
                stats.uploadDates.push(date);
                
                if (!stats.oldestTrack || date < new Date(stats.oldestTrack.UploadedAt)) {
                    stats.oldestTrack = track;
                }
                if (!stats.newestTrack || date > new Date(stats.newestTrack.UploadedAt)) {
                    stats.newestTrack = track;
                }
            }
            
            // Tag stats. `Tags` is an array and a map can carry several, so a
            // track contributes to every tag it holds. `Style` is the legacy
            // single-tag field kept for older uploads. `PrimaryType` is the
            // track TYPE (Race/Platform/Puzzle) and is deliberately not used.
            let trackTags = [];
            if (Array.isArray(track.Tags) && track.Tags.length > 0) {
                trackTags = [...new Set(track.Tags)];
            } else if (track.Style !== null && track.Style !== undefined && track.Style !== -1) {
                trackTags = [track.Style];
            }
            if (trackTags.length > 0) {
                stats.taggedTracks++;
                for (const tag of trackTags) {
                    stats.tagCounts[tag] = (stats.tagCounts[tag] || 0) + 1;
                }
            }
        });
        
        // Calculate derived stats
        stats.totalAuthors = Object.keys(stats.authors).length;
        stats.avgAward = tracks.length > 0 ? (stats.totalAwards / tracks.length).toFixed(2) : 0;
        // A mean over AuthorTime is meaningless when a single INT_MAX row can
        // dominate it; take the median of the plausible values instead.
        const sane = tracks
            .map((t2) => (t2.AuthorTime || 0) / 1000)
            .filter((s) => s > 0 && s < 36000)
            .sort((a, b) => a - b);
        stats.avgLength = sane.length ? sane[Math.floor(sane.length / 2)] : 0;
        
        // Top authors
        stats.topAuthors = Object.values(stats.authors)
            .sort((a, b) => b.trackCount - a.trackCount)
            .slice(0, 15);
        
        // Top rated tracks
        stats.topRatedTracks = [...tracks]
            .sort((a, b) => (b.Awards || 0) - (a.Awards || 0))
            .slice(0, 10);
        
        return stats;
        
    } catch (error) {
        console.error('[TMX] Error analyzing tracks:', error);
        alert(`❌ Error analyzing tracks: ${error.message}`);
        return null;
    }
}

// ============================================================================
// CHART RENDERING
// ============================================================================

function renderStatisticsCharts(stats) {
    // Chart.js is bundled with this extension (chart.min.js, declared in the
    // manifest's content_scripts). No script is ever fetched from a remote origin.
    if (!window.Chart) {
        console.error('[TMX] Bundled Chart.js (chart.min.js) is not available.');
        alert('❌ Charts are unavailable: the bundled Chart.js library did not load.');
        return;
    }
    renderAllCharts(stats);
}

function renderAllCharts(stats) {
    // Update summary cards
    document.getElementById('totalTracks').textContent = stats.totalTracks.toLocaleString();
    document.getElementById('totalAuthors').textContent = stats.totalAuthors.toLocaleString();
    document.getElementById('avgAward').textContent = stats.avgAward;
    document.getElementById('topRated').textContent = stats.topRatedTracks[0]?.TrackName || 'N/A';
    
    // 1. Award Distribution Chart
    renderAwardDistribution(stats);
    
    // 2. Length Distribution Chart
    renderLengthDistribution(stats);
    
    // 3. Top Authors Chart
    renderTopAuthors(stats);
    
    // 4. Awards Scatter Chart
    renderAwardsScatter(stats);
    
    // 5. Most Awarded Tracks List
    renderMostAwardedList(stats);
    
    // 6. Difficulty Chart
    renderDifficultyChart(stats);
    
    // 7. Timeline Chart
    renderTimelineChart(stats);
    
    // 8. Environment Chart
    renderEnvironmentChart(stats);
    
    // Update difficulty counts
    document.getElementById('beginnerCount').textContent = stats.difficultyCount.Beginner;
    document.getElementById('intermediateCount').textContent = stats.difficultyCount.Intermediate;
    document.getElementById('expertCount').textContent = stats.difficultyCount.Expert;
    document.getElementById('lunaticCount').textContent = stats.difficultyCount.Lunatic;
    
    // Update timeline info
    if (stats.oldestTrack) {
        document.getElementById('oldestTrack').textContent = 
            `${stats.oldestTrack.TrackName} (${new Date(stats.oldestTrack.UploadedAt).toLocaleDateString()})`;
    }
    if (stats.newestTrack) {
        document.getElementById('newestTrack').textContent = 
            `${stats.newestTrack.TrackName} (${new Date(stats.newestTrack.UploadedAt).toLocaleDateString()})`;
    }
}

// ============================================================================
// CHART THEME
//
// One palette and one set of defaults for every chart, so the statistics view
// reads as a single thing rather than eight unrelated pictures. Chart.js is
// bundled at v3.9.1; nothing here needs a date adapter, which is why the
// time-based charts use categorical axes.
// ============================================================================

/** Ordered categorical palette - distinct in hue and in lightness. */
const TMX_PALETTE = [
    '#3b82f6', '#f97316', '#10b981', '#a855f7',
    '#ef4444', '#eab308', '#06b6d4', '#ec4899',
    '#84cc16', '#6366f1',
];

/** Sequential ramp for "more is more" bar charts. */
const TMX_RAMP = ['#bfdbfe', '#93c5fd', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8'];

function tmxChartTheme() {
    // TMX ships a light and a dark skin. Read the actual rendered background
    // rather than guessing, so the charts follow whichever the user is on.
    let dark = false;
    try {
        const bg = getComputedStyle(document.body).backgroundColor || '';
        const m = bg.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
        if (m) {
            const [r, g, b] = [+m[1], +m[2], +m[3]];
            dark = (0.299 * r + 0.587 * g + 0.114 * b) < 128;
        }
    } catch (e) { /* keep the light defaults */ }

    return {
        dark,
        text: dark ? 'rgba(235, 237, 243, 0.85)' : 'rgba(30, 33, 40, 0.85)',
        muted: dark ? 'rgba(235, 237, 243, 0.55)' : 'rgba(30, 33, 40, 0.55)',
        grid: dark ? 'rgba(235, 237, 243, 0.10)' : 'rgba(30, 33, 40, 0.10)',
        surface: dark ? '#20242c' : '#ffffff',
    };
}

/** Shared options - axis styling, tooltips and the bits every chart repeats. */
function tmxChartOptions(extra) {
    const t = tmxChartTheme();
    const base = {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 350 },
        layout: { padding: { top: 4, right: 6, bottom: 0, left: 0 } },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: t.dark ? 'rgba(12, 14, 18, 0.95)' : 'rgba(20, 22, 28, 0.95)',
                titleColor: '#fff',
                bodyColor: 'rgba(255, 255, 255, 0.85)',
                borderColor: 'rgba(255, 255, 255, 0.15)',
                borderWidth: 1,
                padding: 10,
                cornerRadius: 6,
                displayColors: false,
                titleFont: { size: 12, weight: '600' },
                bodyFont: { size: 12 },
            },
        },
        scales: {
            x: {
                grid: { display: false, drawBorder: false },
                ticks: { color: t.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
            },
            y: {
                beginAtZero: true,
                grid: { color: t.grid, drawBorder: false, drawTicks: false },
                ticks: { color: t.muted, font: { size: 11 }, padding: 8, precision: 0 },
            },
        },
    };
    return tmxMergeDeep(base, extra || {});
}

function tmxMergeDeep(target, source) {
    const out = Array.isArray(target) ? target.slice() : Object.assign({}, target);
    for (const key of Object.keys(source)) {
        const a = out[key];
        const b = source[key];
        out[key] = (b && typeof b === 'object' && !Array.isArray(b) && a && typeof a === 'object' && !Array.isArray(a))
            ? tmxMergeDeep(a, b)
            : b;
    }
    return out;
}

/** Re-opening the stats view must not trip "Canvas is already in use". */
function tmxCanvas(id) {
    const ctx = document.getElementById(id);
    if (!ctx) return null;
    const existing = (typeof Chart.getChart === 'function') ? Chart.getChart(ctx) : null;
    if (existing) existing.destroy();
    return ctx;
}

const tmxNum = (n) => Number(n || 0).toLocaleString();

// ============================================================================
// CHARTS
// ============================================================================

/**
 * Raw award counts have a very long tail - a handful of tracks with hundreds of
 * awards and thousands with none - so plotting one bar per integer buries the
 * shape. These bands show the distribution people actually care about.
 */
const AWARD_BANDS = [
    { label: 'None', test: (a) => a === 0 },
    { label: '1', test: (a) => a === 1 },
    { label: '2', test: (a) => a === 2 },
    { label: '3-5', test: (a) => a >= 3 && a <= 5 },
    { label: '6-10', test: (a) => a >= 6 && a <= 10 },
    { label: '11-25', test: (a) => a >= 11 && a <= 25 },
    { label: '26-50', test: (a) => a >= 26 && a <= 50 },
    { label: '51-100', test: (a) => a >= 51 && a <= 100 },
    { label: '100+', test: (a) => a > 100 },
];

function renderAwardDistribution(stats) {
    const ctx = tmxCanvas('awardDistChart');
    if (!ctx) return;

    const counts = AWARD_BANDS.map(() => 0);
    for (const [award, n] of Object.entries(stats.awardDistribution)) {
        const value = parseInt(award, 10);
        const idx = AWARD_BANDS.findIndex((b) => b.test(value));
        if (idx >= 0) counts[idx] += n;
    }

    const total = counts.reduce((a, b) => a + b, 0) || 1;

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: AWARD_BANDS.map((b) => b.label),
            datasets: [{
                data: counts,
                backgroundColor: counts.map((_, i) => TMX_RAMP[Math.min(i, TMX_RAMP.length - 1)]),
                borderRadius: 4,
                borderSkipped: false,
            }],
        },
        options: tmxChartOptions({
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) => items[0].label + ' awards',
                        label: (item) => `${tmxNum(item.parsed.y)} tracks (${(item.parsed.y / total * 100).toFixed(1)}%)`,
                    },
                },
            },
            scales: { x: { title: { display: true, text: 'Awards received', color: tmxChartTheme().muted, font: { size: 11 } } } },
        }),
    });
}

/**
 * TMX publishes its own length bucket on every track (`Length`, 0-13) and it is
 * the only length signal worth trusting - the raw author time in the catalogue
 * contains negatives, INT_MIN, INT_MAX and multi-day values, which is what made
 * the old "seconds" histogram unreadable.
 */
const TMX_LENGTH_LABELS = [
    'to 20s', '20-37s', '37-51s', '51-66s', '1:06-1:21', '1:21-1:36', '1:36-1:51',
    '1:51-2:10', '2:10-2:35', '2:35-3:06', '3:06-3:36', '3:36-4:15', '4:15-5:30', '5:30+',
];

function renderLengthDistribution(stats) {
    const ctx = tmxCanvas('lengthDistChart');
    if (!ctx) return;

    const counts = TMX_LENGTH_LABELS.map((_, i) => stats.lengthBuckets[i] || 0);
    const total = counts.reduce((a, b) => a + b, 0) || 1;
    const peak = Math.max(...counts);

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: TMX_LENGTH_LABELS,
            datasets: [{
                data: counts,
                // Highlight the modal bucket; everything else recedes.
                backgroundColor: counts.map((c) => (c === peak && peak > 0 ? '#3b82f6' : 'rgba(59, 130, 246, 0.45)')),
                borderRadius: 4,
                borderSkipped: false,
            }],
        },
        options: tmxChartOptions({
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) => 'Length ' + items[0].label,
                        label: (item) => `${tmxNum(item.parsed.y)} tracks (${(item.parsed.y / total * 100).toFixed(1)}%)`,
                    },
                },
            },
            scales: { x: { ticks: { maxRotation: 45, minRotation: 45, font: { size: 10 } } } },
        }),
    });
}

function renderTopAuthors(stats) {
    const ctx = tmxCanvas('authorsChart');
    if (ctx) {
        new Chart(ctx, {
            type: 'bar',
            data: {
                labels: stats.topAuthors.map((a) => a.name),
                datasets: [{
                    data: stats.topAuthors.map((a) => a.trackCount),
                    backgroundColor: '#a855f7',
                    borderRadius: 4,
                    borderSkipped: false,
                }],
            },
            options: tmxChartOptions({
                indexAxis: 'y',
                scales: {
                    x: { beginAtZero: true, grid: { color: tmxChartTheme().grid, drawBorder: false }, ticks: { color: tmxChartTheme().muted, font: { size: 11 }, precision: 0 } },
                    y: { grid: { display: false, drawBorder: false }, ticks: { color: tmxChartTheme().text, font: { size: 11 } } },
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (item) => {
                                const a = stats.topAuthors[item.dataIndex];
                                return `${tmxNum(a.trackCount)} tracks · ${tmxNum(a.totalAwards)} awards`;
                            },
                        },
                    },
                },
            }),
        });
    }

    const authorsList = document.getElementById('authorsList');
    if (!authorsList) return;
    const max = Math.max(1, ...stats.topAuthors.map((a) => a.trackCount));
    authorsList.innerHTML = stats.topAuthors.map((author, idx) => `
        <div class="tmx-author-item">
            <span class="tmx-author-rank">${idx + 1}</span>
            <span class="tmx-author-name" title="${tmxEscape(author.name)}">${tmxEscape(author.name)}</span>
            <span class="tmx-author-bar"><i style="width:${(author.trackCount / max * 100).toFixed(1)}%"></i></span>
            <span class="tmx-author-tracks">${tmxNum(author.trackCount)}</span>
            <span class="tmx-author-awards">${tmxNum(author.totalAwards)} &#9733;</span>
        </div>
    `).join('');
}

function tmxEscape(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The old chart here plotted awards against the track's index in the result
 * array, which carries no meaning at all. Awards per upload year does: it shows
 * whether the community is still awarding recent maps or mostly older ones.
 */
function renderAwardsScatter(stats) {
    const ctx = tmxCanvas('awardsScatterChart');
    if (!ctx) return;

    const byYear = new Map();
    for (const track of stats.tracks) {
        if (!track.UploadedAt) continue;
        const year = new Date(track.UploadedAt).getFullYear();
        if (!Number.isFinite(year) || year < 2004 || year > 2100) continue;
        if (!byYear.has(year)) byYear.set(year, { total: 0, awards: 0 });
        const b = byYear.get(year);
        b.total += 1;
        b.awards += track.Awards || 0;
    }

    const years = [...byYear.keys()].sort((a, b) => a - b);
    const avg = years.map((y) => {
        const b = byYear.get(y);
        return b.total ? +(b.awards / b.total).toFixed(2) : 0;
    });
    const volume = years.map((y) => byYear.get(y).total);
    const t = tmxChartTheme();

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: years,
            datasets: [
                {
                    type: 'bar',
                    label: 'Tracks uploaded',
                    data: volume,
                    backgroundColor: 'rgba(59, 130, 246, 0.28)',
                    borderRadius: 3,
                    borderSkipped: false,
                    yAxisID: 'y',
                    order: 2,
                },
                {
                    type: 'line',
                    label: 'Average awards',
                    data: avg,
                    borderColor: '#f97316',
                    backgroundColor: '#f97316',
                    borderWidth: 2,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    tension: 0.3,
                    yAxisID: 'y1',
                    order: 1,
                },
            ],
        },
        options: tmxChartOptions({
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    align: 'end',
                    labels: { color: t.muted, boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } },
                },
                tooltip: { displayColors: true },
            },
            scales: {
                y: {
                    position: 'left',
                    title: { display: true, text: 'Tracks uploaded', color: t.muted, font: { size: 11 } },
                },
                y1: {
                    position: 'right',
                    beginAtZero: true,
                    grid: { drawOnChartArea: false, drawBorder: false },
                    ticks: { color: t.muted, font: { size: 11 } },
                    title: { display: true, text: 'Avg awards', color: t.muted, font: { size: 11 } },
                },
            },
        }),
    });
}

const TMX_DIFFICULTY_COLORS = {
    Beginner: '#10b981',
    Intermediate: '#eab308',
    Expert: '#f97316',
    Lunatic: '#ef4444',
    Unknown: '#8b8d98',
};

function renderMostAwardedList(stats) {
    const container = document.getElementById('mostAwardedList');
    if (!container) return;

    const tracks = stats.topRatedTracks || [];
    if (!tracks.length) {
        container.innerHTML = '<p class="tmx-dl-hint">No awarded tracks in these results.</p>';
        return;
    }

    // Escape names - they come straight from user-supplied track titles.
    const max = Math.max(1, ...tracks.map((t) => t.Awards || 0));
    container.innerHTML = tracks.map((track, idx) => `
        <a class="tmx-awarded-track" href="/trackshow/${encodeURIComponent(track.TrackId)}" title="${tmxEscape(track.TrackName)}">
            <span class="tmx-track-rank">${idx + 1}</span>
            <span class="tmx-track-info">
                <span class="tmx-track-name">${tmxEscape(track.TrackName)}</span>
                <span class="tmx-track-author">by ${tmxEscape(track.Uploader && track.Uploader.Name ? track.Uploader.Name : 'Unknown')}</span>
            </span>
            <span class="tmx-track-bar"><i style="width:${((track.Awards || 0) / max * 100).toFixed(1)}%"></i></span>
            <span class="tmx-track-awards">${tmxNum(track.Awards || 0)} &#9733;</span>
        </a>
    `).join('');
}

function renderDifficultyChart(stats) {
    const ctx = tmxCanvas('difficultyChart');
    if (!ctx) return;

    const order = ['Beginner', 'Intermediate', 'Expert', 'Lunatic', 'Unknown'];
    const labels = order.filter((d) => (stats.difficultyCount[d] || 0) > 0);
    const data = labels.map((d) => stats.difficultyCount[d]);
    const total = data.reduce((a, b) => a + b, 0) || 1;
    const t = tmxChartTheme();

    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{
                data,
                backgroundColor: labels.map((d) => TMX_DIFFICULTY_COLORS[d] || '#8b8d98'),
                borderColor: t.surface,
                borderWidth: 2,
                hoverOffset: 6,
            }],
        },
        options: tmxChartOptions({
            cutout: '58%',
            scales: {},
            plugins: {
                legend: {
                    display: true,
                    position: 'bottom',
                    labels: { color: t.text, boxWidth: 10, boxHeight: 10, usePointStyle: true, padding: 14, font: { size: 11 } },
                },
                tooltip: {
                    displayColors: true,
                    callbacks: {
                        label: (item) => `${tmxNum(item.parsed)} tracks (${(item.parsed / total * 100).toFixed(1)}%)`,
                    },
                },
            },
        }),
    });
}

function renderTimelineChart(stats) {
    const ctx = tmxCanvas('timelineChart');
    if (!ctx) return;

    const monthCounts = {};
    stats.uploadDates.forEach((date) => {
        if (!(date instanceof Date) || isNaN(date)) return;
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthCounts[key] = (monthCounts[key] || 0) + 1;
    });

    const months = Object.entries(monthCounts).sort(([a], [b]) => a.localeCompare(b));
    const t = tmxChartTheme();

    new Chart(ctx, {
        type: 'line',
        data: {
            labels: months.map(([m]) => m),
            datasets: [{
                data: months.map(([, c]) => c),
                fill: true,
                backgroundColor: 'rgba(59, 130, 246, 0.16)',
                borderColor: '#3b82f6',
                borderWidth: 2,
                tension: 0.3,
                pointRadius: months.length > 60 ? 0 : 2,
                pointHoverRadius: 5,
            }],
        },
        options: tmxChartOptions({
            interaction: { mode: 'index', intersect: false },
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (items) => {
                            const [y, m] = items[0].label.split('-');
                            const name = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                                'August', 'September', 'October', 'November', 'December'][+m - 1];
                            return `${name} ${y}`;
                        },
                        label: (item) => `${tmxNum(item.parsed.y)} tracks uploaded`,
                    },
                },
            },
            scales: {
                x: { ticks: { maxTicksLimit: 12, font: { size: 10 }, color: t.muted } },
                y: { title: { display: true, text: 'Tracks uploaded', color: t.muted, font: { size: 11 } } },
            },
        }),
    });
}

const TMX_STYLE_NAMES = {
    0: 'Normal', 1: 'Stunt', 2: 'Maze', 3: 'Offroad', 4: 'Laps', 5: 'Fullspeed',
    6: 'LOL', 7: 'Tech', 8: 'SpeedTech', 9: 'RPG', 10: 'PressForward',
    11: 'Trial', 12: 'Grass', Unknown: 'Unknown',
};

/**
 * Tag frequency.
 *
 * This chart used to read `track.PrimaryType` - the TrackMania *track type*,
 * which is "Race" for very nearly every map - and then look it up in a table of
 * tag names. That is why the legend showed tags while the arc was 100% one
 * slice. Tags live in `track.Tags` (an array; a map can carry several), with
 * the legacy single `track.Style` as a fallback.
 *
 * Because one map can hold several tags the counts do not sum to the number of
 * tracks, so this is a bar chart rather than a doughnut.
 */
/** Canonical TMX tag ids, from /api/meta/tags. Identical on all five sites. */
const TMX_TAG_NAMES = {
    0: 'Race', 1: 'Stunt', 2: 'Maze', 3: 'Offroad', 4: 'Multilap', 5: 'FullSpeed',
    6: 'LOL', 7: 'Tech', 8: 'SpeedTech', 9: 'RPG', 10: 'PressForward', 11: 'Trial',
    12: 'Grass', 13: 'Story', 14: 'Nascar', 15: 'Speedfun', 16: 'Endurance',
    17: 'Altered Nadeo', 18: 'Transitional',
};

function renderEnvironmentChart(stats) {
    const ctx = tmxCanvas('environmentChart');
    if (!ctx) return;

    const entries = Object.entries(stats.tagCounts || {})
        .map(([id, count]) => [TMX_TAG_NAMES[id] || ('Tag ' + id), count])
        .sort((a, b) => b[1] - a[1]);

    const tagged = stats.taggedTracks || 0;
    const t = tmxChartTheme();

    if (!entries.length) {
        const wrap = ctx.parentNode;
        if (wrap) wrap.insertAdjacentHTML('beforeend',
            '<p class="tmx-dl-hint">None of these tracks carry a tag.</p>');
        return;
    }

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: entries.map(([name]) => name),
            datasets: [{
                data: entries.map(([, c]) => c),
                backgroundColor: entries.map((_, i) => TMX_PALETTE[i % TMX_PALETTE.length]),
                borderRadius: 4,
                borderSkipped: false,
            }],
        },
        options: tmxChartOptions({
            indexAxis: 'y',
            scales: {
                x: {
                    beginAtZero: true,
                    grid: { color: t.grid, drawBorder: false },
                    ticks: { color: t.muted, font: { size: 11 }, precision: 0 },
                    title: { display: true, text: 'Tracks carrying the tag', color: t.muted, font: { size: 11 } },
                },
                y: {
                    grid: { display: false, drawBorder: false },
                    ticks: { color: t.text, font: { size: 11 } },
                },
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        label: (item) => {
                            const n = item.parsed.x;
                            const pct = tagged ? ` (${(n / tagged * 100).toFixed(1)}% of tagged tracks)` : '';
                            return `${tmxNum(n)} tracks${pct}`;
                        },
                    },
                },
            },
        }),
    });
}


// ============================================================================
// EXPORT FUNCTIONS
// ============================================================================

function exportStatisticsCSV() {
    if (!CACHED_TRACK_DATA) return;
    
    const headers = ['Track ID', 'Track Name', 'Author', 'Awards', 'Difficulty', 'Length (s)', 'Upload Date', 'Environment'];
    const rows = CACHED_TRACK_DATA.map(track => [
        track.TrackId,
        `"${track.TrackName.replace(/"/g, '""')}"`,
        `"${(track.Uploader?.Name || 'Unknown').replace(/"/g, '""')}"`,
        track.Awards || 0,
        track.Difficulty || 'Unknown',
        Math.round((track.AuthorTime || 0) / 1000),
        track.UploadedAt || '',
        track.Environment || track.Style || 'Unknown'
    ]);
    
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TMX_Statistics_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function exportStatisticsJSON() {
    if (!CACHED_TRACK_DATA) return;
    
    const json = JSON.stringify(CACHED_TRACK_DATA, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TMX_Statistics_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
}

    // ============================================================================
    // DOWNLOAD LOGIC
    // ============================================================================
    
    async function handleDownload() {
        const apiUrl = getApiUrlSafe();
        const multiMode = document.getElementById('multiExchangeMode')?.checked;
        
        if (!multiMode && !apiUrl) {
            alert('❌ No API URL available!\n\nPlease:\n1. Click "Apply Filters" or "Search"\n2. Wait for results to load\n3. Try again');
            return;
        }
        
        // Get selected exchanges
        const selectedExchanges = getSelectedExchanges();
        
        if (selectedExchanges.length === 0) {
            alert('❌ No exchanges selected!\n\nPlease select at least one exchange to download from.');
            return;
        }
        
        // Get download options
        const shuffleTracks = document.getElementById('shuffleTracks').checked;
        const randomSelection = document.getElementById('randomSelection').checked;
        const trackCountInput = document.getElementById('trackCount').value;
        const startIndex = parseInt(document.getElementById('startIndex').value || '0', 10);
        const createZip = document.getElementById('createZip').checked;
        const includeMetadata = document.getElementById('includeMetadata').checked;
        const createIdTxt = document.getElementById('createIdTxt')?.checked;
        const idListOnly = document.getElementById('idListOnly')?.checked;
        const effectiveCreateIdTxt = idListOnly ? true : createIdTxt;
        
        // Prepare UI
        const startBtn = document.getElementById('startDownload');
        const cancelBtn = document.getElementById('cancelDownload');
        const downloadBtn = document.querySelector('.tmx-downloader-btn');
        
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = '⏳ Downloading...';
        }
        if (startBtn) {
            startBtn.textContent = '✅ Download Complete';
            startBtn.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
        }
        if (cancelBtn) {
            cancelBtn.textContent = 'Stop';
        }
        if (downloadBtn) {
            downloadBtn.disabled = true;
            downloadBtn.textContent = '⏳ Downloading...';
        }
        
        TMX_STATE.abortController = new AbortController();
        const signal = TMX_STATE.abortController.signal;
        
        let zip;
        if (createZip && !idListOnly) {
            try {
                await loadJSZip();
                zip = new JSZip();
            } catch (error) {
                console.error('[TMX] ❌ Failed to load JSZip:', error);
                alert('❌ Error loading ZIP library. Please try again later.');
                resetDownloadUI();
                return;
            }
        }
        
        let allDownloadedTracks = [];
        
        try {
            const maxTrackCount = trackCountInput ? parseInt(trackCountInput, 10) : Infinity;
            
            // Process each exchange
            for (let i = 0; i < selectedExchanges.length; i++) {
                if (signal.aborted) break;
                
                const exchange = selectedExchanges[i];
                console.log(`[TMX] 📡 Processing ${exchange.name} (${i + 1}/${selectedExchanges.length})`);
                
                // Build API URL for this exchange
                let currentApiUrl;
                if (multiMode) {
                    const currentUrl = new URL(apiUrl || window.location.href);
                    const params = currentUrl.searchParams;
                    
                    const newUrl = new URL(exchange.apiBase);
                    params.forEach((value, key) => {
                        newUrl.searchParams.set(key, value);
                    });
                    currentApiUrl = newUrl.toString();
                } else {
                    currentApiUrl = apiUrl;
                }
                
                updateProgress(
                    (i / selectedExchanges.length) * 100,
                    `Fetching from ${exchange.name}...`
                );
                
                // Fetch tracks from this exchange
                let exchangeTracks = [];

                if (!multiMode && currentApiUrl === getApiUrlSafe() && CACHED_TRACK_DATA && CACHED_TRACK_DATA.length > 0) {
                    console.log(`[TMX] 📦 Reusing ${CACHED_TRACK_DATA.length} cached tracks for download`);
                    exchangeTracks = [...CACHED_TRACK_DATA];
                    
                    const effectiveMaxFetch = maxTrackCount === Infinity ? Infinity : (startIndex + maxTrackCount);
                    if (exchangeTracks.length < effectiveMaxFetch) {
                        console.log('[TMX] 🔄 Need more tracks than cached, fetching additional...');
                        const lastCachedId = exchangeTracks[exchangeTracks.length - 1].TrackId;
                        const urlObj = new URL(currentApiUrl);
                        urlObj.searchParams.set('after', lastCachedId.toString());
                        urlObj.searchParams.set('count', '1000');
                        
                        const remainingTracks = await fetchAllTracks(urlObj.toString(), effectiveMaxFetch - exchangeTracks.length, signal);
                        exchangeTracks = [...exchangeTracks, ...remainingTracks];
                        
                        CACHED_TRACK_DATA = exchangeTracks;
                    }
                } else {
                    console.log(`[TMX] 🔄 Fetching fresh tracks from ${exchange.name}...`);
                    const effectiveMaxFetch = maxTrackCount === Infinity ? Infinity : (startIndex + maxTrackCount);
                    exchangeTracks = await fetchAllTracks(currentApiUrl, effectiveMaxFetch, signal);
                }
                
                console.log(`[TMX] 📊 Fetched ${exchangeTracks.length} tracks from ${exchange.name}`);
                
                if (exchangeTracks.length === 0) {
                    console.log(`[TMX] ⚠️ No tracks found on ${exchange.name}`);
                    continue;
                }
                
                exchangeTracks = exchangeTracks.slice(startIndex, startIndex + maxTrackCount);

                if (idListOnly) {
                    console.log(`[TMX] ⏭️ Skipping binary download for ${exchangeTracks.length} tracks (ID Only Mode)`);
                    
                    exchangeTracks.forEach(t => {
                        allDownloadedTracks.push({...t, exchange: exchange.name});
                    });
                    
                    updateProgress(
                        ((i + 1) / selectedExchanges.length) * 100, 
                        `Collected IDs from ${exchange.name}`
                    );
                    
                    continue; 
                }
                
                updateProgress(
                    ((i + 0.5) / selectedExchanges.length) * 100,
                    `Downloading from ${exchange.name}: 0/${exchangeTracks.length}`
                );
                
                const CONCURRENT_DOWNLOADS = 10;
                const downloadQueue = [...exchangeTracks];
                const activeDownloads = new Set();
                let downloadedCount = 0;
                
                async function downloadTrack(track) {
                    if (signal.aborted) throw new DOMException('Download aborted', 'AbortError');
                    
                    try {
                        const fileUrl = `${exchange.apiBase.replace('/api/tracks', '')}/trackgbx/${track.TrackId}`;
                        const blob = await proxyFetchBinary(fileUrl);
                        const filename = sanitizeFilename(`${track.TrackName} by ${track.Uploader?.Name || 'Unknown'}.gbx`);
                        
                        if (createZip) {
                            const folderPath = `${exchange.name}/${filename}`;
                            zip.file(folderPath, blob);
                            
                            if (includeMetadata) {
                                const metaPath = `${exchange.name}/${filename.replace('.gbx', '.json')}`;
                                zip.file(metaPath, JSON.stringify({...track, exchange: exchange.name}));
                            }
                        } else {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `[${exchange.name}] ${filename}`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                        
                        allDownloadedTracks.push({...track, exchange: exchange.name});
                        downloadedCount++;
                        
                        updateProgress(
                            ((i + (downloadedCount / exchangeTracks.length)) / selectedExchanges.length) * 100,
                            `${exchange.name}: ${downloadedCount}/${exchangeTracks.length} tracks`
                        );
                    } catch (error) {
                        if (error.name === 'AbortError') throw error;
                        console.error(`[TMX] ⚠️ Error downloading track ${track.TrackId}:`, error);
                    }
                }
                
                while (downloadQueue.length > 0 || activeDownloads.size > 0) {
                    if (signal.aborted) break;
                    
                    while (activeDownloads.size < CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
                        const track = downloadQueue.shift();
                        const promise = downloadTrack(track).finally(() => activeDownloads.delete(promise));
                        activeDownloads.add(promise);
                    }
                    
                    if (activeDownloads.size > 0) {
                        await Promise.race(activeDownloads);
                    }
                }
                
                if (activeDownloads.size > 0) {
                    await Promise.allSettled(activeDownloads);
                }
            }
            
            // Apply shuffle/random to final collection
            if (shuffleTracks && allDownloadedTracks.length > 0) {
                console.log('[TMX] 🔀 Shuffling final track collection');
            } else if (randomSelection && maxTrackCount !== Infinity && allDownloadedTracks.length > maxTrackCount) {
                allDownloadedTracks = shuffleArray(allDownloadedTracks).slice(0, maxTrackCount);
                console.log(`[TMX] 🎲 Random selection: ${allDownloadedTracks.length} tracks`);
            }
            
            // Save metadata
            if (createZip && includeMetadata && allDownloadedTracks.length > 0) {
                zip.file('_all_metadata.json', JSON.stringify(allDownloadedTracks, null, 2));
            }

           if (effectiveCreateIdTxt && allDownloadedTracks.length > 0) {
                const idListContent = allDownloadedTracks.map(t => t.TrackId).join('\n');
                const txtFilename = multiMode ? 'track_ids.txt' : `${selectedExchanges[0]?.name || 'tmx'}_track_ids.txt`;

                if (idListOnly || !createZip) {
                    const blob = new Blob([idListContent], { type: 'text/plain' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = txtFilename;
                    a.click();
                    URL.revokeObjectURL(url);
                } else {
                    // Ansonsten ins ZIP packen
                    zip.file(txtFilename, idListContent);
                }
            }
            // ----------------------------------------------------------------

            updateProgress(100, `✅ Complete! ${allDownloadedTracks.length} tracks downloaded from ${selectedExchanges.length} exchange(s).`);
            
            // Generate ZIP
            if (createZip && !idListOnly && allDownloadedTracks.length > 0) {
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                
                const zipName = multiMode 
                    ? `Best_of_All_TMX_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
                    : generateZipName(selectedExchanges[0].name);
                
                a.download = zipName;
                a.click();
                URL.revokeObjectURL(url);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[TMX] ❌ Download failed:', error);
                alert(`❌ Download failed:\n${error.message}`);
            }
        } finally {
            if (createZip && !idListOnly && TMX_STATE.abortController?.signal.aborted && allDownloadedTracks.length > 0) {
                updateProgress(0, 'Creating partial ZIP...');
                try {
                    if (includeMetadata) {
                        zip.file('_all_metadata.json', JSON.stringify(allDownloadedTracks, null, 2));
                    }
                    if (createIdTxt) {
                         const idListContent = allDownloadedTracks.map(t => t.TrackId).join('\n');
                         zip.file('track_ids_partial.txt', idListContent);
                    }

                    const content = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(content);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'Best_of_All_TMX_partial.zip';
                    a.click();
                    URL.revokeObjectURL(url);
                } catch (genError) {
                    console.error('[TMX] ❌ Error generating partial ZIP:', genError);
                }
            }
            
            if (startBtn) {
                startBtn.textContent = '✅ Download Complete';
                startBtn.style.background = 'linear-gradient(135deg, #11998e 0%, #38ef7d 100%)';
            }
            
            resetDownloadUI();
        }
    }

    function handleCancel() {
        if (TMX_STATE.abortController) {
            TMX_STATE.abortController.abort();
            console.log('[TMX] 🚫 Cancel requested');
        } else {
            const modal = document.getElementById('tmx-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        }
    }

    function resetDownloadUI() {
        const startBtn = document.getElementById('startDownload');
        const cancelBtn = document.getElementById('cancelDownload');
        const downloadBtn = document.querySelector('.tmx-downloader-btn');
        const modal = document.getElementById('tmx-modal');
        
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start download';
            startBtn.style.background = '';
        }
        
        if (cancelBtn) {
            cancelBtn.textContent = 'Close';
        }

        const progressWrap = document.getElementById('tmxProgressWrap');
        if (progressWrap) progressWrap.hidden = true;
        
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download Tracks';
        }
        
        if (modal) {
            modal.style.display = 'none';
        }
        
        // Clear skid marks and reset tire position
        clearSkidMarks();
        positionTire(0);
        
        updateProgress(0, 'Ready to download');
        TMX_STATE.abortController = null;
    }

  function createSkidMark(progressContainer, progressPercent) {
      const skidContainer = document.getElementById('skidContainer');
      if (!skidContainer) return;
      
      // Don't create skid marks at 0% or 100%
      if (progressPercent <= 0 || progressPercent >= 100) return;
      
      const skid = document.createElement('div');
      skid.className = 'tmx-skid-mark';
      
      // Position based on progress (convert % to px)
      const containerWidth = progressContainer.offsetWidth;
      const position = (progressPercent / 100) * containerWidth;
      
      // Add some randomness for realism
      const randomOffset = Math.random() * 10 - 5; // -5 to +5px
      
      skid.style.left = `${Math.max(0, position + randomOffset)}px`;
      skidContainer.appendChild(skid);
      
      // Cleanup old skid marks to prevent memory bloat
      const allSkids = skidContainer.querySelectorAll('.tmx-skid-mark');
      if (allSkids.length > 50) {
          allSkids[0].remove(); // Remove oldest
      }
  }

  // Clears all skid marks
  function clearSkidMarks() {
      const skidContainer = document.getElementById('skidContainer');
      if (skidContainer) {
          skidContainer.innerHTML = '';
      }
  }

  // Position the tire based on progress
  function positionTire(progressPercent) {
      const tire = document.getElementById('progressTire');
      const progressContainer = document.getElementById('progressContainer');
      
      if (!tire || !progressContainer) return;
      
      const containerWidth = progressContainer.offsetWidth;
      const tirePosition = (progressPercent / 100) * containerWidth;
      
      // Keep tire within bounds
      const clampedPosition = Math.min(
          Math.max(tirePosition, 10), // Don't go past left edge
          containerWidth - 10 // Don't go past right edge
      );
      
      tire.style.left = `${clampedPosition}px`;
  }

  function updateProgress(percent, text) {
      const wrap = document.getElementById('tmxProgressWrap');
      if (wrap) wrap.hidden = false;
      const progressBar = document.getElementById('progressBar');
      const progressText = document.getElementById('progressText');
      const progressContainer = document.getElementById('progressContainer');
      
      if (progressBar) {
          // Store previous percentage to detect movement
          const prevPercent = parseFloat(progressBar.style.width) || 0;
          
          progressBar.style.width = percent + '%';
          progressBar.textContent = Math.round(percent) + '%';
          
          // Only create skid marks when moving forward
          if (percent > prevPercent && percent > 5) {
              createSkidMark(progressContainer, percent);
          }
          
          // Position the tire
          positionTire(percent);
      }
      
      if (progressText) {
          progressText.textContent = text || 'Processing...';
      }
  }

    function shuffleArray(array) {
        const shuffled = [...array];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
    }

    async function fetchAllTracks(baseUrl, maxFetch = Infinity, signal) {
        const allTracks = [];
        let url = new URL(baseUrl);
        
        const fields = url.searchParams.get('fields');
        if (fields && !fields.includes('UploadedAt')) {
            url.searchParams.set('fields', fields + ',UploadedAt');
            console.log('[TMX] Stats: Added UploadedAt to API fields');
        }

        // Ensure count is 1000 for pagination
        if (!url.searchParams.has('count') || parseInt(url.searchParams.get('count'), 10) < 1000) {
            url.searchParams.set('count', '1000');
        }
        
        let pageNum = 1;
        while (true) {
            if (signal.aborted) {
                throw new DOMException('Download aborted', 'AbortError');
            }
            
            // 🆕 Note: Progress update moved to handleDownload for better UX; remove if not needed here
            console.log(`[TMX] Fetching page ${pageNum} from ${url}...`);  // Temp log for debugging
            
            const data = await proxyFetchJson(url.toString());  // Returns JSON data directly
            const results = data.Results || [];
            
            if (results.length === 0) {
                console.log('[TMX] 📄 No more tracks available.');
                break;
            }
            
            allTracks.push(...results);
            console.log(`[TMX] 📄 Fetched ${results.length} tracks from page ${pageNum}. Total so far: ${allTracks.length}`);
            
            if (results.length < 1000 || allTracks.length >= maxFetch) {
                console.log('[TMX] 📄 Finished gathering tracks.');
                break;
            }
            
            // Prepare next page
            const lastId = results[results.length - 1].TrackId;
            url.searchParams.set('after', lastId.toString());
            pageNum++;
        }
        
        return allTracks;
    }

    // ============================================================================
    // UI PERSISTENCE
    // ============================================================================
    
    function ensureUIExists() {
        // Find ACTIVE dropdown
        const dropdown = document.querySelector('.dropdown-window-active');
        if (!dropdown) return;

        // Verify it's the filter dropdown
        const filterHeader = dropdown.querySelector('.filterselector-header');
        if (!filterHeader || !filterHeader.textContent.includes('FILTERS')) {
            return;
        }

        // Check if our UI exists
        const existingUI = dropdown.querySelector('#tmx-download-filter');
        if (!existingUI) {
            console.log('[TMX] 🔄 UI missing, recreating...');
            createUI(dropdown);
        } else {
            // Check if API URL changed since last update
            const currentApiUrl = getApiUrlSafe();
            if (currentApiUrl !== TMX_STATE.lastApiUrl) {
                console.log('[TMX] 🔄 API URL changed via UI check, resetting count...');
                TMX_STATE.realCount = null;
                CACHED_TRACK_DATA = null;
                TMX_STATE.lastApiUrl = currentApiUrl;  // Update the stored URL
            }
            updateStatus();
        }
    }

    function startUIMonitoring() {
        if (TMX_STATE.uiCheckInterval) {
            clearInterval(TMX_STATE.uiCheckInterval);
        }

        // Check every 500ms
        TMX_STATE.uiCheckInterval = setInterval(ensureUIExists, 500);
        
        // Watch for DOM mutations
        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.target.classList && 
                    (mutation.target.classList.contains('dropdown-window') || 
                     mutation.target.classList.contains('dropdown-window-active'))) {
                    setTimeout(ensureUIExists, 100);
                    break;
                }
            }
        });
        
        observer.observe(document.body, { 
            childList: true, 
            subtree: true,
            attributes: true,
            attributeFilter: ['class']
        });

        // (The old data-tmx-api-url attribute watcher lived here. Nothing writes
        // that attribute now - new searches arrive via watchApiUrl instead.)
        
        console.log('[TMX] ✅ UI monitoring active');
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function init() {
        if (TMX_STATE.isInitialized) {
            console.log('[TMX] Already initialized');
            return;
        }

        const exchange = getCurrentExchange();
        if (!exchange) {
            console.log('[TMX] Unsupported exchange:', window.location.hostname);
            return;
        }

        console.log('[TMX] 🚀 Initializing for:', exchange.name);

        // Refresh the counter when the user runs a new search.
        watchApiUrl('/api/tracks', (url) => {
            console.log('[TMX] 📡 New search seen:', url);
            TMX_STATE.lastApiUrl = url;
            TMX_STATE.hasCapturedUrl = true;
            TMX_STATE.realCount = null;
            CACHED_TRACK_DATA = null;
            TMX_STATE.isFetchingCount = true;
            updateStatus(true);
            setTimeout(() => {
                TMX_STATE.isFetchingCount = false;
                updateStatus();
            }, 300);
        });

        // Poll for the FILTERS dropdown. It only exists once the user opens it,
        // so this keeps watching rather than giving up - but a fresh init (SPA
        // navigation) must retire the previous watcher or they stack up.
        if (TMX_STATE.dropdownWatcher) clearInterval(TMX_STATE.dropdownWatcher);
        const waitForDropdown = TMX_STATE.dropdownWatcher = setInterval(() => {
            const dropdown = document.querySelector('.dropdown-window-active');
            const filterHeader = dropdown?.querySelector('.filterselector-header');

            if (filterHeader && filterHeader.textContent.includes('FILTERS')) {
                clearInterval(waitForDropdown);

                console.log('[TMX] ✅ Filter dropdown found');

                createUI(dropdown);
                createModal();
                startUIMonitoring();

                TMX_STATE.isInitialized = true;
                console.log('[TMX] ✅ Initialization complete');
                updateStatus();
            }
        }, 300);

        // Safety net: if the dropdown is already open but the poll somehow has
        // not caught it, build the UI now. Not finding one is the normal case
        // on a fresh page load - the dropdown simply is not open yet, and the
        // watcher above will pick it up the moment it is - so that is a debug
        // line, not a warning.
        setTimeout(() => {
            if (TMX_STATE.isInitialized) return;
            const dropdown = document.querySelector('.dropdown-window-active');
            if (dropdown) {
                console.log('[TMX] Building UI from the already-open dropdown');
                createUI(dropdown);
                createModal();
                startUIMonitoring();
                TMX_STATE.isInitialized = true;
                updateStatus();
            } else {
                console.debug('[TMX] Filters dropdown not open yet - still watching.');
            }
        }, 3000);
    }

    // ============================================================================
    // STARTUP
    // ============================================================================
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Handle SPA navigation
    let lastUrl = location.href;
    new MutationObserver(() => {
        const url = location.href;
        if (url !== lastUrl) {
            lastUrl = url;
            console.log('[TMX] 🔄 URL changed, reinitializing...');
            TMX_STATE.isInitialized = false;
            setTimeout(init, 500);
        }
    }).observe(document, { subtree: true, childList: true });

})();
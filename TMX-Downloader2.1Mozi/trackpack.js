// ============================================================================
// PART 1: EARLY INJECTION - Runs before page scripts (for /api/trackpacks)
// ============================================================================
(function injectInterceptor() {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `
        (function() {
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                if (typeof url === 'string') {
                    if (url.includes('/api/trackpacks')) {
                        const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
                        document.documentElement.setAttribute('data-tmx-pack-api-url', absoluteUrl);
                        window.dispatchEvent(new CustomEvent('tmx-pack-api-captured', { detail: { url: absoluteUrl } }));
                        console.log('[TMX Fetch Intercept] ✅ Packs Captured:', absoluteUrl);
                    } else if (url.includes('/api/tracks')) {
                        const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
                        document.documentElement.setAttribute('data-tmx-api-url', absoluteUrl);
                        window.dispatchEvent(new CustomEvent('tmx-api-captured', { detail: { url: absoluteUrl } }));
                        console.log('[TMX Fetch Intercept] ✅ Tracks Captured:', absoluteUrl);
                    }
                }
                return originalFetch.apply(this, args);
            };
            console.log('[TMX] Fetch interceptor installed');
        })();
    `;
    (document.head || document.documentElement).appendChild(scriptEl);
    scriptEl.remove(); // Clean up immediately
})();

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
        currentExchange: null,
        uiCheckInterval: null,
        progress: { current: 0, total: 0 },
        abortController: null,
        isFetchingCount: false
    };

    // ============================================================================
    // CONFIGURATION (All exchanges for packs)
    // ============================================================================
    const EXCHANGES = {
        'tmnf.exchange': {
            name: 'TMNF-X',
            apiBase: 'https://tmnf.exchange/api/trackpacks',
            tracksApiBase: 'https://tmnf.exchange/api/tracks',
            host: 'https://tmnf.exchange'
        },
        'tmuf.exchange': {
            name: 'TMUF-X',
            apiBase: 'https://tmuf.exchange/api/trackpacks',
            tracksApiBase: 'https://tmuf.exchange/api/tracks',
            host: 'https://tmuf.exchange'
        },
        'original.tm-exchange.com': {
            name: 'TMO-X',
            apiBase: 'https://original.tm-exchange.com/api/trackpacks',
            tracksApiBase: 'https://original.tm-exchange.com/api/tracks',
            host: 'https://original.tm-exchange.com'
        },
        'sunrise.tm-exchange.com': {
            name: 'TMS-X',
            apiBase: 'https://sunrise.tm-exchange.com/api/trackpacks',
            tracksApiBase: 'https://sunrise.tm-exchange.com/api/tracks',
            host: 'https://sunrise.tm-exchange.com'
        },
        'nations.tm-exchange.com': {
            name: 'TMN-X',
            apiBase: 'https://nations.tm-exchange.com/api/trackpacks',
            tracksApiBase: 'https://nations.tm-exchange.com/api/tracks',
            host: 'https://nations.tm-exchange.com'
        }
    };

    // Proxy helpers
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
            console.error('[TMX-PACK] Unsupported hostname:', hostname);
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

    function getApiUrlSafe() {
        // METHOD 1: Check DOM attribute 
        const domUrl = document.documentElement.getAttribute('data-tmx-pack-api-url');
        if (domUrl) {
            try {
                new URL(domUrl);
                TMX_STATE.lastApiUrl = domUrl;
                TMX_STATE.hasCapturedUrl = true;
                return domUrl;
            } catch (e) {
                console.error('[TMX-PACK] Invalid DOM URL:', domUrl);
            }
        }
        
        // METHOD 2: Check window property
        if (window.__tmx_pack_lastApiUrl) {
            try {
                new URL(window.__tmx_pack_lastApiUrl);
                TMX_STATE.lastApiUrl = window.__tmx_pack_lastApiUrl;
                TMX_STATE.hasCapturedUrl = true;
                return window.__tmx_pack_lastApiUrl;
            } catch (e) {
                console.error('[TMX-PACK] Invalid window URL:', window.__tmx_pack_lastApiUrl);
            }
        }
        
        // METHOD 3: Fallback to internal state
        if (TMX_STATE.hasCapturedUrl && TMX_STATE.lastApiUrl) {
            try {
                new URL(TMX_STATE.lastApiUrl);
                return TMX_STATE.lastApiUrl;
            } catch (e) {
                console.error('[TMX-PACK] Invalid stored URL:', TMX_STATE.lastApiUrl);
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
        return `${sanitizeFilename(exchangeName)}_Trackpacks_${timestamp}.zip`;
    }

    function loadJSZip() {
      return new Promise((resolve, reject) => {
        if (window.JSZip) return resolve();

        const script = document.createElement('script');
        script.src = chrome.runtime.getURL('jszip.min.js');
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load JSZip'));
        document.head.appendChild(script);
      });
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
            urlObj.searchParams.set('count', '40');
            const data = await proxyFetchJson(urlObj.toString());
            const results = data.Results || [];
            const more = data.More || false;
            return more ? '40+' : results.length.toString();
        } catch (e) {
            console.error('[TMX-PACK] Error fetching real count:', e);
            return 'Error';
        }
    }

    async function updateStatus(loading = false) {
        const status = document.getElementById('tmx-pack-status');
        
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
            // Trigger fetch if no real count yet
            if (!TMX_STATE.realCount && !TMX_STATE.isFetchingCount) {
                TMX_STATE.isFetchingCount = true;
                status.textContent = '⏳ Getting pack count...';
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
            
            // Fallback parsing
            if (displayCount === '0' && !TMX_STATE.realCount) {
                try {
                    const urlObj = new URL(apiUrl);
                    const countParam = parseInt(urlObj.searchParams.get('count'), 10) || 0;
                    displayCount = countParam > 40 ? '40+' : countParam.toString();
                } catch (e) {
                    console.error('[TMX-PACK] Error parsing count from URL');
                    displayCount = '0';
                }
            }
            
            // Update UI
            status.textContent = `Search loaded (${displayCount} packs)`;
            status.classList.add('ready');
        } else {
            status.textContent = '❌ Perform search';
            status.classList.add('error');
        }
    }

    function createUI(dropdown) {
        // Remove old UI if exists
        const oldUI = document.getElementById('tmx-pack-download-filter');
        if (oldUI) {
            oldUI.remove();
        }
        
        // Verify correct dropdown
        const filterHeader = dropdown.querySelector('.filterselector-header');
        if (!filterHeader || !filterHeader.textContent.includes('FILTERS')) {
            console.log('[TMX-PACK] Skipping UI creation - not the filter dropdown');
            return;
        }
        
        console.log('[TMX-PACK] 🎯 Creating UI in filter dropdown');
        
        const downloadFilter = document.createElement('div');
        downloadFilter.id = 'tmx-pack-download-filter';
        
        const label = document.createElement('span');
        label.className = 'tmx-section-label';
        label.textContent = 'TRACKPACK DOWNLOADER';
        
        const btnContainer = document.createElement('div');
        btnContainer.className = 'tmx-btn-container';
        
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'tmx-downloader-btn';
        downloadBtn.innerHTML = 'Download Trackpacks';
 
        const status = document.createElement('div');
        status.id = 'tmx-pack-status';
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
            console.log('[TMX-PACK] Button clicked, current URL:', apiUrl);
            
            if (!apiUrl) {
                alert('❌ No API URL found!\n\nPlease perform a search first and wait for results to load.');
                return;
            }
            
            const modal = document.getElementById('tmx-pack-modal');
            if (modal) {
                modal.style.display = 'flex';
                updateStatus();
            } else {
                console.error('[TMX-PACK] Modal not found!');
            }
        });
        
        console.log('[TMX-PACK] ✅ UI created successfully');
        updateStatus();
        
        return { downloadBtn, status };
    }

    function createModal() {
        // Remove old modal if exists
        const oldModal = document.getElementById('tmx-pack-modal');
        if (oldModal) {
            oldModal.remove();
        }
        
        const exchange = getCurrentExchange();
        if (!exchange) {
            console.error('[TMX-PACK] No exchange configured');
            return;
        }
        
        const modal = document.createElement('div');
        modal.id = 'tmx-pack-modal';
        modal.className = 'tmx-modal';
        
        modal.innerHTML = `
            <div class="tmx-modal-content">
                <h2><span id="exchange-name">${exchange.name}</span> Trackpack Downloader</h2>
                
                <!-- Multi-Exchange Search -->
                <div class="tmx-option-group">
                    <label>🌐 Multi-Exchange Search</label>
                    <div class="tmx-checkbox-group">
                        <label class="tmx-interactive">
                            <input type="checkbox" id="multiExchangeMode">
                            <span>Enable Multi-Exchange Mode</span>
                        </label>
                        <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                            Search across multiple TMX platforms simultaneously
                        </small>
                    </div>
                    
                    <div id="exchangeSelector" style="margin-top: 12px; display: none;">
                        <label style="font-size: 11px; margin-bottom: 8px; display: block;">Select Exchanges:</label>
                        <div class="tmx-checkbox-group">
                            <label class="tmx-interactive">
                                <input type="checkbox" class="exchange-checkbox" value="tmnf.exchange" checked>
                                <span>TMNF-X (TrackMania Nations Forever)</span>
                            </label>
                            <label class="tmx-interactive">
                                <input type="checkbox" class="exchange-checkbox" value="tmuf.exchange" checked>
                                <span>TMUF-X (TrackMania United Forever)</span>
                            </label>
                            <label class="tmx-interactive">
                                <input type="checkbox" class="exchange-checkbox" value="original.tm-exchange.com" checked>
                                <span>TMO-X (TrackMania Original)</span>
                            </label>
                            <label class="tmx-interactive">
                                <input type="checkbox" class="exchange-checkbox" value="sunrise.tm-exchange.com" checked>
                                <span>TMS-X (TrackMania Sunrise)</span>
                            </label>
                            <label class="tmx-interactive">
                                <input type="checkbox" class="exchange-checkbox" value="nations.tm-exchange.com" checked>
                                <span>TMN-X (TrackMania Nations)</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <!-- Pack Count -->
                <div class="tmx-option-group">
                    <label>🔢 Number of Trackpacks</label>
                    <input 
                        type="number" 
                        id="packCount" 
                        placeholder="Leave empty to download all packs" 
                        min="1"
                    >
                    <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                        Downloads the top N trackpacks from search and all their tracks.
                    </small>
                </div>
                
                <!-- ZIP Options -->
                <div class="tmx-option-group">
                    <label>📦 Archive Options</label>
                    <div class="tmx-checkbox-group">
                        <label class="tmx-interactive">
                            <input type="checkbox" id="createZip" checked>
                            <span>Create ZIP archive (recommended)</span>
                        </label>
                        <label class="tmx-interactive">
                            <input type="checkbox" id="includeMetadata">
                            <span>Include track metadata (JSON files)</span>
                        </label>
                    </div>
                </div>
                
                <!-- Progress -->
                <div class="tmx-option-group">
                    <label>📊 Progress</label>
                    <div class="tmx-progress" id="progressContainer">
                        <div id="progressBar" class="tmx-progress-bar">0%</div>
                        <!-- Tire icon (emoji) -->
                        <div class="tmx-progress-tire" id="progressTire">🏁</div>
                        <!-- Skid marks container -->
                        <div class="tmx-skid-container" id="skidContainer"></div>
                    </div>
                    <div id="progressText">Ready to download</div>
                </div>
                
                <!-- Action Buttons -->
                <div class="tmx-btn-row">
                    <button id="startDownload" class="tmx-btn">
                        Start Download
                    </button>
                    <button id="cancelDownload" class="tmx-btn tmx-btn-secondary">
                        Cancel
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
        document.getElementById('startDownload').addEventListener('click', handlePackDownload);
        document.getElementById('cancelDownload').addEventListener('click', handleCancel);
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
        
        console.log('[TMX-PACK] ✅ Modal created and attached');
        return modal;
    }

    // ============================================================================
    // DOWNLOAD LOGIC
    // ============================================================================
    
    async function handlePackDownload() {
        const apiUrl = getApiUrlSafe();
        const multiMode = document.getElementById('multiExchangeMode')?.checked;
        
        if (!multiMode && !apiUrl) {
            alert('❌ No API URL available!\n\nPlease:\n1. Perform a search\n2. Wait for results to load\n3. Try again');
            return;
        }
        
        // Get selected exchanges
        const selectedExchanges = getSelectedExchanges();
        
        if (selectedExchanges.length === 0) {
            alert('❌ No exchanges selected!\n\nPlease select at least one exchange to download from.');
            return;
        }
        
        // Get options
        const packCountInput = document.getElementById('packCount').value;
        const maxPacks = packCountInput ? parseInt(packCountInput, 10) : Infinity;
        const createZip = document.getElementById('createZip').checked;
        const includeMetadata = document.getElementById('includeMetadata').checked;
        
        console.log('[TMX-PACK] 🚀 Starting pack download');
        console.log('[TMX-PACK] 🌐 Exchanges:', selectedExchanges.map(e => e.name).join(', '));
        console.log('[TMX-PACK] 📋 Options:', { 
            maxPacks: packCountInput || 'all', 
            createZip, 
            includeMetadata 
        });
        
        // Prepare UI
        const startBtn = document.getElementById('startDownload');
        const cancelBtn = document.getElementById('cancelDownload');
        const downloadBtn = document.querySelector('.tmx-downloader-btn');
        
        if (startBtn) {
            startBtn.disabled = true;
            startBtn.textContent = '⏳ Downloading...';
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
        if (createZip) {
            try {
                await loadJSZip();
                zip = new JSZip();
            } catch (error) {
                console.error('[TMX-PACK] ❌ Failed to load JSZip:', error);
                alert('❌ Error loading ZIP library. Please try again later.');
                resetDownloadUI();
                return;
            }
        }
        
        let allDownloadedTracks = [];
        let allPacks = [];
        
        try {
            // Process each exchange
            for (let i = 0; i < selectedExchanges.length; i++) {
                if (signal.aborted) break;
                
                const exchange = selectedExchanges[i];
                console.log(`[TMX-PACK] 📡 Processing ${exchange.name} (${i + 1}/${selectedExchanges.length})`);
                
                // Build API URL for this exchange
                let currentApiUrl;
                if (multiMode) {
                    // Extract search parameters from current URL
                    const currentUrl = new URL(apiUrl || window.location.href);
                    const params = currentUrl.searchParams;
                    
                    // Build new URL with same parameters
                    const newUrl = new URL(exchange.apiBase);
                    params.forEach((value, key) => {
                        newUrl.searchParams.set(key, value);
                    });
                    currentApiUrl = newUrl.toString();
                } else {
                    currentApiUrl = apiUrl;
                }
                
                updateProgress(
                    (i / selectedExchanges.length) * 50,
                    `Fetching packs from ${exchange.name}...`
                );
                
                // Fetch packs from this exchange
                const exchangePacks = await fetchAllPacks(currentApiUrl, Infinity, signal);
                allPacks.push(...exchangePacks.map(p => ({...p, exchange})));
                
                console.log(`[TMX-PACK] 📦 Fetched ${exchangePacks.length} packs from ${exchange.name}`);
            }
            
            // Apply maxPacks limit to total
            allPacks = allPacks.slice(0, maxPacks);
            
            if (allPacks.length === 0) {
                alert('❌ No trackpacks found!');
                return;
            }
            
            updateProgress(50, `Found ${allPacks.length} packs total. Downloading tracks...`);
            
            // Process each pack
            for (let j = 0; j < allPacks.length; j++) {
                if (signal.aborted) break;
            
                const { exchange, ...pack } = allPacks[j]; 
                console.log(`[TMX-PACK] 📦 Processing ${pack.PackName || 'Unknown'} from ${exchange.name} (${j + 1}/${allPacks.length})`);
            
                // Fetch pack details
                const packDetails = await fetchPackDetails(pack.PackId, exchange);
                const packFolder = sanitizeFilename(packDetails.PackName || `Pack_${pack.PackId}`);
                
                // Fetch tracks for this pack
                const packTracks = await fetchPackTracks(pack.PackId, signal, exchange);
                
                console.log(`[TMX-PACK] 📊 Found ${packTracks.length} tracks in ${packFolder}`);
                
                if (packTracks.length === 0) {
                    console.log(`[TMX-PACK] ⚠️ No tracks in pack ${pack.PackId}`);
                    continue;
                }
                
                // Download tracks from this pack
                updateProgress(
                    50 + ((j / allPacks.length) * 50),
                    `Downloading ${packFolder}: 0/${packTracks.length}`
                );
                
                const CONCURRENT_DOWNLOADS = 10;
                const downloadQueue = [...packTracks];
                const activeDownloads = new Set();
                let downloadedCount = 0;
                
                async function downloadTrack(track) {
                    if (signal.aborted) throw new DOMException('Download aborted', 'AbortError');
                    
                    try {
                        const fileUrl = `${exchange.host}/trackgbx/${track.TrackId}`;
                        const blob = await proxyFetchBinary(fileUrl);
                        const filename = sanitizeFilename(`${track.TrackName} by ${track.Uploader?.Name || 'Unknown'}.gbx`);
                        
                        if (createZip) {
                            // Create exchange-specific folder
                            const folderPath = `${exchange.name}/${packFolder}/${filename}`;
                            zip.file(folderPath, blob);
                            
                            if (includeMetadata) {
                                const metaPath = `${exchange.name}/${packFolder}/${filename.replace('.gbx', '.json')}`;
                                zip.file(metaPath, JSON.stringify({...track, pack: packDetails}));
                            }
                        } else {
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `[${exchange.name}] [${packFolder}] ${filename}`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }
                        
                        allDownloadedTracks.push({...track, pack: packDetails, exchange: exchange.name});
                        downloadedCount++;
                        
                        updateProgress(
                            50 + (((j + (downloadedCount / packTracks.length)) / allPacks.length) * 50),
                            `${exchange.name} / ${packFolder}: ${downloadedCount}/${packTracks.length} tracks`
                        );
                    } catch (error) {
                        if (error.name === 'AbortError') throw error;
                        console.error(`[TMX-PACK] ⚠️ Error downloading track ${track.TrackId}:`, error);
                    }
                }
                
                // Download with concurrency control
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
            
            updateProgress(100, 'Finishing...');
            
            // Generate ZIP
            if (createZip && allDownloadedTracks.length > 0) {
                if (includeMetadata) {
                    zip.file('_all_metadata.json', JSON.stringify(allDownloadedTracks, null, 2));
                }
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                
                const zipName = multiMode 
                    ? `All_TMX_Trackpacks_${new Date().toISOString().replace(/[:.]/g, '-')}.zip`
                    : generateZipName(selectedExchanges[0].name);
                
                a.download = zipName;
                a.click();
                URL.revokeObjectURL(url);
            }
            
            console.log('[TMX-PACK] ✅ Download complete');
            alert(`✅ Download complete!\n${allDownloadedTracks.length} tracks from ${allPacks.length} packs across ${selectedExchanges.length} exchange(s).`);
            
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[TMX-PACK] ❌ Download failed:', error);
                alert(`❌ Download failed:\n${error.message}`);
            }
        } finally {
            if (createZip && TMX_STATE.abortController?.signal.aborted && allDownloadedTracks.length > 0) {
                updateProgress(0, 'Creating partial ZIP...');
                try {
                    if (includeMetadata) {
                        zip.file('_all_metadata.json', JSON.stringify(allDownloadedTracks, null, 2));
                    }
                    const content = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(content);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = 'All_TMX_Trackpacks_partial.zip';
                    a.click();
                    URL.revokeObjectURL(url);
                    alert(`🚫 Download stopped.\n${allDownloadedTracks.length} tracks saved as partial ZIP.`);
                } catch (genError) {
                    console.error('[TMX-PACK] ❌ Error generating partial ZIP:', genError);
                }
            }
            resetDownloadUI();
        }
    }

    function handleCancel() {
        if (TMX_STATE.abortController) {
            TMX_STATE.abortController.abort();
            console.log('[TMX-PACK] 🚫 Cancel requested');
        } else {
            const modal = document.getElementById('tmx-pack-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        }
    }

    function resetDownloadUI() {
        const startBtn = document.getElementById('startDownload');
        const cancelBtn = document.getElementById('cancelDownload');
        const downloadBtn = document.querySelector('.tmx-downloader-btn');
        const modal = document.getElementById('tmx-pack-modal');
        
        if (startBtn) {
            startBtn.disabled = false;
            startBtn.textContent = 'Start Download';
        }
        
        if (cancelBtn) {
            cancelBtn.textContent = 'Cancel';
        }
        
        if (downloadBtn) {
            downloadBtn.disabled = false;
            downloadBtn.textContent = 'Download Trackpacks';
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

    async function fetchAllPacks(baseUrl, maxFetch = Infinity, signal) {
        const allPacks = [];
        let url = new URL(baseUrl);
        
        // Ensure count is 40 for pagination
        if (!url.searchParams.has('count') || parseInt(url.searchParams.get('count'), 10) < 40) {
            url.searchParams.set('count', '40');
        }
        
        let pageNum = 1;
        while (true) {
            if (signal.aborted) {
                throw new DOMException('Download aborted', 'AbortError');
            }
            
            console.log(`[TMX-PACK] Fetching page ${pageNum} from ${url}...`);
            
            const data = await proxyFetchJson(url.toString());
            const results = data.Results || [];
            
            if (results.length === 0) {
                console.log('[TMX-PACK] 📦 No more packs available.');
                break;
            }
            
            allPacks.push(...results);
            console.log(`[TMX-PACK] 📦 Fetched ${results.length} packs from page ${pageNum}. Total so far: ${allPacks.length}`);
            
            if (results.length < 40 || allPacks.length >= maxFetch) {
                console.log('[TMX-PACK] 📦 Finished gathering packs.');
                break;
            }
            
            // Prepare next page
            const lastId = results[results.length - 1].PackId;
            url.searchParams.set('after', lastId.toString());
            pageNum++;
        }
        
        return allPacks;
    }

    async function fetchPackTracks(packId, signal, exchange) {
        const apiUrl = `${exchange.tracksApiBase}?packid=${packId}&fields=TrackId%2CTrackName%2CAuthors%5B%5D%2CUploader.Name&count=1000`;
        return await fetchAllTracks(apiUrl, Infinity, signal);
    }

    async function fetchAllTracks(baseUrl, maxFetch = Infinity, signal) {
        const allTracks = [];
        let url = new URL(baseUrl);
        
        // Ensure count is 1000 for pagination
        if (!url.searchParams.has('count') || parseInt(url.searchParams.get('count'), 10) < 1000) {
            url.searchParams.set('count', '1000');
        }
        
        let pageNum = 1;
        while (true) {
            if (signal.aborted) {
                throw new DOMException('Download aborted', 'AbortError');
            }
            
            console.log(`[TMX-PACK] Fetching tracks page ${pageNum}...`);
            
            const data = await proxyFetchJson(url.toString());
            const results = data.Results || [];
            
            if (results.length === 0) {
                console.log('[TMX-PACK] 📄 No more tracks available.');
                break;
            }
            
            allTracks.push(...results);
            console.log(`[TMX-PACK] 📄 Fetched ${results.length} tracks from page ${pageNum}. Total so far: ${allTracks.length}`);
            
            if (results.length < 1000 || allTracks.length >= maxFetch) {
                console.log('[TMX-PACK] 📄 Finished gathering tracks.');
                break;
            }
            
            // Prepare next page
            const lastId = results[results.length - 1].TrackId;
            url.searchParams.set('after', lastId.toString());
            pageNum++;
        }
        
        return allTracks;
    }

    async function fetchPackDetails(packId, exchange) {
        const url = `${exchange.apiBase}?id=${packId}&fields=PackName%2CCreator.Name`;
        const data = await proxyFetchJson(url.toString());
        return data.Results?.[0] || { PackName: `Pack_${packId}`, Creator: { Name: 'Unknown' } };
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
        const existingUI = dropdown.querySelector('#tmx-pack-download-filter');
        if (!existingUI) {
            console.log('[TMX-PACK] 🔄 UI missing, recreating...');
            createUI(dropdown);
        } else {
            // Check if API URL changed since last update
            const currentApiUrl = getApiUrlSafe();
            if (currentApiUrl !== TMX_STATE.lastApiUrl) {
                console.log('[TMX-PACK] 🔄 API URL changed via UI check, resetting count...');
                TMX_STATE.realCount = null;
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

        // Watch for API URL changes
        const apiUrlObserver = new MutationObserver((mutations) => {
            mutations.forEach(mutation => {
                if (mutation.attributeName === 'data-tmx-pack-api-url') {
                    console.log('[TMX-PACK] 📡 API URL changed, updating status...');
                    TMX_STATE.realCount = null;
                    TMX_STATE.isFetchingCount = true;
                    updateStatus(true);
                    // Simulate a brief loading state
                    setTimeout(() => {
                        TMX_STATE.isFetchingCount = false;
                        updateStatus();
                    }, 300);
                }
            });
        });
        
        apiUrlObserver.observe(document.documentElement, { attributes: true });
        
        console.log('[TMX-PACK] ✅ UI monitoring active');
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function init() {
        if (TMX_STATE.isInitialized) {
            console.log('[TMX-PACK] Already initialized');
            return;
        }

        const exchange = getCurrentExchange();
        if (!exchange) {
            console.log('[TMX-PACK] Unsupported exchange:', window.location.hostname);
            return;
        }

        console.log('[TMX-PACK] 🚀 Initializing for:', exchange.name);

        // Listen for API capture events
        window.addEventListener('tmx-pack-api-captured', (e) => {
            console.log('[TMX-PACK] 📡 API URL captured via event:', e.detail.url);
            TMX_STATE.realCount = null;
            TMX_STATE.isFetchingCount = true;
            updateStatus(true);
            setTimeout(() => {
                TMX_STATE.isFetchingCount = false;
                updateStatus();
            }, 300);
        });

        // Poll for dropdown
        const waitForDropdown = setInterval(() => {
            const dropdown = document.querySelector('.dropdown-window-active');
            const filterHeader = dropdown?.querySelector('.filterselector-header');

            if (filterHeader && filterHeader.textContent.includes('FILTERS')) {
                clearInterval(waitForDropdown);

                console.log('[TMX-PACK] ✅ Filter dropdown found');

                createUI(dropdown);
                createModal();
                startUIMonitoring();

                TMX_STATE.isInitialized = true;
                console.log('[TMX-PACK] ✅ Initialization complete');
                updateStatus();
            }
        }, 300);

        // Safety timeout
        setTimeout(() => {
            if (!TMX_STATE.isInitialized) {
                console.warn('[TMX-PACK] ⚠️ Forcing initialization after timeout');
                const dropdown = document.querySelector('.dropdown-window-active');
                if (dropdown) {
                    createUI(dropdown);
                    createModal();
                    startUIMonitoring();
                    TMX_STATE.isInitialized = true;
                    updateStatus();
                }
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
            console.log('[TMX-PACK] 🔄 URL changed, reinitializing...');
            TMX_STATE.isInitialized = false;
            setTimeout(init, 500);
        }
    }).observe(document, { subtree: true, childList: true });

})();
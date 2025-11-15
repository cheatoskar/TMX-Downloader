// ============================================================================
// PART 1: EARLY INJECTION - Runs before page scripts
// ============================================================================
(function injectInterceptor() {
    const scriptEl = document.createElement('script');
    scriptEl.textContent = `
        (function() {
            const originalFetch = window.fetch;
            window.fetch = function(...args) {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                if (typeof url === 'string' && url.includes('/api/tracks')) {
                    const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
                    document.documentElement.setAttribute('data-tmx-api-url', absoluteUrl);
                    window.dispatchEvent(new CustomEvent('tmx-api-captured', { 
                        detail: { url: absoluteUrl } 
                    }));
                }
                return originalFetch.apply(this, args);
            };
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

    function getApiUrlSafe() {
        // METHOD 1: Check DOM attribute 
        const domUrl = document.documentElement.getAttribute('data-tmx-api-url');
        if (domUrl) {
            try {
                new URL(domUrl);
                TMX_STATE.lastApiUrl = domUrl;
                TMX_STATE.hasCapturedUrl = true;
                return domUrl;
            } catch (e) {
                console.error('[TMX] Invalid DOM URL:', domUrl);
            }
        }
        
        // METHOD 2: Check window property
        if (window.__tmx_lastApiUrl) {
            try {
                new URL(window.__tmx_lastApiUrl);
                TMX_STATE.lastApiUrl = window.__tmx_lastApiUrl;
                TMX_STATE.hasCapturedUrl = true;
                return window.__tmx_lastApiUrl;
            } catch (e) {
                console.error('[TMX] Invalid window URL:', window.__tmx_lastApiUrl);
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
            urlObj.searchParams.set('count', '1000');
            const response = await fetch(urlObj.toString());
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const results = data.Results || [];
            const more = data.More || false;
            return more ? '1000+' : results.length.toString();
        } catch (e) {
            console.error('[TMX] Error fetching real count:', e);
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
            return;
        }
        
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
        updateStatus();
        
        return { downloadBtn, status };
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
        
        modal.innerHTML = `
            <div class="tmx-modal-content">
                <h2><span id="exchange-name">${exchange.name}</span> Track Downloader</h2>
                
                <!-- Download Options -->
                <div class="tmx-option-group">
                    <label>📥 Download Options</label>
                    <div class="tmx-checkbox-group">
                        <label class="tmx-interactive">
                            <input type="checkbox" id="shuffleTracks">
                            <span>Shuffle track order</span>
                        </label>
                        <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                            Downloads the first N maps — just in a random order.
                        </small>

                        <label class="tmx-interactive">
                            <input type="checkbox" id="randomSelection">
                            <span>Random selection</span>
                        </label>
                        <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                            Loads all results and picks N maps at random from the full set.
                        </small>
                    </div>
                    <small style="color: var(--muted-textcolor); font-size: 10px; display: block; margin-top: 8px; font-style: italic;">
                        Note: Only one option applies at a time (shuffle takes priority).
                    </small>
                </div>
                
                <!-- Track Count -->
                <div class="tmx-option-group">
                    <label>🔢 Number of Tracks</label>
                    <input 
                        type="number" 
                        id="trackCount" 
                        placeholder="Leave empty to download all tracks" 
                        min="1"
                    >
                </div>
                
                <!-- Start Position -->
                <div class="tmx-option-group">
                    <label>📍 Start Position</label>
                    <input 
                        type="number" 
                        id="startIndex" 
                        placeholder="0" 
                        min="0" 
                        value="0"
                    >
                    <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                        Skip the first N tracks (0 = start from beginning)
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
                    <div class="tmx-progress">
                        <div id="progressBar" class="tmx-progress-bar">0%</div>
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
        document.getElementById('startDownload').addEventListener('click', handleDownload);
        document.getElementById('cancelDownload').addEventListener('click', handleCancel);
        
        // Close on backdrop click (only when not downloading)
        modal.addEventListener('click', (e) => {
            if (e.target === modal && !TMX_STATE.abortController) {
                modal.style.display = 'none';
            }
        });
        return modal;
    }

    // ============================================================================
    // DOWNLOAD LOGIC
    // ============================================================================
    
    async function handleDownload() {
        const apiUrl = getApiUrlSafe();
        
        if (!apiUrl) {
            alert('❌ No API URL available!\n\nPlease:\n1. Click "Apply Filters" or "Search"\n2. Wait for results to load\n3. Try again');
            return;
        }

        // Get download options
        const shuffleTracks = document.getElementById('shuffleTracks').checked;
        const randomSelection = document.getElementById('randomSelection').checked;
        const trackCountInput = document.getElementById('trackCount').value;
        const startIndex = parseInt(document.getElementById('startIndex').value || '0', 10);
        const createZip = document.getElementById('createZip').checked = true;
        const includeMetadata = document.getElementById('includeMetadata').checked;

        // Prepare UI for downloading
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
                console.error('[TMX] ❌ Failed to load JSZip:', error);
                alert('❌ Error loading ZIP library. Please try again later.');
                resetDownloadUI();
                return;
            }
        }

        const exchange = getCurrentExchange();
        let tracks = [];
        let downloadedTracks = [];

        try {
        // Determine limits
        const maxTrackCount = trackCountInput ? parseInt(trackCountInput, 10) : Infinity;
        const effectiveMaxFetch = maxTrackCount === Infinity ? Infinity : (startIndex + maxTrackCount);
        
        // Fetch all tracks via pagination
        updateProgress(0, 'Loading track list...');
        let allTracks = await fetchAllTracks(apiUrl, effectiveMaxFetch, signal);

        console.log(`[TMX] 📊 Fetched ${allTracks.length} tracks total from search`);

        if (allTracks.length === 0) {
            alert('⚠️ No tracks found for download!');
            resetDownloadUI();
            return;
        }

        // Apply startIndex and trackCount limit
        tracks = allTracks.slice(startIndex, startIndex + maxTrackCount);
        console.log(`[TMX] 🔪 After slicing (start=${startIndex}, max=${maxTrackCount}): ${tracks.length} tracks`);

        // Apply shuffle/random
        if (shuffleTracks) {
            tracks = shuffleArray(tracks);  // Just shuffle the limited set
        } else if (randomSelection && maxTrackCount !== Infinity) {
            // Fetch ALL for true random sample, then select
            updateProgress(0, 'Fetching full results for random sample...');
            const fullTracks = await fetchAllTracks(apiUrl, Infinity, signal);  // No limit
            const shuffledFull = shuffleArray(fullTracks);
            tracks = shuffledFull.slice(startIndex, startIndex + maxTrackCount);
        }

        if (tracks.length === 0) {
            alert('⚠️ No tracks match the selected options!');
            resetDownloadUI();
            return;
        }

        console.log(`[TMX] ⬇ Downloading ${tracks.length} tracks...`);

        TMX_STATE.progress.total = tracks.length;
        TMX_STATE.progress.current = 0;

        // Parallel download with concurrency limit
        const CONCURRENT_DOWNLOADS = 10;
        const downloadQueue = [...tracks];
        const activeDownloads = new Set();

        async function downloadTrack(track) {
            if (signal.aborted) {
                throw new DOMException('Download aborted', 'AbortError');
            }

            try {
                const fileUrl = `${exchange.apiBase.replace('/api/tracks', '')}/trackgbx/${track.TrackId}`;
                const fileResponse = await fetch(fileUrl, { signal });
                
                if (!fileResponse.ok) {
                    throw new Error(`Failed to download track ${track.TrackId}: ${fileResponse.status}`);
                }
                
                const blob = await fileResponse.blob();
                const arrayBuffer = await blob.arrayBuffer();
                const filename = sanitizeFilename(`${track.TrackName} by ${track.Uploader?.Name || 'Unknown'}.gbx`);

                if (createZip) {
                    zip.file(filename, arrayBuffer);
                    if (includeMetadata) {
                        zip.file(filename.replace('.gbx', '.json'), JSON.stringify(track));
                    }
                } else {
                    // Download individually if no ZIP
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = filename;
                    a.click();
                    URL.revokeObjectURL(url);
                }

                downloadedTracks.push(track);
                TMX_STATE.progress.current++;
                updateProgress(
                    (TMX_STATE.progress.current / TMX_STATE.progress.total) * 100, 
                    `Downloaded ${TMX_STATE.progress.current}/${TMX_STATE.progress.total} tracks...`
                );
            } catch (error) {
                if (error.name === 'AbortError') {
                    throw error;
                }
                console.error(`[TMX] ⚠️ Error downloading track ${track.TrackId}:`, error);
                // Continue with next track
            }
        }

        // Process downloads with concurrency control
        while (downloadQueue.length > 0 || activeDownloads.size > 0) {
            if (signal.aborted) {
                console.log('[TMX] 🚫 Download aborted by user');
                break;
            }

            // Fill up to concurrent limit
            while (activeDownloads.size < CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
                const track = downloadQueue.shift();
                const promise = downloadTrack(track)
                    .finally(() => activeDownloads.delete(promise));
                activeDownloads.add(promise);
            }

            // Wait for at least one to complete
            if (activeDownloads.size > 0) {
                await Promise.race(activeDownloads);
            }
        }

        // Wait for any remaining downloads
        if (activeDownloads.size > 0) {
            await Promise.allSettled(activeDownloads);
        }

        if (createZip && includeMetadata && downloadedTracks.length > 0) {
            zip.file('metadata.json', JSON.stringify(downloadedTracks));
        }

        updateProgress(100, 'Finishing...');

        if (createZip && TMX_STATE.progress.current > 0) {
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = generateZipName(exchange.name);
            a.click();
            URL.revokeObjectURL(url);
        }
        alert(`✅ Download complete!\n${TMX_STATE.progress.current} of ${TMX_STATE.progress.total} tracks downloaded.`);

        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[TMX] ❌ Download failed:', error);
                alert(`❌ Download failed:\n${error.message}`);
            }
        } finally {
            if (createZip && TMX_STATE.abortController && TMX_STATE.abortController.signal.aborted && TMX_STATE.progress.current > 0) {
                // Download partial ZIP on abort
                updateProgress((TMX_STATE.progress.current / TMX_STATE.progress.total) * 100, 'Creating partial ZIP...');
                try {
                    if (includeMetadata) {
                        zip.file('metadata.json', JSON.stringify(downloadedTracks));
                    }
                    const content = await zip.generateAsync({ type: 'blob' });
                    const url = URL.createObjectURL(content);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = generateZipName(exchange.name).replace('.zip', '_partial.zip');
                    a.click();
                    URL.revokeObjectURL(url);
                    alert(`🚫 Download stopped.\n${downloadedTracks.length} tracks downloaded and saved as partial ZIP.`);
                } catch (genError) {
                    console.error('[TMX] ❌ Error generating partial ZIP:', genError);
                }
            }
            resetDownloadUI();
        }
    }

    function handleCancel() {
        if (TMX_STATE.abortController) {
            TMX_STATE.abortController.abort();
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
          startBtn.textContent = 'Start Download';
      }
      
      if (cancelBtn) {
          cancelBtn.textContent = 'Cancel';
      }
      
      if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = 'Download Tracks';
      }
      
      if (modal) {
          modal.style.display = 'none';
      }
      
      updateProgress(0, 'Ready to download');
      TMX_STATE.abortController = null;
  }

    function updateProgress(percent, text) {
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        
        if (progressBar) {
            progressBar.style.width = percent + '%';
            progressBar.textContent = Math.round(percent) + '%';
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
        
        // Ensure count is 1000 for pagination
        if (!url.searchParams.has('count') || parseInt(url.searchParams.get('count'), 10) < 1000) {
            url.searchParams.set('count', '1000');
        }
        
        let pageNum = 1;
        while (true) {
            if (signal.aborted) {
                throw new DOMException('Download aborted', 'AbortError');
            }
            
            updateProgress(0, `Fetching page ${pageNum}, got ${allTracks.length} tracks so far...`);
            
            const response = await fetch(url.toString(), { signal });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
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
            createUI(dropdown);
        } else {
            // Check if API URL changed since last update
            const currentApiUrl = getApiUrlSafe();
            if (currentApiUrl !== TMX_STATE.lastApiUrl) {
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
            if (mutation.attributeName === 'data-tmx-api-url') {
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
    }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    
    function init() {
        if (TMX_STATE.isInitialized) {
            return;
        }

        const exchange = getCurrentExchange();
        if (!exchange) {
            console.log('[TMX] Unsupported exchange:', window.location.hostname);
            return;
        }

        // Listen for API capture events
        window.addEventListener('tmx-api-captured', (e) => {
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
                createUI(dropdown);
                createModal();
                startUIMonitoring();

                TMX_STATE.isInitialized = true;
                updateStatus();
            }
        }, 300);

        // Safety timeout
        setTimeout(() => {
            if (!TMX_STATE.isInitialized) {
                console.warn('[TMX] ⚠️ Forcing initialization after timeout');
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
            console.log('[TMX] 🔄 URL changed, reinitializing...');
            TMX_STATE.isInitialized = false;
            setTimeout(init, 500);
        }
    }).observe(document, { subtree: true, childList: true });

})();
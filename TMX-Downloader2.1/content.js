// ============================================================================
// PART 1: EARLY INJECTION - Runs before page scripts
// ============================================================================
(function() {
    'use strict';
    
    chrome.runtime.sendMessage({action: 'injectFetchOverride'}, (response) => {
        if (chrome.runtime.lastError) {
            console.error('[TMX] Message error:', chrome.runtime.lastError);
        } else if (response.success) {
            console.log('[TMX] ✅ Fetch interceptor installed via background');
        } else {
            console.error('[TMX] ❌ Failed to inject interceptor:', response.error);
        }
    });
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
                    <label>📦 Archive & Export</label>
                    <div class="tmx-checkbox-group">
                        <label class="tmx-interactive">
                            <input type="checkbox" id="createZip" checked>
                            <span>Create ZIP archive</span>
                        </label>
                        <label class="tmx-interactive">
                            <input type="checkbox" id="includeMetadata">
                            <span>Include metadata (JSON)</span>
                        </label>
                        <div style="margin-top: 8px; border-top: 1px solid var(--muted-border-color); padding-top: 8px;">
                            <label class="tmx-interactive">
                                <input type="checkbox" id="createIdTxt">
                                <span>Create ID List (.txt)</span>
                            </label>
                            <label class="tmx-interactive" style="margin-left: 20px;">
                                <input type="checkbox" id="idListOnly">
                                <span style="color: #ffaa00;">Skip Map Download (Only IDs)</span>
                            </label>
                        </div>
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
                <!-- Statistics Button -->
                <div class="tmx-option-group">
                    <button id="viewStatistics" class="tmx-btn tmx-btn-stats">
                        📊 View Track Statistics
                    </button>
                    <small style="color: var(--muted-textcolor); font-size: 11px; display: block; margin-top: 4px;">
                        Analyze all tracks from current search results
                    </small>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // Event listeners
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
                    <button class="tmx-stats-tab" data-tab="environments">Environments</button>
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
                            <h3>📊 Track Length Distribution</h3>
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
                            <h3>⭐ Awards vs Track Count</h3>
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
                            <h3>🌍 Environment/Style Distribution</h3>
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
            
            // Environment analysis
            environments: {}
        };
        
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
            
            // Length stats
            const lengthSeconds = Math.round((track.AuthorTime || 0) / 1000);
            const lengthBucket = Math.floor(lengthSeconds / 30) * 30;
            stats.lengthBuckets[lengthBucket] = (stats.lengthBuckets[lengthBucket] || 0) + 1;
            
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
            
            // Environment stats
            const styleType = track.PrimaryType;
            const styleKey = (styleType !== null && styleType !== undefined) ? styleType : 'Unknown';
            stats.environments[styleKey] = (stats.environments[styleKey] || 0) + 1;
        });
        
        // Calculate derived stats
        stats.totalAuthors = Object.keys(stats.authors).length;
        stats.avgAward = tracks.length > 0 ? (stats.totalAwards / tracks.length).toFixed(2) : 0;
        stats.avgLength = tracks.reduce((sum, t) => sum + (t.AuthorTime || 0), 0) / tracks.length / 1000;
        
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
    // Load Chart.js if not already loaded
    if (!window.Chart) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js';
        script.onload = () => renderAllCharts(stats);
        document.head.appendChild(script);
    } else {
        renderAllCharts(stats);
    }
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

function renderAwardDistribution(stats) {
    const ctx = document.getElementById('awardDistChart');
    const sortedAwards = Object.entries(stats.awardDistribution)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .slice(0, 20); // Top 20 award values
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sortedAwards.map(([award]) => `${award} ⭐`),
            datasets: [{
                label: 'Number of Tracks',
                data: sortedAwards.map(([, count]) => count),
                backgroundColor: 'rgba(75, 192, 192, 0.6)',
                borderColor: 'rgba(75, 192, 192, 1)',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false },
                title: { display: false }
            },
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderLengthDistribution(stats) {
    const ctx = document.getElementById('lengthDistChart');
    const sortedLengths = Object.entries(stats.lengthBuckets)
        .sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
        .slice(0, 20);
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedLengths.map(([sec]) => `${sec}s`),
            datasets: [{
                label: 'Track Count',
                data: sortedLengths.map(([, count]) => count),
                fill: true,
                backgroundColor: 'rgba(255, 159, 64, 0.2)',
                borderColor: 'rgba(255, 159, 64, 1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderTopAuthors(stats) {
    const ctx = document.getElementById('authorsChart');
    
    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: stats.topAuthors.map(a => a.name),
            datasets: [{
                label: 'Tracks',
                data: stats.topAuthors.map(a => a.trackCount),
                backgroundColor: 'rgba(153, 102, 255, 0.6)',
                borderColor: 'rgba(153, 102, 255, 1)',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
    
    // Render detailed author list
    const authorsList = document.getElementById('authorsList');
    authorsList.innerHTML = stats.topAuthors.map((author, idx) => `
        <div class="tmx-author-item">
            <span class="tmx-author-rank">#${idx + 1}</span>
            <span class="tmx-author-name">${author.name}</span>
            <span class="tmx-author-tracks">${author.trackCount} tracks</span>
            <span class="tmx-author-awards">⭐ ${author.totalAwards}</span>
        </div>
    `).join('');
}

function renderAwardsScatter(stats) {
    const ctx = document.getElementById('awardsScatterChart');
    const data = stats.tracks.map((track, idx) => ({
        x: idx,
        y: track.Awards || 0
    }));
    
    new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Awards per Track',
                data: data,
                backgroundColor: 'rgba(255, 99, 132, 0.5)'
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderMostAwardedList(stats) {
    const container = document.getElementById('mostAwardedList');
    container.innerHTML = stats.topRatedTracks.map((track, idx) => `
        <div class="tmx-awarded-track">
            <span class="tmx-track-rank">${idx + 1}</span>
            <div class="tmx-track-info">
                <div class="tmx-track-name">${track.TrackName}</div>
                <div class="tmx-track-author">by ${track.Uploader?.Name || 'Unknown'}</div>
            </div>
            <span class="tmx-track-awards">⭐ ${track.Awards || 0}</span>
        </div>
    `).join('');
}

function renderDifficultyChart(stats) {
    const ctx = document.getElementById('difficultyChart');
    const difficulties = ['Beginner', 'Intermediate', 'Expert', 'Lunatic'];
    const colors = [
        'rgba(75, 192, 192, 0.6)',
        'rgba(255, 206, 86, 0.6)',
        'rgba(255, 159, 64, 0.6)',
        'rgba(255, 99, 132, 0.6)'
    ];
    
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: difficulties,
            datasets: [{
                data: difficulties.map(d => stats.difficultyCount[d]),
                backgroundColor: colors
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function renderTimelineChart(stats) {
    const ctx = document.getElementById('timelineChart');
    
    // Group by month
    const monthCounts = {};
    stats.uploadDates.forEach(date => {
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        monthCounts[monthKey] = (monthCounts[monthKey] || 0) + 1;
    });
    
    const sortedMonths = Object.entries(monthCounts).sort();
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: sortedMonths.map(([month]) => month),
            datasets: [{
                label: 'Uploads',
                data: sortedMonths.map(([, count]) => count),
                fill: true,
                backgroundColor: 'rgba(54, 162, 235, 0.2)',
                borderColor: 'rgba(54, 162, 235, 1)',
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderEnvironmentChart(stats) {
    const ctx = document.getElementById('environmentChart');
    const sortedEnvs = Object.entries(stats.environments)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    
    const styleMap = {
        0: 'Normal',
        1: 'Stunt',
        2: 'Maze',
        3: 'Offroad',
        4: 'Laps',
        5: 'Fullspeed',
        6: 'LOL',
        7: 'Tech',
        8: 'SpeedTech',
        9: 'RPG',
        10: 'PressForward',
        11: 'Trial',
        12: 'Grass',
        'Unknown': 'Unknown' // Handle the unknown category
    };
    
    new Chart(ctx, {
        type: 'pie',
        data: {
            labels: sortedEnvs.map(([styleKey, count]) => styleMap[styleKey] || `Other (${styleKey})`),
            datasets: [{
                data: sortedEnvs.map(([, count]) => count),
                backgroundColor: [
                    'rgba(255, 99, 132, 0.6)',
                    'rgba(54, 162, 235, 0.6)',
                    'rgba(255, 206, 86, 0.6)',
                    'rgba(75, 192, 192, 0.6)',
                    'rgba(153, 102, 255, 0.6)',
                    'rgba(255, 159, 64, 0.6)',
                    'rgba(199, 199, 199, 0.6)',
                    'rgba(83, 102, 255, 0.6)',
                    'rgba(255, 99, 255, 0.6)',
                    'rgba(99, 255, 132, 0.6)'
                ]
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { position: 'right' }
            }
        }
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
            startBtn.textContent = 'Start Download';
            startBtn.style.background = '';
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

        // Watch for API URL changes
        const apiUrlObserver = new MutationObserver((mutations) => {
        mutations.forEach(mutation => {
            if (mutation.attributeName === 'data-tmx-api-url') {
                console.log('[TMX] 📡 API URL changed, updating status...');
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

        // Listen for API capture events
        window.addEventListener('tmx-api-captured', (e) => {
          console.log('[TMX] 📡 API URL captured via event:', e.detail.url);
          TMX_STATE.realCount = null;
          CACHED_TRACK_DATA = null;
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

                console.log('[TMX] ✅ Filter dropdown found');

                createUI(dropdown);
                createModal();
                startUIMonitoring();

                TMX_STATE.isInitialized = true;
                console.log('[TMX] ✅ Initialization complete');
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
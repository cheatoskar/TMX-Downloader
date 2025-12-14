// ============================================================================
// TMX Trackshow Enhancement Script - Redesigned
// Seamless page integration with visual statistics
// ============================================================================
(function() {
    'use strict';
    
    // ============================================================================
    // CONFIGURATION
    // ============================================================================
    const EXCHANGES = {
        'tmnf.exchange': {
            name: 'TMNF-X',
            apiBase: 'https://tmnf.exchange/api'
        },
        'tmuf.exchange': {
            name: 'TMUF-X',
            apiBase: 'https://tmuf.exchange/api'
        },
        'original.tm-exchange.com': {
            name: 'TMO-X',
            apiBase: 'https://original.tm-exchange.com/api'
        },
        'sunrise.tm-exchange.com': {
            name: 'TMS-X',
            apiBase: 'https://sunrise.tm-exchange.com/api'
        },
        'nations.tm-exchange.com': {
            name: 'TMN-X',
            apiBase: 'https://nations.tm-exchange.com/api'
        }
    };

    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================
    const TMX_STATE = {
        trackId: null,
        currentExchange: null,
        abortController: null,
        replayCount: 0,
        trackMetadata: null,
        replaysData: null,
        statsCalculated: null
    };

    // ============================================================================
    // PROXY HELPERS
    // ============================================================================
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
    // UTILITY FUNCTIONS
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

    function extractTrackId() {
        const match = window.location.pathname.match(/\/trackshow\/(\d+)/);
        return match ? match[1] : null;
    }

    function formatTime(ms) {
        const minutes = Math.floor(ms / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        const millis = ms % 1000;
        if (minutes > 0) {
            return `${minutes}:${seconds.toString().padStart(2, '0')}.${Math.floor(millis / 10).toString().padStart(2, '0')}`;
        }
        return `${seconds}.${Math.floor(millis / 10).toString().padStart(2, '0')}`;
    }

    function timeToMs(timeStr) {
        const parts = timeStr.split(':');
        if (parts.length === 2) {
            const min = parseInt(parts[0], 10);
            const secMs = parseFloat(parts[1]) * 1000;
            return (min * 60000) + secMs;
        } else {
            return parseFloat(timeStr) * 1000;
        }
    }

    function sanitizeFilename(filename) {
        return filename.replace(/[<>:"/\\|?*]/g, '_');
    }

    // ============================================================================
    // DATA FETCHING
    // ============================================================================
    async function fetchTrackMetadata(trackId) {
        const exchange = getCurrentExchange();
        if (!exchange) return null;
    
        try {
            // Build fields string - comma-separated, then encode the whole thing
            const fields = [
                'TrackId', 'TrackName', 'UId', 'AuthorTime', 'AuthorScore',
                'GoldTarget', 'SilverTarget', 'BronzeTarget',
                'Uploader.UserId', 'Uploader.Name',
                'UploadedAt', 'UpdatedAt', 'ActivityAt',
                'PrimaryType', 'TrackValue', 'AuthorComments',
                'Style', 'Routes', 'Difficulty', 'Environment', 'Car', 'Mood',
                'Awards', 'Comments', 'ReplayType', 'HasThumbnail',
                'UnlimiterVersion',
                'WRReplay.ReplayId', 'WRReplay.ReplayTime', 'WRReplay.ReplayScore',
                'WRReplay.User.UserId', 'WRReplay.User.Name'
            ];
        
            let url = `${exchange.apiBase}/tracks?id=${trackId}`;
            const fieldsStr = fields.join(',');
            url += `&fields=${encodeURIComponent(fieldsStr)}`;
        
            console.log('[TMX] Fetching metadata from:', url);
            const data = await proxyFetchJson(url);
        
            if (data && data.Results && data.Results.length > 0) {
                const track = data.Results[0];
                console.log('[TMX] Fetched metadata from API:', track);
                return track;
            } else {
                console.warn('[TMX] No track data returned from API');
                return createFallbackMetadata(trackId);
            }
        } catch (error) {
            console.error('[TMX] API fetch error:', error);
            return createFallbackMetadata(trackId);
        }
    }

    function createFallbackMetadata(trackId) {
        // Fallback: scrape what we can from the page
        const metadata = {
            TrackId: parseInt(trackId),
            TrackName: 'Unknown',
            UId: null,
            AuthorTime: 0,
            AuthorScore: 0,
            GoldTarget: 0,
            SilverTarget: 0,
            BronzeTarget: 0,
            Uploader: { UserId: null, Name: 'Unknown' },
            UploadedAt: new Date().toISOString(),
            UpdatedAt: new Date().toISOString(),
            ActivityAt: new Date().toISOString(),
            PrimaryType: null,
            TrackValue: 0,
            AuthorComments: '',
            Style: null,
            Routes: 1,
            Difficulty: 'Unknown',
            Environment: 'Stadium',
            Car: null,
            Mood: 'Unknown',
            Awards: 0,
            Comments: 0,
            ReplayType: null,
            HasThumbnail: true,
            UnlimiterVersion: null,
            WRReplay: null,
            UserReplay: null,
            Authors: [],
            Tags: [],
            Images: null
        };
        
        // Try to scrape basic info from page
        const pageTitle = document.title;
        const titlePrefix = pageTitle.split(' | ')[0];
        const parts = titlePrefix.split(' by ');
        if (parts.length > 0) {
            metadata.TrackName = parts[0];
        }
        
        // Get track value from flexinfo
        const flexInfo = document.querySelector('.flexinfo');
        if (flexInfo) {
            const valueMatch = flexInfo.textContent.match(/<i class="fas fa-bolt"><\/i>\s*(\d+(?:,\d+)?)/);
            if (valueMatch) {
                metadata.TrackValue = parseInt(valueMatch[1].replace(',', ''));
            }
            
            const awardsMatch = flexInfo.textContent.match(/<i class="fas fa-trophy"><\/i>\s*(\d+)/);
            if (awardsMatch) {
                metadata.Awards = parseInt(awardsMatch[1]);
            }
            
            const commentsMatch = flexInfo.textContent.match(/<i class="fas fa-comment-alt"><\/i>\s*(\d+)/);
            if (commentsMatch) {
                metadata.Comments = parseInt(commentsMatch[1]);
            }
        }
        
        // Parse times from medals accordion
        const medalButton = document.querySelector('#showmedals');
        if (medalButton) {
            const timeText = medalButton.textContent;
            const timeMatch = timeText.match(/(\d+):(\d+)\.(\d+)/);
            if (timeMatch) {
                const min = parseInt(timeMatch[1]);
                const sec = parseInt(timeMatch[2]);
                const ms = parseInt(timeMatch[3]) * 10;
                metadata.AuthorTime = (min * 60000) + (sec * 1000) + ms;
            }
        }
        
        const medalAccordion = document.querySelector('#trackmedals');
        if (medalAccordion) {
            const medalDivs = medalAccordion.querySelectorAll('.row');
            medalDivs.forEach(div => {
                const text = div.textContent;
                const timeMatch = text.match(/(\d+):(\d+)\.(\d+)/);
                if (timeMatch) {
                    const min = parseInt(timeMatch[1]);
                    const sec = parseInt(timeMatch[2]);
                    const ms = parseInt(timeMatch[3]) * 10;
                    const time = (min * 60000) + (sec * 1000) + ms;
                    
                    if (text.includes('Gold')) metadata.GoldTarget = time;
                    else if (text.includes('Silver')) metadata.SilverTarget = time;
                    else if (text.includes('Bronze')) metadata.BronzeTarget = time;
                }
            });
        }
        
        return metadata;
    }

    async function fetchAllReplays(trackId, signal) {
        const exchange = getCurrentExchange();
        if (!exchange) return [];
        
        const baseUrl = exchange.apiBase;
        const fields = 'ReplayId,User.UserId,User.Name,ReplayTime,ReplayScore,ReplayRespawns,Score,Position,IsBest,IsLeaderboard,TrackAt,ReplayAt';
        const fieldsStr = fields.split(',').map(f => f.trim()).join(','); // FIXED: Single comma-separated param
        const fieldsParams = `&fields=${encodeURIComponent(fieldsStr)}`;
        
        const allReplays = [];
        let after = null;
        
        while (true) {
            if (signal && signal.aborted) {
                throw new DOMException('Fetch aborted', 'AbortError');
            }
            
            let url = `${baseUrl}/replays?trackId=${trackId}${fieldsParams}&count=1000`;
            if (after) {
                url += `&after=${after}`;
            }
            
            try {
                const data = await proxyFetchJson(url);
                const results = data.Results || [];
                
                if (results.length === 0) break;
                
                allReplays.push(...results);
                
                if (!data.More) break;
                
                after = results[results.length - 1].ReplayId;
            } catch (error) {
                console.error('[TMX Trackshow] Error fetching replays:', error);
                break;
            }
        }
        
        TMX_STATE.replayCount = allReplays.length;
        return allReplays;
    }

    async function fetchReplayDownloadUrl(replayId) {
        const exchange = getCurrentExchange();
        if (!exchange) return null;
        
        return `${exchange.apiBase.replace('/api', '')}/recordgbx/${replayId}`;
    }

    // ============================================================================
    // STATISTICS CALCULATION
    // ============================================================================
    function calculateReplayStats(replays) {
        if (replays.length === 0) return null;
        
        let times = replays.map(r => r.ReplayTime).filter(t => typeof t === 'number' && t > 0); // Filter invalid
        if (times.length === 0) return null;
        times.sort((a, b) => a - b);
        
        const total = times.length;
        const sum = times.reduce((a, b) => a + b, 0);
        const mean = sum / total;
        const median = times[Math.floor(total / 2)];
        const min = times[0]; // WR
        const max = times[times.length - 1];
        
        const variance = times.reduce((acc, t) => acc + Math.pow(t - mean, 2), 0) / total;
        const stdDev = Math.sqrt(variance);
        
        // Optional: Filter outliers for full stats (keep as-is; comment out if unwanted)
        const cutoff = mean + 3 * stdDev;
        times = times.filter(t => t <= cutoff);
        if (times.length === 0) times = replays.map(r => r.ReplayTime).filter(t => typeof t === 'number' && t > 0).sort((a, b) => a - b); // Fallback
        const filteredTotal = times.length;
        const filteredMean = times.reduce((a, b) => a + b, 0) / filteredTotal;
        const filteredMedian = times[Math.floor(filteredTotal / 2)];
        const filteredMin = times[0];
        const filteredMax = times[filteredTotal - 1];
        const filteredStdDev = Math.sqrt(times.reduce((acc, t) => acc + Math.pow(t - filteredMean, 2), 0) / filteredTotal);
        
        // For chart: Dynamic range with 10-15 buckets, focusing on main cluster
        const allChartTimes = replays.map(r => r.ReplayTime).filter(t => typeof t === 'number' && t > 0).sort((a, b) => a - b);
        const wrTime = allChartTimes[0]; // True WR

        // Use 95th percentile to exclude extreme outliers
        const p95Index = Math.floor(allChartTimes.length * 0.95);
        const p95Time = allChartTimes[Math.min(p95Index, allChartTimes.length - 1)];
        const minRange = 2000; // Ensure at least 2 seconds
        const chartMaxTime = Math.max(p95Time, wrTime + minRange);

        // Filter to dynamic range
        let chartTimes = allChartTimes.filter(t => t >= wrTime && t <= chartMaxTime);
        chartTimes.sort((a, b) => a - b);

        const chartRange = chartMaxTime - wrTime;
        let bucketSize, numBuckets, distribution;

        if (chartRange <= 0) {
            bucketSize = 100;
            numBuckets = 1;
            distribution = [chartTimes.length];
        } else {
            // Target exactly 12 buckets (within 10-15 range)
            const targetBuckets = 12;
            bucketSize = chartRange / targetBuckets;
            
            // Round to nice readable intervals
            const niceIntervals = [10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
            bucketSize = niceIntervals.find(interval => interval >= bucketSize) || niceIntervals[niceIntervals.length - 1];
            
            numBuckets = Math.ceil(chartRange / bucketSize);
            distribution = new Array(numBuckets).fill(0);
            chartTimes.forEach(t => {
                const bucket = Math.min(Math.floor((t - wrTime) / bucketSize), numBuckets - 1);
                distribution[bucket]++;
            });
        }
                
        return {
            total: filteredTotal, // Full (filtered) for stats
            mean: filteredMean,
            median: filteredMedian,
            min: filteredMin,
            max: filteredMax,
            stdDev: filteredStdDev,
            outliersRemoved: total - filteredTotal,
           timeDistribution: {
                bucketSize,
                distribution,
                minTime: min,
                maxTime: chartMaxTime,
                chartTimesCount: chartTimes.length
            }
        };
    }

    function calculateCustomScore(metadata, stats) {
        if (!metadata) return { total: 0, breakdown: {} };
        
        const breakdown = {};
        let score = 0;
        
        // REMOVED: Base TrackValue (per request—now pure engagement/competitive focus)
        // breakdown.trackValue = metadata.TrackValue || 0;
        // score += breakdown.trackValue;
        
        // Awards: 50 points each (increased weight slightly for balance)
        const awards = metadata.Awards || 0;
        breakdown.awards = awards * 60; // Minor bump since TrackValue gone
        score += breakdown.awards;
        
        // Comments: 10 points each  
        const comments = metadata.Comments || 0;
        breakdown.comments = comments * 10;
        score += breakdown.comments;
        
        if (stats) {
            // Replay activity (logarithmic scale)
            breakdown.replayActivity = Math.log10(stats.total + 1) * 500;
            score += breakdown.replayActivity;
            
            // Competitive bonus (WR vs Author time)
            const authorTime = metadata.AuthorTime || 0;
            const wrTime = stats.min || (metadata.WRReplay?.ReplayTime) || 0;

            if (wrTime > 0 && authorTime > 0) {
                const ratio = authorTime / wrTime;
                // Bonus scales with how much faster WR is than AT
                breakdown.competitive = Math.max(0, (ratio - 1) * 1000);
                score += breakdown.competitive;
            } else {
                breakdown.competitive = 0;
            }
            
            // Diversity bonus (standard deviation)
            if (stats.stdDev) {
                breakdown.diversity = Math.min(stats.stdDev / 100, 500);
                score += breakdown.diversity;
            } else {
                breakdown.diversity = 0;
            }
        }
        
        const normalizedScore = Math.min(Math.round(score), 10000);
        
        return {
            total: normalizedScore,
            breakdown: breakdown,
            percentage: (normalizedScore / 10000) * 100
        };
    }

    // Enhanced Hype Meter Calculation (0-100 score + trend)
    function calculateHypeScore(metadata, replays) {
        const now = new Date();
        const uploadDate = new Date(metadata.UploadedAt);
        const ageDays = Math.max(0.25, (now - uploadDate) / (24 * 60 * 60 * 1000));
        const ageHours = Math.ceil((now - uploadDate) / 3600000);
        
        // === 1. TIME-WINDOWED ACTIVITY (Multi-tier decay) ===
        const windows = {
            ultraRecent: { hours: 48, weight: 0.50, replays: 0 },
            recent:      { hours: 72, weight: 0.30, replays: 0 },
            shortTerm:   { hours: 168, weight: 0.15, replays: 0 }, // 7 days
            midTerm:     { hours: 720, weight: 0.04, replays: 0 }, // 30 days
            longTerm:    { hours: Infinity, weight: 0.01, replays: 0 }
        };
        
        // Distribute replays into time windows
        replays.forEach(r => {
            const hoursSince = (now - new Date(r.ReplayAt)) / 3600000;
            for (let [key, window] of Object.entries(windows)) {
                if (hoursSince < window.hours) {
                    window.replays++;
                    break;
                }
            }
        });
        
        // Calculate weighted activity score (4 points per replay)
        let activityScore = Object.values(windows).reduce((sum, w) => 
            sum + (w.replays * w.weight * 4), 0
        );
        
        // === 2. AWARDS & COMMENTS (weighted higher, distributed by recent activity) ===
        const totalAwards = metadata.Awards || 0;
        const totalComments = metadata.Comments || 0;
        const totalReplays = replays.length;
        
        // Estimate recent awards/comments based on replay distribution
        const recentReplayRatio = totalReplays > 0 
            ? (windows.ultraRecent.replays + windows.recent.replays) / totalReplays 
            : 0.5; // Assume 50% recent if no replays
        
        const recentAwardBonus = totalAwards * recentReplayRatio * 5;
        const recentCommentBonus = totalComments * recentReplayRatio * 2;
        
        activityScore += recentAwardBonus + recentCommentBonus;
        
        // === 3. VELOCITY BONUS (acceleration/deceleration) ===
        const velocity = windows.ultraRecent.replays > 0 
            ? windows.ultraRecent.replays / Math.max(windows.recent.replays - windows.ultraRecent.replays, 0.1)
            : 0;
        
        const velocityMultiplier = 1 + Math.min(Math.max(velocity - 1, -0.3), 1.0) * 0.3; // -10% to +30%
        activityScore *= velocityMultiplier;
        
        // === 4. AGE MULTIPLIER (Newbie boost with smooth decay) ===
        let ageFactor;
        if (ageDays < 1) {
            ageFactor = 3.0; // Brand new: 3x
        } else if (ageDays < 7) {
            ageFactor = 1 + (2 * Math.exp(-ageDays / 2.5)); // Steep: 3x → 1.2x
        } else {
            ageFactor = 1 + (0.5 * Math.exp(-ageDays / 30)); // Gentle: 1.5x → 1x
        }
        
        activityScore *= ageFactor;
        
        // === 5. QUALITY PENALTIES (anti-spam) ===
        if (totalReplays > 0) {
            const uniqueRatio = new Set(replays.map(r => r.User.UserId)).size / totalReplays;
            if (uniqueRatio < 0.4) {
                activityScore *= 0.7; // Penalty for bot/spam patterns
            }
        }
        
        // === 6. NORMALIZE TO 0-100 ===
        // Target: 10 replays in 6h on new map = ~100 hype
        const expectedMax = 40;
        let hype = Math.min(Math.round((activityScore / expectedMax) * 100), 100);
        
        // === 7. BASELINE HANDLING ===
        const hasActivity = totalReplays > 0 || totalAwards > 0 || totalComments > 0;
        if (!hasActivity) {
            hype = 5; // Truly inactive
        } else if (hype < 1) {
            hype = 1; // Active maps minimum
        }
        
        // === 8. TREND VISUALIZATION (Dynamic bucketing) ===
        let bucketType, trendData = [], labels = [];
        
        if (ageHours < 24) {
            // Hourly buckets
            bucketType = 'hour';
            const numBuckets = Math.min(24, ageHours);
            const hourly = {};
            replays.forEach(r => {
                const hour = new Date(r.ReplayAt).toISOString().slice(0, 13);
                hourly[hour] = (hourly[hour] || 0) + 1;
            });
            const sorted = Object.entries(hourly).sort(([a], [b]) => a.localeCompare(b));
            trendData = sorted.slice(-numBuckets).map(([, count]) => count);
            labels = trendData.map((_, i) => `H-${trendData.length - i}`);
        } else if (ageDays < 7) {
            // Daily buckets
            bucketType = 'day';
            const numBuckets = Math.min(7, Math.ceil(ageDays));
            const daily = {};
            replays.forEach(r => {
                const day = new Date(r.ReplayAt).toISOString().slice(0, 10);
                daily[day] = (daily[day] || 0) + 1;
            });
            const sorted = Object.entries(daily).sort(([a], [b]) => a.localeCompare(b));
            trendData = sorted.slice(-numBuckets).map(([, count]) => count);
            labels = trendData.map((_, i) => `D-${trendData.length - i}`);
        } else if (ageDays <= 30) {
            // Weekly buckets
            bucketType = 'week';
            const numBuckets = Math.min(4, Math.ceil(ageDays / 7));
            const weekly = {};
            replays.forEach(r => {
                const weekStart = new Date(r.ReplayAt);
                weekStart.setDate(weekStart.getDate() - weekStart.getDay());
                const weekKey = weekStart.toISOString().slice(0, 10);
                weekly[weekKey] = (weekly[weekKey] || 0) + 1;
            });
            const sorted = Object.entries(weekly).sort(([a], [b]) => a.localeCompare(b));
            trendData = sorted.slice(-numBuckets).map(([, count]) => count);
            labels = trendData.map((_, i) => `W-${trendData.length - i}`);
        } else {
            // Monthly buckets
            bucketType = 'month';
            const monthly = {};
            replays.forEach(r => {
                const month = new Date(r.ReplayAt).toISOString().slice(0, 7);
                monthly[month] = (monthly[month] || 0) + 1;
            });
            const sorted = Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b));
            trendData = sorted.slice(-6).map(([, count]) => count);
            labels = trendData.map((_, i) => `M-${trendData.length - i}`);
        }
        
        // === 9. TREND LABEL ===
        const growth = trendData.length > 1 
            ? ((trendData[trendData.length - 1] / Math.max(trendData[0], 0.1)) * 100 - 100) 
            : 0;
        
        let trendLabel;
        if (ageDays < 7) {
            // New maps: simple emerging/quiet logic
            trendLabel = totalReplays > (ageDays * 0.5) ? 'Emerging 📈' : 'Quiet 🕐';
        } else if (velocity > 1.5) {
            trendLabel = 'Exploding 🚀';
        } else if (growth > 20) {
            trendLabel = 'Growing 📈';
        } else if (growth < -20) {
            trendLabel = 'Fading 📉';
        } else {
            trendLabel = 'Stable ⚖️';
        }
        
        console.log(`[TMX] Hype: ${hype}/100 (${trendLabel}, velocity: ${velocity.toFixed(2)}x, age: ${Math.round(ageDays)}d)`);
        
        return {
            score: hype,
            trendData,
            labels,
            label: trendLabel,
            bucketType,
            ageDays: Math.round(ageDays),
            velocity: velocity.toFixed(2)
        };
    }

    // ============================================================================
    // UI CREATION - INTEGRATED STATISTICS CARD
    // ============================================================================
    function createStatsCard() {
        const statsCard = document.createElement('div');
        statsCard.className = 'card';
        statsCard.id = 'tmx-stats-card';
        statsCard.innerHTML = `
            <div class="card-header">
                <div class="row">
                    <div class="col">
                        <i class="fas fa-chart-line"></i> Track Statistics & Analysis
                    </div>
                    <div class="col-auto text-end">
                        <a role="button" id="tmx-refresh-stats"><i class="fas fa-sync-alt"></i> Refresh</a>
                    </div>
                </div>
            </div>
            <div class="card-body" id="tmx-stats-content">
                <div style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin fa-2x" style="color: var(--primary-color);"></i>
                    <p style="margin-top: 15px;">Loading statistics...</p>
                </div>
            </div>
        `;
        
        return statsCard;
    }

    function formatScoreLabel(key) {
        const labels = {
            trackValue: 'Track Value',
            awards: 'Awards',
            comments: 'Comments',
            replayActivity: 'Replay Activity',
            competitive: 'Competitive Bonus',
            diversity: 'Diversity Bonus'
        };
        return labels[key] || key;
    }

    function renderStatsContent(metadata, stats, hypeData) { // UPDATED: Accept hypeData
        const scoreData = calculateCustomScore(metadata, stats);
    
        let replayStatsHTML = '';
        if (stats) {
            replayStatsHTML = `
                <!-- Replay Statistics -->
                <div class="tmx-stat-section">
                    <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;">
                        <i class="fas fa-stopwatch"></i> Replay Statistics
                    </h5>
                    <div class="tmx-stat-grid">
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">Total Replays</div>
                            <div class="tmx-stat-value">${stats.total}</div>
                        </div>
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">World Record</div>
                            <div class="tmx-stat-value">${formatTime(stats.min)}</div>
                        </div>
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">Average Time</div>
                            <div class="tmx-stat-value">${formatTime(Math.round(stats.mean))}</div>
                        </div>
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">Median Time</div>
                            <div class="tmx-stat-value">${formatTime(stats.median)}</div>
                        </div>
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">Std Deviation</div>
                            <div class="tmx-stat-value">${formatTime(Math.round(stats.stdDev))}</div>
                        </div>
                        <div class="tmx-stat-box">
                            <div class="tmx-stat-label">Time Range</div>
                            <div class="tmx-stat-value">${formatTime(stats.max - stats.min)}</div>
                        </div>
                        ${stats.outliersRemoved > 0 ? `<div class="tmx-stat-box"><div class="tmx-stat-label">Outliers Filtered</div><div class="tmx-stat-value">${stats.outliersRemoved}</div></div>` : ''}
                    </div>
                </div>
                <!-- Time Distribution Chart -->
                <div class="tmx-stat-section">
                    <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;">
                        <i class="fas fa-chart-bar"></i> Time Distribution
                    </h5>
                    <canvas id="tmx-time-chart" height="200"></canvas>
                </div>
            `;
        } else {
            replayStatsHTML = `
                <!-- No Replays Fallback -->
                <div class="tmx-stat-section">
                    <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;">
                        <i class="fas fa-stopwatch"></i> Replay Statistics
                    </h5>
                    <div style="text-align: center; padding: 40px; color: #999;">
                        <i class="fas fa-inbox fa-2x" style="margin-bottom: 10px;"></i>
                        <p>No replays available yet.</p>
                        <small>This track may be new or not widely played.</small>
                    </div>
                </div>
            `;
        }

        // Hype Meter Section
        const hypeHTML = `
            <!-- Hype Meter Section -->
            <div class="tmx-stat-section">
                <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;">
                    <i class="fas fa-rocket"></i> Hype Meter
                </h5>
                <div class="tmx-score-container">
                    <div class="tmx-score-circle">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#e0e0e0" stroke-width="8"/>
                            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--primary-color)" stroke-width="8"
                                    stroke-dasharray="${((hypeData.score / 100) * 339)} 339" stroke-linecap="round" transform="rotate(-90 60 60)"/>
                            <text x="60" y="60" text-anchor="middle" dy=".3em"
                                style="font-size: 28px; font-weight: bold; fill: var(--primary-color);">
                                ${hypeData.score}
                            </text>
                            <text x="60" y="80" text-anchor="middle"
                                style="font-size: 12px; fill: #666;">
                                / 100
                            </text>
                        </svg>
                    </div>
                    <div class="tmx-score-breakdown">
                        <h6 style="margin-bottom: 10px; font-weight: 600;">Trend: ${hypeData.label}</h6>
                        <canvas id="tmx-hype-spark" class="tmx-hype-spark" width="200" height="320"></canvas>
                    </div>
                </div>
            </div>
        `;

        return `
            ${hypeHTML}
            <!-- Custom Score Section (TrackValue removed) -->
            <div class="tmx-stat-section">
                <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;" data-tooltip="How calculated: Recent replays (50% wt) + awards (30%) + comments (20%) over last 30 days, scaled to 100. Trend from 6-mo replay growth.">
                    <i class="fas fa-star-half-alt"></i> Quality Score
                </h5>
                <div class="tmx-score-container">
                    <div class="tmx-score-circle">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#e0e0e0" stroke-width="8"/>
                            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--primary-color)" stroke-width="8"
                                    stroke-dasharray="${(scoreData.percentage * 339.292) / 100} 339.292"
                                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                            <text x="60" y="60" text-anchor="middle" dy=".3em"
                                style="font-size: 28px; font-weight: bold; fill: var(--primary-color);">
                                ${scoreData.total}
                            </text>
                            <text x="60" y="80" text-anchor="middle"
                                style="font-size: 12px; fill: #666;">
                                / 10000
                            </text>
                        </svg>
                    </div>
                    <div class="tmx-score-breakdown">
                        <h6 style="margin-bottom: 10px; font-weight: 600;">Score Breakdown:</h6>
                        ${Object.entries(scoreData.breakdown).map(([key, value]) => { // TrackValue auto-excluded
                            const tooltips = {
                                awards: '60 points per award received',
                                comments: '10 points per comment',
                                replayActivity: 'Logarithmic scale based on replay count',
                                competitive: 'Bonus when WR beats author time',
                                diversity: 'Based on time variance (max 500 pts)'
                            };
                            return `
                            <div class="tmx-score-item" data-tooltip="${tooltips[key] || ''}">
                                <span class="tmx-score-label">${formatScoreLabel(key)}:</span>
                                <span class="tmx-score-value">${Math.round(value)}</span>
                            </div>
                        `;
                        }).join('')}
                    </div>
                </div>
            </div>
            ${replayStatsHTML}
        `;
    }

    function addStatsStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .tmx-stat-section {
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--card-secondary-bordercolor);
            }
            
            .tmx-stat-section:last-child {
                border-bottom: none;
            }
            
            .tmx-score-container {
                display: flex;
                align-items: center;
                gap: 30px;
                padding: 20px;
                background: var(--card-secondary-bgcolor);
                border-radius: 8px;
            }
            
            .tmx-score-circle {
                flex-shrink: 0;
            }
            
            .tmx-score-breakdown {
                flex: 1;
            }
            
            .tmx-score-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid var(--card-secondary-bordercolor);
            }
            
            .tmx-score-item:last-child {
                border-bottom: none;
            }
            
            .tmx-score-label {
                color: var(--main-textcolor);
                font-weight: 500;
            }
            
            .tmx-score-value {
                color: var(--primary-color);
                font-weight: 600;
            }
            
            .tmx-stat-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 15px;
            }
            
            .tmx-stat-box {
                background: var(--card-secondary-bgcolor);
                padding: 15px;
                border-radius: 6px;
                text-align: center;
                border: 1px solid var(--card-secondary-bordercolor);
            }
            
            .tmx-stat-label {
                font-size: 12px;
                color: var(--muted-textcolor);
                margin-bottom: 8px;
            }
            
            .tmx-stat-value {
                font-size: 20px;
                font-weight: 600;
                color: var(--primary-color);
            }
            
            .tmx-wr-timeline {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }
            
            .tmx-wr-entry {
                display: flex;
                align-items: center;
                padding: 12px;
                background: var(--card-secondary-bgcolor);
                border-radius: 6px;
                border: 1px solid var(--card-secondary-bordercolor);
            }
            
            .tmx-wr-rank {
                font-size: 24px;
                font-weight: 700;
                color: var(--primary-color);
                width: 60px;
                text-align: center;
            }
            
            .tmx-wr-details {
                flex: 1;
            }
            
            .tmx-wr-time {
                font-size: 18px;
                font-weight: 600;
                color: var(--main-textcolor);
            }
            
            .tmx-wr-user {
                font-size: 14px;
                color: var(--main-textcolor);
                margin-top: 2px;
            }
            
            .tmx-wr-date {
                font-size: 12px;
                color: var(--muted-textcolor);
                margin-top: 2px;
            }
            
            /* Hype Sparkline Style */
            .tmx-hype-spark {
                height: 100px !important;
                margin-top: 10px;
            }
            
            @media (max-width: 768px) {
                .tmx-score-container {
                    flex-direction: column;
                }
                
                .tmx-stat-grid {
                    grid-template-columns: repeat(2, 1fr);
                }
            }
        `;
        document.head.appendChild(style);
    }

    // ============================================================================
    // CHART RENDERING
    // ============================================================================
    function renderTimeChart(stats) {
        const canvas = document.getElementById('tmx-time-chart');
        if (!canvas) {
            console.error('[TMX] Canvas not found');
            return;
        }

        if (typeof Chart === 'undefined') {
            console.error('[TMX] Chart.js library missing. Check manifest loading order.');
            return;
        }
        
        if (!window.Chart) {
            console.error('[TMX] Chart.js not loaded');
            loadChartJS().then(() => renderTimeChart(stats));
            return;
        }
        
        const ctx = canvas.getContext('2d');
        const { distribution, bucketSize, minTime, maxTime } = stats.timeDistribution;
        const chartMaxTime = maxTime;
        
        const labels = [];
        const data = [];
        const bucketRanges = []; // For tooltips
        
        distribution.forEach((count, i) => {
            if (count > 0) {
                const start = minTime + i * bucketSize;
                const end = start + bucketSize;
                labels.push(formatTime(start));
                data.push(count);
                bucketRanges.push(`${formatTime(start)} - ${formatTime(end)}`);
            }
        });
        
        if (labels.length === 0) {
            ctx.fillStyle = '#999';
            ctx.font = '16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('No replays near WR (showing full range fallback)', canvas.width / 2, canvas.height / 2);
            return;
        }
        
        // Destroy existing
        if (canvas.chart) canvas.chart.destroy();
        
        // Add subtitle note via plugin
        canvas.chart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Number of Replays',
                    data: data,
                    backgroundColor: 'rgba(217, 40, 40, 0.7)',
                    borderColor: 'rgba(217, 40, 40, 1)',
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: `Time Distribution (WR to ${formatTime(stats.timeDistribution.maxTime)}, ${stats.timeDistribution.chartTimesCount} replays)`,
                        font: { size: 12 },
                        color: getComputedStyle(document.documentElement).getPropertyValue('--muted-textcolor') || '#999'
                    },
                    tooltip: {
                        callbacks: {
                            title: function(context) {
                                return bucketRanges[context[0].dataIndex] || context[0].label;
                            },
                            label: function(context) {
                                return `${context.parsed.y} replays`;
                            }
                        }
                    }
                },
                scales: { 
                    x: { 
                        display: true, 
                        title: { display: true, text: 'Recent Months', font: { size: 10 } },
                        ticks: { font: { size: 8 } }
                    },
                    y: { 
                        display: true, 
                        title: { display: true, text: 'Replays/Mo', font: { size: 10 } },
                        ticks: { font: { size: 8 } }
                    }
                },
                elements: { point: { radius: 0 } }

            }
        });
        
}

    // Hype Sparkline Render (dynamic labels and axis based on bucketType)
    function renderHypeSparkline(hypeData) {
    const canvas = document.getElementById('tmx-hype-spark');
    if (!canvas) return;

    const { trendData, labels, bucketType } = hypeData;

    // 1. Check data sufficiency
    if (!trendData || trendData.length < 2) {
        canvas.style.display = 'none';
        console.log(`[TMX] Sparkline: Hidden (low data: ${trendData ? trendData.length : 0} points)`);
        return;
    }

    // 2. Prepare Canvas
    canvas.style.display = 'block';
    const ctx = canvas.getContext('2d');
    canvas.width = 200;
    canvas.height = 100;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 3. Check if Chart.js is available (loaded via Manifest)
    // Wir prüfen auf 'undefined', da es keine importierte Variable mehr ist, sondern global
    if (typeof Chart === 'undefined') {
        // --- FALLBACK: Manuelles Zeichnen (Simple Line) ---
        console.warn('[TMX] Chart.js missing, using fallback renderer.');
        
        ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || '#007bff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        
        const maxVal = Math.max(...trendData, 1);
        const stepX = canvas.width / (trendData.length - 1 || 1);
        
        trendData.forEach((val, i) => {
            const x = i * stepX;
            const y = canvas.height - (val / maxVal * (canvas.height - 20)) - 10;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Quick axes
        ctx.strokeStyle = '#ccc';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, canvas.height - 10); ctx.lineTo(canvas.width, canvas.height - 10);
        ctx.moveTo(10, 0); ctx.lineTo(10, canvas.height);
        ctx.stroke();
        return;
    }

    // --- MAIN: Full Chart.js rendering ---
    if (canvas.chart instanceof Chart) {
        canvas.chart.destroy();
    }

    const axisTitle = bucketType === 'hour' ? 'Recent Hours' : 
                      bucketType === 'day' ? 'Recent Days' : 
                      bucketType === 'week' ? 'Recent Weeks' : 'Recent Months';

    canvas.chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: trendData,
                borderColor: getComputedStyle(document.documentElement).getPropertyValue('--primary-color') || '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                tension: 0.4,
                fill: true,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Performance Optimierung
            plugins: { legend: { display: false } },
            scales: {
                x: {
                    display: true,
                    title: { display: true, text: axisTitle, font: { size: 11, style: 'italic' } },
                    ticks: { font: { size: 9 }, maxRotation: 45 },
                    grid: { display: false }
                },
                y: {
                    display: true,
                    title: { display: true, text: 'Replays', font: { size: 11, style: 'italic' } },
                    ticks: { font: { size: 9 } },
                    grid: { display: false }
                }
            },
            elements: { point: { radius: 0 } },
            interaction: { intersect: false }
        }
    });

    console.log(`[TMX] Sparkline: Rendered with Chart.js (${trendData.length} points)`);
}

    // ============================================================================
    // DOWNLOAD HANDLERS
    // ============================================================================
    async function handleDownloadReplays() {
        if (!confirm(`Download ${TMX_STATE.replayCount} replays?\n\nThis will create a ZIP file.`)) {
            return;
        }
        
        try {
            await loadJSZip();
            const zip = new JSZip();
            const folder = zip.folder(`replays_${TMX_STATE.trackId}`);
            
            for (const replay of TMX_STATE.replaysData) {
                const replayUrl = await fetchReplayDownloadUrl(replay.ReplayId);
                const blob = await proxyFetchBinary(replayUrl);
                const filename = `${sanitizeFilename(replay.User.Name)}_${replay.ReplayId}.gbx`;
                folder.file(filename, blob);
            }
            
            const content = await zip.generateAsync({ type: 'blob' });
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = sanitizeFilename(`${TMX_STATE.trackMetadata.TrackName}_replays.zip`);
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('[TMX] Download error:', error);
            alert(`Error: ${error.message}`);
        }
    }

    async function handleExportMetadata() {
        const jsonStr = JSON.stringify(TMX_STATE.trackMetadata, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = sanitizeFilename(`${TMX_STATE.trackMetadata.TrackName}_metadata.json`);
        a.click();
        URL.revokeObjectURL(url);
    }

    // ============================================================================
    // JSZIP LOADER
    // ============================================================================
    async function loadJSZip() {
        return new Promise((resolve, reject) => {
            if (window.JSZip) return resolve();
            
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('jszip.min.js');
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load JSZip'));
            document.head.appendChild(script);
        });
    }

    // ============================================================================
    // MAIN UI INTEGRATION
    // ============================================================================
    function createEnhancedUI() {
        // Find the track information card footer
        const trackInfoCard = Array.from(document.querySelectorAll('.card')).find(card => {
            const header = card.querySelector('.card-header .col');
            return header && header.textContent.trim() === 'Track Information';
        });
        
        const footer = trackInfoCard?.querySelector('.card-footer .col.text-right');
        
        if (!footer) {
            console.error('[TMX] Could not find footer to inject buttons');
            return;
        }
        
        // Create compact action buttons
        const buttonGroup = document.createElement('div');
        buttonGroup.className = 'btn-group';
        buttonGroup.style.marginLeft = '10px';
        buttonGroup.style.position = 'relative';
        buttonGroup.innerHTML = `
            <button class="btn btn-primary dropdown-toggle" type="button" id="tmx-tools-btn" aria-expanded="false">
                <i class="fas fa-tools"></i> Tools
            </button>
            <ul class="dropdown-menu dropdown-menu-end" id="tmx-tools-dropdown" style="display: none;">
                <li><a class="dropdown-item" href="#" id="tmx-download-replays">
                    <i class="fas fa-download fa-fw"></i> Download All Replays
                </a></li>
                <li><a class="dropdown-item" href="#" id="tmx-export-metadata">
                    <i class="fas fa-file-code fa-fw"></i> Export Metadata (JSON)
                </a></li>
                <li><hr class="dropdown-divider"></li>
                <li><a class="dropdown-item" href="#tmx-stats-card">
                    <i class="fas fa-chart-line fa-fw"></i> View Statistics Below
                </a></li>
            </ul>
        `;
        
        footer.appendChild(buttonGroup);

        // Manual dropdown toggle handler
        const toolsBtn = document.getElementById('tmx-tools-btn');
        const toolsDropdown = document.getElementById('tmx-tools-dropdown');

        toolsBtn?.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const isOpen = toolsDropdown.style.display === 'block';
            toolsDropdown.style.display = isOpen ? 'none' : 'block';
            toolsBtn.setAttribute('aria-expanded', !isOpen);
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!buttonGroup.contains(e.target)) {
                toolsDropdown.style.display = 'none';
                toolsBtn?.setAttribute('aria-expanded', 'false');
            }
        });

        // Add event listeners
        document.getElementById('tmx-download-replays')?.addEventListener('click', (e) => {
            e.preventDefault();
            toolsDropdown.style.display = 'none';
            e.preventDefault();
            handleDownloadReplays();
        });
        
        document.getElementById('tmx-export-metadata')?.addEventListener('click', (e) => {
            e.preventDefault();
            toolsDropdown.style.display = 'none';
            handleExportMetadata();
        });

        // Smooth scroll to stats
        document.querySelector('a[href="#tmx-stats-card"]')?.addEventListener('click', (e) => {
            e.preventDefault();
            toolsDropdown.style.display = 'none';
            document.getElementById('tmx-stats-card')?.scrollIntoView({ behavior: 'smooth' });
        });
    }

    async function loadAndRenderStats() {
        let statsCard = document.getElementById('tmx-stats-card');
        const isRefresh = !!statsCard; // Track if this is a refresh (for logging if needed)
        
        if (!statsCard) {
            statsCard = createStatsCard();
            
            // Insert stats card after the Replays card
            const replaysCard = document.getElementById('Replays');
            if (replaysCard) {
                replaysCard.parentNode.insertBefore(statsCard, replaysCard.nextSibling);
            } else {
                // Fallback: insert before comments
                const commentsCard = document.getElementById('Comments');
                if (commentsCard) {
                    commentsCard.parentNode.insertBefore(statsCard, commentsCard);
                }
            }
        }
        
        const contentDiv = statsCard.querySelector('#tmx-stats-content');
        
        // Always show loading state on load/refresh
        contentDiv.innerHTML = `
            <div style="text-align: center; padding: 40px;">
                <i class="fas fa-spinner fa-spin fa-2x" style="color: var(--primary-color);"></i>
                <p style="margin-top: 15px;">Loading statistics...</p>
            </div>
        `;
        
        try {
            // Load metadata and replays
            TMX_STATE.trackMetadata = await fetchTrackMetadata(TMX_STATE.trackId);
            TMX_STATE.replaysData = await fetchAllReplays(TMX_STATE.trackId);
            TMX_STATE.statsCalculated = calculateReplayStats(TMX_STATE.replaysData);
            
            // Compute Hype
            const hypeData = calculateHypeScore(TMX_STATE.trackMetadata, TMX_STATE.replaysData);
            
            // Render content (pass hypeData)
            contentDiv.innerHTML = renderStatsContent(TMX_STATE.trackMetadata, TMX_STATE.statsCalculated, hypeData);
            
            // Render charts after a short delay to ensure canvas is in DOM
            setTimeout(() => {
                        try {
                            // Time Distribution Chart
                            if (TMX_STATE.statsCalculated) {
                                renderTimeChart(TMX_STATE.statsCalculated);
                            }
                            
                            // Hype Sparkline
                            if (hypeData && hypeData.trendData && hypeData.trendData.length > 0) {
                                renderHypeSparkline(hypeData);
                            }
                        } catch (chartError) {
                            console.error('[TMX] Error rendering charts:', chartError);
                            // Optional: Canvas ausblenden bei Fehler
                            const chartSection = document.getElementById('tmx-time-chart')?.closest('.tmx-stat-section');
                            if (chartSection) chartSection.style.display = 'none';
                        }
                    }, 100);
                    
                } catch (error) {
                    console.error('[TMX] Error loading stats:', error);
                    contentDiv.innerHTML = `
                        <div style="text-align: center; padding: 40px; color: #ff6666;">
                            <i class="fas fa-exclamation-triangle fa-2x"></i>
                            <p style="margin-top: 15px;">Failed to load statistics</p>
                            <small>${error.message}</small>
                        </div>
                    `;
                }
            }

    // ============================================================================
    // INITIALIZATION
    // ============================================================================
    async function init() {
        const exchange = getCurrentExchange();
        if (!exchange) {
            console.log('[TMX] Unsupported exchange:', window.location.hostname);
            return;
        }
        
        TMX_STATE.trackId = extractTrackId();
        if (!TMX_STATE.trackId) {
            console.error('[TMX] Could not extract track ID');
            return;
        }
        
        console.log('[TMX] Initializing for track:', TMX_STATE.trackId);
        
        // Add styles
        addStatsStyles();
        
        // Wait for page to be ready
        const waitForFooter = setInterval(() => {
            const trackInfoCard = Array.from(document.querySelectorAll('.card')).find(card => {
                const header = card.querySelector('.card-header .col');
                return header && header.textContent.trim() === 'Track Information';
            });
            
            const footer = trackInfoCard?.querySelector('.card-footer .col.text-right');
            
            if (footer) {
                clearInterval(waitForFooter);
                createEnhancedUI();
                loadAndRenderStats();
                
                // Add refresh handler
                document.getElementById('tmx-refresh-stats')?.addEventListener('click', () => {
                    loadAndRenderStats();
                });
                
                console.log('[TMX] Initialization complete');
            }
        }, 500);
        
        // Safety timeout
        setTimeout(() => clearInterval(waitForFooter), 10000);
    }

    // ============================================================================
    // STARTUP
    // ============================================================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
// ============================================================================
// TMX User Enhancement Script - Redesigned
// Seamless integration with user statistics and scores
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

    // Fields for the *list* on /usersearch (for leaderboard)
    const USER_LIST_FIELDS = [
        'UserId', 'Name', 'Tracks', 'TrackAwardsReceived', 'Replays'
    ].join(',');

    // ============================================================================
    // STATE MANAGEMENT
    // ============================================================================
    const TMX_STATE = {
        currentExchange: null,
        userData: new Map(), // Caches data from list fetch
        activityData: new Map() // Caches activity for individual pages
    };

    // ============================================================================
    // PROXY HELPERS (Reuse existing)
    // ============================================================================
    async function proxyFetchJson(url) {
        console.log('[TMX] Fetching:', url);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error('[TMX] Fetch error:', error);
            throw error;
        }
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

    function sanitizeFilename(filename) {
        return filename.replace(/[<>:"/\\|?*]/g, '_');
    }

    function formatNumber(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    }

    function extractUserIdFromTemplate() {
        // Wait for the IdView element to exist
        const idViewElement = document.querySelector('[template="IdView"]');
        if (!idViewElement) {
            console.log('[TMX] IdView element not found in DOM');
            return null;
        }
        
        const span = idViewElement.querySelector('span');
        if (!span) {
            console.log('[TMX] Span not found inside IdView element');
            return null;
        }
        
        const text = span.textContent || '';
        console.log('[TMX] IdView span text content:', text);
        
        // Extract the first number from the text
        const match = text.match(/(\d+)/);
        if (!match) {
            console.log('[TMX] No numeric ID found in IdView text');
            return null;
        }
        
        return match[1];
    }

    // ============================================================================
    // DATA FETCHING
    // ============================================================================

    // Fetches the *list* of users on the /usersearch page
    async function fetchUsersData() {
        const exchange = getCurrentExchange();
        if (!exchange) return [];

        // Determine count from URL or default to 40
        const urlParams = new URLSearchParams(window.location.search);
        const count = urlParams.get('count') || 40;
        const nameQuery = urlParams.get('name') || '';

        let url = `${exchange.apiBase}/users?count=${count}&fields=${encodeURIComponent(USER_LIST_FIELDS)}`;
        if (nameQuery) {
            url += `&name=${encodeURIComponent(nameQuery)}`;
        }
        
        console.log('[TMX Users] Fetching user list from:', url);
        try {
            const data = await proxyFetchJson(url);
            if (data && data.Results) {
                // Clear and populate the state map
                TMX_STATE.userData.clear();
                data.Results.forEach(user => {
                    TMX_STATE.userData.set(user.UserId, user);
                });
                console.log(`[TMX Users] Fetched ${data.Results.length} users for leaderboard.`);
                return data.Results;
            }
        } catch (error) {
            console.error('[TMX Users] Failed to fetch user data list:', error);
            return [];
        }
    }
    
    // Fetches *detailed* data for *one* user
    async function fetchUserMetadata(userId) {
        // First, check cache from list (might be incomplete, but good for download)
        const cachedUser = TMX_STATE.userData.get(parseInt(userId, 10));
        if (cachedUser && cachedUser.TrackAwardsGiven !== undefined) { // Check if it's a full-detail object
            return cachedUser;
        }

        const exchange = getCurrentExchange();
        if (!exchange) return null;

        try {
            const fields = [
                'UserId', 'Name', 'Tracks', 'TrackAwardsReceived', 'TrackAwardsGiven',
                'TrackCommentsReceived', 'TrackCommentsGiven', 'VideosCreated',
                'VideosPosted', 'RegisteredAt', 'TrackPacks', 'ForumThreads',
                'Replays', 'Favorites', 'Achievements', 'AuthorMedals'
            ];
            
            const url = `${exchange.apiBase}/users?id=${userId}&fields=${encodeURIComponent(fields.join(','))}`;
            console.log('[TMX] Fetching user metadata from:', url);
            const data = await proxyFetchJson(url);
            
            if (data && data.Results && data.Results.length > 0) {
                TMX_STATE.userData.set(data.Results[0].UserId, data.Results[0]); // Update cache
                return data.Results[0];
            }
            return null;
        } catch (error) {
            console.error('[TMX] API fetch error:', error);
            return null;
        }
    }

    async function fetchUserRecentActivity(userId, userData = null) {
        const exchange = getCurrentExchange();
        if (!exchange) return null;
        try {
           let username;
            if (userData && userData.Name) {
                username = userData.Name.toLowerCase();
            } else {
                const fetchedUserData = await fetchUserMetadata(userId);  // <-- Fallback fetch
                if (!fetchedUserData?.Name) throw new Error('No user Name');
                username = fetchedUserData.Name.toLowerCase();
            }

            // 2. Fetch LB stats
            const lbFields = 'User.UserId,User.Name,ReplayScore,ReplayWRs,Top10s,Replays,Position,Delta';
            const lbUrl = `${exchange.apiBase}/leaderboards?username=${encodeURIComponent(username)}&lbid=0&lbenv=0&count=1&fields=${encodeURIComponent(lbFields)}`;
            const lbData = await proxyFetchJson(lbUrl);
            const lbStats = (lbData.Results || [])[0] || {};

            // 3. Fetch latest track for upload activity
            const trackFields = 'UploadedAt';
            const trackUrl = `${exchange.apiBase}/tracks?authoruserid=${userId}&order1=UploadedAt&count=1&fields=${encodeURIComponent(trackFields)}`;
            console.log('[TMX] Fetching latest track from:', trackUrl);
            const trackData = await proxyFetchJson(trackUrl);
            const latestTrack = (trackData.Results || [])[0];
            const lastTrackDate = latestTrack ? new Date(latestTrack.UploadedAt) : null;

            // 4. Fetch latest replay upload activity (using your original two-step logic)
            let lastReplayDate = null;
            try {
                // Step 1: Get the TrackId of the newest submitted replay
                const replayTrackFields = 'TrackId'; // We only need the TrackId
                const latestReplayTrackUrl = `${exchange.apiBase}/tracks?order1=30&inreplays=1&replaysby=${userId}&count=1&fields=${encodeURIComponent(replayTrackFields)}`;
                console.log('[TMX] Fetching latest replay track ID from:', latestReplayTrackUrl);
                
                const replayTrackData = await proxyFetchJson(latestReplayTrackUrl);
                
                if (replayTrackData && replayTrackData.Results && replayTrackData.Results.length > 0) {
                    const latestTrackId = replayTrackData.Results[0].TrackId;
                    
                    // Step 2: Get the replays for that track, filtering by our user
                    const replayFields = 'ReplayAt,User.UserId';
                    // Fetch up to 100 replays, as the user's might not be the #1 on the map
                    const replaysUrl = `${exchange.apiBase}/replays?trackid=${latestTrackId}&count=100&fields=${encodeURIComponent(replayFields)}`;
                    console.log('[TMX] Fetching replay timestamps from:', replaysUrl);
                    
                    const replaysData = await proxyFetchJson(replaysUrl);
                    
                    if (replaysData && replaysData.Results && replaysData.Results.length > 0) {
                        // Find the newest replay *by this user* on this track
                        // We must parse userId as int for comparison
                        const intUserId = parseInt(userId, 10); 
                        const userReplays = replaysData.Results
                            .filter(r => r.User && r.User.UserId === intUserId)
                            .sort((a, b) => new Date(b.ReplayAt) - new Date(a.ReplayAt)); // Sort newest first
                        
                        if (userReplays.length > 0) {
                            lastReplayDate = new Date(userReplays[0].ReplayAt);
                        }
                    }
                }
            } catch (replayError) {
                console.error('[TMX] Failed to fetch replay activity:', replayError); // This is the error log you saw
                // lastReplayDate remains null
            }

            // 5. Determine the most recent activity date
            let mostRecentActivityDate = null;
            if (lastTrackDate && lastReplayDate) {
                mostRecentActivityDate = lastTrackDate > lastReplayDate ? lastTrackDate : lastReplayDate;
            } else {
                mostRecentActivityDate = lastTrackDate || lastReplayDate;
            }

            return {
                lastActivityDate: mostRecentActivityDate,
                replayScore: lbStats.ReplayScore || 0,
                position: lbStats.Position || 999999,
                delta: lbStats.Delta || 0,
                lbStats: { 
                    lbScore: lbStats.ReplayScore || 0,
                    lbPosition: lbStats.Position || 999999,
                    lbDelta: lbStats.Delta || 0,
                    lbReplays: lbStats.Replays || 0,
                    lbTop10s: lbStats.Top10s || 0,
                    lbWRs: lbStats.ReplayWRs || 0
                }
            };
        } catch (error) {
            console.error('[TMX] Activity fetch error:', error);
            return null;
        }
    }

    // ============================================================================
    // SCORE CALCULATION
    // ============================================================================
    function calculatePlayerScore(userData) {
        if (!userData) return { total: 0, breakdown: {}, percentage: 0 };
        
        const breakdown = {};
        let score = 0;
        
        // Replay activity (1 point per replay, max 5000)
        const replays = userData.Replays || 0;
        breakdown.replays = Math.min(replays * 0.5, 5000);
        score += breakdown.replays;

        // Awards given (2 points each)
        const awardsGiven = userData.TrackAwardsGiven || 0;
        breakdown.awardsGiven = awardsGiven * 2;
        score += breakdown.awardsGiven;

        // Comments given (0.5 point each)
        const commentsGiven = userData.TrackCommentsGiven || 0;
        breakdown.commentsGiven = commentsGiven * 0.5;
        score += breakdown.commentsGiven;
        
        // Author medals (1 points each)
        const authorMedals = userData.AuthorMedals || 0;
        breakdown.authorMedals = authorMedals * 0.5;
        score += breakdown.authorMedals;

         // Favorites (3 points each)
        const favorites = userData.Favorites || 0;
        breakdown.favorites = Math.min(favorites * 3, 400);
        score += breakdown.favorites;
        
        // Normalize to 10000
        const normalizedScore = Math.min(Math.round(score), 10000);
        
        return {
            total: normalizedScore,
            breakdown: breakdown,
            percentage: (normalizedScore / 10000) * 100
        };
    }

    function calculateBuilderScore(userData) {
        if (!userData) return { total: 0, breakdown: {}, percentage: 0 };
        
        const breakdown = {};
        let score = 0;
        
        // Tracks uploaded (50 points each, max 5000)
        const tracks = userData.Tracks || 0;
        breakdown.tracks = Math.min(tracks * 50, 5000);
        score += breakdown.tracks;

        // Awards received (10 points each)
        const awardsReceived = userData.TrackAwardsReceived || 0;
        breakdown.awardsReceived = awardsReceived * 10;
        score += breakdown.awardsReceived;
        
        // Comments received (2 points each)
        const commentsReceived = userData.TrackCommentsReceived || 0;
        breakdown.commentsReceived = commentsReceived * 2;
        score += breakdown.commentsReceived;
        
        // Track packs created (20 points each)
        const trackPacks = userData.TrackPacks || 0;
        breakdown.trackPacks = trackPacks * 20;
        score += breakdown.trackPacks;
        
        // Videos created (20 points each)
        const videos = userData.VideosCreated || 0;
        breakdown.videos = videos * 20;
        score += breakdown.videos;
        
        // Forum activity (10 points per thread)
        const forumThreads = userData.ForumThreads || 0;
        breakdown.forumThreads = forumThreads * 10;
        score += breakdown.forumThreads;
        
        // Normalize to 10000
        const normalizedScore = Math.min(Math.round(score), 10000);
        
        return {
            total: normalizedScore,
            breakdown: breakdown,
            percentage: (normalizedScore / 10000) * 100
        };
    }

    function calculateActivityStatus(activityData, userData) {
        if (!activityData) {
            return { 
                status: 'unknown', 
                label: 'No Data Available', 
                icon: 'fa-question-circle',
                daysSince: null, 
                color: '#6c757d', 
                details: 'Unable to determine activity status',
                score: 0,
                position: 999999,
                delta: 0
            };
        }
        
        const now = new Date();
        // CHANGED: Use lastActivityDate instead of lastTrackDate
        const daysSinceActivity = activityData.lastActivityDate 
            ? Math.floor((now - activityData.lastActivityDate) / (24 * 60 * 60 * 1000)) 
            : 999;
        
        const score = activityData.replayScore || 0;
        const pos = activityData.position || 999999;
        const delta = activityData.lbDelta || 0;
        
        const isTop20 = pos <= 20 || score > 500000;
        const hasActiveReplays = score > 0;
        const isFresh = delta !== 0;
        
        let status, label, icon, color, details;
        
        if (isTop20 || (isFresh && score > 100000)) {
            status = 'elite';
            label = 'Elite Player';
            icon = 'fa-crown';
            color = '#00ff88';
            details = `Top ${pos} • Score: ${formatNumber(score)} • Δ${delta > 0 ? '+' : ''}${delta}`;
        // CHANGED: Use daysSinceActivity
        } else if (hasActiveReplays && (daysSinceActivity < 30 || isFresh)) {
            status = 'active';
            label = 'Active Player';
            icon = 'fa-chart-line';
            color = '#28a745';
            // CHANGED: Updated text and use daysSinceActivity
            details = `Recent activity • Score: ${formatNumber(score)} • Last seen ${daysSinceActivity}d ago`;
        // CHANGED: Use daysSinceActivity
        } else if (hasActiveReplays || daysSinceActivity < 90) {
            status = 'recent';
            label = 'Recently Active';
             icon = 'fa-clock';
            color = '#ffc107';
            // CHANGED: Use daysSinceActivity
            details = `Score: ${formatNumber(score)} • Last seen ${daysSinceActivity}d ago`;
        // CHANGED: Use daysSinceActivity
        } else if (daysSinceActivity < 365) {
            status = 'idle';
            label = 'Idle';
            icon = 'fa-pause-circle';
            color = '#fd7e14';
            // CHANGED: Use daysSinceActivity
            details = `Last activity ${daysSinceActivity} days ago`;
        } else {
            status = 'inactive';
            label = 'Inactive';
            icon = 'fa-user-slash';
            color = '#dc3545';
            // CHANGED: Use daysSinceActivity
             details = daysSinceActivity < 999 ? `Last seen ${daysSinceActivity}d ago` : 'No recent activity';
        }
        
        // CHANGED: Return daysSinceActivity
        return { status, label, icon, daysSince: daysSinceActivity, color, details, score, position: pos, delta };
    }

    // ============================================================================
    // UI CREATION - USER SEARCH PAGE (/usersearch)
    // ============================================================================
    
    // Injects the leaderboard card on /usersearch
    function injectLeaderboardCard(usersList) {
        if (usersList.length === 0) return;

        const searchLb = document.getElementById('searchLB');
        if (!searchLb) return;

        // 1. Sort for Top Builders (Tracks)
        const topBuilders = [...usersList].sort((a, b) => b.Tracks - a.Tracks).slice(0, 5);
        // 2. Sort for Top Awarded (Awards Received)
        const topAwarded = [...usersList].sort((a, b) => b.TrackAwardsReceived - a.TrackAwardsReceived).slice(0, 5);
        // 3. Sort for Top Players (Replays)
        const topPlayers = [...usersList].sort((a, b) => b.Replays - a.Replays).slice(0, 5);

        const card = document.createElement('div');
        card.className = 'card';
        card.id = 'tmx-user-leaderboard-card';
        card.innerHTML = `
            <div class="card-header">
                <i class="fas fa-chart-line"></i> Top Stats (from loaded ${usersList.length} users)
            </div>
            <div class="card-body">
                <div class="tmx-leaderboard-grid">
                    <div class="tmx-leaderboard-col">
                        <h5><i class="fas fa-hammer"></i> Top Builders</h5>
                        ${topBuilders.map(u => `
                            <div class="tmx-leaderboard-entry">
                                <a href="/usershow/${u.UserId}" class="userlink-title" title="${u.Name}">${u.Name}</a>
                                <span class="tmx-leaderboard-value">${formatNumber(u.Tracks)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="tmx-leaderboard-col">
                        <h5><i class="fas fa-trophy"></i> Most Awarded</h5>
                        ${topAwarded.map(u => `
                            <div class="tmx-leaderboard-entry">
                                <a href="/usershow/${u.UserId}" class="userlink-title" title="${u.Name}">${u.Name}</a>
                                <span class="tmx-leaderboard-value">${formatNumber(u.TrackAwardsReceived)}</span>
                            </div>
                        `).join('')}
                    </div>
                    <div class="tmx-leaderboard-col">
                        <h5><i class="fas fa-stopwatch"></i> Top Players</h5>
                        ${topPlayers.map(u => `
                            <div class="tmx-leaderboard-entry">
                                <a href="/usershow/${u.UserId}" class="userlink-title" title="${u.Name}">${u.Name}</a>
                                <span class="tmx-leaderboard-value">${formatNumber(u.Replays)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        searchLb.parentNode.insertBefore(card, searchLb);
    }

    function addDownloadButtonsToTable() {
        const table = document.querySelector('#searchLB table');
        if (!table) return;

        // Add header column
        const headerRow = table.querySelector('thead tr');
        if (headerRow && !headerRow.querySelector('th.tmx-user-actions')) {
            const th = document.createElement('th');
            th.className = 'WindowTableHeader1 tmx-user-actions';
            th.width = '60';
            th.innerHTML = '<i class="fas fa-download" style="margin-left:1rem;"></i>';
            headerRow.insertBefore(th, headerRow.firstChild);
        }

        // Add buttons to each row
        const rows = table.querySelectorAll('tbody tr.WindowTableRow');
        rows.forEach(row => {
            if (row.querySelector('.tmx-download-user-btn')) return;
            
            const userLink = row.querySelector('a.userlink-title');
            if (!userLink) return;
            
            const userId = userLink.href.match(/\/usershow\/(\d+)/)?.[1];
            if (!userId) return;

            const td = document.createElement('td');
            td.className = 'no-ellipsis tmx-button-cell';
            td.innerHTML = `<button class="tmx-download-user-btn btn btn-sm btn-primary" data-user-id="${userId}" title="Download metadata">
                <i class="fas fa-download"></i>
            </button>`;
            
            row.insertBefore(td, row.firstChild);
        });

        // Add event listeners (delegated)
        if (!table.dataset.listenerAdded) {
            table.addEventListener('click', async (e) => {
                const btn = e.target.closest('.tmx-download-user-btn');
                if (btn) {
                    e.stopPropagation();
                    const userId = btn.dataset.userId;
                    await handleDownloadUserMetadata(userId);
                }
            });
            table.dataset.listenerAdded = "true";
        }
    }

    // ============================================================================
    // UI CREATION - INDIVIDUAL USER PAGE (/usershow)
    // ============================================================================
    function createUserStatsCard() {
        const statsCard = document.createElement('div');
        statsCard.className = 'card';
        statsCard.id = 'tmx-user-stats-card'; // ID for individual page
        statsCard.innerHTML = `
            <div class="card-header">
                <div class="row">
                    <div class="col">
                        <i class="fas fa-chart-line"></i> User Statistics & Scores
                    </div>
                    <div class="col-auto text-end">
                        <a role="button" id="tmx-refresh-user-stats"><i class="fas fa-sync-alt"></i> Refresh</a>
                    </div>
                </div>
            </div>
            <div class="card-body" id="tmx-user-stats-content">
                <div style="text-align: center; padding: 40px;">
                    <i class="fas fa-spinner fa-spin fa-2x" style="color: var(--primary-color);"></i>
                    <p style="margin-top: 15px;">Loading user statistics...</p>
                </div>
            </div>
        `;
        return statsCard;
    }

    function renderUserStatsContent(userData, playerScore, builderScore, activityStatus) {
        return `
            <div class="tmx-stat-section">
                <h5 class="mb-3 text-primary fw-semibold">
                    <i class="fas fa-signal me-2" aria-hidden="true"></i> Activity Status
                </h5>
                
                <div class="tmx-activity-card">
                    <div class="tmx-activity-status tmx-status-${activityStatus.status}">
                        <div class="tmx-status-icon">
                            <i class="fas ${activityStatus.icon}" aria-hidden="true"></i>
                        </div>
                        
                        <div class="tmx-status-content">
                            <span class="tmx-status-label">${activityStatus.label}</span>
                            <span class="tmx-status-details">${activityStatus.details}</span>
                        </div>
                    </div>
                    
                    ${activityStatus.score > 0 ? `
                    <div class="tmx-status-metrics">
                        <div class="tmx-status-metric">
                            <span class="tmx-metric-value">#${activityStatus.position}</span>
                            <span class="tmx-metric-label">Position</span>
                        </div>
                        <div class="tmx-status-metric">
                            <span class="tmx-metric-value">${formatNumber(activityStatus.score)}</span>
                            <span class="tmx-metric-label">Score</span>
                        </div>
                        <div class="tmx-status-metric">
                            <span class="tmx-metric-value" style="color: ${activityStatus.delta > 0 ? '#28a745' : activityStatus.delta < 0 ? '#dc3545' : 'var(--muted-textcolor)'}">
                                ${activityStatus.delta > 0 ? '+' : ''}${activityStatus.delta}
                            </span>
                            <span class="tmx-metric-label">Delta</span>
                        </div>
                        ${activityStatus.daysSince !== null && activityStatus.daysSince < 999 ? `
                        <div class="tmx-status-metric">
                            <span class="tmx-metric-value">${activityStatus.daysSince}</span>
                            <span class="tmx-metric-label">Days Ago</span>
                        </div>
                        ` : ''}
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="tmx-stat-section">
                <h5 style="margin-bottom: 15px; color: var(--primary-color); font-weight: 600;" data-tooltip="Based on replays, awards received, favorites, achievements, and author medals">
                    <i class="fas fa-gamepad"></i> Player Score
                </h5>
                <div class="tmx-score-container">
                    <div class="tmx-score-circle">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#e0e0e0" stroke-width="8"/>
                            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--primary-color)" stroke-width="8"
                                    stroke-dasharray="${(playerScore.percentage * 339.292) / 100} 339.292"
                                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                            <text x="60" y="60" text-anchor="middle" dy=".3em"
                                style="font-size: 28px; font-weight: bold; fill: var(--primary-color);">
                                ${playerScore.total}
                            </text>
                            <text x="60" y="80" text-anchor="middle"
                                style="font-size: 12px; fill: #666;">
                                / 10000
                            </text>
                        </svg>
                    </div>
                    <div class="tmx-score-breakdown">
                        <h6 style="margin-bottom: 10px; font-weight: 600;">Score Breakdown:</h6>
                        ${Object.entries(playerScore.breakdown).map(([key, value]) => `
                            <div class="tmx-score-item" data-tooltip="${getPlayerScoreTooltip(key)}">
                                <span class="tmx-score-label">${formatScoreLabel(key)}:</span>
                                <span class="tmx-score-value">${Math.round(value)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>

            <div class="tmx-stat-section">
                <h5 style="margin-bottom: 15px; color: var(--secondary-color); font-weight: 600;" data-tooltip="Based on tracks, awards given, comments, trackpacks, videos, and forum activity">
                    <i class="fas fa-hammer"></i> Builder Score
                </h5>
                <div class="tmx-score-container">
                    <div class="tmx-score-circle">
                        <svg width="120" height="120" viewBox="0 0 120 120">
                            <circle cx="60" cy="60" r="54" fill="none" stroke="#e0e0e0" stroke-width="8"/>
                            <circle cx="60" cy="60" r="54" fill="none" stroke="var(--secondary-color)" stroke-width="8"
                                    stroke-dasharray="${(builderScore.percentage * 339.292) / 100} 339.292"
                                    stroke-linecap="round" transform="rotate(-90 60 60)"/>
                            <text x="60" y="60" text-anchor="middle" dy=".3em"
                                style="font-size: 28px; font-weight: bold; fill: var(--secondary-color);">
                                ${builderScore.total}
                            </text>
                            <text x="60" y="80" text-anchor="middle"
                                style="font-size: 12px; fill: #666;">
                                / 10000
                            </text>
                        </svg>
                    </div>
                    <div class="tmx-score-breakdown">
                        <h6 style="margin-bottom: 10px; font-weight: 600;">Score Breakdown:</h6>
                        ${Object.entries(builderScore.breakdown).map(([key, value]) => `
                            <div class="tmx-score-item" data-tooltip="${getBuilderScoreTooltip(key)}">
                                <span class="tmx-score-label">${formatScoreLabel(key)}:</span>
                                <span class="tmx-score-value">${Math.round(value)}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    // ============================================================================
    // HELPERS
    // ============================================================================
    function formatScoreLabel(key) {
        const labels = {
            replays: 'Replays',
            awardsReceived: 'Awards Received',
            favorites: 'Favorites',
            achievements: 'Achievements',
            authorMedals: 'Author Medals',
            tracks: 'Tracks Uploaded',
            awardsGiven: 'Awards Given',
            commentsReceived: 'Comments Received',
            commentsGiven: 'Comments Given',
            trackPacks: 'Trackpacks',
            videos: 'Videos',
            forumThreads: 'Forum Threads'
        };
        return labels[key] || key;
    }

    function getPlayerScoreTooltip(key) {
        const tooltips = {
            replays: '0.5 point per replay (max 5000)',
            commentsGiven: '0.5 point per comment given',
            awardsGiven: '2 points per award received',
            favorites: '2 points per favorite',
            authorMedals: '1 points per author medal'
        };
        return tooltips[key] || '';
    }

    function getBuilderScoreTooltip(key) {
        const tooltips = {
            tracks: '50 points per track uploaded (max 5000)',
            awardsGiven: '5 points per award given',
            commentsReceived: '2 points per comment received',
            awardsReceived: '10 points per award received',
            trackPacks: '20 points per trackpack',
            videos: '20 points per video',
            forumThreads: '10 points per forum thread'
        };
        return tooltips[key] || '';
    }

    // ============================================================================
    // DOWNLOAD HANDLERS
    // ============================================================================
    async function handleDownloadUserMetadata(userId) {
        const button = document.querySelector(`[data-user-id="${userId}"]`);
        if (button) {
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            button.disabled = true;
        }

        try {
            // This will now fetch detailed data if not fully cached
            const userData = await fetchUserMetadata(userId); 
            if (!userData) {
                throw new Error('Failed to fetch user metadata');
            }
            
            const jsonStr = JSON.stringify(userData, null, 2);
            const blob = new Blob([jsonStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = sanitizeFilename(`${userData.Name}_metadata.json`);
            a.click();
            URL.revokeObjectURL(url);
            
        } catch (error) {
            console.error('[TMX] Download error:', error);
            alert(`Error: ${error.message}`);
        } finally {
            if (button) {
                button.innerHTML = '<i class="fas fa-download download-top-icon"></i>';
                button.disabled = false;
            }
        }
    }

    // ============================================================================
    // MAIN UI INTEGRATION
    // ============================================================================
    function addUserStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* Action Buttons in Table */
            .tmx-button-cell {
                text-align: center;
                vertical-align: middle;
            }
            .tmx-button-cell + td {
                padding-left: 1.5rem !important;  /* Shifts username/image right */
            }
            th.tmx-user-actions + th {
                padding-left: 1.5rem !important;  /* Shifts header "User" column right */
            }
            @media (max-width: 768px) {
                .tmx-button-cell + td {
                    padding-left: 10px !important;
                }
                th.tmx-user-actions + th {
                    padding-left: 10px !important;
                }
            }
            /* Action Buttons in Table */
            .tmx-user-actions {
                text-align: center;
                padding: 0 !important;
            }
            
            .tmx-download-user-btn {
                padding: 4px 8px;
                font-size: 12px;
                min-width: 32px;
            }

            /* Activity Indicator (/usershow) */
            .tmx-activity-indicator {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 15px;
                border-radius: 8px;
                font-weight: 600;
                font-size: 16px;
                margin-bottom: 20px;
            }
            
            .tmx-activity-indicator i {
                font-size: 24px;
            }
            .tmx-activity-indicator small {
                font-weight: 400;
                opacity: 0.8;
                margin-left: 5px;
            }
            
            .tmx-activity-active {
                background: rgba(40, 167, 69, 0.15);
                color: #28a745;
                border: 1px solid #28a745;
            }
            
            .tmx-activity-recent {
                background: rgba(32, 201, 151, 0.15);
                color: #20c997;
                border: 1px solid #20c997;
            }
            
            .tmx-activity-idle {
                background: rgba(255, 193, 7, 0.15);
                color: #ffc107;
                border: 1px solid #ffc107;
            }
            
            .tmx-activity-inactive {
                background: rgba(220, 53, 69, 0.15);
                color: #dc3545;
                border: 1px solid #dc3545;
            }
            
            .tmx-activity-unknown {
                background: rgba(108, 117, 125, 0.15);
                color: #6c757d;
                border: 1px solid #6c757d;
            }

            /* Leaderboard Panel (/usersearch) */
            #tmx-user-leaderboard-card {
                margin-bottom: 20px;
                animation: fadeIn 0.3s ease-in;
            }

            .tmx-leaderboard-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
            }

            .tmx-leaderboard-col h5 {
                color: var(--primary-color);
                font-weight: 600;
                border-bottom: 2px solid var(--primary-color);
                padding-bottom: 8px;
                margin-bottom: 10px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .tmx-leaderboard-entry {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 6px 4px;
                border-bottom: 1px solid var(--card-secondary-bordercolor);
                font-size: 13px;
            }
            .tmx-leaderboard-entry:last-child {
                border-bottom: none;
            }
            .tmx-leaderboard-entry .userlink-title {
                font-weight: 500;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
                max-width: 150px;
            }
            .tmx-leaderboard-value {
                font-weight: 700;
                color: var(--primary-color);
                font-family: 'Courier New', monospace;
                font-size: 14px;
            }

            /* Copied Styles from trackshow for Scores */
            .tmx-stat-section {
                margin-bottom: 30px;
                padding-bottom: 20px;
                border-bottom: 1px solid var(--card-secondary-bordercolor);
            }
            .tmx-stat-section:last-child {
                border-bottom: none;
                margin-bottom: 0;
            }
            .tmx-score-container {
                display: flex;
                align-items: center;
                gap: 30px;
                padding: 20px;
                background: var(--card-secondary-bgcolor);
                border-radius: 8px;
                border: 1px solid var(--card-secondary-bordercolor);
            }
            .tmx-score-circle { flex-shrink: 0; }
            .tmx-score-breakdown { flex: 1; min-width: 0; }
            .tmx-score-item {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid var(--card-secondary-bordercolor);
            }
            .tmx-score-item:last-child { border-bottom: none; }
            .tmx-score-label { color: var(--main-textcolor); font-weight: 500; font-size: 14px; }
            .tmx-score-value { color: var(--primary-color); font-weight: 600; font-size: 14px; }
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
                font-family: 'Courier New', monospace;
            }
            @keyframes fadeIn {
                from { opacity: 0; transform: translateY(10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            @media (max-width: 768px) {
                .tmx-score-container { flex-direction: column; }
            }
        `;
        document.head.appendChild(style);
    }

    async function loadAndRenderUserStats(userId) {
        const existingCard = document.getElementById('tmx-user-stats-card');
        if (existingCard) existingCard.remove();

        const statsCard = createUserStatsCard();
        
        // Insert after user info card on usershow page
        const commentsHeaders = document.querySelectorAll('.card-header');
        const commentsHeader = Array.from(commentsHeaders).find(header => 
            header.textContent.trim().includes('User Comments')
        );
        if (commentsHeader) {
            const commentsCard = commentsHeader.closest('.card');
            if (commentsCard) {
                commentsCard.parentNode.insertBefore(statsCard, commentsCard.nextSibling);
            }
        }

        const contentDiv = statsCard.querySelector('#tmx-user-stats-content');
        
        try {
                // Fetch data with loading states (sequential to avoid duplicate)
                const userData = await fetchUserMetadata(userId);
                
                if (!userData) {
                    throw new Error('Failed to fetch user data - user may not exist or API error');
                }

                const activityData = await fetchUserRecentActivity(userId, userData);

                // Calculate scores
                const playerScore = calculatePlayerScore(userData);
                const builderScore = calculateBuilderScore(userData);
                const activityStatus = calculateActivityStatus(activityData);

                // Cache data
                TMX_STATE.activityData.set(parseInt(userId, 10), activityStatus);

            // Render
            contentDiv.innerHTML = renderUserStatsContent(userData, playerScore, builderScore, activityStatus);
            
        } catch (error) {
            console.error('[TMX] Error loading user stats:', error);
            contentDiv.innerHTML = `
                <div style="text-align: center; padding: 40px; color: #ff6666;">
                    <i class="fas fa-exclamation-triangle fa-2x"></i>
                    <p style="margin-top: 15px;">Failed to load user statistics</p>
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
        
        console.log('[TMX] Initializing user enhancements');
        
        // Add styles
        addUserStyles();
        
        const pathname = window.location.pathname;
        
        if (pathname.includes('/usersearch')) {
            // --- User Search Page ---
            
            // 1. Inject Leaderboard Card
            try {
                const usersList = await fetchUsersData(); // Fetches list and populates cache
                const searchLB = document.getElementById('searchLB');
                if (searchLB && usersList && usersList.length > 0) {
                    injectLeaderboardCard(usersList);
                }
            } catch (e) {
                console.error("[TMX] Failed to load user leaderboard:", e);
            }
            
            // 2. Add Download Buttons to Table
            const waitForTable = setInterval(() => {
                const table = document.querySelector('#searchLB table');
                if (table) {
                    clearInterval(waitForTable);
                    addDownloadButtonsToTable();
                    
                    // Watch for dynamic table updates
                    const observer = new MutationObserver((mutations) => {
                        // Check if nodes were added
                        if (mutations.some(m => m.addedNodes.length > 0)) {
                            addDownloadButtonsToTable();
                        }
                    });
                    observer.observe(table.querySelector('tbody'), { childList: true });
                }
            }, 500);
            
            setTimeout(() => clearInterval(waitForTable), 10000);
            
        } else if (pathname.includes('/usershow/')) {
            // --- Individual User Page ---
            // Extract ID from URL first (for backward compatibility)
            const urlUserId = pathname.match(/\/usershow\/(\d+)/)?.[1];
            
            const waitForUserCard = setInterval(() => {
                const userCard = document.querySelector('.card');
                if (userCard) {
                    clearInterval(waitForUserCard);
                    
                    // Try URL first, then fallback to DOM extraction
                    let userId = urlUserId;
                    if (!userId) {
                        userId = extractUserIdFromTemplate();
                        console.log('[TMX] Extracted user ID from DOM:', userId);
                    }
                    
                    if (!userId) {
                        console.error('[TMX] Could not extract user ID from URL or DOM');
                        return;
                    }
                    
                    loadAndRenderUserStats(userId);
                    // Add refresh handler
                    document.body.addEventListener('click', (e) => {
                        if (e.target.closest('#tmx-refresh-user-stats')) {
                            loadAndRenderUserStats(userId);
                        }
                    });
                }
            }, 500);
            
            setTimeout(() => clearInterval(waitForUserCard), 10000);
        }
        
        console.log('[TMX] User enhancements initialized');
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
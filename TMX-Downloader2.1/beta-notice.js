// ============================================================================
// BETA PAGE NOTICE - Enhanced TMX-styled version
// ============================================================================
(function() {
    'use strict';
    
    // Only run on beta pages
    if (!window.location.pathname.includes('/trackbeta')) return;
    
    // Wait for DOM ready
    if (document.readyState !== 'loading') {
        injectNotice();
    } else {
        document.addEventListener('DOMContentLoaded', injectNotice);
    }
    
    function injectNotice() {        
        // Add custom styling first
        const style = document.createElement('style');
        style.textContent = `
            .tmx-beta-info-card {
                animation: tmxBetaSlideIn 0.4s ease-out;
                margin: 20px 0;
                border-left: 4px solid #d92828 !important;
            }
            
            @keyframes tmxBetaSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px);
                }
                to {
                    opacity: 1;
                    transform: translateY(0);
                }
            }
            
            .tmx-beta-dismiss:hover {
                opacity: 1 !important;
            }
            
            .tmx-beta-info-card .btn {
                transition: all 0.2s;
            }
            
            .tmx-beta-info-card .btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
            }
            
            @media (max-width: 600px) {
                .tmx-beta-content-flex {
                    flex-direction: column !important;
                }
                
                .tmx-beta-text-content {
                    padding-right: 0 !important;
                }
            }
        `;
        document.head.appendChild(style);
        
        // Create notice card
        const notice = document.createElement('div');
        notice.className = 'card tmx-beta-info-card';
        notice.id = 'tmx-beta-notice';
        
        notice.innerHTML = `
            <div class="card-body" style="position: relative; padding: 20px;">
                <button class="tmx-beta-dismiss" style="
                    position: absolute;
                    top: 10px;
                    right: 10px;
                    background: none;
                    border: none;
                    color: #999;
                    font-size: 24px;
                    cursor: pointer;
                    opacity: 0.6;
                    transition: opacity 0.2s;
                    line-height: 1;
                    padding: 0;
                    width: 30px;
                    height: 30px;
                ">&times;</button>
                
                <div class="tmx-beta-content-flex" style="display: flex; align-items: flex-start; gap: 15px;">
                    <div style="
                        background: #d92828;
                        border-radius: 50%;
                        width: 48px;
                        height: 48px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        flex-shrink: 0;
                    ">
                        <i class="fas fa-info" style="color: white; font-size: 24px;"></i>
                    </div>
                    
                    <div class="tmx-beta-text-content" style="flex: 1; padding-right: 20px;">
                        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
                            <h4 style="
                                margin: 0;
                                color: #d92828;
                                font-size: 18px;
                                font-weight: 600;
                            ">Looking for beta tracks to download?</h4>
                            <span style="
                                background: #f0f0f0;
                                color: #666;
                                font-size: 11px;
                                padding: 2px 8px;
                                border-radius: 3px;
                                font-weight: 600;
                                text-transform: uppercase;
                                letter-spacing: 0.5px;
                            ">TMX Downloader</span>
                        </div>
                        
                        <p style="margin: 0 0 12px 0; line-height: 1.6; font-size: 14px;">
                            To download beta tracks with the TMX Downloader extension, use <strong>Track Search</strong> 
                            and enable the <strong>Collection: BetaTracks</strong> filter.
                        </p>
                        
                        <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
                            <a href="/tracksearch?query=in%3A+beta" class="btn btn-primary" style="
                                display: inline-flex;
                                align-items: center;
                                gap: 8px;
                                padding: 8px 16px;
                                text-decoration: none;
                            ">
                                <i class="fas fa-flask"></i>
                                <span>Search Beta Tracks</span>
                            </a>
                        </div>
                    </div>
                </div>
            </div>
        `;
        // Insert after first <h3> ("Beta Area")
        const firstH3 = document.querySelector('h3');
        if (firstH3) {
            firstH3.parentNode.insertBefore(notice, firstH3.nextSibling);
        } else {
            // Fallback: prepend to main
            const main = document.querySelector('main');
            if (main) main.prepend(notice);
        }
    }
})();
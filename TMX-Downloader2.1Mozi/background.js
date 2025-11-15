// Firefox-kompatible Version mit browser.* API
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectFetchOverride') {
    browser.tabs.executeScript(sender.tab.id, {
      code: `
        (function() {
          const originalFetch = window.fetch;
          window.fetch = function(...args) {
            const url = args[0] instanceof Request ? args[0].url : args[0];
            if (typeof url === 'string' && url.includes('/api/tracks')) {
              const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
              document.documentElement.setAttribute('data-tmx-api-url', absoluteUrl);
              window.dispatchEvent(new CustomEvent('tmx-api-captured', { detail: { url: absoluteUrl } }));
              console.log('[TMX Fetch Intercept] ✅ Captured:', absoluteUrl);
            }
            return originalFetch.apply(this, args);
          };
          console.log('[TMX] Fetch interceptor installed at document-start');
        })();
      `,
      runAt: 'document_start'
    }).then((results) => {
      sendResponse({success: true});
    }).catch((error) => {
      sendResponse({success: false, error: error.message});
    });
    
    return true; // Wichtig: Async response
  }
});
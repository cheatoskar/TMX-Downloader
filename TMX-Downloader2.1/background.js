chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'injectFetchOverride') {
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: 'MAIN',
      func: () => {
        const originalFetch = window.fetch;
        window.fetch = function(...args) {
          const url = args[0] instanceof Request ? args[0].url : args[0];
          if (typeof url === 'string') {
            if (url.includes('/api/tracks')) {
              // Existing track logic
              const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
              document.documentElement.setAttribute('data-tmx-api-url', absoluteUrl);
              window.dispatchEvent(new CustomEvent('tmx-api-captured', { detail: { url: absoluteUrl } }));
              console.log('[TMX Fetch Intercept] ✅ Tracks Captured:', absoluteUrl);
            } else if (url.includes('/api/trackpacks')) {
              // 🆕 New: Pack interception
              const absoluteUrl = url.startsWith('http') ? url : new URL(url, window.location.origin).href;
              document.documentElement.setAttribute('data-tmx-pack-api-url', absoluteUrl);
              window.dispatchEvent(new CustomEvent('tmx-pack-api-captured', { detail: { url: absoluteUrl } }));
              console.log('[TMX Fetch Intercept] ✅ Packs Captured:', absoluteUrl);
            }
          }
          return originalFetch.apply(this, args);
        };
        console.log('[TMX] Fetch interceptor installed');
      }
    }).then(() => sendResponse({success: true})).catch((error) => sendResponse({success: false, error: error.message}));
    return true;
  }

    // Existing fetchApi & fetchBinary (unchanged)
  if (request.action === 'fetchApi') {
      fetch(request.url, {
          credentials: 'include' // Add this
      }).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.json();
      }).then(data => sendResponse({success: true, data}))
        .catch(error => sendResponse({success: false, error: error.message}));
      return true;
  }

  if (request.action === 'fetchBinary') {
      fetch(request.url, {
          credentials: 'include' // Add this
      }).then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}: ${r.statusText}`);
          return r.arrayBuffer();
      }).then(ab => {
      const uint8 = new Uint8Array(ab);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      const base64 = btoa(binary);
      sendResponse({success: true, base64});
    }).catch(error => sendResponse({success: false, error: error.message}));
    return true;
  }
});
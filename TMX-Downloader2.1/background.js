// The replay bridge runs in this same worker. Loaded first so its message
// listener is registered before anything can ask it for a status.
importScripts('bridge.js');

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // The search URL is read from the Resource Timing API in the content
  // scripts, so nothing is injected from here and no "scripting"
  // permission is needed.

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

  // The 100% TMX project status shown on TMX's own pages. Credentials are
  // omitted deliberately: the endpoint is public, there is no account behind
  // it, and a request made from a page on tmnf.exchange should not be quietly
  // carrying a cookie for somewhere else.
  if (request.action === 'fetchProject') {
      fetch(request.url, { credentials: 'omit', cache: 'no-store' }).then(r => {
          if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + r.statusText);
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
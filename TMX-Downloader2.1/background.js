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
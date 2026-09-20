// Firefox-kompatible Version des Background Scripts
'use strict';

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // NOTE: the page-world fetch interceptor is injected by the content scripts
  // themselves (see PART 1 of content.js / trackpack.js). No code is executed
  // from a string, and no code is loaded from a remote origin.

  // fetchApi & fetchBinary (adapted for Firefox)
  if (request.action === 'fetchApi') {
    fetch(request.url, {
      credentials: 'include'
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
      credentials: 'include'
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
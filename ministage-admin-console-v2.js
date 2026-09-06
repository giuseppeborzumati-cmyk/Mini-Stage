(() => {
  'use strict';

  // Ripristina il comportamento storico degli Apps Script: fetch standard,
  // senza mode:'no-cors', mantenendo gli endpoint configurati nel progetto.
  if (!window.__miniStageAppsScriptFetchRestored) {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (url.startsWith('https://script.google.com/macros/s/') && init && init.mode === 'no-cors') {
        const restoredInit = { ...init };
        delete restoredInit.mode;
        return nativeFetch(input, restoredInit);
      }
      return nativeFetch(input, init);
    };
    window.__miniStageAppsScriptFetchRestored = true;
  }

  function loadPdfDateExtension() {
    if (document.querySelector('script[data-mini-pdf-date-extension]')) return;
    const ext = document.createElement('script');
    ext.src = 'ministage-pdf-date-extension.js?v=20260906-pdfdate2';
    ext.async = false;
    ext.dataset.miniPdfDateExtension = '1';
    document.body.appendChild(ext);
  }

  // Conserva e carica integralmente il pannello docente attuale.
  const adminScript = document.createElement('script');
  adminScript.src = 'ministage-admin-console-v2-original.js?v=20260906-licei1';
  adminScript.async = false;
  adminScript.addEventListener('load', loadPdfDateExtension, { once: true });
  document.body.appendChild(adminScript);
})();

(() => {
  'use strict';

  // Ripristino compatibilità con l'integrazione Apps Script usata nella versione
  // MiniStage precedente: le chiamate verso i Web App Google tornano a usare
  // il comportamento fetch standard, senza mode:'no-cors'. Gli endpoint restano
  // quelli storici già presenti nel progetto.
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

  // Carica senza modifiche il pannello docente attuale dopo aver ripristinato
  // il comportamento storico delle chiamate Apps Script.
  const adminScript = document.createElement('script');
  adminScript.src = 'ministage-admin-console-v2-original.js?v=20260906-appscriptrestore1';
  adminScript.async = false;
  document.body.appendChild(adminScript);
})();

(() => {
  'use strict';

  // MiniStage Apps Script restore v1 - comportamento storico ripristinato.
  // Le chiamate verso i Web App Google tornano a usare fetch standard,
  // senza mode:'no-cors'. Gli endpoint restano quelli storici del progetto.
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

  // Conserva e carica integralmente il pannello docente attuale.
  const adminScript = document.createElement('script');
  adminScript.src = 'ministage-admin-console-v2-original.js?v=20260906-licei1';
  adminScript.async = false;
  document.body.appendChild(adminScript);
})();

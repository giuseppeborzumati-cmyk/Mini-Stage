(() => {
  'use strict';

  const CORRECT_LS_LABEL = 'LS - Liceo Scientifico opzione Scienze Applicate - Liceo Scientifico opzione Scienze Applicate - Curvatura Economica';

  // Mantiene inalterata la chiave tecnica usata da Firebase e corregge solo
  // la dicitura mostrata all'utente in home, menu, riepiloghi e pannelli.
  function isCurvaturaEconomicaLabel(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return text.includes('liceo scientifico') && text.includes('scienze applicate') && text.includes('curvatura economica');
  }

  function installLabelFormatter() {
    const current = window.getIndirizzoLabel;
    if (typeof current !== 'function' || current.__correctLsCurvaturaLabel) return;

    const wrapped = function(indirizzo) {
      if (isCurvaturaEconomicaLabel(indirizzo)) return CORRECT_LS_LABEL;
      const result = current.apply(this, arguments);
      return isCurvaturaEconomicaLabel(result) ? CORRECT_LS_LABEL : result;
    };
    wrapped.__correctLsCurvaturaLabel = true;
    window.getIndirizzoLabel = wrapped;
  }

  function fixVisibleLabel() {
    installLabelFormatter();

    const container = document.getElementById('container-curvatura-economica');
    const heading = container?.closest('.glass-card')?.querySelector('h4 > span.flex.items-center');
    if (heading) {
      const dot = heading.querySelector('span');
      heading.textContent = '';
      if (dot) heading.appendChild(dot);
      heading.appendChild(document.createTextNode(CORRECT_LS_LABEL));
    }

    document.querySelectorAll('option, td, th, label, p, span, div').forEach(el => {
      if (el.children.length === 0 && isCurvaturaEconomicaLabel(el.textContent) && el.textContent.trim() !== CORRECT_LS_LABEL) {
        el.textContent = CORRECT_LS_LABEL;
      }
    });
  }

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
    ext.src = 'ministage-pdf-date-extension.js?v=20260907-label2';
    ext.async = false;
    ext.dataset.miniPdfDateExtension = '1';
    document.body.appendChild(ext);
  }

  fixVisibleLabel();
  const labelObserver = new MutationObserver(() => fixVisibleLabel());
  labelObserver.observe(document.body, { childList: true, subtree: true });

  // Conserva e carica integralmente il pannello docente attuale.
  const adminScript = document.createElement('script');
  adminScript.src = 'ministage-admin-console-v2-original.js?v=20260907-label2';
  adminScript.async = false;
  adminScript.addEventListener('load', () => {
    fixVisibleLabel();
    loadPdfDateExtension();
  }, { once: true });
  document.body.appendChild(adminScript);
})();

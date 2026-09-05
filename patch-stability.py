from pathlib import Path

p = Path('ministage-complete.js')
s = p.read_text(encoding='utf-8')
old = '''  async function init() {
    if(installed)return;
    core=window.__miniStageCore; f=window.firebaseImports;
    const ready=core?.db && f?.collection && typeof window.openBookingModal==='function' && typeof window.renderStages==='function' && window.jspdf?.jsPDF;
    if(!ready){setTimeout(init,120);return;}
    installed=true;
    window.__MINISTAGE_COMPLETE__={version:VERSION};
    const scannerToken=new URLSearchParams(location.search).get('scanner');
    await ensureCapacity25Seed(); await ensureClassSeed(); await refreshState();
    if(scannerToken){await initMobileScanner(scannerToken);return;}
    installWrappers(); ensureAdminPanels(); renderAdminExtension(); decorateStages(); subscribe(); revealHomeFallback(); scheduleReconcile(400);
  }'''
new = '''  async function init() {
    if(installed)return;
    core=window.__miniStageCore; f=window.firebaseImports;
    const ready=core?.db && f?.collection && typeof window.openBookingModal==='function' && typeof window.renderStages==='function' && window.jspdf?.jsPDF;
    if(!ready){setTimeout(init,120);return;}
    installed=true;
    window.__MINISTAGE_COMPLETE__={version:VERSION,uiReady:false,dataReady:false};
    const scannerToken=new URLSearchParams(location.search).get('scanner');

    // La UI non deve mai attendere Firestore: installa subito tutte le funzioni.
    if(!scannerToken){
      installWrappers();
      ensureAdminPanels();
      renderAdminExtension();
      revealHomeFallback();
      window.__MINISTAGE_COMPLETE__.uiReady=true;
    }

    // Sincronizzazione cloud separata: eventuali ritardi/errori non bloccano i click.
    try {
      await ensureCapacity25Seed();
      await ensureClassSeed();
      await refreshState();
      if(scannerToken){
        await initMobileScanner(scannerToken);
        window.__MINISTAGE_COMPLETE__.uiReady=true;
        window.__MINISTAGE_COMPLETE__.dataReady=true;
        return;
      }
      renderAdminExtension();
      decorateStages();
      subscribe();
      window.__MINISTAGE_COMPLETE__.dataReady=true;
      scheduleReconcile(400);
    } catch(e) {
      console.warn('MiniStage: sincronizzazione iniziale non completata; interfaccia disponibile in modalità resiliente.',e);
      if(scannerToken){
        document.body.innerHTML='<main class="min-h-screen flex items-center justify-center p-6"><div class="max-w-md bg-white rounded-2xl shadow p-6 text-center"><h1 class="font-black text-red-700">Scanner non disponibile</h1><p class="text-sm text-gray-600 mt-2">Impossibile collegarsi al database. Riapri il collegamento quando la connessione è disponibile.</p></div></main>';
      }
    }
  }'''
if old not in s:
    raise SystemExit('Blocco init atteso non trovato')
s = s.replace(old, new, 1)
p.write_text(s, encoding='utf-8')
print('STABILITY_PATCH_OK')

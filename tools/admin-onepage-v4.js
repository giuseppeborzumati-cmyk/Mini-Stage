(() => {
  'use strict';

  const VERSION = '2026.09-docente-onepage-v4';
  const WAITLIST = 'lista_attesa';
  const ACTIVE = 'prenotazione';
  const CHECKED = 'entrato';
  const CANCELLED = 'cancellazione';
  const CLASS_COLLECTION = 'config_classi_ministage';
  const SCANNER_COLLECTION = 'scanner_sessions';
  const SCANNER_TTL_MS = 8 * 60 * 60 * 1000;
  const DEFAULT_CAPACITY = 25;

  let core = null;
  let f = null;
  let installed = false;
  let currentScanner = null;
  let sessionPassword = '';
  let state = { bookings: [], slots: [], caps: {}, classes: {}, sessions: [] };

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const rootPath = (name) => `artifacts/${core.appId}/public/data/${name}`;
  const bookingsPath = () => rootPath(core.collections.prenotazioni);
  const slotsPath = () => rootPath(core.collections.impostazioni);
  const capsPath = () => rootPath(core.collections.capacita);
  const remindersPath = () => rootPath(core.collections.promemoria);
  const classesPath = () => rootPath(CLASS_COLLECTION);
  const scannerPath = () => rootPath(SCANNER_COLLECTION);

  function formatDateIt(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function isoFromDateIt(value) {
    const m = String(value || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return '';
    return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }

  function slotIso(slot) {
    return String(slot?.isoDate || '') || isoFromDateIt(slot?.dateStr || '');
  }

  function weekdayIt(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(d).replace(/^./, x => x.toUpperCase());
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT');
  }

  function statusLabel(b) {
    if (b.type === WAITLIST) return 'Lista d’attesa';
    if (b.type === CHECKED) return 'Presente';
    if (b.type === CANCELLED) return 'Annullata';
    if (b.waitlistPromotedAt || b.waitlistPromotionStatus === 'Ammesso da scorrimento') return 'Ammesso da scorrimento';
    return 'Prenotazione confermata';
  }

  function statusClass(b) {
    if (b.type === WAITLIST) return 'bg-purple-100 text-purple-800';
    if (b.type === CHECKED) return 'bg-green-100 text-green-800';
    if (b.type === CANCELLED) return 'bg-red-100 text-red-800';
    if (b.waitlistPromotedAt) return 'bg-fuchsia-100 text-fuchsia-800';
    return 'bg-indigo-100 text-indigo-800';
  }

  function activeBookings() {
    return state.bookings.filter(b => b.type === ACTIVE || b.type === CHECKED);
  }

  function waitBookings() {
    return state.bookings.filter(b => b.type === WAITLIST).sort((a,b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  function liveForSlot(slotId) {
    return state.bookings.filter(b => b.slotId === slotId && (b.type === ACTIVE || b.type === CHECKED));
  }

  function waitForSlot(slotId) {
    return waitBookings().filter(b => b.slotId === slotId);
  }

  function capacityFor(slot) {
    return Math.max(1, Number(slot?.postiMax || state.caps[slot?.indirizzo] || DEFAULT_CAPACITY) || DEFAULT_CAPACITY);
  }

  function showMessage(msg, error = false) {
    if (typeof window.showMessage === 'function') window.showMessage(msg, error);
    else alert(msg);
  }

  function expectedPassword() {
    return sessionPassword || String(document.getElementById('admin-password')?.value || '');
  }

  function requirePassword(actionLabel) {
    const expected = expectedPassword();
    if (!expected) {
      showMessage('Per questa operazione devi accedere nuovamente all’area docente.', true);
      return false;
    }
    const entered = prompt(`Operazione protetta: ${actionLabel}.\nReinserisci la password docente:`);
    if (entered === null) return false;
    if (entered !== expected) {
      showMessage('Password docente non corretta. Operazione annullata.', true);
      return false;
    }
    return true;
  }

  function hideLegacyAdmin() {
    const dash = document.getElementById('admin-dashboard');
    const root = document.getElementById('mini-admin-console-v2');
    if (!dash || !root) return;
    Array.from(dash.children).forEach(el => {
      if (el === root) return;
      el.style.display = 'none';
      el.dataset.miniLegacyHidden = '1';
    });
  }

  function ensureConsole() {
    const dash = document.getElementById('admin-dashboard');
    if (!dash || document.getElementById('mini-admin-console-v2')) return;

    const root = document.createElement('section');
    root.id = 'mini-admin-console-v2';
    root.className = 'w-full space-y-4 pb-10';
    root.innerHTML = `
      <div class="glass-card p-5 border-l-4 border-indigo-600">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Area Docente / Commissione Orientamento</p>
            <h1 class="text-2xl font-black text-indigo-950 mt-1">Gestione completa MiniStage</h1>
            <p class="text-xs text-gray-500 mt-1">Un’unica schermata con classi, iscritti, lista d’attesa, calendario, autorizzazioni, scanner, PDF e gestione dati.</p>
          </div>
          <button type="button" onclick="window.goToHome?.()" class="bg-white border border-indigo-200 text-indigo-700 px-4 py-2.5 rounded-xl text-xs font-black shadow-sm">Torna alla Home</button>
        </div>
      </div>

      <div id="mini-one-summary" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"></div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-indigo-500">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><p class="text-[10px] font-black uppercase text-indigo-500">Blocco 1</p><h2 class="text-base font-black text-indigo-950">Classi assegnate ai percorsi</h2><p class="text-[10px] text-gray-500">La classe salvata viene usata in conferme, PDF ed elenchi. Le prenotazioni esistenti vengono aggiornate automaticamente.</p></div>
          <button type="button" onclick="window.miniOneSaveClasses()" class="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Salva classi</button>
        </div>
        <div id="mini-one-classes" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-blue-500">
        <div><p class="text-[10px] font-black uppercase text-blue-500">Blocco 2</p><h2 class="text-base font-black text-blue-950">Quadro per indirizzo e disponibilità</h2><p class="text-[10px] text-gray-500">Posti, iscritti, presenti, lista d’attesa e disponibilità per ogni percorso.</p></div>
        <div id="mini-one-path-summary" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-slate-500">
        <div class="flex flex-col xl:flex-row xl:items-end xl:justify-between gap-3">
          <div><p class="text-[10px] font-black uppercase text-slate-500">Blocco 3</p><h2 class="text-base font-black text-slate-950">Archivio completo prenotazioni</h2><p class="text-[10px] text-gray-500">Visualizza tutti i dati disponibili: attivi, presenti, annullati e ammessi da scorrimento.</p></div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full xl:w-auto">
            <input id="mini-one-search" type="search" placeholder="Nome, codice, e-mail, scuola..." class="p-2.5 rounded-xl border border-slate-200 text-xs min-w-64">
            <select id="mini-one-status" class="p-2.5 rounded-xl border border-slate-200 text-xs"><option value="">Tutti gli stati</option><option value="prenotazione">Confermati</option><option value="entrato">Presenti</option><option value="cancellazione">Annullati</option></select>
            <select id="mini-one-address" class="p-2.5 rounded-xl border border-slate-200 text-xs"><option value="">Tutti gli indirizzi</option></select>
          </div>
        </div>
        <div id="mini-one-bookings" class="space-y-3 max-h-[900px] overflow-y-auto compact-scroll pr-1"></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-purple-500">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div><p class="text-[10px] font-black uppercase text-purple-500">Blocco 4</p><h2 class="text-base font-black text-purple-950">Lista d’attesa</h2><p class="text-[10px] text-gray-500">Ordine cronologico per singolo MiniStage e posizione aggiornata.</p></div>
          <div class="flex flex-wrap gap-2"><input id="mini-one-wait-search" type="search" placeholder="Cerca in lista d’attesa..." class="p-2.5 rounded-xl border border-purple-100 text-xs"><button type="button" onclick="window.downloadWaitlistPdf?.()" class="bg-purple-600 text-white px-3 py-2.5 rounded-xl text-xs font-black">PDF lista d’attesa</button></div>
        </div>
        <div id="mini-one-waitlist" class="space-y-3 max-h-[650px] overflow-y-auto compact-scroll"></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-blue-600">
        <div><p class="text-[10px] font-black uppercase text-blue-600">Blocco 5</p><h2 class="text-base font-black text-blue-950">Calendario e capienze</h2><p class="text-[10px] text-gray-500">Tutti gli slot Firebase in un’unica tabella. Puoi modificare, disattivare o eliminare il singolo slot.</p></div>
        <div id="mini-one-capacities" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
        <div class="flex justify-end"><button type="button" onclick="window.miniOneSaveCapacities()" class="bg-blue-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Salva capienze</button></div>
        <div class="overflow-x-auto rounded-2xl border border-blue-100"><table class="w-full min-w-[940px] text-[11px] bg-white"><thead class="bg-blue-50 text-blue-900 uppercase text-[9px]"><tr><th class="p-3 text-left">Attivo</th><th class="p-3 text-left">Percorso</th><th class="p-3 text-left">Data</th><th class="p-3 text-left">Giorno</th><th class="p-3 text-left">Orario</th><th class="p-3 text-left">Posti</th><th class="p-3 text-left">Occupati</th><th class="p-3 text-right">Azioni</th></tr></thead><tbody id="mini-one-calendar"></tbody></table></div>
        <div class="rounded-2xl border border-green-100 bg-green-50/40 p-4 space-y-3">
          <h3 class="text-sm font-black text-green-950">Aggiungi nuova data MiniStage</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-2"><select id="mini-one-new-address" class="p-2.5 rounded-xl border text-xs"></select><input id="mini-one-new-date" type="date" class="p-2.5 rounded-xl border text-xs"><input id="mini-one-new-time" value="14:30 - 16:30" class="p-2.5 rounded-xl border text-xs" aria-label="Orario"><input id="mini-one-new-cap" type="number" min="1" value="25" class="p-2.5 rounded-xl border text-xs" aria-label="Posti"></div>
          <button type="button" onclick="window.miniOneCreateSlot()" class="bg-green-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Aggiungi data</button>
        </div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-emerald-500">
        <div><p class="text-[10px] font-black uppercase text-emerald-600">Blocco 6</p><h2 class="text-base font-black text-emerald-950">Genera prenotazione manuale</h2><p class="text-[10px] text-gray-500">Per inserimenti effettuati direttamente dalla Commissione. L’operazione richiede nuovamente la password docente.</p></div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
          <select id="mini-one-manual-slot" class="p-2.5 rounded-xl border text-xs xl:col-span-2"></select>
          <select id="mini-one-manual-type" class="p-2.5 rounded-xl border text-xs"><option value="prenotazione">Prenotazione confermata</option><option value="lista_attesa">Iscrizione con riserva</option></select>
          <input id="mini-one-manual-name" placeholder="Nome e cognome studente" class="p-2.5 rounded-xl border text-xs">
          <input id="mini-one-manual-school" placeholder="Scuola di provenienza" class="p-2.5 rounded-xl border text-xs">
          <input id="mini-one-manual-email" type="email" placeholder="E-mail" class="p-2.5 rounded-xl border text-xs">
          <input id="mini-one-manual-phone" placeholder="Cellulare" class="p-2.5 rounded-xl border text-xs">
          <select id="mini-one-manual-exit" class="p-2.5 rounded-xl border text-xs"><option value="">Modalità di uscita</option><option value="autonoma">Uscita autonoma</option><option value="ritiro_adulto">Ritiro da adulto</option></select>
          <input id="mini-one-manual-parent" placeholder="Genitore / tutore" class="p-2.5 rounded-xl border text-xs">
          <input id="mini-one-manual-role" placeholder="Ruolo (madre, padre, tutore...)" class="p-2.5 rounded-xl border text-xs">
          <input id="mini-one-manual-pickup" placeholder="Adulto incaricato del ritiro" class="p-2.5 rounded-xl border text-xs">
          <label class="md:col-span-2 xl:col-span-3 flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/40 p-3 text-[10px] text-gray-700"><input id="mini-one-manual-auth" type="checkbox" class="mt-0.5"><span>Confermo che i dati e l’eventuale autorizzazione del genitore/tutore sono stati acquisiti dalla Commissione e possono essere registrati nel sistema.</span></label>
        </div>
        <button type="button" onclick="window.miniOneGenerateBooking()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-5 py-3 rounded-xl text-xs font-black shadow-sm">Genera prenotazione</button>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-orange-500">
        <div><p class="text-[10px] font-black uppercase text-orange-600">Blocco 7</p><h2 class="text-base font-black text-orange-950">Autorizzazioni uscita autonoma</h2><p class="text-[10px] text-gray-500">Stato dell’autorizzazione online e del modulo cartaceo firmato.</p></div>
        <div id="mini-one-auth" class="space-y-3 max-h-[600px] overflow-y-auto compact-scroll"></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-cyan-500">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><p class="text-[10px] font-black uppercase text-cyan-600">Blocco 8</p><h2 class="text-base font-black text-cyan-950">Scanner accoglienza</h2><p class="text-[10px] text-gray-500">Genera il QR per collegare gli smartphone e registra le presenze anche manualmente.</p></div><button type="button" onclick="window.createSmartphoneScannerLink()" class="bg-cyan-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Genera QR scanner</button></div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div id="mini-one-scanner-qr" class="min-h-64 rounded-2xl border border-cyan-100 bg-cyan-50/40 flex items-center justify-center p-4 text-center text-xs text-gray-500">Nessun QR scanner attivo generato in questa sessione.</div><div class="space-y-3"><div class="rounded-xl border border-indigo-100 bg-white p-4"><p class="text-[10px] font-black uppercase text-indigo-500">Registrazione manuale presenza</p><div class="flex gap-2 mt-2"><input id="mini-one-manual-checkin" placeholder="MS-123456" class="flex-1 p-2.5 rounded-xl border text-xs font-mono uppercase"><button type="button" onclick="window.miniOneManualCheckIn()" class="bg-indigo-600 text-white px-3 rounded-xl text-xs font-black">Registra</button></div></div><div id="mini-one-scanner-sessions" class="space-y-2 max-h-64 overflow-y-auto compact-scroll"></div></div></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-l-4 border-red-500">
        <div><p class="text-[10px] font-black uppercase text-red-600">Blocco 9</p><h2 class="text-base font-black text-red-950">PDF ed elenchi</h2></div>
        <div class="flex flex-wrap gap-2"><button type="button" onclick="window.downloadAllClassListsPdf?.()" class="bg-red-600 text-white px-3 py-2.5 rounded-xl text-xs font-black">PDF tutte le classi</button><button type="button" onclick="window.downloadWaitlistPdf?.()" class="bg-purple-600 text-white px-3 py-2.5 rounded-xl text-xs font-black">PDF lista d’attesa</button><div id="mini-one-class-pdfs" class="flex flex-wrap gap-2"></div></div>
      </div>

      <div class="glass-card p-5 space-y-4 border-2 border-red-200 bg-red-50/30">
        <div><p class="text-[10px] font-black uppercase tracking-wider text-red-600">Blocco 10 · Operazioni protette</p><h2 class="text-base font-black text-red-950">Gestione cancellazioni e database</h2><p class="text-[10px] text-red-700">Ogni operazione richiede nuovamente la password docente e una conferma esplicita.</p></div>
        <div class="rounded-xl bg-white border border-red-100 p-4 space-y-2"><p class="text-xs font-black text-red-950">Cancella una prenotazione</p><div class="flex flex-col sm:flex-row gap-2"><input id="mini-one-cancel-code" placeholder="Codice MS-123456" class="flex-1 p-2.5 rounded-xl border border-red-100 text-xs font-mono uppercase"><button type="button" onclick="window.miniOneCancelByCode()" class="bg-red-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Cancella prenotazione</button></div></div>
        <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <button type="button" onclick="window.miniOneClearWaitlist()" class="bg-purple-700 hover:bg-purple-800 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella lista d’attesa</strong><span class="block text-[10px] opacity-80 mt-1">Elimina tutte le richieste con riserva.</span></button>
          <button type="button" onclick="window.miniOneClearBookings()" class="bg-red-700 hover:bg-red-800 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella totale database</strong><span class="block text-[10px] opacity-80 mt-1">Elimina tutte le prenotazioni, attese, annullate e presenze.</span></button>
          <button type="button" onclick="window.miniOneClearDates()" class="bg-orange-600 hover:bg-orange-700 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella date</strong><span class="block text-[10px] opacity-80 mt-1">Elimina tutti gli slot del calendario MiniStage.</span></button>
          <button type="button" onclick="window.miniOneClearEverything()" class="bg-slate-900 hover:bg-black text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella tutto</strong><span class="block text-[10px] opacity-80 mt-1">Azzera prenotazioni, date, capienze, classi, scanner e configurazioni.</span></button>
        </div>
      </div>`;

    dash.prepend(root);
    hideLegacyAdmin();

    document.getElementById('mini-one-search')?.addEventListener('input', renderBookings);
    document.getElementById('mini-one-status')?.addEventListener('change', renderBookings);
    document.getElementById('mini-one-address')?.addEventListener('change', renderBookings);
    document.getElementById('mini-one-wait-search')?.addEventListener('input', renderWaitlist);
  }

  function renderSummary() {
    const root = document.getElementById('mini-one-summary');
    if (!root) return;
    const active = activeBookings();
    const waits = waitBookings();
    const cancelled = state.bookings.filter(b => b.type === CANCELLED);
    const checked = state.bookings.filter(b => b.type === CHECKED);
    const pendingDocs = active.filter(b => b.exitMode === 'autonoma' && !b.authorizationPaperReceived);
    const activeSlots = state.slots.filter(s => s.active !== false);
    const cards = [
      ['Totale record', state.bookings.length, 'text-slate-900'],
      ['Iscritti attivi', active.length, 'text-indigo-950'],
      ['Presenti', checked.length, 'text-green-900'],
      ['Lista d’attesa', waits.length, 'text-purple-950'],
      ['Annullati', cancelled.length, 'text-red-900'],
      ['Moduli da ritirare', pendingDocs.length, 'text-orange-900'],
      ['Date attive', activeSlots.length, 'text-blue-950'],
      ['Ammessi da scorrimento', state.bookings.filter(b => b.waitlistPromotedAt || b.waitlistPromotionStatus === 'Ammesso da scorrimento').length, 'text-fuchsia-950'],
      ['Scanner attivi', state.sessions.filter(s => s.active && Number(s.expiresAt || 0) > Date.now()).length, 'text-cyan-950']
    ];
    root.innerHTML = cards.map(([label,val,color]) => `<div class="glass-card p-4"><p class="text-[9px] uppercase font-black text-gray-500">${esc(label)}</p><p class="text-3xl font-black ${color}">${Number(val)}</p></div>`).join('');
  }

  function renderClasses() {
    const root = document.getElementById('mini-one-classes');
    if (!root) return;
    root.innerHTML = (core?.addresses || []).map(a => `<label class="block rounded-xl border border-indigo-100 bg-white p-3"><span class="block text-[9px] font-black uppercase text-indigo-600 mb-1">${esc(a)}</span><input data-one-class="${esc(a)}" value="${esc(state.classes[a] || '')}" placeholder="Classe assegnata" class="w-full p-2.5 rounded-lg border border-indigo-100 text-xs font-bold"></label>`).join('');
    const pdf = document.getElementById('mini-one-class-pdfs');
    if (pdf) pdf.innerHTML = Object.entries(state.classes).filter(([,c]) => c).map(([a,c]) => `<button type="button" onclick="window.downloadClassListPdf?.('${esc(a).replace(/'/g, "\\'")}')" class="bg-white border border-indigo-200 text-indigo-700 px-3 py-2.5 rounded-xl text-[10px] font-black">${esc(c)}</button>`).join('');
  }

  function renderPathSummary() {
    const root = document.getElementById('mini-one-path-summary');
    if (!root) return;
    root.innerHTML = (core?.addresses || []).map(a => {
      const slots = state.slots.filter(s => s.indirizzo === a && s.active !== false);
      const slotIds = new Set(slots.map(s => s.id));
      const live = activeBookings().filter(b => b.indirizzo === a || slotIds.has(b.slotId));
      const waits = waitBookings().filter(b => b.indirizzo === a || slotIds.has(b.slotId));
      const checked = live.filter(b => b.type === CHECKED).length;
      const capacity = slots.reduce((n,s) => n + capacityFor(s), 0);
      const free = Math.max(0, capacity - live.length);
      const pct = capacity ? Math.min(100, Math.round((live.length / capacity) * 100)) : 0;
      return `<div class="rounded-2xl border border-blue-100 bg-white p-4 space-y-3"><div><p class="text-[9px] font-black uppercase text-blue-500">${esc(state.classes[a] || 'Classe da definire')}</p><h3 class="text-xs font-black text-blue-950 leading-snug">${esc(a)}</h3></div><div class="grid grid-cols-4 gap-2 text-center"><div><p class="text-lg font-black text-indigo-900">${live.length}</p><p class="text-[8px] uppercase text-gray-400">Iscritti</p></div><div><p class="text-lg font-black text-green-800">${checked}</p><p class="text-[8px] uppercase text-gray-400">Presenti</p></div><div><p class="text-lg font-black text-purple-800">${waits.length}</p><p class="text-[8px] uppercase text-gray-400">Attesa</p></div><div><p class="text-lg font-black text-blue-800">${free}</p><p class="text-[8px] uppercase text-gray-400">Liberi</p></div></div><div class="h-2 rounded-full bg-blue-50 overflow-hidden"><div class="h-full bg-blue-500" style="width:${pct}%"></div></div><p class="text-[9px] text-gray-500">${slots.length} date attive · capienza totale ${capacity}</p></div>`;
    }).join('');
  }

  function bookingSearchText(b) {
    return [b.nome,b.code,b.email,b.cellulare,b.scuola,b.indirizzo,b.classeAssegnata,b.parentGuardianName,b.parentGuardianRole,b.pickupAdultName,b.stageDate,b.stageTime].join(' ').toLowerCase();
  }

  function renderBookings() {
    const root = document.getElementById('mini-one-bookings');
    if (!root) return;
    const q = String(document.getElementById('mini-one-search')?.value || '').trim().toLowerCase();
    const status = document.getElementById('mini-one-status')?.value || '';
    const address = document.getElementById('mini-one-address')?.value || '';
    let rows = [...state.bookings].filter(b => b.type !== WAITLIST).sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (q) rows = rows.filter(b => bookingSearchText(b).includes(q));
    if (status) rows = rows.filter(b => b.type === status);
    if (address) rows = rows.filter(b => b.indirizzo === address);
    root.innerHTML = rows.map(b => {
      const paper = b.exitMode === 'autonoma' ? (b.authorizationPaperReceived ? 'Ricevuto' : 'Da ricevere') : 'Non richiesto';
      const exit = b.exitMode === 'autonoma' ? 'Uscita autonoma' : b.exitMode === 'ritiro_adulto' ? `Ritiro adulto: ${b.pickupAdultName || 'da verificare'}` : 'Non indicata';
      return `<article class="rounded-2xl border border-slate-200 bg-white p-4 space-y-3"><div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-slate-950">${esc(b.nome || 'Senza nome')}</strong><span class="${statusClass(b)} px-2 py-0.5 rounded-full text-[9px] font-black">${esc(statusLabel(b))}</span><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold">${esc(b.code || b.id)}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.indirizzo || '')} · ${esc(b.classeAssegnata || state.classes[b.indirizzo] || 'Classe da definire')} · ${esc(b.stageDate || '')} ${esc(b.stageTime || '')}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniOneOpenReceipt('${esc(b.code || b.id)}')" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Ricevuta</button>${b.type === ACTIVE ? `<button type="button" onclick="window.miniOneCheckIn('${esc(b.code)}')" class="bg-green-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black">Segna presente</button>` : ''}${b.type !== CANCELLED ? `<button type="button" onclick="window.miniOneCancelBooking('${esc(b.code)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Cancella prenotazione</button>` : ''}</div></div><div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2 text-[10px]"><p><span class="text-gray-400 uppercase font-black">Scuola</span><br><strong>${esc(b.scuola || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">E-mail</span><br><strong>${esc(b.email || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Cellulare</span><br><strong>${esc(b.cellulare || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Registrata</span><br><strong>${esc(fmtTs(b.timestamp))}</strong></p><p><span class="text-gray-400 uppercase font-black">Uscita</span><br><strong>${esc(exit)}</strong></p><p><span class="text-gray-400 uppercase font-black">Genitore/Tutore</span><br><strong>${esc(b.parentGuardianName || '—')} ${b.parentGuardianRole ? `(${esc(b.parentGuardianRole)})` : ''}</strong></p><p><span class="text-gray-400 uppercase font-black">Autorizzazione online</span><br><strong>${b.exitAuthorizationAccepted || b.declarationAccepted ? 'Acquisita' : 'Non registrata'}</strong></p><p><span class="text-gray-400 uppercase font-black">Modulo cartaceo</span><br><strong>${esc(paper)}</strong></p><p><span class="text-gray-400 uppercase font-black">Promemoria</span><br><strong>${b.reminderSent ? 'Inviato' : 'Non inviato'}</strong></p><p><span class="text-gray-400 uppercase font-black">Attestato</span><br><strong>${b.certificateSent ? 'Inviato' : 'Non inviato'}</strong></p><p><span class="text-gray-400 uppercase font-black">Check-in</span><br><strong>${esc(fmtTs(b.checkInAt))}</strong></p><p><span class="text-gray-400 uppercase font-black">Scorrimento</span><br><strong>${b.waitlistPromotedAt ? `Ammesso ${esc(fmtTs(b.waitlistPromotedAt))}` : '—'}</strong></p></div></article>`;
    }).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuna prenotazione corrispondente.</p>';
  }

  function waitPosition(b) {
    const same = waitForSlot(b.slotId);
    return same.findIndex(x => (x.code || x.id) === (b.code || b.id)) + 1;
  }

  function renderWaitlist() {
    const root = document.getElementById('mini-one-waitlist');
    if (!root) return;
    const q = String(document.getElementById('mini-one-wait-search')?.value || '').trim().toLowerCase();
    let rows = waitBookings();
    if (q) rows = rows.filter(b => bookingSearchText(b).includes(q));
    root.innerHTML = rows.map(b => `<article class="rounded-2xl border border-purple-100 bg-white p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap gap-2 items-center"><strong class="text-sm text-purple-950">${esc(b.nome)}</strong><span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[9px] font-black">Posizione ${waitPosition(b)}</span><span class="font-mono text-[9px] bg-gray-100 px-2 py-0.5 rounded-full">${esc(b.code)}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.indirizzo)} · ${esc(b.classeAssegnata || state.classes[b.indirizzo] || 'Classe da definire')} · ${esc(b.stageDate)} ${esc(b.stageTime)}</p><p class="text-[10px] text-gray-500">${esc(b.scuola || '—')} · ${esc(b.email || '—')} · ${esc(b.cellulare || '—')}</p><p class="text-[9px] text-purple-600 mt-1">Richiesta: ${esc(fmtTs(b.waitlistRequestedAt || b.timestamp))}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniOneOpenReceipt('${esc(b.code)}')" class="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Ricevuta riserva</button><button type="button" onclick="window.miniOneCancelBooking('${esc(b.code)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Cancella richiesta</button></div></article>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuno in lista d’attesa.</p>';
  }

  function renderCapacities() {
    const root = document.getElementById('mini-one-capacities');
    if (!root || root.contains(document.activeElement)) return;
    root.innerHTML = (core?.addresses || []).map(a => `<label class="rounded-xl border border-blue-100 bg-white p-3"><span class="block text-[9px] font-black uppercase text-blue-600 mb-1">${esc(a)}</span><input data-one-cap="${esc(a)}" type="number" min="1" value="${Number(state.caps[a] || DEFAULT_CAPACITY)}" class="w-full p-2.5 rounded-lg border border-blue-100 text-xs font-black"></label>`).join('');
  }

  function renderCalendar() {
    const root = document.getElementById('mini-one-calendar');
    if (!root || root.contains(document.activeElement)) return;
    const sorted = [...state.slots].sort((a,b) => `${slotIso(a)}|${a.indirizzo || ''}`.localeCompare(`${slotIso(b)}|${b.indirizzo || ''}`));
    root.innerHTML = sorted.map(s => {
      const iso = slotIso(s);
      const occupied = liveForSlot(s.id).length;
      return `<tr data-one-slot="${esc(s.id)}" class="border-t border-blue-50 ${s.active === false ? 'opacity-55' : ''}"><td class="p-3"><input data-field="active" type="checkbox" ${s.active === false ? '' : 'checked'}></td><td class="p-3 font-semibold text-blue-950">${esc(s.indirizzo)}</td><td class="p-3"><input data-field="date" type="date" value="${esc(iso)}" class="p-2 rounded-lg border text-xs"></td><td class="p-3 text-gray-500" data-day>${esc(s.day || weekdayIt(iso))}</td><td class="p-3"><input data-field="time" value="${esc(s.time || '')}" class="p-2 rounded-lg border text-xs w-32"></td><td class="p-3"><input data-field="cap" type="number" min="1" value="${capacityFor(s)}" class="p-2 rounded-lg border text-xs w-20"></td><td class="p-3 font-black ${occupied >= capacityFor(s) ? 'text-red-700' : 'text-green-700'}">${occupied}/${capacityFor(s)}</td><td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="window.miniOneSaveSlot('${esc(s.id)}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black mr-1">Salva</button><button type="button" onclick="window.miniOneDeleteSlot('${esc(s.id)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Elimina</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="p-8 text-center text-gray-400 italic">Nessuna data nel database.</td></tr>';
    root.querySelectorAll('input[data-field="date"]').forEach(input => input.addEventListener('change', () => { const row = input.closest('tr'); const day = row?.querySelector('[data-day]'); if (day) day.textContent = weekdayIt(input.value); }));
  }

  function renderManualSlotOptions() {
    const sel = document.getElementById('mini-one-manual-slot');
    const newAddress = document.getElementById('mini-one-new-address');
    const options = [...state.slots].filter(s => s.active !== false).sort((a,b) => `${slotIso(a)}|${a.indirizzo}`.localeCompare(`${slotIso(b)}|${b.indirizzo}`));
    if (sel && !sel.contains(document.activeElement)) sel.innerHTML = '<option value="">Seleziona MiniStage / data</option>' + options.map(s => `<option value="${esc(s.id)}">${esc(s.indirizzo)} · ${esc(s.dateStr || formatDateIt(slotIso(s)))} · ${esc(s.time || '')} · ${liveForSlot(s.id).length}/${capacityFor(s)}</option>`).join('');
    if (newAddress && !newAddress.options.length) newAddress.innerHTML = (core?.addresses || []).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  }

  function renderAuth() {
    const root = document.getElementById('mini-one-auth');
    if (!root) return;
    const docs = state.bookings.filter(b => b.type !== CANCELLED && b.exitMode === 'autonoma').sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    root.innerHTML = docs.map(b => `<article class="rounded-xl border ${b.authorizationPaperReceived ? 'border-green-100 bg-green-50/30' : 'border-orange-100 bg-white'} p-3 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap gap-2 items-center"><strong class="text-xs text-orange-950">${esc(b.nome)}</strong><span class="${b.exitAuthorizationAccepted || b.declarationAccepted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} px-2 py-0.5 rounded-full text-[9px] font-black">${b.exitAuthorizationAccepted || b.declarationAccepted ? 'Autorizzazione online acquisita' : 'Autorizzazione online non registrata'}</span><span class="${b.authorizationPaperReceived ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} px-2 py-0.5 rounded-full text-[9px] font-black">${b.authorizationPaperReceived ? 'Modulo firmato ricevuto' : 'Modulo da consegnare'}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.code)} · ${esc(b.indirizzo)} · ${esc(b.stageDate)} ${esc(b.stageTime)}</p><p class="text-[10px] text-gray-600">Genitore/tutore: <strong>${esc(b.parentGuardianName || '—')}</strong>${b.parentGuardianRole ? ` (${esc(b.parentGuardianRole)})` : ''}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.downloadMiniStageBookingPdf?.('${esc(b.code)}')" class="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-[10px] font-black">PDF + autorizzazione</button>${!b.authorizationPaperReceived ? `<button type="button" onclick="window.markAuthorizationPaperReceived?.('${esc(b.code)}')" class="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black">Segna ricevuto</button>` : ''}</div></article>`).join('') || '<p class="text-xs text-gray-400 italic">Nessuna uscita autonoma registrata.</p>';
  }

  function renderScannerSessions() {
    const root = document.getElementById('mini-one-scanner-sessions');
    if (!root) return;
    const now = Date.now();
    const rows = [...state.sessions].sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 20);
    root.innerHTML = rows.map(s => { const active = !!s.active && Number(s.expiresAt || 0) > now; return `<div class="rounded-xl border ${active ? 'border-cyan-100 bg-cyan-50/40' : 'border-gray-100 bg-gray-50'} p-3 flex items-center justify-between gap-2"><div><strong class="text-[10px] ${active ? 'text-cyan-950' : 'text-gray-500'}">${active ? 'Sessione scanner attiva' : 'Sessione scaduta/revocata'}</strong><p class="text-[9px] text-gray-500">Creata ${esc(fmtTs(s.createdAt))} · Scade ${esc(fmtTs(s.expiresAt))}</p></div>${active ? `<button type="button" onclick="window.miniOneRevokeScanner('${esc(s.id)}')" class="bg-red-50 text-red-700 px-2 py-1 rounded-lg text-[9px] font-black">Revoca</button>` : ''}</div>`; }).join('') || '<p class="text-[10px] text-gray-400 italic">Nessuna sessione scanner.</p>';
  }

  function updateSelects() {
    const address = document.getElementById('mini-one-address');
    if (address && address.options.length <= 1) address.innerHTML = '<option value="">Tutti gli indirizzi</option>' + (core?.addresses || []).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  }

  function renderAll() {
    if (!document.getElementById('mini-admin-console-v2')) return;
    hideLegacyAdmin();
    updateSelects();
    renderSummary();
    renderClasses();
    renderPathSummary();
    renderBookings();
    renderWaitlist();
    renderCapacities();
    renderCalendar();
    renderManualSlotOptions();
    renderAuth();
    renderScannerSessions();
    renderScannerQr();
  }

  async function saveClasses() {
    const inputs = document.querySelectorAll('#mini-one-classes [data-one-class]');
    for (const input of inputs) {
      const indirizzo = input.dataset.oneClass;
      const classe = input.value.trim();
      await f.setDoc(f.doc(core.db, `${classesPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() }, { merge: true });
      const linked = state.bookings.filter(b => b.indirizzo === indirizzo && b.type !== CANCELLED);
      for (const b of linked) await f.setDoc(f.doc(core.db, `${bookingsPath()}/${b.code || b.id}`), { classeAssegnata: classe || 'Da definire', classUpdatedAt: Date.now() }, { merge: true });
    }
    showMessage('Classi assegnate salvate e prenotazioni collegate aggiornate.');
  }

  async function saveCapacities() {
    const inputs = document.querySelectorAll('#mini-one-capacities [data-one-cap]');
    for (const input of inputs) {
      const indirizzo = input.dataset.oneCap;
      const postiMax = Math.max(1, parseInt(input.value, 10) || DEFAULT_CAPACITY);
      const maxOccupied = Math.max(0, ...state.slots.filter(s => s.indirizzo === indirizzo).map(s => liveForSlot(s.id).length));
      if (postiMax < maxOccupied) return showMessage(`Capienza non salvata per ${indirizzo}: uno slot ha già ${maxOccupied} posti occupati.`, true);
      await f.setDoc(f.doc(core.db, `${capsPath()}/${indirizzo}`), { indirizzo, postiMax, updatedAt: Date.now() }, { merge: true });
    }
    showMessage('Capienze salvate.');
  }

  async function saveSlot(id) {
    const slot = state.slots.find(s => s.id === id);
    const row = document.querySelector(`[data-one-slot="${CSS.escape(id)}"]`);
    if (!slot || !row) return;
    const active = !!row.querySelector('[data-field="active"]')?.checked;
    const isoDate = row.querySelector('[data-field="date"]')?.value || '';
    const time = row.querySelector('[data-field="time"]')?.value.trim() || '';
    const cap = Math.max(1, parseInt(row.querySelector('[data-field="cap"]')?.value, 10) || DEFAULT_CAPACITY);
    if (!isoDate || !time) return showMessage('Data e orario sono obbligatori.', true);
    const occupied = liveForSlot(id).length;
    if (cap < occupied) return showMessage(`Capienza non modificata: ci sono già ${occupied} posti occupati.`, true);
    const duplicate = state.slots.some(s => s.id !== id && s.indirizzo === slot.indirizzo && slotIso(s) === isoDate && String(s.time || '') === time);
    if (duplicate) return showMessage('Esiste già uno slot dello stesso percorso con data e orario uguali.', true);
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo: slot.indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax: cap, active, updatedAt: Date.now() }, { merge: true });
    showMessage('MiniStage aggiornato.');
  }

  async function deleteSlot(id) {
    const slot = state.slots.find(s => s.id === id);
    if (!slot) return;
    const linked = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);
    if (linked.length) return showMessage(`Lo slot non può essere eliminato perché ha ${linked.length} prenotazioni/richieste collegate. Puoi disattivarlo.`, true);
    if (!requirePassword('eliminazione singola data')) return;
    if (!confirm(`Eliminare definitivamente ${slot.indirizzo} - ${slot.dateStr || formatDateIt(slotIso(slot))} ${slot.time || ''}?`)) return;
    await f.deleteDoc(f.doc(core.db, `${slotsPath()}/${id}`));
    showMessage('Data eliminata.');
  }

  async function createSlot() {
    const indirizzo = document.getElementById('mini-one-new-address')?.value || '';
    const isoDate = document.getElementById('mini-one-new-date')?.value || '';
    const time = document.getElementById('mini-one-new-time')?.value.trim() || '';
    const postiMax = Math.max(1, parseInt(document.getElementById('mini-one-new-cap')?.value, 10) || DEFAULT_CAPACITY);
    if (!indirizzo || !isoDate || !time) return showMessage('Seleziona indirizzo, data e orario.', true);
    if (state.slots.some(s => s.indirizzo === indirizzo && slotIso(s) === isoDate && String(s.time || '') === time)) return showMessage('Esiste già una data identica per questo percorso.', true);
    const id = `SLOT-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax, active: true, createdAt: Date.now(), updatedAt: Date.now() });
    if (document.getElementById('mini-one-new-date')) document.getElementById('mini-one-new-date').value = '';
    showMessage('Nuova data aggiunta.');
  }

  async function uniqueCode() {
    for (let i = 0; i < 12; i++) {
      const code = `MS-${Math.floor(100000 + Math.random() * 900000)}`;
      const snap = await f.getDoc(f.doc(core.db, `${bookingsPath()}/${code}`));
      if (!snap.exists()) return code;
    }
    return `MS-${String(Date.now()).slice(-6)}`;
  }

  async function generateBooking() {
    if (!requirePassword('generazione prenotazione manuale')) return;
    const slotId = document.getElementById('mini-one-manual-slot')?.value || '';
    const requestedType = document.getElementById('mini-one-manual-type')?.value || ACTIVE;
    const nome = document.getElementById('mini-one-manual-name')?.value.trim() || '';
    const scuola = document.getElementById('mini-one-manual-school')?.value.trim() || '';
    const email = document.getElementById('mini-one-manual-email')?.value.trim() || '';
    const cellulare = document.getElementById('mini-one-manual-phone')?.value.trim() || '';
    const exitMode = document.getElementById('mini-one-manual-exit')?.value || '';
    const parentGuardianName = document.getElementById('mini-one-manual-parent')?.value.trim() || '';
    const parentGuardianRole = document.getElementById('mini-one-manual-role')?.value.trim() || '';
    const pickupAdultName = document.getElementById('mini-one-manual-pickup')?.value.trim() || '';
    const auth = !!document.getElementById('mini-one-manual-auth')?.checked;
    const slot = state.slots.find(s => s.id === slotId && s.active !== false);
    if (!slot) return showMessage('Seleziona un MiniStage attivo.', true);
    if (nome.length < 3 || !scuola || !/^\S+@\S+\.\S+$/.test(email) || String(cellulare).replace(/\D/g,'').length < 7) return showMessage('Completa correttamente nome, scuola, e-mail e cellulare.', true);
    if (!exitMode || !parentGuardianName || !parentGuardianRole || !auth) return showMessage('Completa i dati del genitore/tutore e conferma l’acquisizione dei dati.', true);
    if (exitMode === 'ritiro_adulto' && !pickupAdultName) return showMessage('Indica l’adulto incaricato del ritiro.', true);
    const duplicate = state.bookings.some(b => b.slotId === slotId && b.type !== CANCELLED && String(b.nome || '').trim().toLowerCase() === nome.toLowerCase() && String(b.email || '').trim().toLowerCase() === email.toLowerCase());
    if (duplicate) return showMessage('Esiste già una richiesta non annullata con lo stesso nome ed e-mail per questo MiniStage.', true);
    if (requestedType === ACTIVE && (liveForSlot(slotId).length >= capacityFor(slot) || waitForSlot(slotId).length > 0)) return showMessage('Non posso creare una conferma manuale che superi la capienza o scavalchi la lista d’attesa. Seleziona “Iscrizione con riserva”.', true);
    const code = await uniqueCode();
    const timestamp = Date.now();
    const data = {
      code,
      type: requestedType === WAITLIST ? WAITLIST : ACTIVE,
      slotId,
      indirizzo: slot.indirizzo,
      stageDay: slot.day || weekdayIt(slotIso(slot)),
      stageDate: slot.dateStr || formatDateIt(slotIso(slot)),
      stageTime: slot.time || '',
      nome, scuola, email, cellulare,
      timestamp,
      reminderSent: false,
      certificateSent: false,
      classeAssegnata: state.classes[slot.indirizzo] || 'Da definire',
      exitMode,
      parentGuardianName,
      parentGuardianRole,
      pickupAdultName: exitMode === 'ritiro_adulto' ? pickupAdultName : '',
      declarationAccepted: true,
      declarationTimestamp: timestamp,
      declarationVersion: 'MiniStage-2026-manuale-docente-v1',
      exitAuthorizationAccepted: true,
      exitAuthorizationMode: exitMode,
      exitAuthorizationAcceptedAt: timestamp,
      exitAuthorizationVersion: 'MiniStage-uscita-autorizzazione-manuale-v1',
      authorizationPaperRequired: exitMode === 'autonoma',
      authorizationPaperReceived: false,
      createdByTeacher: true,
      teacherManualEntryAt: timestamp
    };
    if (data.type === WAITLIST) {
      data.waitlistRequestedAt = timestamp;
      data.waitlistStatus = 'Iscrizione con riserva';
      data.iscrizioneConRiserva = true;
    }
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), data);
    showMessage(`${data.type === WAITLIST ? 'Iscrizione con riserva' : 'Prenotazione'} generata: ${code}`);
    setTimeout(() => window.sendAutomaticEmailNotification?.(data, false), 100);
    ['mini-one-manual-name','mini-one-manual-school','mini-one-manual-email','mini-one-manual-phone','mini-one-manual-parent','mini-one-manual-role','mini-one-manual-pickup'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    const authEl = document.getElementById('mini-one-manual-auth'); if (authEl) authEl.checked = false;
  }

  async function openReceipt(code) {
    const b = state.bookings.find(x => (x.code || x.id) === code);
    if (!b) return showMessage('Prenotazione non trovata.', true);
    window.setView?.('receipt', { code: b.code || b.id, type: b.type, data: b });
  }

  async function checkIn(code) {
    const b = state.bookings.find(x => x.code === code);
    if (!b) return showMessage('Prenotazione non trovata.', true);
    if (b.type === WAITLIST) return showMessage('Lo studente è in lista d’attesa.', true);
    if (b.type === CANCELLED) return showMessage('Prenotazione annullata.', true);
    if (b.type === CHECKED) return showMessage('Presenza già registrata.', true);
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { type: CHECKED, checkInAt: Date.now(), checkInSource: 'docente-onepage' }, { merge: true });
    showMessage(`Presenza registrata: ${b.nome}`);
  }

  async function manualCheckIn() {
    const input = document.getElementById('mini-one-manual-checkin');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!/^MS-\d{6}$/.test(code)) return showMessage('Inserisci un codice MS valido.', true);
    await checkIn(code);
    if (input) input.value = '';
  }

  async function cancelBooking(code) {
    const b = state.bookings.find(x => x.code === code);
    if (!b) return showMessage('Prenotazione/richiesta non trovata.', true);
    if (b.type === CANCELLED) return showMessage('Questa prenotazione è già annullata.', true);
    if (!requirePassword(`cancellazione ${code}`)) return;
    if (!confirm(`Confermi la cancellazione di ${b.nome || code}?`)) return;
    const cancelledAt = Date.now();
    const cancelled = { ...b, type: CANCELLED, cancelledAt, cancelledBy: 'docente-onepage' };
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { type: CANCELLED, cancelledAt, cancelledBy: 'docente-onepage' }, { merge: true });
    try { window.sendCancellationEmailNotification?.(cancelled); } catch (_) {}
    showMessage('Prenotazione/richiesta cancellata.');
  }

  async function cancelByCode() {
    const input = document.getElementById('mini-one-cancel-code');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!/^MS-\d{6}$/.test(code)) return showMessage('Inserisci un codice MS valido.', true);
    await cancelBooking(code);
    if (input) input.value = '';
  }

  async function deleteDocs(rows, pathFn) {
    for (const row of rows) await f.deleteDoc(f.doc(core.db, `${pathFn()}/${row.id || row.code}`));
  }

  async function clearWaitlist() {
    if (!requirePassword('cancellazione completa lista d’attesa')) return;
    const rows = waitBookings();
    if (!rows.length) return showMessage('La lista d’attesa è già vuota.');
    if (!confirm(`Eliminare definitivamente tutte le ${rows.length} richieste in lista d’attesa?`)) return;
    await deleteDocs(rows, bookingsPath);
    showMessage('Lista d’attesa cancellata completamente.');
  }

  async function clearBookings() {
    if (!requirePassword('cancellazione totale database prenotazioni')) return;
    if (!state.bookings.length) return showMessage('Il database prenotazioni è già vuoto.');
    if (!confirm(`ATTENZIONE: eliminare definitivamente tutti i ${state.bookings.length} record di prenotazione, lista d’attesa, annullamento e presenza?`)) return;
    await deleteDocs(state.bookings, bookingsPath);
    showMessage('Database prenotazioni cancellato completamente.');
  }

  async function clearDates() {
    if (!requirePassword('cancellazione di tutte le date')) return;
    if (!state.slots.length) return showMessage('Il calendario è già vuoto.');
    if (!confirm(`ATTENZIONE: eliminare definitivamente tutte le ${state.slots.length} date MiniStage? Le prenotazioni eventualmente presenti conserveranno i dati storici della data, ma non ci saranno più slot pubblici.`)) return;
    await deleteDocs(state.slots, slotsPath);
    showMessage('Tutte le date MiniStage sono state cancellate.');
  }

  async function snapshotPath(p) {
    const snap = await f.getDocs(f.collection(core.db, p));
    const out = []; snap.forEach(d => out.push({ id: d.id, ...d.data() })); return out;
  }

  async function clearEverything() {
    if (!requirePassword('AZZERAMENTO COMPLETO MiniStage')) return;
    if (!confirm('ATTENZIONE MASSIMA: questa operazione elimina prenotazioni, lista d’attesa, date, capienze, classi assegnate, sessioni scanner e configurazioni promemoria. Confermi davvero?')) return;
    const text = prompt('Per confermare definitivamente digita: CANCELLA TUTTO');
    if (text !== 'CANCELLA TUTTO') return showMessage('Conferma testuale non corretta. Nessun dato cancellato.', true);
    const paths = [bookingsPath(), slotsPath(), capsPath(), classesPath(), scannerPath(), remindersPath()];
    for (const p of paths) {
      const rows = await snapshotPath(p).catch(() => []);
      for (const row of rows) await f.deleteDoc(f.doc(core.db, `${p}/${row.id}`));
    }
    currentScanner = null;
    showMessage('MiniStage azzerato completamente.');
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function createScannerSession() {
    try {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2,'0')).join('');
      const hash = await sha256(raw);
      const createdAt = Date.now();
      const expiresAt = createdAt + SCANNER_TTL_MS;
      await f.setDoc(f.doc(core.db, `${scannerPath()}/${hash}`), { active: true, createdAt, expiresAt, source: 'docente-onepage' });
      const url = new URL(location.origin + location.pathname);
      url.searchParams.set('scanner', raw);
      url.searchParams.set('v', 'scanner-onepage');
      currentScanner = { raw, hash, url: url.toString(), createdAt, expiresAt };
      renderScannerQr();
      showMessage('QR scanner generato. Valido 8 ore.');
    } catch (e) {
      console.error(e);
      showMessage('Impossibile generare lo scanner.', true);
    }
  }

  function renderScannerQr() {
    const root = document.getElementById('mini-one-scanner-qr');
    if (!root) return;
    if (!currentScanner) return;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(currentScanner.url)}`;
    root.innerHTML = `<div class="space-y-3 w-full"><img src="${esc(qr)}" alt="QR scanner MiniStage" class="w-52 h-52 mx-auto bg-white p-2 rounded-2xl border border-cyan-200 shadow"><p class="text-xs font-black text-cyan-950">Inquadra il QR con gli smartphone dell’accoglienza</p><p class="text-[9px] text-gray-500">Valido fino a ${esc(fmtTs(currentScanner.expiresAt))}</p><div class="flex flex-wrap justify-center gap-2"><button type="button" onclick="window.miniOneCopyScanner()" class="bg-white border border-cyan-200 text-cyan-800 px-3 py-2 rounded-xl text-[10px] font-black">Copia link</button><a href="${esc(currentScanner.url)}" target="_blank" rel="noopener" class="bg-cyan-600 text-white px-3 py-2 rounded-xl text-[10px] font-black">Apri scanner</a><button type="button" onclick="window.miniOneRevokeScanner('${esc(currentScanner.hash)}')" class="bg-red-50 text-red-700 px-3 py-2 rounded-xl text-[10px] font-black">Revoca</button></div></div>`;
  }

  async function copyScanner() {
    if (!currentScanner?.url) return showMessage('Genera prima un QR scanner.', true);
    try { await navigator.clipboard.writeText(currentScanner.url); showMessage('Link scanner copiato.'); }
    catch (_) { showMessage(currentScanner.url); }
  }

  async function revokeScanner(hash) {
    if (!hash) return;
    await f.setDoc(f.doc(core.db, `${scannerPath()}/${hash}`), { active: false, revokedAt: Date.now() }, { merge: true });
    if (currentScanner?.hash === hash) currentScanner = null;
    const root = document.getElementById('mini-one-scanner-qr');
    if (root && !currentScanner) root.textContent = 'Sessione revocata. Genera un nuovo QR quando serve.';
    showMessage('Sessione scanner revocata.');
  }

  function postProcessHomeSlots() {
    const map = {
      'Liceo Scientifico - Scienze Applicate': 'container-liceo',
      'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica': 'container-curvatura-economica',
      'Relazioni Internazionali per il Marketing (RIM)': 'container-rim',
      'Logistica - Quadriennale': 'container-logistica',
      'Costruzione Ambiente e Territorio (CAT)': 'container-cat',
      'Sistema Moda': 'container-moda'
    };
    state.slots.filter(s => s.active === false).forEach(s => {
      const container = document.getElementById(map[s.indirizzo]);
      if (!container) return;
      Array.from(container.children).forEach(card => {
        const text = card.textContent || '';
        if (text.includes(String(s.dateStr || '')) && text.includes(String(s.time || ''))) card.style.display = 'none';
      });
    });
  }

  function installBookingGuards() {
    if (window.__MINISTAGE_ADMIN_ONEPAGE_GUARDS__) return;
    window.__MINISTAGE_ADMIN_ONEPAGE_GUARDS__ = true;
    const baseOpen = window.openBookingModal;
    const baseWait = window.openWaitlistModal;
    const baseRender = window.renderStages;
    if (typeof baseOpen === 'function') window.openBookingModal = function(slotId, ...args) {
      const slot = state.slots.find(s => s.id === slotId);
      if (slot?.active === false) return showMessage('Questo MiniStage è stato disattivato dalla Commissione.', true);
      return baseOpen.call(this, slotId, ...args);
    };
    if (typeof baseWait === 'function') window.openWaitlistModal = function(slotId, ...args) {
      const slot = state.slots.find(s => s.id === slotId);
      if (slot?.active === false) return showMessage('Questo MiniStage è stato disattivato dalla Commissione.', true);
      return baseWait.call(this, slotId, ...args);
    };
    if (typeof baseRender === 'function') window.renderStages = function(...args) {
      const result = baseRender.apply(this, args);
      setTimeout(postProcessHomeSlots, 0);
      return result;
    };
  }

  function subscribe() {
    f.onSnapshot(f.collection(core.db, bookingsPath()), snap => { state.bookings = []; snap.forEach(d => state.bookings.push({ id: d.id, ...d.data() })); renderAll(); }, e => console.warn('Prenotazioni onepage', e));
    f.onSnapshot(f.collection(core.db, slotsPath()), snap => { state.slots = []; snap.forEach(d => state.slots.push({ id: d.id, ...d.data() })); renderAll(); setTimeout(postProcessHomeSlots,0); }, e => console.warn('Slot onepage', e));
    f.onSnapshot(f.collection(core.db, capsPath()), snap => { state.caps = {}; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.caps[x.indirizzo] = Number(x.postiMax || DEFAULT_CAPACITY); }); renderAll(); }, e => console.warn('Capienze onepage', e));
    f.onSnapshot(f.collection(core.db, classesPath()), snap => { state.classes = {}; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.classes[x.indirizzo] = String(x.classe || ''); }); renderAll(); }, e => console.warn('Classi onepage', e));
    f.onSnapshot(f.collection(core.db, scannerPath()), snap => { state.sessions = []; snap.forEach(d => state.sessions.push({ id: d.id, ...d.data() })); renderAll(); }, e => console.warn('Scanner onepage', e));
  }

  function expose() {
    window.miniOneSaveClasses = saveClasses;
    window.miniOneSaveCapacities = saveCapacities;
    window.miniOneSaveSlot = saveSlot;
    window.miniOneDeleteSlot = deleteSlot;
    window.miniOneCreateSlot = createSlot;
    window.miniOneGenerateBooking = generateBooking;
    window.miniOneOpenReceipt = openReceipt;
    window.miniOneCheckIn = checkIn;
    window.miniOneManualCheckIn = manualCheckIn;
    window.miniOneCancelBooking = cancelBooking;
    window.miniOneCancelByCode = cancelByCode;
    window.miniOneClearWaitlist = clearWaitlist;
    window.miniOneClearBookings = clearBookings;
    window.miniOneClearDates = clearDates;
    window.miniOneClearEverything = clearEverything;
    window.createSmartphoneScannerLink = createScannerSession;
    window.miniOneCopyScanner = copyScanner;
    window.miniOneRevokeScanner = revokeScanner;
  }

  function wrapAdminLogin() {
    const base = window.adminLogin;
    if (typeof base !== 'function' || base.__miniOneWrapped) return;
    const wrapped = function(...args) {
      const attempted = String(document.getElementById('admin-password')?.value || '');
      const result = base.apply(this, args);
      setTimeout(() => {
        const dashboard = document.getElementById('admin-dashboard');
        if (dashboard && !dashboard.classList.contains('hidden')) {
          sessionPassword = attempted;
          ensureConsole();
          hideLegacyAdmin();
          renderAll();
        }
      }, 50);
      return result;
    };
    wrapped.__miniOneWrapped = true;
    window.adminLogin = wrapped;
  }

  function init() {
    if (installed) return;
    if (new URLSearchParams(location.search).has('scanner')) return;
    core = window.__miniStageCore;
    f = window.firebaseImports;
    const ready = core?.db && f?.collection && f?.onSnapshot && f?.getDocs && f?.getDoc && window.__MINISTAGE_COMPLETE__?.uiReady;
    if (!ready) return setTimeout(init, 120);
    installed = true;
    window.__MINISTAGE_ADMIN_CONSOLE_V2__ = { version: VERSION, onePage: true };
    expose();
    installBookingGuards();
    ensureConsole();
    wrapAdminLogin();
    subscribe();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init,0), { once:true });
  else setTimeout(init,0);
})();

(() => {
  'use strict';

  const VERSION = '2026.09-docente-pagine-v7';
  const ACTIVE = 'prenotazione';
  const WAITLIST = 'lista_attesa';
  const CHECKED = 'entrato';
  const EXITED = 'uscito';
  const CANCELLED = 'cancellazione';
  const CLASS_COLLECTION = 'config_classi_ministage';
  const SCANNER_COLLECTION = 'scanner_sessions';
  const DEFAULT_CAPACITY = 25;
  const SCANNER_TTL_MS = 8 * 60 * 60 * 1000;
  const CURVATURA = 'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica';

  const defaultClasses = {
    'Liceo Scientifico - Scienze Applicate': '1L Liceo Scienze Applicate',
    'Relazioni Internazionali per il Marketing (RIM)': '1N RIM',
    'Logistica - Quadriennale': '1I Logistica',
    'Costruzione Ambiente e Territorio (CAT)': '1D CAT',
    'Sistema Moda': '1A Sistema Moda',
    [CURVATURA]: ''
  };

  let core = null;
  let f = null;
  let installed = false;
  let sessionPassword = '';
  let currentPage = 'home';
  let bookingSubpage = 'active';
  let publicDataReady = false;
  let currentScanner = null;
  let state = { bookings: [], slots: [], caps: {}, classes: { ...defaultClasses }, sessions: [] };

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

  function isoFromDateIt(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
  }

  function formatDateIt(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function weekdayIt(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(d).replace(/^./, c => c.toUpperCase());
  }

  function normalizeSlot(data, docId = '') {
    const raw = data || {};
    const rawDate = raw.isoDate || raw.date || raw.data || raw.dateStr || '';
    const isoDate = isoFromDateIt(rawDate) || isoFromDateIt(raw.dateStr || '');
    const id = String(docId || raw.id || '').trim();
    return {
      ...raw,
      id,
      isoDate,
      dateStr: String(raw.dateStr || formatDateIt(isoDate) || '').trim(),
      day: String(raw.day || raw.giorno || weekdayIt(isoDate) || '').trim(),
      time: String(raw.time || raw.orario || '14:30 - 16:30').trim(),
      postiMax: Math.max(1, Number(raw.postiMax || raw.capacity || raw.capienza || 0) || 0) || undefined,
      active: raw.active !== false
    };
  }

  function slotIso(slot) {
    return String(slot?.isoDate || '') || isoFromDateIt(slot?.dateStr || '');
  }

  function fmtTs(ts) {
    if (!ts) return '—';
    const d = new Date(Number(ts));
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('it-IT');
  }

  function statusLabel(b) {
    if (b.type === WAITLIST) return 'Lista d’attesa';
    if (b.type === EXITED) return 'Uscito';
    if (b.type === CHECKED) return 'Presente';
    if (b.type === CANCELLED) return 'Annullata';
    if (b.waitlistPromotedAt || b.waitlistPromotionStatus === 'Ammesso da scorrimento') return 'Ammesso da scorrimento';
    return 'Prenotazione confermata';
  }

  function statusBadge(b) {
    if (b.type === WAITLIST) return 'bg-purple-100 text-purple-800';
    if (b.type === EXITED) return 'bg-teal-100 text-teal-800';
    if (b.type === CHECKED) return 'bg-green-100 text-green-800';
    if (b.type === CANCELLED) return 'bg-red-100 text-red-800';
    if (b.waitlistPromotedAt) return 'bg-fuchsia-100 text-fuchsia-800';
    return 'bg-indigo-100 text-indigo-800';
  }

  function activeBookings() {
    return state.bookings.filter(b => b.type === ACTIVE || b.type === CHECKED);
  }

  function waitBookings() {
    return state.bookings.filter(b => b.type === WAITLIST).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  function cancelledBookings() {
    return state.bookings.filter(b => b.type === CANCELLED).sort((a, b) => (b.cancelledAt || b.timestamp || 0) - (a.cancelledAt || a.timestamp || 0));
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

  function classFor(indirizzo, stored = '') {
    const configured = String(state.classes[indirizzo] || '').trim();
    if (configured) return configured;
    const saved = String(stored || '').trim();
    return saved && saved.toLowerCase() !== 'da definire' ? saved : 'Da definire';
  }

  function showMessage(message, error = false) {
    if (typeof window.showMessage === 'function') window.showMessage(message, error);
    else alert(message);
  }

  function expectedPassword() {
    return sessionPassword || String(document.getElementById('admin-password')?.value || '');
  }

  function requirePassword(label) {
    const expected = expectedPassword();
    if (!expected) {
      showMessage('Per questa operazione devi accedere nuovamente all’area docente.', true);
      return false;
    }
    const entered = prompt(`Operazione protetta: ${label}.\nReinserisci la password docente:`);
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

  function pageCard(page, number, title, desc, accent) {
    return `<button type="button" onclick="window.miniTeacherOpenPage('${page}')" class="glass-card p-5 text-left border-l-4 ${accent} hover:-translate-y-0.5 hover:shadow-lg transition min-h-[132px]">
      <p class="text-[10px] font-black uppercase tracking-widest text-gray-400">Blocco ${number}</p>
      <h3 class="text-base font-black text-indigo-950 mt-1">${esc(title)}</h3>
      <p class="text-[11px] text-gray-500 mt-2 leading-relaxed">${esc(desc)}</p>
      <span class="inline-block mt-3 text-[10px] font-black text-indigo-600">Apri pagina →</span>
    </button>`;
  }

  function ensureShell() {
    const dash = document.getElementById('admin-dashboard');
    if (!dash) return null;
    let root = document.getElementById('mini-admin-console-v2');
    if (!root) {
      root = document.createElement('section');
      root.id = 'mini-admin-console-v2';
      dash.appendChild(root);
    }
    if (root.dataset.pagesBuilt === '1') {
      hideLegacyAdmin();
      return root;
    }

    root.dataset.pagesBuilt = '1';
    root.className = 'w-full space-y-4 pb-10';
    root.innerHTML = `
      <div class="glass-card p-5 border-l-4 border-indigo-600">
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p class="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">Area Docente / Commissione Orientamento</p>
            <h1 id="mini-pages-title" class="text-2xl font-black text-indigo-950 mt-1">Gestione MiniStage</h1>
            <p id="mini-pages-subtitle" class="text-xs text-gray-500 mt-1">Scegli il blocco da aprire. Ogni funzione ha una pagina dedicata.</p>
          </div>
          <div class="flex gap-2">
            <button id="mini-pages-back" type="button" onclick="window.miniTeacherHome()" class="hidden bg-indigo-50 text-indigo-700 border border-indigo-100 px-4 py-2.5 rounded-xl text-xs font-black">← Tutti i blocchi</button>
            <button type="button" onclick="window.goToHome?.()" class="bg-white border border-indigo-200 text-indigo-700 px-4 py-2.5 rounded-xl text-xs font-black shadow-sm">Home sito</button>
          </div>
        </div>
      </div>

      <section id="mini-pages-home" class="space-y-4">
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          ${pageCard('classes', 1, 'Classi assegnate', 'Associa e aggiorna la classe relativa a ciascun indirizzo.', 'border-indigo-500')}
          ${pageCard('overview', 2, 'Quadro generale', 'Numeri complessivi, posti, presenti e disponibilità per indirizzo.', 'border-blue-500')}
          ${pageCard('bookings', 3, 'Prenotazioni', 'Prenotazioni, lista d’attesa e cancellazioni con filtri intelligenti.', 'border-emerald-500')}
          ${pageCard('calendar', 4, 'Calendario e capienze', 'Date Firebase, attivazione, modifica, capienze e nuova data.', 'border-sky-500')}
          ${pageCard('auth', 5, 'Autorizzazioni', 'Uscita autonoma e controllo dei moduli cartacei.', 'border-orange-500')}
          ${pageCard('scanner', 6, 'Scanner accoglienza', 'QR smartphone, sessioni attive e registrazione presenze.', 'border-cyan-500')}
          ${pageCard('closure', 7, 'Chiusura e pergamene', 'Invio automatico pergamena a +5 minuti, stato Uscito e chiusura MiniStage.', 'border-teal-500')}
          ${pageCard('pdf', 8, 'PDF ed elenchi', 'Elenchi ufficiali per classi e lista d’attesa.', 'border-red-500')}
          ${pageCard('data', 9, 'Gestione dati', 'Operazioni protette di cancellazione e azzeramento.', 'border-slate-700')}
        </div>
      </section>

      <section id="mini-page-classes" data-mini-page="classes" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-indigo-500 space-y-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div><h2 class="text-lg font-black text-indigo-950">Classi assegnate ai percorsi</h2><p class="text-xs text-gray-500">Le modifiche vengono riportate anche sulle prenotazioni esistenti.</p></div>
            <button type="button" onclick="window.miniTeacherSaveClasses()" class="bg-indigo-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Salva classi</button>
          </div>
          <div id="mini-pages-classes" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
        </div>
      </section>

      <section id="mini-page-overview" data-mini-page="overview" class="hidden space-y-4">
        <div id="mini-pages-summary" class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3"></div>
        <div class="glass-card p-5 border-l-4 border-blue-500 space-y-4">
          <div><h2 class="text-lg font-black text-blue-950">Disponibilità per indirizzo</h2><p class="text-xs text-gray-500">Iscritti, presenti, lista d’attesa, posti liberi e date attive.</p></div>
          <div id="mini-pages-path-summary" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
        </div>
      </section>

      <section id="mini-page-bookings" data-mini-page="bookings" class="hidden space-y-4">
        <div class="glass-card p-3">
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button data-book-sub="active" type="button" onclick="window.miniTeacherBookingSub('active')" class="p-3 rounded-xl text-xs font-black bg-emerald-600 text-white">Prenotazioni</button>
            <button data-book-sub="wait" type="button" onclick="window.miniTeacherBookingSub('wait')" class="p-3 rounded-xl text-xs font-black bg-purple-50 text-purple-700 border border-purple-100">Lista d’attesa</button>
            <button data-book-sub="cancelled" type="button" onclick="window.miniTeacherBookingSub('cancelled')" class="p-3 rounded-xl text-xs font-black bg-red-50 text-red-700 border border-red-100">Cancellazioni</button>
          </div>
        </div>

        <div id="mini-book-sub-active" class="space-y-4">
          <div class="glass-card p-5 border-l-4 border-emerald-500 space-y-4">
            <div><h2 class="text-lg font-black text-emerald-950">Prenotazioni confermate</h2><p class="text-xs text-gray-500">Filtro intelligente per indirizzo e data. I presenti restano conteggiati come posti occupati.</p></div>
            <div id="mini-pages-address-chips" class="flex flex-wrap gap-2"></div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <input id="mini-pages-book-search" type="search" placeholder="Cerca nome, codice, e-mail, scuola..." class="p-2.5 rounded-xl border border-emerald-100 text-xs">
              <select id="mini-pages-book-date" class="p-2.5 rounded-xl border border-emerald-100 text-xs"><option value="">Tutte le date</option></select>
              <select id="mini-pages-book-status" class="p-2.5 rounded-xl border border-emerald-100 text-xs"><option value="">Confermati + presenti</option><option value="prenotazione">Solo confermati</option><option value="entrato">Solo presenti</option></select>
            </div>
            <div id="mini-pages-book-list" class="space-y-3"></div>
          </div>

          <details class="glass-card p-5 border-l-4 border-teal-500 group">
            <summary class="cursor-pointer list-none flex items-center justify-between gap-3"><div><h3 class="text-base font-black text-teal-950">Genera prenotazione manuale</h3><p class="text-[11px] text-gray-500">Inserimento diretto Commissione. La generazione richiede la password docente.</p></div><span class="text-teal-600 font-black">Apri ↓</span></summary>
            <div class="mt-4 space-y-3">
              <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                <select id="mini-pages-manual-slot" class="p-2.5 rounded-xl border text-xs xl:col-span-2"></select>
                <select id="mini-pages-manual-type" class="p-2.5 rounded-xl border text-xs"><option value="prenotazione">Prenotazione confermata</option><option value="lista_attesa">Iscrizione con riserva</option></select>
                <input id="mini-pages-manual-name" placeholder="Nome e cognome studente" class="p-2.5 rounded-xl border text-xs">
                <input id="mini-pages-manual-school" placeholder="Scuola di provenienza" class="p-2.5 rounded-xl border text-xs">
                <input id="mini-pages-manual-email" type="email" placeholder="E-mail" class="p-2.5 rounded-xl border text-xs">
                <input id="mini-pages-manual-phone" type="tel" placeholder="Cellulare" class="p-2.5 rounded-xl border text-xs">
                <select id="mini-pages-manual-exit" class="p-2.5 rounded-xl border text-xs"><option value="">Modalità uscita</option><option value="autonoma">Uscita autonoma</option><option value="ritiro_adulto">Ritiro adulto</option></select>
                <input id="mini-pages-manual-parent" placeholder="Genitore / tutore" class="p-2.5 rounded-xl border text-xs">
                <input id="mini-pages-manual-role" placeholder="Ruolo (madre, padre, tutore...)" class="p-2.5 rounded-xl border text-xs">
                <input id="mini-pages-manual-pickup" placeholder="Adulto incaricato del ritiro" class="p-2.5 rounded-xl border text-xs">
              </div>
              <label class="flex items-start gap-2 text-[10px] text-gray-600"><input id="mini-pages-manual-auth" type="checkbox" class="mt-0.5"><span>Confermo che i dati e le dichiarazioni sono stati acquisiti dalla Commissione.</span></label>
              <button type="button" onclick="window.miniTeacherGenerateBooking()" class="bg-teal-600 text-white px-5 py-3 rounded-xl text-xs font-black">Genera prenotazione</button>
            </div>
          </details>
        </div>

        <div id="mini-book-sub-wait" class="hidden space-y-4">
          <div class="glass-card p-5 border-l-4 border-purple-500 space-y-4">
            <div><h2 class="text-lg font-black text-purple-950">Lista d’attesa</h2><p class="text-xs text-gray-500">Ordine cronologico e posizione per singolo slot.</p></div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select id="mini-pages-wait-address" class="p-2.5 rounded-xl border border-purple-100 text-xs"></select>
              <select id="mini-pages-wait-date" class="p-2.5 rounded-xl border border-purple-100 text-xs"></select>
              <input id="mini-pages-wait-search" type="search" placeholder="Cerca studente o codice..." class="p-2.5 rounded-xl border border-purple-100 text-xs">
            </div>
            <div id="mini-pages-wait-list" class="space-y-3"></div>
          </div>
        </div>

        <div id="mini-book-sub-cancelled" class="hidden space-y-4">
          <div class="glass-card p-5 border-l-4 border-red-500 space-y-4">
            <div><h2 class="text-lg font-black text-red-950">Cancellazione prenotazione</h2><p class="text-xs text-gray-500">Cancella una prenotazione tramite codice. L’operazione è protetta da password.</p></div>
            <div class="flex flex-col sm:flex-row gap-2"><input id="mini-pages-cancel-code" placeholder="MS-123456" class="flex-1 p-2.5 rounded-xl border border-red-100 text-xs font-mono uppercase"><button type="button" onclick="window.miniTeacherCancelByCode()" class="bg-red-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Cancella prenotazione</button></div>
          </div>
          <div class="glass-card p-5 border-l-4 border-rose-400 space-y-4">
            <div><h3 class="text-base font-black text-rose-950">Archivio cancellazioni</h3><p class="text-[11px] text-gray-500">Storico delle prenotazioni annullate.</p></div>
            <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
              <select id="mini-pages-cancel-address" class="p-2.5 rounded-xl border border-rose-100 text-xs"></select>
              <select id="mini-pages-cancel-date" class="p-2.5 rounded-xl border border-rose-100 text-xs"></select>
              <input id="mini-pages-cancel-search" type="search" placeholder="Cerca studente o codice..." class="p-2.5 rounded-xl border border-rose-100 text-xs">
            </div>
            <div id="mini-pages-cancel-list" class="space-y-3"></div>
          </div>
        </div>
      </section>

      <section id="mini-page-calendar" data-mini-page="calendar" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-sky-500 space-y-4">
          <div><h2 class="text-lg font-black text-sky-950">Calendario e capienze</h2><p class="text-xs text-gray-500">Sono mostrati tutti i documenti presenti nella raccolta Firebase, comprese eventuali date prova.</p></div>
          <div id="mini-pages-capacities" class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3"></div>
          <div class="flex justify-end"><button type="button" onclick="window.miniTeacherSaveCapacities()" class="bg-sky-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Salva capienze</button></div>
          <div class="overflow-x-auto rounded-2xl border border-sky-100"><table class="w-full min-w-[980px] text-[11px] bg-white"><thead class="bg-sky-50 text-sky-900 uppercase text-[9px]"><tr><th class="p-3 text-left">Attivo</th><th class="p-3 text-left">Percorso</th><th class="p-3 text-left">Data</th><th class="p-3 text-left">Giorno</th><th class="p-3 text-left">Orario</th><th class="p-3 text-left">Posti</th><th class="p-3 text-left">Occupati</th><th class="p-3 text-right">Azioni</th></tr></thead><tbody id="mini-pages-calendar"></tbody></table></div>
        </div>
        <div class="glass-card p-5 border-l-4 border-green-500 space-y-3">
          <div><h3 class="text-base font-black text-green-950">Aggiungi nuova data MiniStage</h3><p class="text-[11px] text-gray-500">La data viene salvata con ID, data ISO, giorno e data italiana, così è immediatamente utilizzabile anche dalla pagina genitori.</p></div>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-2"><select id="mini-pages-new-address" class="p-2.5 rounded-xl border text-xs"></select><input id="mini-pages-new-date" type="date" class="p-2.5 rounded-xl border text-xs"><input id="mini-pages-new-time" value="14:30 - 16:30" class="p-2.5 rounded-xl border text-xs"><input id="mini-pages-new-cap" type="number" min="1" value="25" class="p-2.5 rounded-xl border text-xs"></div>
          <button type="button" onclick="window.miniTeacherCreateSlot()" class="bg-green-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Aggiungi data</button>
        </div>
      </section>

      <section id="mini-page-auth" data-mini-page="auth" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-orange-500 space-y-4"><div><h2 class="text-lg font-black text-orange-950">Autorizzazioni uscita autonoma</h2><p class="text-xs text-gray-500">Controlla dichiarazione online, modulo cartaceo e PDF.</p></div><div id="mini-pages-auth" class="space-y-3"></div></div>
      </section>

      <section id="mini-page-scanner" data-mini-page="scanner" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-cyan-500 space-y-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><h2 class="text-lg font-black text-cyan-950">Scanner accoglienza</h2><p class="text-xs text-gray-500">Genera un collegamento temporaneo per lo smartphone o registra manualmente un codice.</p></div><button type="button" onclick="window.miniTeacherCreateScanner()" class="bg-cyan-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Genera QR scanner</button></div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4"><div id="mini-pages-scanner-qr" class="min-h-64 rounded-2xl border border-cyan-100 bg-cyan-50/40 flex items-center justify-center p-4 text-center text-xs text-gray-500">Nessun QR scanner generato in questa sessione.</div><div class="space-y-3"><div class="rounded-xl border border-indigo-100 bg-white p-4"><p class="text-[10px] font-black uppercase text-indigo-500">Registrazione manuale presenza</p><div class="flex gap-2 mt-2"><input id="mini-pages-checkin" placeholder="MS-123456" class="flex-1 p-2.5 rounded-xl border text-xs font-mono uppercase"><button type="button" onclick="window.miniTeacherManualCheckIn()" class="bg-indigo-600 text-white px-3 rounded-xl text-xs font-black">Registra</button></div></div><div id="mini-pages-scanner-sessions" class="space-y-2"></div></div></div>
        </div>
      </section>


      <section id="mini-page-closure" data-mini-page="closure" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-teal-500 space-y-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div><h2 class="text-lg font-black text-teal-950">Chiusura automatica MiniStage e pergamene</h2><p class="text-xs text-gray-500">Cinque minuti dopo l’orario di fine, la data viene chiusa. Agli studenti segnati Presenti viene inviata la pergamena e, dopo l’invio riuscito, lo stato passa a Uscito.</p></div>
            <button type="button" onclick="window.runMiniStageAutoClosure?.()" class="bg-teal-600 text-white px-4 py-2.5 rounded-xl text-xs font-black">Controlla ora</button>
          </div>
          <div class="rounded-xl border border-teal-100 bg-teal-50/50 p-3 text-[10px] text-teal-900 leading-relaxed"><strong>Automazione attiva:</strong> il controllo viene eseguito ogni 30 secondi mentre il sito è aperto. Se il browser è stato chiuso, il primo accesso successivo recupera automaticamente eventuali chiusure rimaste in sospeso, senza reinviare pergamene già registrate.</div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3"><div class="rounded-xl border border-green-100 bg-white p-4"><p class="text-[9px] uppercase font-black text-green-600">Presenti da chiudere</p><p id="mini-closure-present" class="text-3xl font-black text-green-950">0</p></div><div class="rounded-xl border border-teal-100 bg-white p-4"><p class="text-[9px] uppercase font-black text-teal-600">Usciti / pergamena inviata</p><p id="mini-closure-exited" class="text-3xl font-black text-teal-950">0</p></div><div class="rounded-xl border border-slate-100 bg-white p-4"><p class="text-[9px] uppercase font-black text-slate-600">MiniStage chiusi</p><p id="mini-closure-closed" class="text-3xl font-black text-slate-950">0</p></div></div>
          <div id="mini-pages-closure-list" class="space-y-3"></div>
        </div>
      </section>

      <section id="mini-page-pdf" data-mini-page="pdf" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-red-500 space-y-4"><div><h2 class="text-lg font-black text-red-950">PDF ed elenchi</h2><p class="text-xs text-gray-500">Genera gli elenchi ufficiali senza entrare in altre pagine.</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.downloadAllClassListsPdf?.()" class="bg-red-600 text-white px-3 py-2.5 rounded-xl text-xs font-black">PDF tutte le classi</button><button type="button" onclick="window.downloadWaitlistPdf?.()" class="bg-purple-600 text-white px-3 py-2.5 rounded-xl text-xs font-black">PDF lista d’attesa</button><div id="mini-pages-class-pdfs" class="flex flex-wrap gap-2"></div></div></div>
      </section>

      <section id="mini-page-data" data-mini-page="data" class="hidden space-y-4">
        <div class="glass-card p-5 border-2 border-red-200 bg-red-50/30 space-y-4">
          <div><h2 class="text-lg font-black text-red-950">Gestione dati e cancellazioni massive</h2><p class="text-xs text-red-700">Tutte le operazioni richiedono nuovamente la password docente e una conferma esplicita.</p></div>
          <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <button type="button" onclick="window.miniTeacherClearWaitlist()" class="bg-purple-700 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella lista d’attesa</strong><span class="block text-[10px] opacity-80 mt-1">Elimina tutte le richieste con riserva.</span></button>
            <button type="button" onclick="window.miniTeacherClearBookings()" class="bg-red-700 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella totale database</strong><span class="block text-[10px] opacity-80 mt-1">Elimina prenotazioni, attese, annullamenti e presenze.</span></button>
            <button type="button" onclick="window.miniTeacherClearDates()" class="bg-orange-600 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella date</strong><span class="block text-[10px] opacity-80 mt-1">Elimina tutti gli slot MiniStage.</span></button>
            <button type="button" onclick="window.miniTeacherClearEverything()" class="bg-slate-900 text-white p-4 rounded-2xl text-left"><strong class="block text-sm">Cancella tutto</strong><span class="block text-[10px] opacity-80 mt-1">Azzera dati, date, classi, capienze e scanner.</span></button>
          </div>
        </div>
      </section>`;

    ['mini-pages-book-search','mini-pages-book-date','mini-pages-book-status','mini-pages-wait-address','mini-pages-wait-date','mini-pages-wait-search','mini-pages-cancel-address','mini-pages-cancel-date','mini-pages-cancel-search'].forEach(id => {
      document.getElementById(id)?.addEventListener('input', renderBookingsPage);
      document.getElementById(id)?.addEventListener('change', renderBookingsPage);
    });
    hideLegacyAdmin();
    return root;
  }

  const pageMeta = {
    classes: ['Classi assegnate', 'Modifica le classi collegate ai sei percorsi MiniStage.'],
    overview: ['Quadro generale', 'Situazione aggiornata di prenotazioni, posti e indirizzi.'],
    bookings: ['Prenotazioni', 'Prenotazioni, lista d’attesa e cancellazioni in tre sottoblocchi.'],
    calendar: ['Calendario e capienze', 'Tutte le date Firebase, comprese eventuali date prova.'],
    auth: ['Autorizzazioni', 'Uscita autonoma e documentazione cartacea.'],
    scanner: ['Scanner accoglienza', 'QR temporanei e registrazione delle presenze.'],
    closure: ['Chiusura e pergamene', 'Invio automatico a +5 minuti e passaggio da Presente a Uscito.'],
    pdf: ['PDF ed elenchi', 'Generazione degli elenchi ufficiali.'],
    data: ['Gestione dati', 'Operazioni protette di cancellazione e azzeramento.']
  };

  function showPage(page, pushHash = true) {
    ensureShell();
    currentPage = pageMeta[page] ? page : 'home';
    const home = document.getElementById('mini-pages-home');
    if (home) home.classList.toggle('hidden', currentPage !== 'home');
    document.querySelectorAll('[data-mini-page]').forEach(el => el.classList.toggle('hidden', el.dataset.miniPage !== currentPage));
    const back = document.getElementById('mini-pages-back');
    if (back) back.classList.toggle('hidden', currentPage === 'home');
    const title = document.getElementById('mini-pages-title');
    const subtitle = document.getElementById('mini-pages-subtitle');
    if (currentPage === 'home') {
      if (title) title.textContent = 'Gestione MiniStage';
      if (subtitle) subtitle.textContent = 'Scegli il blocco da aprire. Ogni funzione ha una pagina dedicata.';
    } else {
      if (title) title.textContent = pageMeta[currentPage][0];
      if (subtitle) subtitle.textContent = pageMeta[currentPage][1];
    }
    if (pushHash) {
      const hash = currentPage === 'home' ? '#docente' : `#docente-${currentPage}`;
      if (location.hash !== hash) history.pushState(null, '', hash);
    }
    renderAll();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function showBookingSub(sub) {
    bookingSubpage = ['active','wait','cancelled'].includes(sub) ? sub : 'active';
    ['active','wait','cancelled'].forEach(name => document.getElementById(`mini-book-sub-${name}`)?.classList.toggle('hidden', name !== bookingSubpage));
    document.querySelectorAll('[data-book-sub]').forEach(btn => {
      const on = btn.dataset.bookSub === bookingSubpage;
      btn.className = `p-3 rounded-xl text-xs font-black border transition ${on ? (bookingSubpage === 'active' ? 'bg-emerald-600 text-white border-emerald-600' : bookingSubpage === 'wait' ? 'bg-purple-600 text-white border-purple-600' : 'bg-red-600 text-white border-red-600') : 'bg-white text-gray-600 border-gray-100'}`;
    });
    renderBookingsPage();
  }

  function renderClasses() {
    const root = document.getElementById('mini-pages-classes');
    if (!root) return;
    root.innerHTML = (core.addresses || []).map(a => `<label class="block rounded-xl border border-indigo-100 bg-white p-3"><span class="block text-[9px] font-black uppercase text-indigo-600 mb-1">${esc(a)}</span><input data-mini-class="${esc(a)}" value="${esc(state.classes[a] || '')}" placeholder="Classe assegnata" class="w-full p-2.5 rounded-lg border border-indigo-100 text-xs font-bold"></label>`).join('');
    const pdf = document.getElementById('mini-pages-class-pdfs');
    if (pdf) pdf.innerHTML = Object.entries(state.classes).filter(([,c]) => c).map(([a,c]) => `<button type="button" onclick="window.downloadClassListPdf?.('${esc(a).replace(/'/g, "\\'")}')" class="bg-white border border-indigo-200 text-indigo-700 px-3 py-2.5 rounded-xl text-[10px] font-black">${esc(c)}</button>`).join('');
  }

  function renderOverview() {
    const summary = document.getElementById('mini-pages-summary');
    if (summary) {
      const active = activeBookings();
      const waits = waitBookings();
      const checked = state.bookings.filter(b => b.type === CHECKED);
      const exited = state.bookings.filter(b => b.type === EXITED);
      const pendingDocs = active.filter(b => b.exitMode === 'autonoma' && !b.authorizationPaperReceived);
      const cards = [
        ['Iscritti attivi', active.length], ['Presenti', checked.length], ['Usciti', exited.length], ['Lista d’attesa', waits.length], ['Annullati', cancelledBookings().length], ['Date attive', state.slots.filter(s => s.active !== false).length], ['Moduli da ritirare', pendingDocs.length]
      ];
      summary.innerHTML = cards.map(([label,val]) => `<div class="glass-card p-4"><p class="text-[9px] uppercase font-black text-gray-500">${esc(label)}</p><p class="text-3xl font-black text-indigo-950">${Number(val)}</p></div>`).join('');
    }
    const root = document.getElementById('mini-pages-path-summary');
    if (!root) return;
    root.innerHTML = (core.addresses || []).map(a => {
      const slots = state.slots.filter(s => s.indirizzo === a && s.active !== false);
      const slotIds = new Set(slots.map(s => s.id));
      const live = activeBookings().filter(b => b.indirizzo === a || slotIds.has(b.slotId));
      const waits = waitBookings().filter(b => b.indirizzo === a || slotIds.has(b.slotId));
      const capacity = slots.reduce((n,s) => n + capacityFor(s), 0);
      const free = Math.max(0, capacity - live.length);
      return `<div class="rounded-2xl border border-blue-100 bg-white p-4"><p class="text-[9px] font-black uppercase text-blue-500">${esc(classFor(a))}</p><h3 class="text-xs font-black text-blue-950 mt-1">${esc(a)}</h3><div class="grid grid-cols-4 gap-2 text-center mt-4"><div><p class="text-lg font-black text-indigo-900">${live.length}</p><p class="text-[8px] uppercase text-gray-400">Iscritti</p></div><div><p class="text-lg font-black text-green-800">${live.filter(b=>b.type===CHECKED).length}</p><p class="text-[8px] uppercase text-gray-400">Presenti</p></div><div><p class="text-lg font-black text-purple-800">${waits.length}</p><p class="text-[8px] uppercase text-gray-400">Attesa</p></div><div><p class="text-lg font-black text-blue-800">${free}</p><p class="text-[8px] uppercase text-gray-400">Liberi</p></div></div><p class="text-[9px] text-gray-500 mt-3">${slots.length} date attive · capienza totale ${capacity}</p></div>`;
    }).join('');
  }

  function bookingSearchText(b) {
    return [b.nome,b.code,b.email,b.cellulare,b.scuola,b.indirizzo,b.classeAssegnata,b.stageDate,b.stageTime].join(' ').toLowerCase();
  }

  function populateFilterSelect(id, kind, rows) {
    const el = document.getElementById(id);
    if (!el || el.contains(document.activeElement)) return;
    const old = el.value;
    let values = [];
    let first = 'Tutti';
    if (kind === 'address') {
      values = core.addresses || [];
      first = 'Tutti gli indirizzi';
    } else {
      values = Array.from(new Set(rows.map(b => b.stageDate).filter(Boolean))).sort((a,b) => (isoFromDateIt(a) || a).localeCompare(isoFromDateIt(b) || b));
      first = 'Tutte le date';
    }
    el.innerHTML = `<option value="">${first}</option>` + values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
    if (values.includes(old)) el.value = old;
  }

  function renderAddressChips() {
    const root = document.getElementById('mini-pages-address-chips');
    if (!root) return;
    const selected = root.dataset.selected || '';
    const rows = activeBookings();
    const chips = [['', 'Tutti', rows.length], ...(core.addresses || []).map(a => [a, a, rows.filter(b => b.indirizzo === a).length])];
    root.innerHTML = chips.map(([value,label,count]) => `<button type="button" data-address="${esc(value)}" onclick="window.miniTeacherSetAddress(this.dataset.address)" class="px-3 py-2 rounded-xl text-[10px] font-black border ${selected === value ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-emerald-800 border-emerald-100'}">${esc(label)} <span class="opacity-70">(${count})</span></button>`).join('');
  }

  function renderActiveBookings() {
    const root = document.getElementById('mini-pages-book-list');
    if (!root) return;
    const chips = document.getElementById('mini-pages-address-chips');
    const address = chips?.dataset.selected || '';
    const q = String(document.getElementById('mini-pages-book-search')?.value || '').trim().toLowerCase();
    const date = document.getElementById('mini-pages-book-date')?.value || '';
    const status = document.getElementById('mini-pages-book-status')?.value || '';
    let rows = activeBookings().sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    populateFilterSelect('mini-pages-book-date', 'date', rows);
    if (address) rows = rows.filter(b => b.indirizzo === address);
    if (date) rows = rows.filter(b => b.stageDate === date);
    if (status) rows = rows.filter(b => b.type === status);
    if (q) rows = rows.filter(b => bookingSearchText(b).includes(q));
    root.innerHTML = rows.map(b => `<article class="rounded-2xl border border-emerald-100 bg-white p-4 space-y-3"><div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-slate-950">${esc(b.nome || 'Senza nome')}</strong><span class="${statusBadge(b)} px-2 py-0.5 rounded-full text-[9px] font-black">${esc(statusLabel(b))}</span><span class="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full text-[9px] font-mono font-bold">${esc(b.code || b.id)}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.indirizzo || '')} · ${esc(classFor(b.indirizzo,b.classeAssegnata))} · ${esc(b.stageDate || '')} ${esc(b.stageTime || '')}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniTeacherOpenReceipt('${esc(b.code || b.id)}')" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Ricevuta</button>${b.type === ACTIVE ? `<button type="button" onclick="window.miniTeacherCheckIn('${esc(b.code)}')" class="bg-green-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black">Segna presente</button>` : ''}<button type="button" onclick="window.miniTeacherCancelBooking('${esc(b.code)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Cancella</button></div></div><div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-4 gap-y-2 text-[10px]"><p><span class="text-gray-400 uppercase font-black">Scuola</span><br><strong>${esc(b.scuola || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">E-mail</span><br><strong>${esc(b.email || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Cellulare</span><br><strong>${esc(b.cellulare || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Registrata</span><br><strong>${esc(fmtTs(b.timestamp))}</strong></p><p><span class="text-gray-400 uppercase font-black">Genitore/Tutore</span><br><strong>${esc(b.parentGuardianName || '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Uscita</span><br><strong>${esc(b.exitMode === 'autonoma' ? 'Autonoma' : b.exitMode === 'ritiro_adulto' ? 'Ritiro adulto' : '—')}</strong></p><p><span class="text-gray-400 uppercase font-black">Modulo cartaceo</span><br><strong>${b.exitMode === 'autonoma' ? (b.authorizationPaperReceived ? 'Ricevuto' : 'Da ricevere') : 'Non richiesto'}</strong></p><p><span class="text-gray-400 uppercase font-black">Check-in</span><br><strong>${esc(fmtTs(b.checkInAt))}</strong></p></div></article>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuna prenotazione corrispondente.</p>';
  }

  function waitPosition(b) {
    return waitForSlot(b.slotId).findIndex(x => (x.code || x.id) === (b.code || b.id)) + 1;
  }

  function renderWaitlist() {
    const root = document.getElementById('mini-pages-wait-list');
    if (!root) return;
    let rows = waitBookings();
    populateFilterSelect('mini-pages-wait-address', 'address', rows);
    populateFilterSelect('mini-pages-wait-date', 'date', rows);
    const address = document.getElementById('mini-pages-wait-address')?.value || '';
    const date = document.getElementById('mini-pages-wait-date')?.value || '';
    const q = String(document.getElementById('mini-pages-wait-search')?.value || '').trim().toLowerCase();
    if (address) rows = rows.filter(b => b.indirizzo === address);
    if (date) rows = rows.filter(b => b.stageDate === date);
    if (q) rows = rows.filter(b => bookingSearchText(b).includes(q));
    root.innerHTML = rows.map(b => `<article class="rounded-2xl border border-purple-100 bg-white p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap gap-2 items-center"><strong class="text-sm text-purple-950">${esc(b.nome || 'Senza nome')}</strong><span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[9px] font-black">Posizione ${waitPosition(b)}</span><span class="font-mono text-[9px] bg-gray-100 px-2 py-0.5 rounded-full">${esc(b.code)}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.indirizzo)} · ${esc(classFor(b.indirizzo,b.classeAssegnata))} · ${esc(b.stageDate)} ${esc(b.stageTime)}</p><p class="text-[10px] text-gray-500">${esc(b.scuola || '—')} · ${esc(b.email || '—')} · ${esc(b.cellulare || '—')}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniTeacherOpenReceipt('${esc(b.code)}')" class="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Ricevuta riserva</button><button type="button" onclick="window.miniTeacherCancelBooking('${esc(b.code)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Cancella richiesta</button></div></article>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuno in lista d’attesa.</p>';
  }

  function renderCancelled() {
    const root = document.getElementById('mini-pages-cancel-list');
    if (!root) return;
    let rows = cancelledBookings();
    populateFilterSelect('mini-pages-cancel-address', 'address', rows);
    populateFilterSelect('mini-pages-cancel-date', 'date', rows);
    const address = document.getElementById('mini-pages-cancel-address')?.value || '';
    const date = document.getElementById('mini-pages-cancel-date')?.value || '';
    const q = String(document.getElementById('mini-pages-cancel-search')?.value || '').trim().toLowerCase();
    if (address) rows = rows.filter(b => b.indirizzo === address);
    if (date) rows = rows.filter(b => b.stageDate === date);
    if (q) rows = rows.filter(b => bookingSearchText(b).includes(q));
    root.innerHTML = rows.map(b => `<article class="rounded-2xl border border-red-100 bg-white p-4"><div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><strong class="text-sm text-red-950">${esc(b.nome || 'Senza nome')}</strong><p class="text-[10px] text-gray-500">${esc(b.code || b.id)} · ${esc(b.indirizzo || '')} · ${esc(b.stageDate || '')} ${esc(b.stageTime || '')}</p><p class="text-[9px] text-red-600 mt-1">Annullata: ${esc(fmtTs(b.cancelledAt || b.timestamp))}</p></div><button type="button" onclick="window.miniTeacherOpenReceipt('${esc(b.code || b.id)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Apri ricevuta annullata</button></div></article>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuna cancellazione registrata.</p>';
  }

  function renderManualSlots() {
    const sel = document.getElementById('mini-pages-manual-slot');
    if (!sel || sel.contains(document.activeElement)) return;
    const old = sel.value;
    const rows = [...state.slots].filter(s => s.active !== false).sort((a,b) => `${slotIso(a)}|${a.indirizzo}`.localeCompare(`${slotIso(b)}|${b.indirizzo}`));
    sel.innerHTML = '<option value="">Seleziona MiniStage / data</option>' + rows.map(s => {
      const live = liveForSlot(s.id).length;
      const wait = waitForSlot(s.id).length;
      const max = capacityFor(s);
      return `<option value="${esc(s.id)}">${esc(s.indirizzo)} · ${esc(s.dateStr)} · ${esc(s.time)} · ${live}/${max}${wait ? ` · attesa ${wait}` : ''}</option>`;
    }).join('');
    if (rows.some(s => s.id === old)) sel.value = old;
  }

  function renderBookingsPage() {
    renderAddressChips();
    renderActiveBookings();
    renderWaitlist();
    renderCancelled();
    renderManualSlots();
  }

  function renderCapacities() {
    const root = document.getElementById('mini-pages-capacities');
    if (!root || root.contains(document.activeElement)) return;
    root.innerHTML = (core.addresses || []).map(a => `<label class="rounded-xl border border-sky-100 bg-white p-3"><span class="block text-[9px] font-black uppercase text-sky-600 mb-1">${esc(a)}</span><input data-mini-cap="${esc(a)}" type="number" min="1" value="${Number(state.caps[a] || DEFAULT_CAPACITY)}" class="w-full p-2.5 rounded-lg border border-sky-100 text-xs font-black"></label>`).join('');
  }

  function renderCalendar() {
    const root = document.getElementById('mini-pages-calendar');
    if (!root || root.contains(document.activeElement)) return;
    const rows = [...state.slots].sort((a,b) => `${slotIso(a)}|${a.indirizzo || ''}`.localeCompare(`${slotIso(b)}|${b.indirizzo || ''}`));
    root.innerHTML = rows.map(s => `<tr data-mini-slot="${esc(s.id)}" class="border-t border-sky-50 ${s.active === false ? 'opacity-55' : ''}"><td class="p-3"><input data-field="active" type="checkbox" ${s.active === false ? '' : 'checked'}></td><td class="p-3 font-semibold text-sky-950">${esc(s.indirizzo || 'Percorso non definito')}</td><td class="p-3"><input data-field="date" type="date" value="${esc(slotIso(s))}" class="p-2 rounded-lg border text-xs"></td><td class="p-3 text-gray-500" data-day>${esc(s.day || weekdayIt(slotIso(s)))}</td><td class="p-3"><input data-field="time" value="${esc(s.time || '')}" class="p-2 rounded-lg border text-xs w-32"></td><td class="p-3"><input data-field="cap" type="number" min="1" value="${capacityFor(s)}" class="p-2 rounded-lg border text-xs w-20"></td><td class="p-3 font-black ${liveForSlot(s.id).length >= capacityFor(s) ? 'text-red-700' : 'text-green-700'}">${liveForSlot(s.id).length}/${capacityFor(s)}</td><td class="p-3 text-right whitespace-nowrap"><button type="button" onclick="window.miniTeacherSaveSlot('${esc(s.id)}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black mr-1">Salva</button><button type="button" onclick="window.miniTeacherDeleteSlot('${esc(s.id)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-black">Elimina</button></td></tr>`).join('') || '<tr><td colspan="8" class="p-8 text-center text-gray-400 italic">Nessuna data nel database.</td></tr>';
    root.querySelectorAll('input[data-field="date"]').forEach(input => input.addEventListener('change', () => { const day = input.closest('tr')?.querySelector('[data-day]'); if (day) day.textContent = weekdayIt(input.value); }));
    const address = document.getElementById('mini-pages-new-address');
    if (address && !address.options.length) address.innerHTML = (core.addresses || []).map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
  }

  function renderAuth() {
    const root = document.getElementById('mini-pages-auth');
    if (!root) return;
    const rows = state.bookings.filter(b => b.type !== CANCELLED && b.exitMode === 'autonoma').sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    root.innerHTML = rows.map(b => `<article class="rounded-xl border ${b.authorizationPaperReceived ? 'border-green-100 bg-green-50/30' : 'border-orange-100 bg-white'} p-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap gap-2 items-center"><strong class="text-xs text-orange-950">${esc(b.nome)}</strong><span class="${b.exitAuthorizationAccepted || b.declarationAccepted ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} px-2 py-0.5 rounded-full text-[9px] font-black">${b.exitAuthorizationAccepted || b.declarationAccepted ? 'Autorizzazione online acquisita' : 'Autorizzazione online non registrata'}</span><span class="${b.authorizationPaperReceived ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'} px-2 py-0.5 rounded-full text-[9px] font-black">${b.authorizationPaperReceived ? 'Modulo firmato ricevuto' : 'Modulo da consegnare'}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(b.code)} · ${esc(b.indirizzo)} · ${esc(b.stageDate)} ${esc(b.stageTime)}</p><p class="text-[10px] text-gray-600">Genitore/tutore: <strong>${esc(b.parentGuardianName || '—')}</strong>${b.parentGuardianRole ? ` (${esc(b.parentGuardianRole)})` : ''}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.downloadMiniStageBookingPdf?.('${esc(b.code)}')" class="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-[10px] font-black">PDF + autorizzazione</button>${!b.authorizationPaperReceived ? `<button type="button" onclick="window.miniTeacherMarkAuthReceived('${esc(b.code)}')" class="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-black">Segna ricevuto</button>` : ''}</div></article>`).join('') || '<p class="text-xs text-gray-400 italic">Nessuna uscita autonoma registrata.</p>';
  }


  function renderClosure() {
    const present = state.bookings.filter(b => b.type === CHECKED);
    const exited = state.bookings.filter(b => b.type === EXITED);
    const closed = state.slots.filter(s => s.closed === true || s.closureStatus === 'chiuso');
    const p = document.getElementById('mini-closure-present'); if (p) p.textContent = String(present.length);
    const e = document.getElementById('mini-closure-exited'); if (e) e.textContent = String(exited.length);
    const c = document.getElementById('mini-closure-closed'); if (c) c.textContent = String(closed.length);
    const root = document.getElementById('mini-pages-closure-list');
    if (!root) return;
    const rows = [...state.slots].sort((a,b) => (window.getMiniStageClosureDueAt?.(a) || 0) - (window.getMiniStageClosureDueAt?.(b) || 0));
    root.innerHTML = rows.map(s => {
      const due = Number(window.getMiniStageClosureDueAt?.(s) || 0);
      const slotPresent = present.filter(b => b.slotId === s.id).length;
      const slotExited = exited.filter(b => b.slotId === s.id).length;
      const errors = state.bookings.filter(b => b.slotId === s.id && b.certificateError).length;
      const isClosed = s.closed === true || s.closureStatus === 'chiuso';
      const now = Date.now();
      const label = isClosed ? 'Chiuso' : due && now >= due ? 'Chiusura in elaborazione' : due ? `Chiusura prevista ${new Date(due).toLocaleString('it-IT')}` : 'Orario non interpretabile';
      const cls = isClosed ? 'bg-slate-100 text-slate-800' : due && now >= due ? 'bg-orange-100 text-orange-800' : 'bg-teal-100 text-teal-800';
      return `<article class="rounded-xl border border-teal-100 bg-white p-4"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap items-center gap-2"><strong class="text-xs text-teal-950">${esc(s.indirizzo || 'MiniStage')}</strong><span class="${cls} px-2 py-0.5 rounded-full text-[9px] font-black">${esc(label)}</span></div><p class="text-[10px] text-gray-500 mt-1">${esc(s.day || weekdayIt(slotIso(s)))} ${esc(s.dateStr || formatDateIt(slotIso(s)))} · ${esc(s.time || '')}</p></div><div class="grid grid-cols-3 gap-2 text-center min-w-[260px]"><div><p class="text-lg font-black text-green-800">${slotPresent}</p><p class="text-[8px] uppercase text-gray-400">Presenti</p></div><div><p class="text-lg font-black text-teal-800">${slotExited}</p><p class="text-[8px] uppercase text-gray-400">Usciti</p></div><div><p class="text-lg font-black ${errors ? 'text-red-700' : 'text-gray-700'}">${errors}</p><p class="text-[8px] uppercase text-gray-400">Errori mail</p></div></div></div></article>`;
    }).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuna data MiniStage configurata.</p>';
  }

  function renderScanner() {
    const qrRoot = document.getElementById('mini-pages-scanner-qr');
    if (qrRoot && currentScanner) {
      const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(currentScanner.url)}`;
      qrRoot.innerHTML = `<div class="space-y-3 w-full"><img src="${esc(qr)}" alt="QR scanner MiniStage" class="w-56 h-56 mx-auto rounded-xl bg-white p-2"><p class="text-[10px] text-gray-500">Valido fino a ${esc(new Date(currentScanner.expiresAt).toLocaleString('it-IT'))}</p><a href="${esc(currentScanner.url)}" target="_blank" class="text-cyan-700 underline break-all text-[10px]">Apri collegamento scanner</a></div>`;
    }
    const sessions = document.getElementById('mini-pages-scanner-sessions');
    if (sessions) {
      const rows = state.sessions.filter(s => s.active && Number(s.expiresAt || 0) > Date.now()).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));
      sessions.innerHTML = rows.map(s => `<div class="rounded-xl border border-cyan-100 bg-white p-3 flex items-center justify-between gap-2"><div><p class="text-[10px] font-black text-cyan-950">Sessione scanner attiva</p><p class="text-[9px] text-gray-500">Scade ${esc(new Date(Number(s.expiresAt)).toLocaleString('it-IT'))}</p></div><button type="button" onclick="window.miniTeacherRevokeScanner('${esc(s.id)}')" class="bg-red-50 text-red-700 px-2.5 py-1.5 rounded-lg text-[9px] font-black">Revoca</button></div>`).join('') || '<p class="text-[10px] text-gray-400 italic">Nessuna sessione scanner attiva.</p>';
    }
  }

  function renderAll() {
    if (!document.getElementById('mini-admin-console-v2')) return;
    renderClasses();
    renderOverview();
    renderBookingsPage();
    renderCapacities();
    renderCalendar();
    renderAuth();
    renderClosure();
    renderScanner();
    showBookingSub(bookingSubpage);
  }

  async function saveClasses() {
    const inputs = Array.from(document.querySelectorAll('[data-mini-class]'));
    for (const input of inputs) {
      const indirizzo = input.dataset.miniClass;
      const classe = input.value.trim();
      await f.setDoc(f.doc(core.db, `${classesPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() }, { merge: true });
    }
    const current = [...state.bookings];
    for (const b of current) {
      if (!b.code || b.type === CANCELLED) continue;
      const desired = String(document.querySelector(`[data-mini-class="${CSS.escape(b.indirizzo || '')}"]`)?.value || state.classes[b.indirizzo] || '').trim() || 'Da definire';
      if (String(b.classeAssegnata || '') !== desired) await f.setDoc(f.doc(core.db, `${bookingsPath()}/${b.code}`), { classeAssegnata: desired, classAssignmentUpdatedAt: Date.now() }, { merge: true });
    }
    showMessage('Classi assegnate salvate e prenotazioni aggiornate.');
  }

  async function saveCapacities() {
    const inputs = Array.from(document.querySelectorAll('[data-mini-cap]'));
    for (const input of inputs) {
      const indirizzo = input.dataset.miniCap;
      const requested = Math.max(1, parseInt(input.value, 10) || DEFAULT_CAPACITY);
      const occupiedMax = Math.max(0, ...state.slots.filter(s => s.indirizzo === indirizzo).map(s => liveForSlot(s.id).length));
      if (requested < occupiedMax) {
        showMessage(`Capienza di ${indirizzo} non ridotta: esiste uno slot con ${occupiedMax} posti già occupati.`, true);
        continue;
      }
      await f.setDoc(f.doc(core.db, `${capsPath()}/${indirizzo}`), { indirizzo, postiMax: requested, updatedAt: Date.now() }, { merge: true });
    }
    showMessage('Capienze salvate.');
  }

  async function saveSlot(id) {
    const slot = state.slots.find(s => s.id === id);
    const row = document.querySelector(`[data-mini-slot="${CSS.escape(id)}"]`);
    if (!slot || !row) return;
    const active = !!row.querySelector('[data-field="active"]')?.checked;
    const isoDate = row.querySelector('[data-field="date"]')?.value || '';
    const time = row.querySelector('[data-field="time"]')?.value.trim() || '';
    const postiMax = Math.max(1, parseInt(row.querySelector('[data-field="cap"]')?.value, 10) || DEFAULT_CAPACITY);
    if (!isoDate || !time) return showMessage('Data e orario sono obbligatori.', true);
    const occupied = liveForSlot(id).length;
    if (postiMax < occupied) return showMessage(`Capienza non modificata: ci sono già ${occupied} posti occupati.`, true);
    const duplicate = state.slots.some(s => s.id !== id && s.indirizzo === slot.indirizzo && slotIso(s) === isoDate && String(s.time || '') === time);
    if (duplicate) return showMessage('Esiste già uno slot dello stesso percorso con data e orario uguali.', true);
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo: slot.indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax, active, updatedAt: Date.now() }, { merge: true });
    showMessage('Data MiniStage aggiornata.');
  }

  async function deleteSlot(id) {
    const slot = state.slots.find(s => s.id === id);
    if (!slot) return;
    const linked = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);
    if (linked.length) return showMessage(`La data non può essere eliminata perché ha ${linked.length} prenotazioni/richieste collegate. Puoi disattivarla.`, true);
    if (!requirePassword('eliminazione singola data')) return;
    if (!confirm(`Eliminare definitivamente ${slot.indirizzo} - ${slot.dateStr} ${slot.time}?`)) return;
    await f.deleteDoc(f.doc(core.db, `${slotsPath()}/${id}`));
    showMessage('Data eliminata.');
  }

  async function createSlot() {
    const indirizzo = document.getElementById('mini-pages-new-address')?.value || '';
    const isoDate = document.getElementById('mini-pages-new-date')?.value || '';
    const time = document.getElementById('mini-pages-new-time')?.value.trim() || '';
    const postiMax = Math.max(1, parseInt(document.getElementById('mini-pages-new-cap')?.value, 10) || DEFAULT_CAPACITY);
    if (!indirizzo || !isoDate || !time) return showMessage('Seleziona indirizzo, data e orario.', true);
    if (state.slots.some(s => s.indirizzo === indirizzo && slotIso(s) === isoDate && String(s.time || '') === time)) return showMessage('Esiste già una data identica per questo percorso.', true);
    const id = `SLOT-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax, active: true, createdAt: Date.now(), updatedAt: Date.now() });
    const dateEl = document.getElementById('mini-pages-new-date'); if (dateEl) dateEl.value = '';
    showMessage('Nuova data aggiunta e resa disponibile alla pagina genitori.');
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
    const slotId = document.getElementById('mini-pages-manual-slot')?.value || '';
    const requestedType = document.getElementById('mini-pages-manual-type')?.value || ACTIVE;
    const nome = document.getElementById('mini-pages-manual-name')?.value.trim() || '';
    const scuola = document.getElementById('mini-pages-manual-school')?.value.trim() || '';
    const email = document.getElementById('mini-pages-manual-email')?.value.trim() || '';
    const cellulare = document.getElementById('mini-pages-manual-phone')?.value.trim() || '';
    const exitMode = document.getElementById('mini-pages-manual-exit')?.value || '';
    const parentGuardianName = document.getElementById('mini-pages-manual-parent')?.value.trim() || '';
    const parentGuardianRole = document.getElementById('mini-pages-manual-role')?.value.trim() || '';
    const pickupAdultName = document.getElementById('mini-pages-manual-pickup')?.value.trim() || '';
    const auth = !!document.getElementById('mini-pages-manual-auth')?.checked;
    const slot = state.slots.find(s => s.id === slotId && s.active !== false);
    if (!slot) return showMessage('Seleziona un MiniStage attivo.', true);
    if (nome.length < 3 || !scuola || !/^\S+@\S+\.\S+$/.test(email) || cellulare.replace(/\D/g,'').length < 7) return showMessage('Completa correttamente nome, scuola, e-mail e cellulare.', true);
    if (!exitMode || !parentGuardianName || !parentGuardianRole || !auth) return showMessage('Completa i dati del genitore/tutore e conferma l’acquisizione dei dati.', true);
    if (exitMode === 'ritiro_adulto' && !pickupAdultName) return showMessage('Indica l’adulto incaricato del ritiro.', true);
    const duplicate = state.bookings.some(b => b.slotId === slotId && b.type !== CANCELLED && String(b.nome || '').trim().toLowerCase() === nome.toLowerCase() && String(b.email || '').trim().toLowerCase() === email.toLowerCase());
    if (duplicate) return showMessage('Esiste già una richiesta non annullata con lo stesso nome ed e-mail per questa data.', true);
    if (requestedType === ACTIVE && (liveForSlot(slotId).length >= capacityFor(slot) || waitForSlot(slotId).length > 0)) return showMessage('Lo slot è completo oppure ha già una lista d’attesa. Seleziona “Iscrizione con riserva”.', true);
    const code = await uniqueCode();
    const timestamp = Date.now();
    const data = { code, type: requestedType === WAITLIST ? WAITLIST : ACTIVE, slotId, indirizzo: slot.indirizzo, stageDay: slot.day, stageDate: slot.dateStr, stageTime: slot.time, nome, scuola, email, cellulare, timestamp, reminderSent: false, certificateSent: false, classeAssegnata: classFor(slot.indirizzo), exitMode, parentGuardianName, parentGuardianRole, pickupAdultName: exitMode === 'ritiro_adulto' ? pickupAdultName : '', declarationAccepted: true, declarationTimestamp: timestamp, declarationVersion: 'MiniStage-2026-manuale-docente-v2', exitAuthorizationAccepted: true, exitAuthorizationMode: exitMode, exitAuthorizationAcceptedAt: timestamp, exitAuthorizationVersion: 'MiniStage-uscita-autorizzazione-manuale-v2', authorizationPaperRequired: exitMode === 'autonoma', authorizationPaperReceived: false, createdByTeacher: true, teacherManualEntryAt: timestamp };
    if (data.type === WAITLIST) { data.waitlistRequestedAt = timestamp; data.waitlistStatus = 'Iscrizione con riserva'; data.iscrizioneConRiserva = true; }
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), data);
    showMessage(`${data.type === WAITLIST ? 'Iscrizione con riserva' : 'Prenotazione'} generata: ${code}`);
    setTimeout(() => window.sendAutomaticEmailNotification?.(data, false), 100);
  }

  function openReceipt(code) {
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
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { type: CHECKED, checkInAt: Date.now(), checkInSource: 'docente-pagine' }, { merge: true });
    showMessage(`Presenza registrata: ${b.nome}`);
  }

  async function cancelBooking(code) {
    const b = state.bookings.find(x => x.code === code);
    if (!b) return showMessage('Prenotazione/richiesta non trovata.', true);
    if (b.type === CANCELLED) return showMessage('Questa prenotazione è già annullata.', true);
    if (!requirePassword(`cancellazione ${code}`)) return;
    if (!confirm(`Confermi la cancellazione di ${b.nome || code}?`)) return;
    const cancelledAt = Date.now();
    const cancelled = { ...b, type: CANCELLED, cancelledAt, cancelledBy: 'docente-pagine' };
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { type: CANCELLED, cancelledAt, cancelledBy: 'docente-pagine' }, { merge: true });
    try { window.sendCancellationEmailNotification?.(cancelled); } catch (_) {}
    showMessage('Prenotazione/richiesta cancellata.');
  }

  async function cancelByCode() {
    const input = document.getElementById('mini-pages-cancel-code');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!/^MS-\d{6}$/.test(code)) return showMessage('Inserisci un codice MS valido.', true);
    await cancelBooking(code);
    if (input) input.value = '';
  }

  async function markAuthReceived(code) {
    await f.setDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { authorizationPaperReceived: true, authorizationPaperReceivedAt: Date.now() }, { merge: true });
    showMessage('Consegna documenti registrata.');
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
  }

  async function createScanner() {
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2,'0')).join('');
    const hash = await sha256(raw);
    const createdAt = Date.now();
    const expiresAt = createdAt + SCANNER_TTL_MS;
    await f.setDoc(f.doc(core.db, `${scannerPath()}/${hash}`), { active: true, createdAt, expiresAt, source: 'docente-pagine' });
    const url = new URL(location.origin + location.pathname); url.searchParams.set('scanner', raw); url.searchParams.set('v','scanner-docente');
    currentScanner = { hash, raw, createdAt, expiresAt, url: url.toString() };
    renderScanner();
    showMessage('QR scanner generato. Valido 8 ore.');
  }

  async function revokeScanner(id) {
    await f.setDoc(f.doc(core.db, `${scannerPath()}/${id}`), { active: false, revokedAt: Date.now() }, { merge: true });
    if (currentScanner?.hash === id) currentScanner = null;
    showMessage('Sessione scanner revocata.');
  }

  async function manualCheckIn() {
    const input = document.getElementById('mini-pages-checkin');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!/^MS-\d{6}$/.test(code)) return showMessage('Inserisci un codice MS valido.', true);
    await checkIn(code);
    if (input) input.value = '';
  }

  async function deleteRows(rows, pathFn) {
    for (const row of rows) await f.deleteDoc(f.doc(core.db, `${pathFn()}/${row.id || row.code}`));
  }

  async function clearWaitlist() {
    if (!requirePassword('cancellazione completa lista d’attesa')) return;
    const rows = waitBookings();
    if (!rows.length) return showMessage('La lista d’attesa è già vuota.');
    if (!confirm(`Eliminare definitivamente tutte le ${rows.length} richieste in lista d’attesa?`)) return;
    await deleteRows(rows, bookingsPath); showMessage('Lista d’attesa cancellata completamente.');
  }

  async function clearBookings() {
    if (!requirePassword('cancellazione totale database prenotazioni')) return;
    if (!state.bookings.length) return showMessage('Il database prenotazioni è già vuoto.');
    if (!confirm(`ATTENZIONE: eliminare definitivamente tutti i ${state.bookings.length} record?`)) return;
    await deleteRows(state.bookings, bookingsPath); showMessage('Database prenotazioni cancellato completamente.');
  }

  async function clearDates() {
    if (!requirePassword('cancellazione di tutte le date')) return;
    if (!state.slots.length) return showMessage('Il calendario è già vuoto.');
    if (!confirm(`ATTENZIONE: eliminare definitivamente tutte le ${state.slots.length} date MiniStage?`)) return;
    await deleteRows(state.slots, slotsPath); showMessage('Tutte le date MiniStage sono state cancellate.');
  }

  async function snapshotPath(path) {
    const snap = await f.getDocs(f.collection(core.db, path));
    const rows = []; snap.forEach(d => rows.push({ id: d.id, ...d.data() })); return rows;
  }

  async function clearEverything() {
    if (!requirePassword('AZZERAMENTO COMPLETO MiniStage')) return;
    if (!confirm('ATTENZIONE MASSIMA: questa operazione elimina prenotazioni, lista d’attesa, date, capienze, classi, scanner e configurazioni. Confermi davvero?')) return;
    const text = prompt('Per confermare definitivamente digita: CANCELLA TUTTO');
    if (text !== 'CANCELLA TUTTO') return showMessage('Conferma testuale non corretta. Nessun dato cancellato.', true);
    for (const p of [bookingsPath(), slotsPath(), capsPath(), classesPath(), scannerPath(), remindersPath()]) {
      const rows = await snapshotPath(p).catch(() => []);
      for (const row of rows) await f.deleteDoc(f.doc(core.db, `${p}/${row.id}`));
    }
    currentScanner = null; showMessage('MiniStage azzerato completamente.');
  }

  function renderPublicStages() {
    if (!publicDataReady) return;
    const mapping = {
      'Liceo Scientifico - Scienze Applicate': 'container-liceo',
      [CURVATURA]: 'container-curvatura-economica',
      'Relazioni Internazionali per il Marketing (RIM)': 'container-rim',
      'Logistica - Quadriennale': 'container-logistica',
      'Costruzione Ambiente e Territorio (CAT)': 'container-cat',
      'Sistema Moda': 'container-moda'
    };
    (core.addresses || []).forEach(indirizzo => {
      const container = document.getElementById(mapping[indirizzo]);
      if (!container) return;
      const rows = state.slots.filter(s => s.indirizzo === indirizzo && s.active !== false).sort((a,b) => `${slotIso(a)}|${a.time}`.localeCompare(`${slotIso(b)}|${b.time}`));
      if (!rows.length) {
        container.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-center py-6"><p class="text-xs text-gray-400 italic">Nessun calendario registrato.</p></div>';
        return;
      }
      container.innerHTML = rows.map(slot => {
        const max = capacityFor(slot);
        const booked = liveForSlot(slot.id).length;
        const queue = waitForSlot(slot.id).length;
        const remaining = Math.max(0, max - booked);
        const waitMode = queue > 0 || booked >= max;
        const pct = Math.min(100, Math.round((booked / max) * 100));
        const color = waitMode ? 'bg-purple-500' : remaining <= 2 ? 'bg-orange-500' : 'bg-green-500';
        const badge = waitMode ? (queue ? `Lista attesa: ${queue}` : 'Posti esauriti') : `${remaining} disponibili`;
        const action = waitMode ? `<button type="button" onclick="window.miniPublicOpenSlot('${esc(slot.id)}', true)" class="bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-extrabold px-4 py-2.5 min-h-[44px] rounded-xl transition shadow-md">Lista d'attesa${queue ? ` (${queue})` : ''}</button>` : `<button type="button" onclick="window.miniPublicOpenSlot('${esc(slot.id)}', false)" class="bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-extrabold px-4 py-2.5 min-h-[44px] rounded-xl transition shadow-md">Prenota</button>`;
        return `<div class="p-3 bg-white border ${waitMode ? 'border-purple-100' : 'border-green-100'} rounded-xl shadow-sm flex flex-col justify-between space-y-2"><div class="flex justify-between items-start gap-3"><div><p class="text-xs font-black text-indigo-950">${esc(slot.day || weekdayIt(slotIso(slot)))} ${esc(slot.dateStr || formatDateIt(slotIso(slot)))}</p><p class="text-[11px] font-medium text-gray-500 font-mono">${esc(slot.time)}</p></div><div class="text-right"><span class="inline-block text-[9px] font-bold ${waitMode ? 'bg-purple-100 text-purple-800' : 'bg-green-100 text-green-800'} px-2 py-0.5 rounded-full">${esc(badge)}</span><p class="text-[9px] text-gray-400 font-semibold mt-0.5">${booked} / ${max} iscritti</p></div></div><div class="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden"><div class="${color} h-full transition-all duration-500" style="width:${pct}%"></div></div><div class="flex justify-between items-center pt-1"><span class="text-[9px] text-indigo-400 font-extrabold tracking-wider uppercase">${waitMode ? 'Richiesta con riserva' : 'Prenotazione disponibile'}</span>${action}</div></div>`;
      }).join('');
    });
  }

  function publicOpenSlot(id, forceWait) {
    const slot = state.slots.find(s => s.id === id && s.active !== false);
    if (!slot) return showMessage('Questa data non è più disponibile.', true);
    const waitMode = forceWait || waitForSlot(id).length > 0 || liveForSlot(id).length >= capacityFor(slot);
    const fn = waitMode && typeof window.openWaitlistModal === 'function' ? window.openWaitlistModal : window.openBookingModal;
    if (typeof fn !== 'function') return showMessage('Modulo di prenotazione non disponibile.', true);
    fn(id, slot.indirizzo, slot.day || weekdayIt(slotIso(slot)), slot.dateStr || formatDateIt(slotIso(slot)), slot.time);
  }

  function installPublicRenderFix() {
    const base = window.renderStages;
    if (base?.__miniPagesWrapped) return;
    const wrapped = function(...args) {
      const result = typeof base === 'function' ? base.apply(this, args) : undefined;
      setTimeout(renderPublicStages, 0);
      return result;
    };
    wrapped.__miniPagesWrapped = true;
    window.renderStages = wrapped;
    window.miniPublicOpenSlot = publicOpenSlot;
  }

  function subscribe() {
    f.onSnapshot(f.collection(core.db, bookingsPath()), snap => {
      state.bookings = []; snap.forEach(d => state.bookings.push({ ...d.data(), id: d.id, code: d.data().code || d.id }));
      state.bookings.sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
      renderAll(); renderPublicStages();
    }, e => console.warn('MiniStage docente: listener prenotazioni', e));
    f.onSnapshot(f.collection(core.db, slotsPath()), snap => {
      state.slots = []; snap.forEach(d => state.slots.push(normalizeSlot(d.data(), d.id)));
      publicDataReady = true;
      renderAll(); renderPublicStages();
    }, e => console.warn('MiniStage docente: listener date', e));
    f.onSnapshot(f.collection(core.db, capsPath()), snap => {
      state.caps = {}; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.caps[x.indirizzo] = Number(x.postiMax || DEFAULT_CAPACITY); });
      renderAll(); renderPublicStages();
    }, e => console.warn('MiniStage docente: listener capienze', e));
    f.onSnapshot(f.collection(core.db, classesPath()), snap => {
      state.classes = { ...defaultClasses }; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.classes[x.indirizzo] = String(x.classe || ''); }); renderAll();
    }, e => console.warn('MiniStage docente: listener classi', e));
    f.onSnapshot(f.collection(core.db, scannerPath()), snap => {
      state.sessions = []; snap.forEach(d => state.sessions.push({ id: d.id, ...d.data() })); renderScanner();
    }, e => console.warn('MiniStage docente: listener scanner', e));
  }

  function expose() {
    window.miniTeacherOpenPage = page => showPage(page, true);
    window.miniTeacherHome = () => showPage('home', true);
    window.miniTeacherBookingSub = showBookingSub;
    window.miniTeacherSetAddress = value => { const root = document.getElementById('mini-pages-address-chips'); if (root) root.dataset.selected = value || ''; renderBookingsPage(); };
    window.miniTeacherSaveClasses = saveClasses;
    window.miniTeacherSaveCapacities = saveCapacities;
    window.miniTeacherSaveSlot = saveSlot;
    window.miniTeacherDeleteSlot = deleteSlot;
    window.miniTeacherCreateSlot = createSlot;
    window.miniTeacherGenerateBooking = generateBooking;
    window.miniTeacherOpenReceipt = openReceipt;
    window.miniTeacherCheckIn = checkIn;
    window.miniTeacherCancelBooking = cancelBooking;
    window.miniTeacherCancelByCode = cancelByCode;
    window.miniTeacherMarkAuthReceived = markAuthReceived;
    window.miniTeacherCreateScanner = createScanner;
    window.miniTeacherRevokeScanner = revokeScanner;
    window.miniTeacherManualCheckIn = manualCheckIn;
    window.miniTeacherClearWaitlist = clearWaitlist;
    window.miniTeacherClearBookings = clearBookings;
    window.miniTeacherClearDates = clearDates;
    window.miniTeacherClearEverything = clearEverything;
  }

  function wrapAdminLogin() {
    const base = window.adminLogin;
    if (typeof base !== 'function' || base.__miniPagesWrapped) return;
    const wrapped = function(...args) {
      const candidate = String(document.getElementById('admin-password')?.value || '');
      const result = base.apply(this, args);
      setTimeout(() => {
        const view = document.getElementById('view-admin');
        if (view && !view.classList.contains('hidden')) {
          sessionPassword = candidate;
          ensureShell(); hideLegacyAdmin(); showPage('home', false);
        }
      }, 100);
      return result;
    };
    wrapped.__miniPagesWrapped = true;
    window.adminLogin = wrapped;
  }

  function handleHash() {
    const view = document.getElementById('view-admin');
    if (!view || view.classList.contains('hidden')) return;
    const h = location.hash.replace(/^#docente-?/, '');
    if (!h || h === 'docente') showPage('home', false);
    else if (pageMeta[h]) showPage(h, false);
  }

  async function init() {
    if (installed) return;
    core = window.__miniStageCore;
    f = window.firebaseImports;
    const ready = core?.db && f?.collection && typeof window.adminLogin === 'function';
    if (!ready) { setTimeout(init, 120); return; }
    installed = true;
    expose();
    ensureShell();
    installPublicRenderFix();
    wrapAdminLogin();
    const connectFirestoreWhenAuthenticated = () => {
      if (core.auth?.currentUser) {
        subscribe();
        return;
      }
      setTimeout(connectFirestoreWhenAuthenticated, 150);
    };
    connectFirestoreWhenAuthenticated();
    window.addEventListener('hashchange', handleHash);
    window.__MINISTAGE_ADMIN_CONSOLE_V2__ = { version: VERSION, pages: Object.keys(pageMeta), publicSlotNormalization: true };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
  else setTimeout(init, 0);
})();
(() => {
  'use strict';

  const VERSION = '2026.09-admin-final-hardening-v3';
  const WAITLIST = 'lista_attesa';
  const ACTIVE = 'prenotazione';
  const CHECKED = 'entrato';
  const CANCELLED = 'cancellazione';
  const CLASS_COLLECTION = 'config_classi_ministage';
  const SCANNER_COLLECTION = 'scanner_sessions';
  const SCANNER_TTL_MS = 8 * 60 * 60 * 1000;

  let core = null;
  let f = null;
  let installed = false;
  let activeTab = 'overview';
  let legacyVisible = false;
  let currentScanner = null;
  let state = { bookings: [], slots: [], caps: {}, classes: {}, sessions: [] };

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const rootPath = (name) => `artifacts/${core.appId}/public/data/${name}`;
  const bookingsPath = () => rootPath(core.collections.prenotazioni);
  const slotsPath = () => rootPath(core.collections.impostazioni);
  const capsPath = () => rootPath(core.collections.capacita);
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

  function statusLabel(b) {
    if (b.type === WAITLIST) return 'Lista d’attesa';
    if (b.type === CHECKED) return 'Presente';
    if (b.type === CANCELLED) return 'Annullata';
    if (b.waitlistPromotedAt || b.waitlistPromotionStatus === 'Ammesso da scorrimento') return 'Ammesso da scorrimento';
    return 'Iscritto';
  }

  function slotLabel(b) {
    return `${b.stageDate || ''} ${b.stageTime || ''}`.trim();
  }

  function activeBookings() {
    return state.bookings.filter(b => b.type === ACTIVE || b.type === CHECKED);
  }

  function waitBookings() {
    return state.bookings.filter(b => b.type === WAITLIST).sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  function promotedBookings() {
    return state.bookings.filter(b => b.waitlistPromotedAt || b.waitlistPromotionStatus === 'Ammesso da scorrimento');
  }

  function showMessage(msg, error = false) {
    if (typeof window.showMessage === 'function') window.showMessage(msg, error);
    else alert(msg);
  }

  function ensureConsole() {
    const dash = document.getElementById('admin-dashboard');
    if (!dash || document.getElementById('mini-admin-console-v2')) return;

    const root = document.createElement('section');
    root.id = 'mini-admin-console-v2';
    root.className = 'space-y-4';
    root.innerHTML = `
      <div class="glass-card p-4 border-l-4 border-indigo-600">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <h2 class="text-lg font-black text-indigo-950">Centro Gestione MiniStage</h2>
            <p class="text-[11px] text-gray-500">Iscritti, liste d’attesa, calendario, scanner accoglienza e documenti in sezioni separate.</p>
          </div>
          <div id="mini-admin-tabs" class="flex flex-wrap gap-2">
            ${[
              ['overview','Panoramica'],['iscritti','Iscritti'],['attesa','Lista d’attesa'],['calendario','Calendario'],['scanner','Scanner Accoglienza'],['documenti','Documenti'],['strumenti','Altri strumenti']
            ].map(([id,label]) => `<button type="button" data-mini-tab="${id}" class="px-3 py-2 rounded-xl text-[11px] font-black border transition">${label}</button>`).join('')}
          </div>
        </div>
      </div>

      <div data-mini-panel="overview" class="space-y-4">
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div class="glass-card p-4"><p class="text-[9px] font-black uppercase text-indigo-500">Iscritti attivi</p><p id="mini-v2-count-active" class="text-3xl font-black text-indigo-950">0</p></div>
          <div class="glass-card p-4"><p class="text-[9px] font-black uppercase text-green-600">Presenti</p><p id="mini-v2-count-checked" class="text-3xl font-black text-green-900">0</p></div>
          <div class="glass-card p-4"><p class="text-[9px] font-black uppercase text-purple-600">Lista d’attesa</p><p id="mini-v2-count-wait" class="text-3xl font-black text-purple-950">0</p></div>
          <div class="glass-card p-4"><p class="text-[9px] font-black uppercase text-fuchsia-600">Ammessi da scorrimento</p><p id="mini-v2-count-promoted" class="text-3xl font-black text-fuchsia-950">0</p></div>
          <div class="glass-card p-4"><p class="text-[9px] font-black uppercase text-cyan-600">Sessioni scanner attive</p><p id="mini-v2-count-scanners" class="text-3xl font-black text-cyan-950">0</p></div>
        </div>
        <div class="glass-card p-5 space-y-3">
          <h3 class="text-sm font-black text-indigo-950">Accesso rapido</h3>
          <div class="flex flex-wrap gap-2">
            <button type="button" onclick="window.miniAdminShowTab('iscritti')" class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Gestisci iscritti</button>
            <button type="button" onclick="window.miniAdminShowTab('attesa')" class="bg-purple-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Apri lista d’attesa</button>
            <button type="button" onclick="window.miniAdminShowTab('calendario')" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Modifica calendario</button>
            <button type="button" onclick="window.miniAdminShowTab('scanner')" class="bg-cyan-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Genera QR scanner</button>
          </div>
        </div>
      </div>

      <div data-mini-panel="iscritti" class="hidden space-y-3">
        <div class="glass-card p-5 space-y-3">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div><h3 class="text-sm font-black text-indigo-950">Iscritti confermati</h3><p class="text-[10px] text-gray-500">Prenotati e presenti, separati dalla lista d’attesa.</p></div>
            <div class="flex flex-wrap gap-2">
              <input id="mini-v2-active-search" type="search" placeholder="Cerca nome, codice, e-mail..." class="p-2.5 rounded-xl border border-indigo-100 text-xs min-w-56">
              <select id="mini-v2-active-address" class="p-2.5 rounded-xl border border-indigo-100 text-xs"><option value="">Tutti gli indirizzi</option></select>
              <button type="button" onclick="window.downloadAllClassListsPdf?.()" class="bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-bold">PDF tutte le classi</button>
            </div>
          </div>
          <div id="mini-v2-active-list" class="space-y-2 max-h-[520px] overflow-y-auto compact-scroll"></div>
        </div>
      </div>

      <div data-mini-panel="attesa" class="hidden space-y-3">
        <div class="glass-card p-5 border-l-4 border-purple-500 space-y-3">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div><h3 class="text-sm font-black text-purple-950">Lista d’attesa / Iscrizioni con riserva</h3><p class="text-[10px] text-gray-500">Ordine cronologico per ogni singolo MiniStage. Lo scorrimento rimane automatico.</p></div>
            <div class="flex gap-2 flex-wrap"><input id="mini-v2-wait-search" type="search" placeholder="Cerca..." class="p-2.5 rounded-xl border border-purple-100 text-xs"><button type="button" onclick="window.downloadWaitlistPdf?.()" class="bg-purple-600 text-white px-3 py-2 rounded-xl text-xs font-bold">PDF lista d’attesa</button></div>
          </div>
          <div id="mini-v2-wait-list" class="space-y-2 max-h-[520px] overflow-y-auto compact-scroll"></div>
        </div>
      </div>

      <div data-mini-panel="calendario" class="hidden space-y-4">
        <div class="glass-card p-5 space-y-3">
          <div><h3 class="text-sm font-black text-blue-950">Capienza per indirizzo</h3><p class="text-[10px] text-gray-500">Valore predefinito per ogni percorso. Gli slot possono comunque avere una capienza specifica.</p></div>
          <div id="mini-v2-capacities" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2"></div>
          <button type="button" onclick="window.miniAdminSaveCapacities()" class="bg-blue-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Salva capienze</button>
        </div>
        <div class="glass-card p-5 space-y-3">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div><h3 class="text-sm font-black text-indigo-950">Calendario MiniStage</h3><p class="text-[10px] text-gray-500">Le date sono lette da Firebase: qui puoi cambiarle, disattivarle, eliminare uno slot o aggiungerne uno nuovo.</p></div>
            <button type="button" onclick="window.miniAdminRenderCalendar()" class="bg-gray-100 text-gray-700 px-3 py-2 rounded-xl text-xs font-bold">Ricarica tabella</button>
          </div>
          <div class="overflow-x-auto"><table class="w-full text-[11px] min-w-[900px]"><thead><tr class="text-left text-gray-400 uppercase text-[9px]"><th class="p-2">Attivo</th><th class="p-2">Indirizzo</th><th class="p-2">Data</th><th class="p-2">Giorno</th><th class="p-2">Orario</th><th class="p-2">Posti</th><th class="p-2 text-right">Azioni</th></tr></thead><tbody id="mini-v2-calendar-rows"></tbody></table></div>
        </div>
        <div class="glass-card p-5 space-y-3 border-l-4 border-green-500">
          <h3 class="text-sm font-black text-green-950">Aggiungi nuovo MiniStage</h3>
          <div class="grid grid-cols-1 md:grid-cols-4 gap-2">
            <select id="mini-v2-new-address" class="p-2.5 rounded-xl border text-xs"></select>
            <input id="mini-v2-new-date" type="date" class="p-2.5 rounded-xl border text-xs">
            <input id="mini-v2-new-time" type="text" value="14:30 - 16:30" class="p-2.5 rounded-xl border text-xs" aria-label="Orario">
            <input id="mini-v2-new-cap" type="number" min="1" value="25" class="p-2.5 rounded-xl border text-xs" aria-label="Posti">
          </div>
          <button type="button" onclick="window.miniAdminCreateSlot()" class="bg-green-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Aggiungi al calendario Firebase</button>
        </div>
      </div>

      <div data-mini-panel="scanner" class="hidden space-y-4">
        <div class="glass-card p-5 border-l-4 border-cyan-500 space-y-4">
          <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div><h3 class="text-sm font-black text-cyan-950">Scanner Accoglienza da smartphone</h3><p class="text-[10px] text-gray-500">Genera un QR temporaneo. I telefoni lo inquadrano e diventano scanner per i QR/codici delle prenotazioni.</p></div>
            <button type="button" onclick="window.createSmartphoneScannerLink()" class="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2.5 rounded-xl text-xs font-black">Genera QR per collegare i telefoni</button>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div id="mini-v2-scanner-qr" class="rounded-2xl border border-cyan-100 bg-cyan-50/50 p-5 min-h-72 flex items-center justify-center text-center text-xs text-gray-500">Genera una sessione per visualizzare il QR.</div>
            <div class="space-y-3">
              <div class="rounded-xl bg-white border border-cyan-100 p-4 text-xs leading-relaxed">
                <strong class="text-cyan-950">Come funziona</strong>
                <ol class="list-decimal pl-5 mt-2 space-y-1 text-gray-600"><li>Genera il QR.</li><li>Inquadralo con uno o più telefoni.</li><li>Ogni telefono apre lo scanner con fotocamera posteriore.</li><li>Inquadra il QR o inserisci il codice MS dello studente.</li><li>Il sistema registra la presenza solo per prenotazioni valide.</li></ol>
                <p class="mt-2 text-purple-700 font-bold">Lista d’attesa e prenotazioni annullate non vengono accettate.</p>
              </div>
              <div class="rounded-xl bg-white border border-indigo-100 p-4 space-y-2">
                <p class="text-[10px] font-black uppercase text-indigo-500">Postazione manuale docente</p>
                <div class="flex gap-2"><input id="mini-v2-manual-code" placeholder="MS-123456" class="flex-1 p-2.5 rounded-xl border text-xs font-mono uppercase"><button type="button" onclick="window.miniAdminManualCheckIn()" class="bg-indigo-600 text-white px-3 rounded-xl text-xs font-bold">Registra presenza</button></div>
              </div>
            </div>
          </div>
        </div>
        <div class="glass-card p-5 space-y-3"><h3 class="text-sm font-black text-cyan-950">Sessioni scanner</h3><div id="mini-v2-scanner-sessions" class="space-y-2"></div></div>
      </div>

      <div data-mini-panel="documenti" class="hidden space-y-4">
        <div class="glass-card p-5 space-y-3"><div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><h3 class="text-sm font-black text-indigo-950">Classi assegnate</h3><p class="text-[10px] text-gray-500">Classe mostrata nelle conferme e negli elenchi.</p></div><button type="button" onclick="window.miniAdminSaveClasses()" class="bg-indigo-600 text-white px-4 py-2 rounded-xl text-xs font-bold">Salva classi</button></div><div id="mini-v2-classes" class="grid grid-cols-1 md:grid-cols-2 gap-2"></div></div>
        <div class="glass-card p-5 space-y-3"><h3 class="text-sm font-black text-red-950">PDF ed elenchi</h3><div class="flex flex-wrap gap-2"><button type="button" onclick="window.downloadAllClassListsPdf?.()" class="bg-red-600 text-white px-3 py-2 rounded-xl text-xs font-bold">PDF tutte le classi</button><button type="button" onclick="window.downloadWaitlistPdf?.()" class="bg-purple-600 text-white px-3 py-2 rounded-xl text-xs font-bold">PDF lista d’attesa</button><div id="mini-v2-class-pdf-buttons" class="flex flex-wrap gap-2"></div></div></div>
        <div class="glass-card p-5 space-y-3 border-l-4 border-orange-500"><h3 class="text-sm font-black text-orange-950">Autorizzazioni uscita autonoma da ritirare</h3><div id="mini-v2-auth-list" class="space-y-2"></div></div>
      </div>

      <div data-mini-panel="strumenti" class="hidden space-y-3">
        <div class="glass-card p-5 space-y-3"><h3 class="text-sm font-black text-gray-900">Strumenti amministrativi aggiuntivi</h3><p class="text-xs text-gray-500">Promemoria, attestati, statistiche, esportazioni e le altre funzioni storiche restano disponibili ma non affollano più la schermata principale.</p><button type="button" onclick="window.miniAdminToggleLegacyTools()" id="mini-v2-legacy-toggle" class="bg-gray-700 text-white px-4 py-2 rounded-xl text-xs font-bold">Mostra strumenti avanzati</button></div>
      </div>`;

    const heading = Array.from(dash.children).find(el => el !== root && /Pannello di Gestione/i.test(el.textContent || ''));
    if (heading) heading.insertAdjacentElement('afterend', root); else dash.prepend(root);

    root.querySelectorAll('[data-mini-tab]').forEach(btn => btn.addEventListener('click', () => showTab(btn.dataset.miniTab)));
    document.getElementById('mini-v2-active-search')?.addEventListener('input', renderActiveList);
    document.getElementById('mini-v2-active-address')?.addEventListener('change', renderActiveList);
    document.getElementById('mini-v2-wait-search')?.addEventListener('input', renderWaitList);

    organizeLegacyDashboard();
    showTab(activeTab);
  }

  function organizeLegacyDashboard() {
    const dash = document.getElementById('admin-dashboard');
    const root = document.getElementById('mini-admin-console-v2');
    if (!dash || !root) return;
    Array.from(dash.children).forEach(el => {
      if (el === root || /Pannello di Gestione/i.test(el.textContent || '') && el.querySelector('h1')) return;
      if (!el.dataset.miniLegacyAdmin) el.dataset.miniLegacyAdmin = '1';
      if (!legacyVisible) el.style.display = 'none';
    });
  }

  function setLegacyVisible(show) {
    legacyVisible = !!show;
    document.querySelectorAll('#admin-dashboard > [data-mini-legacy-admin="1"]').forEach(el => { el.style.display = show ? '' : 'none'; });
    const btn = document.getElementById('mini-v2-legacy-toggle');
    if (btn) btn.textContent = show ? 'Nascondi strumenti avanzati' : 'Mostra strumenti avanzati';
  }

  function showTab(tab) {
    activeTab = tab || 'overview';
    const root = document.getElementById('mini-admin-console-v2');
    if (!root) return;
    root.querySelectorAll('[data-mini-panel]').forEach(el => el.classList.toggle('hidden', el.dataset.miniPanel !== activeTab));
    root.querySelectorAll('[data-mini-tab]').forEach(btn => {
      const on = btn.dataset.miniTab === activeTab;
      btn.className = `px-3 py-2 rounded-xl text-[11px] font-black border transition ${on ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-indigo-100 text-indigo-700 hover:bg-indigo-50'}`;
    });
    if (activeTab !== 'strumenti') setLegacyVisible(false);
    renderAll();
  }

  function updateSelectOptions() {
    const addresses = core?.addresses || [];
    const opts = addresses.map(a => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
    const active = document.getElementById('mini-v2-active-address');
    if (active && active.options.length <= 1) active.insertAdjacentHTML('beforeend', opts);
    const add = document.getElementById('mini-v2-new-address');
    if (add) add.innerHTML = opts;
  }

  function renderOverview() {
    const active = activeBookings();
    const checked = state.bookings.filter(b => b.type === CHECKED);
    const waits = waitBookings();
    const scanners = state.sessions.filter(s => s.active && Number(s.expiresAt || 0) > Date.now());
    const values = {
      'mini-v2-count-active': active.length,
      'mini-v2-count-checked': checked.length,
      'mini-v2-count-wait': waits.length,
      'mini-v2-count-promoted': promotedBookings().length,
      'mini-v2-count-scanners': scanners.length
    };
    Object.entries(values).forEach(([id, v]) => { const el = document.getElementById(id); if (el) el.textContent = String(v); });
  }

  function renderActiveList() {
    const root = document.getElementById('mini-v2-active-list');
    if (!root) return;
    const q = (document.getElementById('mini-v2-active-search')?.value || '').trim().toLowerCase();
    const address = document.getElementById('mini-v2-active-address')?.value || '';
    let rows = activeBookings().sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    if (address) rows = rows.filter(b => b.indirizzo === address);
    if (q) rows = rows.filter(b => `${b.nome || ''} ${b.code || ''} ${b.email || ''} ${b.indirizzo || ''}`.toLowerCase().includes(q));
    root.innerHTML = rows.map(b => `
      <div class="p-3 rounded-xl border border-indigo-100 bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-indigo-950">${esc(b.nome)}</strong><span class="text-[9px] font-black px-2 py-0.5 rounded-full ${b.type === CHECKED ? 'bg-green-100 text-green-800' : 'bg-indigo-100 text-indigo-800'}">${esc(statusLabel(b))}</span>${b.exitMode === 'autonoma' ? '<span class="text-[9px] font-black px-2 py-0.5 rounded-full bg-orange-100 text-orange-800">Uscita autonoma</span>' : ''}</div>
          <p class="text-[10px] text-gray-500 font-mono">${esc(b.code)} · ${esc(b.indirizzo)}</p><p class="text-[10px] text-gray-500">${esc(slotLabel(b))} · ${esc(b.email || '')}</p>
          ${b.exitMode === 'autonoma' ? `<p class="text-[10px] mt-1"><span class="text-green-700 font-bold">Autorizzazione online acquisita</span> · <span class="${b.authorizationPaperReceived ? 'text-green-700' : 'text-orange-700'} font-bold">${b.authorizationPaperReceived ? 'Modulo firmato ricevuto' : 'Modulo firmato da consegnare'}</span>${b.parentGuardianName ? ` · Genitore/tutore: ${esc(b.parentGuardianName)}${b.parentGuardianRole ? ` (${esc(b.parentGuardianRole)})` : ''}` : ''}</p>` : b.exitMode === 'ritiro_adulto' ? `<p class="text-[10px] mt-1 text-gray-600">Ritiro adulto: ${esc(b.pickupAdultName || 'da verificare')}</p>` : ''}
        </div>
        <div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniAdminOpenReceipt('${esc(b.code)}')" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">Dettaglio prenotazione</button>${b.exitMode === 'autonoma' ? `<button type="button" onclick="window.downloadMiniStageBookingPdf?.('${esc(b.code)}')" class="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">PDF + autorizzazione</button>` : ''}${b.type === ACTIVE ? `<button type="button" onclick="window.miniAdminCheckIn('${esc(b.code)}')" class="bg-green-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold">Segna presente</button>` : ''}</div>
      </div>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessun iscritto corrispondente.</p>';
  }

  function waitPosition(b) {
    const same = waitBookings().filter(x => x.slotId === b.slotId);
    return same.findIndex(x => x.code === b.code) + 1;
  }

  function renderWaitList() {
    const root = document.getElementById('mini-v2-wait-list');
    if (!root) return;
    const q = (document.getElementById('mini-v2-wait-search')?.value || '').trim().toLowerCase();
    let rows = waitBookings();
    if (q) rows = rows.filter(b => `${b.nome || ''} ${b.code || ''} ${b.email || ''} ${b.indirizzo || ''}`.toLowerCase().includes(q));
    root.innerHTML = rows.map(b => `
      <div class="p-3 rounded-xl border border-purple-100 bg-white flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div><div class="flex flex-wrap items-center gap-2"><strong class="text-sm text-purple-950">${esc(b.nome)}</strong><span class="bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full text-[9px] font-black">Posizione ${waitPosition(b)}</span></div><p class="text-[10px] text-gray-500 font-mono">${esc(b.code)} · ${esc(b.indirizzo)}</p><p class="text-[10px] text-gray-500">${esc(slotLabel(b))} · ${esc(b.email || '')}</p></div>
        <div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniAdminOpenReceipt('${esc(b.code)}')" class="bg-purple-50 text-purple-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">Ricevuta riserva</button></div>
      </div>`).join('') || '<p class="text-xs text-gray-400 italic text-center py-8">Nessuno in lista d’attesa.</p>';
  }

  function renderCapacities() {
    const root = document.getElementById('mini-v2-capacities');
    if (!root) return;
    root.innerHTML = (core?.addresses || []).map(a => `<label class="block p-3 rounded-xl border border-blue-100 bg-white"><span class="block text-[9px] font-black uppercase text-blue-600 mb-1">${esc(a)}</span><input data-mini-cap-address="${esc(a)}" type="number" min="1" value="${Number(state.caps[a] || 25)}" class="w-full p-2 rounded-lg border border-blue-100 text-xs font-black"></label>`).join('');
  }

  function renderCalendar() {
    const root = document.getElementById('mini-v2-calendar-rows');
    if (!root || root.contains(document.activeElement)) return;
    const sorted = [...state.slots].sort((a,b) => `${slotIso(a)}|${a.indirizzo || ''}`.localeCompare(`${slotIso(b)}|${b.indirizzo || ''}`));
    root.innerHTML = sorted.map(s => {
      const iso = slotIso(s);
      return `<tr data-mini-slot-row="${esc(s.id)}" class="border-t border-gray-100 ${s.active === false ? 'opacity-60' : ''}"><td class="p-2"><input data-field="active" type="checkbox" ${s.active === false ? '' : 'checked'}></td><td class="p-2 font-semibold text-indigo-950">${esc(s.indirizzo)}</td><td class="p-2"><input data-field="date" type="date" value="${esc(iso)}" class="p-2 rounded-lg border text-xs"></td><td class="p-2 text-gray-500" data-mini-day>${esc(s.day || weekdayIt(iso))}</td><td class="p-2"><input data-field="time" value="${esc(s.time || '')}" class="p-2 rounded-lg border text-xs w-32"></td><td class="p-2"><input data-field="cap" type="number" min="1" value="${Number(s.postiMax || state.caps[s.indirizzo] || 25)}" class="p-2 rounded-lg border text-xs w-20"></td><td class="p-2 text-right whitespace-nowrap"><button type="button" onclick="window.miniAdminSaveSlot('${esc(s.id)}')" class="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold mr-1">Salva</button><button type="button" onclick="window.miniAdminDeleteSlot('${esc(s.id)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">Elimina</button></td></tr>`;
    }).join('') || '<tr><td colspan="7" class="p-8 text-center text-gray-400 italic">Nessuno slot nel database.</td></tr>';
    root.querySelectorAll('input[data-field="date"]').forEach(input => input.addEventListener('change', () => { const row = input.closest('tr'); const day = row?.querySelector('[data-mini-day]'); if (day) day.textContent = weekdayIt(input.value); }));
  }

  function renderClasses() {
    const root = document.getElementById('mini-v2-classes');
    if (!root) return;
    root.innerHTML = (core?.addresses || []).map(a => `<label class="block p-3 rounded-xl border border-indigo-100 bg-white"><span class="block text-[9px] font-black uppercase text-indigo-600 mb-1">${esc(a)}</span><input data-mini-class-address="${esc(a)}" value="${esc(state.classes[a] || '')}" placeholder="Classe assegnata" class="w-full p-2 rounded-lg border border-indigo-100 text-xs font-bold"></label>`).join('');
    const pdf = document.getElementById('mini-v2-class-pdf-buttons');
    if (pdf) pdf.innerHTML = Object.entries(state.classes).filter(([,c]) => c).map(([a,c]) => `<button type="button" onclick="window.downloadClassListPdf?.('${esc(a).replace(/'/g, "\\'")}')" class="bg-white border border-indigo-200 text-indigo-700 px-3 py-2 rounded-xl text-[10px] font-bold">${esc(c)}</button>`).join('');
  }

  function renderAuth() {
    const root = document.getElementById('mini-v2-auth-list');
    if (!root) return;
    const docs = state.bookings
      .filter(b => b.type !== CANCELLED && b.exitMode === 'autonoma' && (b.declarationAccepted || b.exitAuthorizationAccepted))
      .sort((a,b) => (b.timestamp || 0) - (a.timestamp || 0));
    root.innerHTML = docs.map(b => `<div class="p-3 rounded-xl border ${b.authorizationPaperReceived ? 'border-green-100 bg-green-50/30' : 'border-orange-100 bg-white'} flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><div class="flex flex-wrap gap-2 items-center"><strong class="text-xs text-orange-950">${esc(b.nome)}</strong><span class="text-[9px] font-black px-2 py-0.5 rounded-full bg-green-100 text-green-800">Autorizzazione online acquisita</span><span class="text-[9px] font-black px-2 py-0.5 rounded-full ${b.authorizationPaperReceived ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}">${b.authorizationPaperReceived ? 'Modulo firmato ricevuto' : 'Modulo da consegnare'}</span></div><p class="text-[10px] text-gray-500 font-mono mt-1">${esc(b.code)} · ${esc(b.indirizzo)} · ${esc(slotLabel(b))}</p><p class="text-[10px] text-gray-600">Genitore/tutore: <strong>${esc(b.parentGuardianName || 'non indicato')}</strong>${b.parentGuardianRole ? ` (${esc(b.parentGuardianRole)})` : ''}</p></div><div class="flex flex-wrap gap-2"><button type="button" onclick="window.miniAdminOpenReceipt('${esc(b.code)}')" class="bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">Dettaglio</button><button type="button" onclick="window.downloadMiniStageBookingPdf?.('${esc(b.code)}')" class="bg-orange-50 text-orange-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">PDF + autorizzazione</button>${!b.authorizationPaperReceived ? `<button type="button" onclick="window.markAuthorizationPaperReceived?.('${esc(b.code)}')" class="bg-orange-600 text-white px-3 py-1.5 rounded-lg text-[10px] font-bold">Segna modulo ricevuto</button>` : ''}</div></div>`).join('') || '<p class="text-xs text-gray-400 italic">Nessuna autorizzazione di uscita autonoma registrata.</p>';
  }

  function renderScannerSessions() {
    const root = document.getElementById('mini-v2-scanner-sessions');
    if (!root) return;
    const now = Date.now();
    const rows = [...state.sessions].sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 12);
    root.innerHTML = rows.map(s => {
      const active = !!s.active && Number(s.expiresAt || 0) > now;
      const created = s.createdAt ? new Date(s.createdAt).toLocaleString('it-IT') : 'N/D';
      const expires = s.expiresAt ? new Date(s.expiresAt).toLocaleString('it-IT') : 'N/D';
      return `<div class="p-3 rounded-xl border ${active ? 'border-cyan-100 bg-cyan-50/40' : 'border-gray-100 bg-gray-50'} flex flex-col md:flex-row md:items-center md:justify-between gap-2"><div><strong class="text-xs ${active ? 'text-cyan-950' : 'text-gray-500'}">${active ? 'Sessione attiva' : 'Sessione scaduta/revocata'}</strong><p class="text-[10px] text-gray-500">Creata: ${esc(created)} · Scade: ${esc(expires)}</p></div>${active ? `<button type="button" onclick="window.miniAdminRevokeScanner('${esc(s.id)}')" class="bg-red-50 text-red-700 px-3 py-1.5 rounded-lg text-[10px] font-bold">Revoca</button>` : ''}</div>`;
    }).join('') || '<p class="text-xs text-gray-400 italic">Nessuna sessione scanner registrata.</p>';
  }

  function renderAll() {
    if (!document.getElementById('mini-admin-console-v2')) return;
    updateSelectOptions();
    renderOverview();
    if (activeTab === 'iscritti') renderActiveList();
    if (activeTab === 'attesa') renderWaitList();
    if (activeTab === 'calendario') { renderCapacities(); renderCalendar(); }
    if (activeTab === 'scanner') renderScannerSessions();
    if (activeTab === 'documenti') { renderClasses(); renderAuth(); }
  }

  async function saveCapacities() {
    const inputs = document.querySelectorAll('#mini-v2-capacities [data-mini-cap-address]');
    for (const input of inputs) {
      const indirizzo = input.dataset.miniCapAddress;
      const postiMax = Math.max(1, parseInt(input.value, 10) || 25);
      const maxOccupied = Math.max(0, ...state.slots.filter(s => s.indirizzo === indirizzo).map(s => state.bookings.filter(b => b.slotId === s.id && (b.type === ACTIVE || b.type === CHECKED)).length));
      if (postiMax < maxOccupied) {
        input.value = String(Math.max(maxOccupied, Number(state.caps[indirizzo] || 25)));
        return showMessage(`Capienza non salvata per ${indirizzo}: ci sono già ${maxOccupied} posti occupati in uno degli slot.`, true);
      }
      await f.setDoc(f.doc(core.db, `${capsPath()}/${indirizzo}`), { indirizzo, postiMax, updatedAt: Date.now() }, { merge: true });
    }
    showMessage('Capienze salvate su Firebase.');
  }

  async function saveSlot(id) {
    const row = document.querySelector(`[data-mini-slot-row="${CSS.escape(id)}"]`);
    const slot = state.slots.find(s => s.id === id);
    if (!row || !slot) return;
    const isoDate = row.querySelector('[data-field="date"]')?.value || '';
    const time = row.querySelector('[data-field="time"]')?.value.trim() || '';
    const postiMax = Math.max(1, parseInt(row.querySelector('[data-field="cap"]')?.value, 10) || 25);
    const active = !!row.querySelector('[data-field="active"]')?.checked;
    if (!isoDate || !time) return showMessage('Inserisci data e orario.', true);
    const liveBookings = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);
    const scheduleChanged = isoDate !== slotIso(slot) || time !== String(slot.time || '');
    if (liveBookings.length && scheduleChanged) {
      renderCalendar();
      return showMessage(`Data e orario non modificati: questo MiniStage ha già ${liveBookings.length} prenotazioni/richieste. Crea un nuovo slot o gestisci prima gli iscritti.`, true);
    }
    const occupied = liveBookings.filter(b => b.type === ACTIVE || b.type === CHECKED).length;
    if (postiMax < occupied) {
      renderCalendar();
      return showMessage(`Capienza non modificata: ci sono già ${occupied} posti occupati.`, true);
    }
    const duplicate = state.slots.some(s => s.id !== id && s.indirizzo === slot.indirizzo && slotIso(s) === isoDate && String(s.time || '') === time);
    if (duplicate) {
      renderCalendar();
      return showMessage('Esiste già un MiniStage dello stesso percorso con la stessa data e lo stesso orario.', true);
    }
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo: slot.indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax, active, updatedAt: Date.now() }, { merge: true });
    showMessage('MiniStage aggiornato su Firebase.');
  }

  async function deleteSlot(id) {
    const liveBookings = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);
    if (liveBookings.length) return showMessage(`Impossibile eliminare lo slot: sono presenti ${liveBookings.length} prenotazioni/richieste collegate. Puoi disattivarlo senza cancellarlo.`, true);
    if (!confirm('Eliminare questo MiniStage dal calendario?')) return;
    await f.deleteDoc(f.doc(core.db, `${slotsPath()}/${id}`));
    showMessage('MiniStage eliminato dal calendario.');
  }

  async function createSlot() {
    const indirizzo = document.getElementById('mini-v2-new-address')?.value || '';
    const isoDate = document.getElementById('mini-v2-new-date')?.value || '';
    const time = document.getElementById('mini-v2-new-time')?.value.trim() || '';
    const postiMax = Math.max(1, parseInt(document.getElementById('mini-v2-new-cap')?.value, 10) || 25);
    if (!indirizzo || !isoDate || !time) return showMessage('Seleziona indirizzo, data e orario.', true);
    if (state.slots.some(s => s.indirizzo === indirizzo && slotIso(s) === isoDate && String(s.time || '') === time)) return showMessage('Esiste già un MiniStage dello stesso percorso con la stessa data e lo stesso orario.', true);
    const id = `SLOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await f.setDoc(f.doc(core.db, `${slotsPath()}/${id}`), { id, indirizzo, isoDate, dateStr: formatDateIt(isoDate), day: weekdayIt(isoDate), time, postiMax, active: true, createdAt: Date.now(), updatedAt: Date.now() });
    document.getElementById('mini-v2-new-date').value = '';
    showMessage('Nuovo MiniStage aggiunto su Firebase.');
  }

  async function saveClasses() {
    const inputs = document.querySelectorAll('#mini-v2-classes [data-mini-class-address]');
    for (const input of inputs) {
      const indirizzo = input.dataset.miniClassAddress;
      const classe = input.value.trim();
      const previous = String(state.classes[indirizzo] || '');
      const liveBookings = state.bookings.filter(b => b.indirizzo === indirizzo && b.type !== CANCELLED);
      if (liveBookings.length && classe !== previous) {
        input.value = previous;
        return showMessage(`Classe non modificata per ${indirizzo}: esistono già ${liveBookings.length} prenotazioni/richieste collegate.`, true);
      }
      await f.setDoc(f.doc(core.db, `${classesPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() }, { merge: true });
    }
    showMessage('Classi assegnate salvate.');
  }

  async function openReceipt(code) {
    const b = state.bookings.find(x => x.code === code);
    if (!b) return showMessage('Prenotazione non trovata.', true);
    window.setView?.('receipt', { code: b.code, type: b.type, data: b });
  }

  async function checkIn(code) {
    const b = state.bookings.find(x => x.code === code);
    if (!b) return showMessage('Prenotazione non trovata.', true);
    if (b.type === WAITLIST) return showMessage('Lo studente è ancora in lista d’attesa.', true);
    if (b.type === CANCELLED) return showMessage('La prenotazione è annullata.', true);
    if (b.type === CHECKED) return showMessage('Presenza già registrata.', true);
    if (typeof window.checkInStudent === 'function') return window.checkInStudent(code);
    await f.updateDoc(f.doc(core.db, `${bookingsPath()}/${code}`), { type: CHECKED, checkInAt: Date.now(), checkInSource: 'docente-console-v2' });
    showMessage(`Presenza registrata: ${b.nome}`);
  }

  async function manualCheckIn() {
    const input = document.getElementById('mini-v2-manual-code');
    const code = String(input?.value || '').trim().toUpperCase();
    if (!/^MS-\d{6}$/.test(code)) return showMessage('Inserisci un codice MS valido.', true);
    await checkIn(code);
    if (input) input.value = '';
  }

  async function sha256(value) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  async function createScannerSession() {
    try {
      const raw = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b => b.toString(16).padStart(2, '0')).join('');
      const hash = await sha256(raw);
      const createdAt = Date.now();
      const expiresAt = createdAt + SCANNER_TTL_MS;
      await f.setDoc(f.doc(core.db, `${scannerPath()}/${hash}`), { active: true, createdAt, expiresAt, source: 'docente-console-v2' });
      const url = new URL(location.origin + location.pathname);
      url.searchParams.set('scanner', raw);
      url.searchParams.set('v', 'scanner2');
      currentScanner = { raw, hash, url: url.toString(), createdAt, expiresAt };
      renderScannerQr();
      showMessage('QR scanner generato. Può essere usato da più telefoni per 8 ore.');
    } catch (e) {
      console.error('MiniStage scanner session', e);
      showMessage('Impossibile generare la sessione scanner.', true);
    }
  }

  function renderScannerQr() {
    const root = document.getElementById('mini-v2-scanner-qr');
    if (!root || !currentScanner) return;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(currentScanner.url)}`;
    root.innerHTML = `<div class="space-y-3 w-full"><img src="${esc(qr)}" alt="QR collegamento scanner MiniStage" class="w-56 h-56 mx-auto bg-white p-2 rounded-2xl border border-cyan-200 shadow"><p class="text-xs font-black text-cyan-950">Inquadra questo QR con i telefoni dell’accoglienza</p><p class="text-[10px] text-gray-500">Valido fino alle ${esc(new Date(currentScanner.expiresAt).toLocaleString('it-IT'))}. Lo stesso QR può collegare più telefoni.</p><div class="flex flex-wrap justify-center gap-2"><button type="button" onclick="window.miniAdminCopyScannerLink()" class="bg-white border border-cyan-200 text-cyan-800 px-3 py-2 rounded-xl text-[10px] font-bold">Copia link</button><a href="${esc(currentScanner.url)}" target="_blank" rel="noopener" class="bg-cyan-600 text-white px-3 py-2 rounded-xl text-[10px] font-bold">Apri scanner</a><button type="button" onclick="window.miniAdminRevokeScanner('${esc(currentScanner.hash)}')" class="bg-red-50 text-red-700 px-3 py-2 rounded-xl text-[10px] font-bold">Revoca QR</button></div></div>`;
  }

  async function copyScannerLink() {
    if (!currentScanner?.url) return showMessage('Genera prima un QR scanner.', true);
    try { await navigator.clipboard.writeText(currentScanner.url); showMessage('Link scanner copiato.'); }
    catch (_) { showMessage(currentScanner.url); }
  }

  async function revokeScanner(hash) {
    if (!hash) return;
    await f.setDoc(f.doc(core.db, `${scannerPath()}/${hash}`), { active: false, revokedAt: Date.now() }, { merge: true });
    if (currentScanner?.hash === hash) {
      currentScanner = null;
      const root = document.getElementById('mini-v2-scanner-qr');
      if (root) root.innerHTML = 'Sessione revocata. Genera un nuovo QR per collegare i telefoni.';
    }
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
    if (window.__MINISTAGE_ADMIN_GUARDS_V2__) return;
    window.__MINISTAGE_ADMIN_GUARDS_V2__ = true;
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
      const r = baseRender.apply(this, args);
      setTimeout(postProcessHomeSlots, 0);
      return r;
    };
  }

  function subscribe() {
    f.onSnapshot(f.collection(core.db, bookingsPath()), snap => {
      state.bookings = []; snap.forEach(d => state.bookings.push({ id: d.id, ...d.data() })); renderAll();
    }, e => console.warn('Admin v2 prenotazioni', e));
    f.onSnapshot(f.collection(core.db, slotsPath()), snap => {
      state.slots = []; snap.forEach(d => state.slots.push({ id: d.id, ...d.data() })); renderAll(); setTimeout(postProcessHomeSlots, 0);
    }, e => console.warn('Admin v2 calendario', e));
    f.onSnapshot(f.collection(core.db, capsPath()), snap => {
      state.caps = {}; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.caps[x.indirizzo] = Number(x.postiMax || 25); }); renderAll();
    }, e => console.warn('Admin v2 capienze', e));
    f.onSnapshot(f.collection(core.db, classesPath()), snap => {
      state.classes = {}; snap.forEach(d => { const x = d.data(); if (x.indirizzo) state.classes[x.indirizzo] = String(x.classe || ''); }); renderAll();
    }, e => console.warn('Admin v2 classi', e));
    f.onSnapshot(f.collection(core.db, scannerPath()), snap => {
      state.sessions = []; snap.forEach(d => state.sessions.push({ id: d.id, ...d.data() })); renderAll();
    }, e => console.warn('Admin v2 scanner', e));
  }

  function expose() {
    window.miniAdminShowTab = showTab;
    window.miniAdminToggleLegacyTools = () => setLegacyVisible(!legacyVisible);
    window.miniAdminSaveCapacities = saveCapacities;
    window.miniAdminSaveSlot = saveSlot;
    window.miniAdminDeleteSlot = deleteSlot;
    window.miniAdminCreateSlot = createSlot;
    window.miniAdminRenderCalendar = renderCalendar;
    window.miniAdminSaveClasses = saveClasses;
    window.miniAdminOpenReceipt = openReceipt;
    window.miniAdminCheckIn = checkIn;
    window.miniAdminManualCheckIn = manualCheckIn;
    window.createSmartphoneScannerLink = createScannerSession;
    window.miniAdminCopyScannerLink = copyScannerLink;
    window.miniAdminRevokeScanner = revokeScanner;
  }

  function init() {
    if (installed) return;
    if (new URLSearchParams(location.search).has('scanner')) return;
    core = window.__miniStageCore;
    f = window.firebaseImports;
    const ready = core?.db && f?.collection && f?.onSnapshot && window.__MINISTAGE_COMPLETE__?.uiReady;
    if (!ready) return setTimeout(init, 120);
    installed = true;
    window.__MINISTAGE_ADMIN_CONSOLE_V2__ = { version: VERSION };
    expose();
    installBookingGuards();
    ensureConsole();
    subscribe();
    renderAll();

    const baseAdminLogin = window.adminLogin;
    if (typeof baseAdminLogin === 'function' && !baseAdminLogin.__miniV2Wrapped) {
      const wrapped = function(...args) {
        const r = baseAdminLogin.apply(this, args);
        setTimeout(() => { ensureConsole(); organizeLegacyDashboard(); renderAll(); }, 80);
        return r;
      };
      wrapped.__miniV2Wrapped = true;
      window.adminLogin = wrapped;
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
  else setTimeout(init, 0);
})();
(() => {
  'use strict';

  const VERSION = '2026.09-clean-monolith-v1';
  const WAITLIST = 'lista_attesa';
  const ACTIVE = 'prenotazione';
  const CHECKED = 'entrato';
  const CANCELLED = 'cancellazione';
  const CLASS_COLLECTION = 'config_classi_ministage';
  const LOCK_COLLECTION = 'ministage_slot_locks';
  const SCANNER_COLLECTION = 'scanner_sessions';
  const EMAIL_URL = 'https://script.google.com/macros/s/AKfycby3UI3dEPG9OEzOIHmEK7QLIIUMC6b4yopSFm-twGBV6ZLWtVAZTvmfsa7UxKHFOXfqbQ/exec';
  const DEFAULT_CAPACITY = 25;
  const CURVATURA = 'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica';
  const ownerId = `WEB-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

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
  let bookings = [];
  let slots = [];
  let caps = {};
  let classes = { ...defaultClasses };
  let waitlistMode = false;
  let installed = false;
  let reconcileTimer = null;
  let mobileScanner = null;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const path = (name) => `artifacts/${core.appId}/public/data/${name}`;
  const bookingPath = () => path(core.collections.prenotazioni);
  const slotPath = () => path(core.collections.impostazioni);
  const capPath = () => path(core.collections.capacita);
  const classPath = () => path(CLASS_COLLECTION);
  const lockPath = () => path(LOCK_COLLECTION);
  const scannerPath = () => path(SCANNER_COLLECTION);

  function normalizeText(v) {
    return String(v || '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function activeFor(slotId, source = bookings) {
    return source.filter(b => b.slotId === slotId && (b.type === ACTIVE || b.type === CHECKED));
  }

  function queueFor(slotId, source = bookings) {
    return source
      .filter(b => b.slotId === slotId && b.type === WAITLIST)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }

  function capacityFor(slot) {
    return Math.max(1, Number(slot?.postiMax || caps[slot?.indirizzo] || DEFAULT_CAPACITY) || DEFAULT_CAPACITY);
  }

  function classFor(indirizzo) {
    return classes[indirizzo] || '';
  }

  async function snapshotCollection(collectionPath) {
    const snap = await f.getDocs(f.collection(core.db, collectionPath));
    const out = [];
    snap.forEach(d => out.push({ id: d.id, ...d.data() }));
    return out;
  }

  async function refreshState() {
    const [b, s, c, cl] = await Promise.all([
      snapshotCollection(bookingPath()),
      snapshotCollection(slotPath()),
      snapshotCollection(capPath()),
      snapshotCollection(classPath()).catch(() => [])
    ]);
    bookings = b.sort((x, y) => (y.timestamp || 0) - (x.timestamp || 0));
    slots = s;
    caps = {};
    c.forEach(x => { if (x.indirizzo) caps[x.indirizzo] = Number(x.postiMax || DEFAULT_CAPACITY); });
    classes = { ...defaultClasses };
    cl.forEach(x => { if (x.indirizzo) classes[x.indirizzo] = String(x.classe || ''); });
  }

  async function ensureCapacity25Seed() {
    try {
      const current = await snapshotCollection(capPath());
      const known = new Map(current.map(x => [x.indirizzo, x]));
      for (const indirizzo of core.addresses) {
        const old = known.get(indirizzo);
        if (!old) {
          await f.setDoc(f.doc(core.db, `${capPath()}/${indirizzo}`), {
            indirizzo, postiMax: DEFAULT_CAPACITY, seedVersion: 'capacity25-v1'
          });
        } else if (Number(old.postiMax) === 5 && old.seedVersion !== 'capacity25-v1') {
          await f.setDoc(f.doc(core.db, `${capPath()}/${indirizzo}`), {
            ...old, indirizzo, postiMax: DEFAULT_CAPACITY, seedVersion: 'capacity25-v1'
          }, { merge: true });
        }
      }
    } catch (e) {
      console.warn('MiniStage: inizializzazione capacità 25 non completata', e);
    }
  }

  async function ensureClassSeed() {
    try {
      const current = await snapshotCollection(classPath());
      const known = new Set(current.map(x => x.indirizzo));
      for (const [indirizzo, classe] of Object.entries(defaultClasses)) {
        if (!known.has(indirizzo)) {
          await f.setDoc(f.doc(core.db, `${classPath()}/${indirizzo}`), {
            indirizzo, classe, updatedAt: Date.now()
          });
        }
      }
    } catch (e) {
      console.warn('MiniStage: configurazione classi non inizializzata', e);
    }
  }

  function ensureAuthFields() {
    const modal = document.getElementById('booking-modal');
    const fields = modal?.querySelector('.space-y-3');
    if (!fields || document.getElementById('mini-exit-auth')) return;
    const block = document.createElement('div');
    block.id = 'mini-exit-auth';
    block.className = 'mt-3 p-3 rounded-xl border border-indigo-100 bg-indigo-50/40 space-y-2';
    block.innerHTML = `
      <p class="text-[10px] font-black text-indigo-800 uppercase tracking-wide">Uscita al termine del MiniStage</p>
      <select id="mini-exit-mode" class="w-full p-2.5 rounded-lg border border-indigo-100 bg-white text-xs" required>
        <option value="">Seleziona modalità di uscita</option>
        <option value="autonoma">Può uscire autonomamente</option>
        <option value="ritiro_adulto">Deve attendere un adulto</option>
      </select>
      <input id="mini-parent-name" type="text" placeholder="Nome e cognome del genitore/tutore" class="w-full p-2.5 rounded-lg border border-indigo-100 bg-white text-xs">
      <input id="mini-parent-role" type="text" placeholder="Ruolo del dichiarante (es. madre, padre, tutore)" class="w-full p-2.5 rounded-lg border border-indigo-100 bg-white text-xs">
      <input id="mini-pickup-name" type="text" placeholder="Adulto incaricato del ritiro (se previsto)" class="w-full p-2.5 rounded-lg border border-indigo-100 bg-white text-xs hidden">
      <label class="flex items-start gap-2 text-[10px] text-gray-600 leading-relaxed">
        <input id="mini-declaration" type="checkbox" class="mt-0.5">
        <span>Dichiaro che i dati inseriti sono corretti e prendo visione delle modalità di uscita. Per l'uscita autonoma il documento PDF dovrà essere stampato, firmato a mano e consegnato alla scuola.</span>
      </label>`;
    fields.insertAdjacentElement('afterend', block);
    document.getElementById('mini-exit-mode')?.addEventListener('change', (e) => {
      const pickup = document.getElementById('mini-pickup-name');
      pickup?.classList.toggle('hidden', e.target.value !== 'ritiro_adulto');
    });
  }

  function resetBookingExtras() {
    waitlistMode = false;
    const mode = document.getElementById('mini-exit-mode');
    const parent = document.getElementById('mini-parent-name');
    const role = document.getElementById('mini-parent-role');
    const pickup = document.getElementById('mini-pickup-name');
    const decl = document.getElementById('mini-declaration');
    if (mode) mode.value = '';
    if (parent) parent.value = '';
    if (role) role.value = '';
    if (pickup) { pickup.value = ''; pickup.classList.add('hidden'); }
    if (decl) decl.checked = false;
  }

  async function acquireLock(slotId) {
    const ref = f.doc(core.db, `${lockPath()}/${slotId}`);
    try {
      return await f.runTransaction(core.db, async tx => {
        const snap = await tx.get(ref);
        const data = snap.exists() ? snap.data() : {};
        const now = Date.now();
        if (data.lockedUntil && data.lockedUntil > now && data.owner !== ownerId) return false;
        tx.set(ref, { owner: ownerId, lockedAt: now, lockedUntil: now + 15000 }, { merge: true });
        return true;
      });
    } catch (e) {
      console.warn('MiniStage: lock non acquisito', e);
      return false;
    }
  }

  async function releaseLock(slotId) {
    try {
      await f.setDoc(f.doc(core.db, `${lockPath()}/${slotId}`), {
        owner: '', lockedUntil: 0, releasedAt: Date.now()
      }, { merge: true });
    } catch (_) {}
  }

  async function uniqueCode() {
    for (let i = 0; i < 10; i++) {
      const code = `MS-${Math.floor(100000 + Math.random() * 900000)}`;
      const snap = await f.getDoc(f.doc(core.db, `${bookingPath()}/${code}`));
      if (!snap.exists()) return code;
    }
    return `MS-${String(Date.now()).slice(-6)}`;
  }

  function collectForm() {
    return {
      slotId: document.getElementById('modal-slot-id')?.value || '',
      indirizzo: document.getElementById('modal-indirizzo')?.value || '',
      stageDay: document.getElementById('modal-stage-day')?.value || '',
      stageDate: document.getElementById('modal-stage-date')?.value || '',
      stageTime: document.getElementById('modal-stage-time')?.value || '',
      nome: document.getElementById('modal-nome')?.value.trim() || '',
      scuola: document.getElementById('modal-scuola')?.value.trim() || '',
      email: document.getElementById('modal-email')?.value.trim() || '',
      cellulare: document.getElementById('modal-cellulare')?.value.trim() || '',
      exitMode: document.getElementById('mini-exit-mode')?.value || '',
      parentGuardianName: document.getElementById('mini-parent-name')?.value.trim() || '',
      parentGuardianRole: document.getElementById('mini-parent-role')?.value.trim() || '',
      pickupAdultName: document.getElementById('mini-pickup-name')?.value.trim() || '',
      declarationAccepted: !!document.getElementById('mini-declaration')?.checked
    };
  }

  function validateForm(d) {
    if (!d.slotId || !d.indirizzo || !d.nome || !d.scuola || !d.email || !d.cellulare) return 'Tutti i campi principali sono obbligatori.';
    if (!/^\S+@\S+\.\S+$/.test(d.email)) return 'Inserisci un indirizzo e-mail valido.';
    if (!d.exitMode || !d.parentGuardianName || !d.parentGuardianRole || !d.declarationAccepted) return 'Completa la sezione relativa all’uscita e alla dichiarazione.';
    if (d.exitMode === 'ritiro_adulto' && !d.pickupAdultName) return 'Indica il nome dell’adulto incaricato del ritiro.';
    return '';
  }

  function duplicateExists(d, source) {
    const name = normalizeText(d.nome);
    const email = normalizeText(d.email);
    return source.some(b => b.slotId === d.slotId && b.type !== CANCELLED && normalizeText(b.nome) === name && normalizeText(b.email) === email);
  }

  async function saveSubmission(d) {
    const locked = await acquireLock(d.slotId);
    if (!locked) throw new Error('SLOT_BUSY');
    try {
      const fresh = await snapshotCollection(bookingPath());
      if (duplicateExists(d, fresh)) throw new Error('DUPLICATE');
      const slot = slots.find(s => s.id === d.slotId) || (await snapshotCollection(slotPath())).find(s => s.id === d.slotId);
      if (!slot) throw new Error('SLOT_NOT_FOUND');
      const freshCaps = await snapshotCollection(capPath());
      const capMap = {};
      freshCaps.forEach(x => { if (x.indirizzo) capMap[x.indirizzo] = Number(x.postiMax || DEFAULT_CAPACITY); });
      const max = Math.max(1, Number(slot.postiMax || capMap[d.indirizzo] || DEFAULT_CAPACITY));
      const active = fresh.filter(b => b.slotId === d.slotId && (b.type === ACTIVE || b.type === CHECKED)).length;
      const queue = fresh.filter(b => b.slotId === d.slotId && b.type === WAITLIST).sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
      const type = (waitlistMode || queue.length > 0 || active >= max) ? WAITLIST : ACTIVE;
      const code = await uniqueCode();
      const timestamp = Date.now();
      const data = {
        code, type,
        slotId: d.slotId,
        indirizzo: d.indirizzo,
        stageDay: d.stageDay,
        stageDate: d.stageDate,
        stageTime: d.stageTime,
        nome: d.nome,
        scuola: d.scuola,
        email: d.email,
        cellulare: d.cellulare,
        timestamp,
        reminderSent: false,
        certificateSent: false,
        classeAssegnata: classFor(d.indirizzo) || 'Da definire',
        exitMode: d.exitMode,
        parentGuardianName: d.parentGuardianName,
        parentGuardianRole: d.parentGuardianRole,
        pickupAdultName: d.exitMode === 'ritiro_adulto' ? d.pickupAdultName : '',
        declarationAccepted: true,
        declarationTimestamp: timestamp,
        declarationVersion: 'MiniStage-2026-v1',
        authorizationPaperReceived: false
      };
      if (type === WAITLIST) {
        data.waitlistRequestedAt = timestamp;
        data.waitlistStatus = 'Iscrizione con riserva';
        data.iscrizioneConRiserva = true;
      }
      await f.setDoc(f.doc(core.db, `${bookingPath()}/${code}`), data);
      return data;
    } finally {
      await releaseLock(d.slotId);
    }
  }

  function showSavedReceipt(data) {
    window.closeModal?.();
    window.setView?.('receipt', { code: data.code, type: data.type, data });
    if (data.type === WAITLIST) window.showMessage?.('Iscrizione con riserva registrata. Riceverai una conferma solo se si libera un posto.');
    else window.showMessage?.('Prenotazione registrata con successo!');
    setTimeout(() => window.sendAutomaticEmailNotification?.(data, false), 120);
  }

  async function confirmBooking() {
    const d = collectForm();
    const error = validateForm(d);
    if (error) return window.showMessage?.(error, true);
    const button = document.querySelector('#booking-modal button[onclick="window.confirmBooking()"]');
    if (button?.dataset.saving === '1') return;
    if (button) { button.dataset.saving = '1'; button.disabled = true; button.textContent = 'Salvataggio...'; }
    try {
      const saved = await saveSubmission(d);
      showSavedReceipt(saved);
    } catch (e) {
      console.error(e);
      if (e.message === 'DUPLICATE') window.showMessage?.('Risulta già una richiesta attiva con lo stesso nome ed e-mail per questo MiniStage.', true);
      else if (e.message === 'SLOT_BUSY') window.showMessage?.('Lo slot è in aggiornamento. Riprova tra pochi secondi.', true);
      else if (e.message === 'SLOT_NOT_FOUND') window.showMessage?.('Lo slot non è più disponibile.', true);
      else window.showMessage?.('Impossibile completare il salvataggio. Riprova.', true);
    } finally {
      if (button) {
        button.dataset.saving = '0'; button.disabled = false;
        button.textContent = waitlistMode ? "Inserisci in Lista d'attesa" : 'Conferma Iscrizione';
      }
    }
  }

  function setModalMode(isWait) {
    waitlistMode = isWait;
    const title = document.querySelector('#booking-modal h3');
    const button = document.querySelector('#booking-modal button[onclick="window.confirmBooking()"]');
    const info = document.getElementById('modal-slot-info');
    if (title) title.textContent = isWait ? "Richiesta Lista d'Attesa MiniStage" : 'Modulo di Iscrizione MiniStage';
    if (button) {
      button.textContent = isWait ? "Inserisci in Lista d'attesa" : 'Conferma Iscrizione';
      button.className = isWait
        ? 'bg-purple-600 hover:bg-purple-700 text-white font-bold py-2.5 px-4 rounded-xl transition text-xs shadow-md'
        : 'bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded-xl transition text-xs shadow-md';
    }
    if (isWait && info && !info.querySelector?.('[data-wait-info]')) {
      info.insertAdjacentHTML('beforeend', '<span data-wait-info><br><strong class="text-purple-700">Posti esauriti:</strong> la richiesta verrà registrata con riserva in ordine cronologico.</span>');
    }
  }

  function findSlotCard(slot) {
    const map = {
      'Liceo Scientifico - Scienze Applicate': 'container-liceo',
      'Relazioni Internazionali per il Marketing (RIM)': 'container-rim',
      'Logistica - Quadriennale': 'container-logistica',
      'Costruzione Ambiente e Territorio (CAT)': 'container-cat',
      'Sistema Moda': 'container-moda',
      [CURVATURA]: 'container-curvatura-economica'
    };
    const root = document.getElementById(map[slot.indirizzo]);
    if (!root) return null;
    return Array.from(root.children).find(el => {
      const txt = el.textContent || '';
      return txt.includes(String(slot.day || '')) && txt.includes(String(slot.dateStr || '')) && txt.includes(String(slot.time || ''));
    }) || null;
  }

  function decorateStages() {
    slots.forEach(slot => {
      const card = findSlotCard(slot);
      if (!card) return;
      const queue = queueFor(slot.id);
      const active = activeFor(slot.id).length;
      const max = capacityFor(slot);
      if (!queue.length && active < max) return;
      const actionHost = Array.from(card.querySelectorAll('button,span')).find(el => /prenota|completo/i.test(el.textContent || ''));
      if (actionHost && !/lista d'attesa/i.test(actionHost.textContent || '')) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-extrabold px-4 py-2 rounded-xl transition shadow-md';
        btn.textContent = queue.length ? `Lista d'attesa (${queue.length})` : "Lista d'attesa";
        btn.addEventListener('click', () => window.openWaitlistModal(slot.id, slot.indirizzo, slot.day, slot.dateStr, slot.time));
        actionHost.replaceWith(btn);
      }
      const badge = Array.from(card.querySelectorAll('span')).find(el => /esaurito|disponibili/i.test(el.textContent || ''));
      if (badge) {
        badge.textContent = queue.length ? `Lista attesa: ${queue.length}` : 'Esaurito';
        badge.className = 'inline-block text-[9px] font-bold bg-purple-100 text-purple-800 px-2 py-0.5 rounded-full';
      }
    });
  }

  async function queuePosition(res) {
    const fresh = await snapshotCollection(bookingPath()).catch(() => bookings);
    const q = queueFor(res.slotId, fresh);
    const idx = q.findIndex(x => x.code === res.code);
    return idx >= 0 ? idx + 1 : null;
  }

  function drawField(pdf, label, value, x, y, width = 80) {
    pdf.setFont('Helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(90, 90, 100); pdf.text(label, x, y);
    pdf.setFont('Helvetica', 'normal'); pdf.setFontSize(9.2); pdf.setTextColor(30, 27, 75);
    const lines = pdf.splitTextToSize(String(value || 'N/D'), width);
    pdf.text(lines, x, y + 4.5);
    return y + 4.5 + Math.max(7, lines.length * 4.2);
  }

  function addPdfHeader(pdf, badge, badgeColor = [79, 70, 229]) {
    pdf.setFillColor(30, 27, 75); pdf.rect(0, 0, 210, 38, 'F');
    pdf.setTextColor(255,255,255); pdf.setFont('Helvetica','bold'); pdf.setFontSize(20); pdf.text('IIS PRIMO LEVI - SEREGNO', 15, 16);
    pdf.setFontSize(9); pdf.setFont('Helvetica','normal'); pdf.text('Commissione Orientamento - MiniStage', 15, 23);
    pdf.setFillColor(...badgeColor); pdf.roundedRect(137, 9, 58, 12, 2, 2, 'F');
    pdf.setFont('Helvetica','bold'); pdf.setFontSize(8.5); pdf.text(badge, 141, 16.5);
  }

  async function addQrIfPossible(pdf, code, x, y, size) {
    try {
      const url = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(code)}`;
      const response = await fetch(url);
      if (!response.ok) return;
      const blob = await response.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      pdf.addImage(dataUrl, 'PNG', x, y, size, size);
    } catch (_) {}
  }

  async function createConfirmedPdf(res, isRetrieval = false) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) throw new Error('PDF non disponibile');
    const promoted = !!(res.waitlistPromotedAt || res.waitlistPromotionStatus === 'Ammesso da scorrimento');
    const pdf = new jsPDF('p', 'mm', 'a4');
    addPdfHeader(pdf, promoted ? 'AMMESSO DA SCORRIMENTO' : (isRetrieval ? 'DUPLICATO RICEVUTA' : 'PRENOTAZIONE CONFERMATA'), promoted ? [192, 38, 211] : [79,70,229]);
    pdf.setTextColor(30,27,75); pdf.setFont('Helvetica','bold'); pdf.setFontSize(14); pdf.text('CONFERMA PRENOTAZIONE MINI-STAGE', 15, 51);
    let y1 = 65;
    y1 = drawField(pdf, 'Studente', res.nome, 18, y1);
    y1 = drawField(pdf, 'Scuola di provenienza', res.scuola, 18, y1);
    y1 = drawField(pdf, 'E-mail', res.email, 18, y1);
    y1 = drawField(pdf, 'Cellulare', res.cellulare, 18, y1);
    let y2 = 65;
    y2 = drawField(pdf, 'Percorso', res.indirizzo, 110, y2);
    y2 = drawField(pdf, 'Classe assegnata', res.classeAssegnata || classFor(res.indirizzo) || 'Da definire', 110, y2);
    y2 = drawField(pdf, 'Data', `${res.stageDay || ''} ${res.stageDate || ''}`.trim(), 110, y2);
    y2 = drawField(pdf, 'Orario', res.stageTime || '14:30 - 16:30', 110, y2);
    const boxY = Math.max(y1,y2)+4;
    pdf.setFillColor(243,244,246); pdf.roundedRect(15, boxY, 180, 18, 3,3,'F');
    pdf.setTextColor(30,27,75); pdf.setFont('Helvetica','bold'); pdf.setFontSize(10); pdf.text('CODICE PRENOTAZIONE', 22, boxY+7);
    pdf.setTextColor(220,38,38); pdf.setFont('Courier','bold'); pdf.setFontSize(14); pdf.text(res.code, 112, boxY+8);
    const infoY = boxY + 30;
    pdf.setTextColor(30,27,75); pdf.setFont('Helvetica','bold'); pdf.setFontSize(10); pdf.text('ACCESSO E USCITA', 15, infoY);
    pdf.setFont('Helvetica','normal'); pdf.setFontSize(8.7); pdf.setTextColor(80,80,90);
    const access = [
      'Accoglienza: presentarsi nell’atrio dell’istituto alle ore 14:15.',
      'Attività: ore 14:30 - 16:30, salvo diversa indicazione nello slot inserito dalla Commissione.',
      res.exitMode === 'autonoma' ? 'Uscita: autonoma, subordinata alla consegna del modulo cartaceo firmato.' : `Uscita: attesa dell’adulto incaricato${res.pickupAdultName ? ` (${res.pickupAdultName})` : ''}.`,
      'In caso di impossibilità a partecipare, annullare tempestivamente la prenotazione dal sito.'
    ];
    let ay=infoY+7; access.forEach(t=>{ const lines=pdf.splitTextToSize(`• ${t}`,172); pdf.text(lines,18,ay); ay += lines.length*4.2+2; });
    window.drawBarcodeInPDF?.(pdf, res.code, 18, ay+3);
    await addQrIfPossible(pdf, res.code, 155, ay, 28);
    pdf.setFontSize(7.5); pdf.setTextColor(140,140,150); pdf.text(`Generato il ${new Date().toLocaleString('it-IT')} - IIS Primo Levi Seregno`,15,285);

    if (res.exitMode === 'autonoma') {
      pdf.addPage();
      pdf.setTextColor(30,27,75); pdf.setFont('Helvetica','bold'); pdf.setFontSize(16); pdf.text('AUTORIZZAZIONE ALL’USCITA AUTONOMA', 15, 24);
      pdf.setFontSize(10); pdf.setFont('Helvetica','normal');
      const text = `Il/La sottoscritto/a ${res.parentGuardianName || '________________'}, in qualità di ${res.parentGuardianRole || '________________'}, dichiara di aver indicato nel modulo di prenotazione l’uscita autonoma dello/a studente/ssa ${res.nome || '________________'} al termine del MiniStage presso l’IIS Primo Levi di Seregno.`;
      pdf.text(pdf.splitTextToSize(text,180),15,38);
      pdf.setFont('Helvetica','bold'); pdf.text('Codice prenotazione:',15,72); pdf.setFont('Courier','bold'); pdf.text(res.code,58,72);
      pdf.setFont('Helvetica','normal'); pdf.text('Data: ____________________',15,95); pdf.text('Firma autografa del genitore/tutore:',15,118); pdf.line(15,137,100,137);
      pdf.setFontSize(8); pdf.setTextColor(100,100,110); pdf.text(pdf.splitTextToSize('Stampare, firmare a mano e consegnare questo foglio alla scuola secondo le indicazioni dell’Istituto.',180),15,152);
    }
    return pdf;
  }

  async function createReservePdf(res, position) {
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) throw new Error('PDF non disponibile');
    const pdf = new jsPDF('p','mm','a4');
    addPdfHeader(pdf, 'ISCRIZIONE CON RISERVA', [126,34,206]);
    pdf.setFillColor(255,247,237); pdf.setDrawColor(251,146,60); pdf.roundedRect(15,47,180,25,3,3,'FD');
    pdf.setTextColor(154,52,18); pdf.setFont('Helvetica','bold'); pdf.setFontSize(12); pdf.text('NON ANCORA AMMESSO AL MINISTAGE',22,58);
    pdf.setFont('Helvetica','normal'); pdf.setFontSize(8.5); pdf.text('Questo documento registra la richiesta ma non costituisce conferma definitiva di partecipazione.',22,65);
    let y1=88; y1=drawField(pdf,'Studente',res.nome,18,y1); y1=drawField(pdf,'Scuola',res.scuola,18,y1); y1=drawField(pdf,'E-mail',res.email,18,y1); y1=drawField(pdf,'Telefono',res.cellulare,18,y1);
    let y2=88; y2=drawField(pdf,'Percorso',res.indirizzo,110,y2); y2=drawField(pdf,'Classe',res.classeAssegnata || 'Da definire',110,y2); y2=drawField(pdf,'Data',`${res.stageDay||''} ${res.stageDate||''}`.trim(),110,y2); y2=drawField(pdf,'Orario',res.stageTime,110,y2);
    const qy=Math.max(y1,y2)+5; pdf.setFillColor(245,243,255); pdf.roundedRect(15,qy,180,25,3,3,'F'); pdf.setTextColor(88,28,135); pdf.setFont('Helvetica','bold'); pdf.setFontSize(10); pdf.text(`Codice richiesta: ${res.code}`,22,qy+9); pdf.text(`Posizione indicativa in lista: ${position || 'in aggiornamento'}`,22,qy+17);
    let y=qy+39; pdf.setTextColor(30,27,75); pdf.setFontSize(11); pdf.text('COME FUNZIONA LA LISTA D’ATTESA',15,y); y+=8; pdf.setFont('Helvetica','normal'); pdf.setFontSize(8.5); pdf.setTextColor(70,70,80);
    const steps=[
      'La priorità segue l’ordine cronologico di registrazione nello stesso slot.',
      'Se si libera un posto, il sistema assegna il posto al primo nominativo utile in coda.',
      'La promozione genera una seconda e-mail con la conferma definitiva e il nuovo PDF.',
      'Non presentarsi al MiniStage utilizzando soltanto questa ricevuta di riserva.'
    ];
    steps.forEach((s,i)=>{ const lines=pdf.splitTextToSize(`${i+1}. ${s}`,172); pdf.text(lines,19,y); y+=lines.length*4.2+4; });
    pdf.setFillColor(254,242,242); pdf.setDrawColor(248,113,113); pdf.roundedRect(15,y+3,180,25,3,3,'FD'); pdf.setTextColor(153,27,27); pdf.setFont('Helvetica','bold'); pdf.text('NON VALIDO COME PASS DI ACCESSO',22,y+13); pdf.setFont('Helvetica','normal'); pdf.setFontSize(8); pdf.text(pdf.splitTextToSize('Attendere la seconda e-mail di conferma definitiva prima di considerare il posto assegnato.',160),22,y+20);
    pdf.setFontSize(7.5); pdf.setTextColor(140,140,150); pdf.text(`Generato il ${new Date().toLocaleString('it-IT')} - IIS Primo Levi Seregno`,15,285);
    return pdf;
  }

  async function sendPdfEmail(res, pdf, kind, position = null, isRetrieval = false) {
    const base64 = pdf.output('datauristring').split(',')[1];
    const parts = String(res.nome || '').trim().split(' ');
    const first = parts[0] || '';
    const rest = parts.slice(1).join(' ');
    const promoted = !!(res.waitlistPromotedAt || res.waitlistPromotionStatus === 'Ammesso da scorrimento');
    let subject = `MiniStage IIS Primo Levi - Conferma ${res.code}`;
    let message = `La prenotazione ${res.code} è confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.`;
    if (kind === 'reserve') {
      subject = `MiniStage IIS Primo Levi - Iscrizione con riserva ${res.code}`;
      message = `La richiesta ${res.code} è stata registrata con riserva. Posizione indicativa: ${position || 'in aggiornamento'}. Attendere una successiva e-mail di conferma definitiva.`;
    } else if (promoted) {
      subject = `MiniStage IIS Primo Levi - Ammesso da scorrimento ${res.code}`;
      message = `Il posto è stato assegnato dalla lista d'attesa. La prenotazione ${res.code} è ora confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.`;
    } else if (isRetrieval) {
      subject = `MiniStage IIS Primo Levi - Duplicato prenotazione ${res.code}`;
    }
    await fetch(EMAIL_URL, {
      method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
      body:JSON.stringify({
        email:res.email, nome:first, cognome:rest, codice_prenotazione:res.code,
        pdfBase64:base64, tipo:kind === 'reserve' ? 'iscrizione_con_riserva' : (promoted ? 'ammesso_da_scorrimento' : 'prenotazione'),
        stato:kind === 'reserve' ? 'ISCRIZIONE CON RISERVA' : (promoted ? 'AMMESSO DA SCORRIMENTO' : 'PRENOTAZIONE CONFERMATA'),
        classe_assegnata:res.classeAssegnata || '', posizione_lista:position || '', oggetto:subject, subject, messaggio:message, message
      })
    });
  }

  async function sendAutomatic(res, isRetrieval = false) {
    const statusBg = document.getElementById('email-sending-status');
    const statusText = document.getElementById('email-status-text');
    if (statusBg) statusBg.classList.remove('hidden');
    if (statusText) statusText.textContent = 'Generazione e invio della ricevuta e-mail...';
    try {
      if (res.type === WAITLIST) {
        const position = await queuePosition(res);
        const pdf = await createReservePdf(res, position);
        await sendPdfEmail(res, pdf, 'reserve', position, isRetrieval);
        try {
          await f.updateDoc(f.doc(core.db, `${bookingPath()}/${res.code}`), {
            reservePositionAtRegistration: position || null,
            reserveMailRequestedAt: Date.now(),
            iscrizioneConRiserva: true,
            waitlistStatus: 'Iscrizione con riserva'
          });
        } catch (_) {}
      } else {
        const pdf = await createConfirmedPdf(res, isRetrieval);
        await sendPdfEmail(res, pdf, 'confirmed', null, isRetrieval);
      }
    } catch (e) {
      console.error('MiniStage: invio e-mail/PDF non riuscito', e);
      window.showMessage?.('La registrazione è salvata, ma l’invio della e-mail non è riuscito.', true);
    } finally {
      statusBg?.classList.add('hidden');
    }
  }

  function decorateReceipt(data) {
    const res = data?.data;
    if (!res) return;
    const title = document.getElementById('receipt-title');
    const msg = document.getElementById('receipt-message');
    const details = document.getElementById('receipt-details');
    const notice = document.querySelector('#view-receipt p.text-red-600, #view-receipt p.text-red-700');
    if (res.type === WAITLIST || data.type === WAITLIST) {
      if (title) title.textContent = 'ISCRIZIONE CON RISERVA';
      if (msg) msg.innerHTML = `Gentile <strong>${esc(res.nome)}</strong>, la richiesta è registrata con riserva. Non sei ancora ammesso: riceverai una seconda e-mail solo in caso di scorrimento.`;
      if (notice) notice.textContent = 'ISCRIZIONE CON RISERVA: NON VALIDA COME PASS DI ACCESSO. ATTENDERE LA CONFERMA DEFINITIVA.';
    } else if (res.waitlistPromotedAt || res.waitlistPromotionStatus === 'Ammesso da scorrimento') {
      if (title) title.textContent = 'AMMESSO DA SCORRIMENTO';
      if (msg) msg.innerHTML = `Gentile <strong>${esc(res.nome)}</strong>, il posto è stato assegnato dalla lista d’attesa. La prenotazione è ora confermata.`;
    }
    if (details) {
      const extra = [];
      extra.push(`<div><span class="text-gray-400 font-medium">Classe assegnata:</span> <strong class="text-indigo-950">${esc(res.classeAssegnata || classFor(res.indirizzo) || 'Da definire')}</strong></div>`);
      extra.push(`<div><span class="text-gray-400 font-medium">Uscita:</span> <strong class="text-indigo-950">${res.exitMode === 'autonoma' ? 'Autonoma - consegnare modulo firmato' : res.exitMode === 'ritiro_adulto' ? `Attesa adulto${res.pickupAdultName ? ` (${esc(res.pickupAdultName)})` : ''}` : 'Non indicata'}</strong></div>`);
      if (!details.querySelector('[data-mini-extra]')) details.insertAdjacentHTML('beforeend', `<div data-mini-extra class="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">${extra.join('')}</div>`);
    }
  }

  async function promoteNext(slot) {
    const locked = await acquireLock(slot.id);
    if (!locked) return false;
    try {
      const fresh = await snapshotCollection(bookingPath());
      const active = activeFor(slot.id, fresh).length;
      const capRows = await snapshotCollection(capPath());
      const capMap = {}; capRows.forEach(x=>{if(x.indirizzo)capMap[x.indirizzo]=Number(x.postiMax||DEFAULT_CAPACITY)});
      const max = Math.max(1, Number(slot.postiMax || capMap[slot.indirizzo] || DEFAULT_CAPACITY));
      const queue = queueFor(slot.id, fresh);
      if (!queue.length || active >= max) return false;
      const next = queue[0];
      const ref = f.doc(core.db, `${bookingPath()}/${next.code}`);
      const live = await f.getDoc(ref);
      if (!live.exists() || live.data()?.type !== WAITLIST) return false;
      const patch = {
        type: ACTIVE,
        iscrizioneConRiserva: false,
        waitlistPromotedAt: Date.now(),
        waitlistPromotionStatus: 'Ammesso da scorrimento',
        waitlistPromotionSource: 'automatico',
        waitlistPositionAtPromotion: 1,
        classeAssegnata: next.classeAssegnata || classFor(next.indirizzo) || 'Da definire'
      };
      await f.updateDoc(ref, patch);
      const promoted = { ...next, ...patch };
      setTimeout(() => sendAutomatic(promoted, false), 80);
      return true;
    } finally {
      await releaseLock(slot.id);
    }
  }

  async function reconcileAll() {
    try {
      await refreshState();
      for (const slot of slots) {
        for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {
          const fresh = await snapshotCollection(bookingPath());
          if (!queueFor(slot.id, fresh).length) break;
          const cap = capacityFor(slot);
          if (activeFor(slot.id, fresh).length >= cap) break;
          const done = await promoteNext(slot);
          if (!done) break;
        }
      }
      await refreshState();
      decorateStages();
      renderAdminExtension();
    } catch (e) {
      console.warn('MiniStage: scorrimento non completato', e);
    }
  }

  function scheduleReconcile(delay=180) {
    clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(reconcileAll, delay);
  }

  function renderClassConfig() {
    const root = document.getElementById('mini-class-config');
    if (!root) return;
    root.innerHTML = core.addresses.map(ind=>`
      <label class="block p-2 rounded-xl border border-indigo-100 bg-white">
        <span class="block text-[9px] font-black uppercase text-indigo-500 mb-1">${esc(ind)}</span>
        <input data-class-address="${esc(ind)}" value="${esc(classes[ind] || '')}" placeholder="Classe da assegnare" class="w-full p-2 rounded-lg border border-indigo-100 text-xs font-bold">
      </label>`).join('');
  }

  async function saveClassConfig() {
    const inputs = document.querySelectorAll('#mini-class-config input[data-class-address]');
    for (const input of inputs) {
      const indirizzo = input.dataset.classAddress;
      const classe = input.value.trim();
      classes[indirizzo] = classe;
      await f.setDoc(f.doc(core.db, `${classPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() });
    }
    window.showMessage?.('Classi assegnate salvate.');
    await refreshState();
    renderAdminExtension();
  }

  function statusLabel(b) {
    if (b.type === WAITLIST) return 'Con riserva';
    if (b.type === CHECKED) return 'Presente';
    if (b.type === CANCELLED) return 'Annullata';
    if (b.waitlistPromotedAt) return 'Ammesso da scorrimento';
    return 'Prenotato';
  }

  function ensureAdminPanels() {
    const dash = document.getElementById('admin-dashboard');
    if (!dash || document.getElementById('mini-complete-admin')) return;
    const section = document.createElement('section');
    section.id = 'mini-complete-admin';
    section.className = 'space-y-4';
    section.innerHTML = `
      <div class="glass-card p-5 border-l-4 border-indigo-600 space-y-3">
        <div class="flex flex-col sm:flex-row justify-between gap-3 sm:items-center">
          <div><h3 class="text-sm font-black text-indigo-950">Classi assegnate ai MiniStage</h3><p class="text-[10px] text-gray-500">Modifica la classe comunicata nelle conferme e nei PDF.</p></div>
          <button onclick="window.saveMiniStageClassConfig()" class="bg-indigo-600 text-white font-bold px-4 py-2 rounded-xl text-xs">Salva classi</button>
        </div>
        <div id="mini-class-config" class="grid grid-cols-1 md:grid-cols-2 gap-2"></div>
      </div>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div class="glass-card p-4"><p class="text-[9px] uppercase font-black text-orange-600">Documenti uscita da ritirare</p><p id="mini-doc-count" class="text-3xl font-black text-orange-900">0</p></div>
        <div class="glass-card p-4"><p class="text-[9px] uppercase font-black text-purple-600">Lista d'attesa</p><p id="mini-wait-count" class="text-3xl font-black text-purple-900">0</p></div>
        <div class="glass-card p-4"><p class="text-[9px] uppercase font-black text-fuchsia-600">Ammessi da scorrimento</p><p id="mini-promoted-count" class="text-3xl font-black text-fuchsia-900">0</p></div>
      </div>
      <div class="glass-card p-5 space-y-3">
        <div class="flex flex-wrap justify-between gap-2 items-center">
          <div><h3 class="text-sm font-black text-indigo-950">PDF ed elenchi ufficiali</h3><p class="text-[10px] text-gray-500">Elenchi per classe, tutte le classi e iscrizioni con riserva.</p></div>
          <div class="flex flex-wrap gap-2">
            <button onclick="window.downloadAllClassListsPdf()" class="bg-red-600 text-white font-bold px-3 py-2 rounded-xl text-xs">PDF tutte le classi</button>
            <button onclick="window.downloadWaitlistPdf()" class="bg-purple-600 text-white font-bold px-3 py-2 rounded-xl text-xs">PDF iscrizioni con riserva</button>
          </div>
        </div>
        <div id="mini-class-pdf-buttons" class="flex flex-wrap gap-2"></div>
      </div>
      <div class="glass-card p-5 border-l-4 border-purple-500 space-y-3"><h3 class="text-sm font-black text-purple-950">Lista d'attesa / Iscrizioni con riserva</h3><div id="mini-wait-list" class="space-y-2 max-h-72 overflow-y-auto compact-scroll"></div></div>
      <div class="glass-card p-5 border-l-4 border-orange-500 space-y-3"><h3 class="text-sm font-black text-orange-950">Autorizzazioni e ritiro documenti</h3><div id="mini-auth-list" class="space-y-2 max-h-72 overflow-y-auto compact-scroll"></div></div>
      <div class="glass-card p-5 border-l-4 border-cyan-500 space-y-3">
        <div class="flex flex-col sm:flex-row justify-between gap-3 sm:items-center"><div><h3 class="text-sm font-black text-cyan-950">Scanner da smartphone</h3><p class="text-[10px] text-gray-500">Genera un collegamento temporaneo valido 8 ore.</p></div><button onclick="window.createSmartphoneScannerLink()" class="bg-cyan-600 text-white font-bold px-4 py-2 rounded-xl text-xs">Genera collegamento</button></div>
        <div id="mini-scanner-link-box" class="hidden text-xs bg-cyan-50 border border-cyan-100 p-3 rounded-xl break-all"></div>
      </div>`;
    dash.prepend(section);
    const typeFilter = document.getElementById('filter-type');
    if (typeFilter && !Array.from(typeFilter.options).some(o=>o.value===WAITLIST)) {
      const opt=document.createElement('option'); opt.value=WAITLIST; opt.textContent="Lista d'attesa"; typeFilter.appendChild(opt);
    }
  }

  function renderAdminExtension() {
    ensureAdminPanels();
    renderClassConfig();
    const waits = bookings.filter(b=>b.type===WAITLIST).sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
    const docs = bookings.filter(b=>b.type!==CANCELLED && b.exitMode==='autonoma' && b.declarationAccepted && !b.authorizationPaperReceived);
    const promoted = bookings.filter(b=>b.waitlistPromotedAt || b.waitlistPromotionStatus==='Ammesso da scorrimento');
    const wCount=document.getElementById('mini-wait-count'); if(wCount)wCount.textContent=String(waits.length);
    const dCount=document.getElementById('mini-doc-count'); if(dCount)dCount.textContent=String(docs.length);
    const pCount=document.getElementById('mini-promoted-count'); if(pCount)pCount.textContent=String(promoted.length);
    const waitRoot=document.getElementById('mini-wait-list');
    if(waitRoot) waitRoot.innerHTML = waits.map(b=>{
      const pos=queueFor(b.slotId).findIndex(x=>x.code===b.code)+1;
      return `<div class="p-3 bg-white border border-purple-100 rounded-xl text-xs"><div class="flex justify-between gap-3"><div><strong class="text-purple-950">${esc(b.nome)}</strong><p class="text-[10px] text-gray-500">${esc(b.code)} · ${esc(b.indirizzo)} · ${esc(b.stageDate)} ${esc(b.stageTime)}</p><p class="text-[10px] text-purple-700">Classe: ${esc(b.classeAssegnata || 'Da definire')}</p></div><span class="bg-purple-100 text-purple-800 font-black px-2 py-1 rounded-lg h-fit">Pos. ${pos}</span></div></div>`;
    }).join('') || '<p class="text-[11px] text-gray-400 italic text-center py-4">Nessuna iscrizione con riserva.</p>';
    const authRoot=document.getElementById('mini-auth-list');
    if(authRoot) authRoot.innerHTML = docs.map(b=>`<div class="p-3 bg-white border border-orange-100 rounded-xl text-xs flex justify-between gap-3 items-center"><div><strong class="text-orange-950">${esc(b.nome)}</strong><p class="text-[10px] text-gray-500">${esc(b.code)} · uscita autonoma</p></div><button onclick="window.markAuthorizationPaperReceived('${esc(b.code)}')" class="bg-orange-600 text-white font-bold px-3 py-1.5 rounded-lg text-[10px]">Documenti ricevuti</button></div>`).join('') || '<p class="text-[11px] text-gray-400 italic text-center py-4">Nessun documento in attesa.</p>';
    const btnRoot=document.getElementById('mini-class-pdf-buttons');
    if(btnRoot) btnRoot.innerHTML = Object.entries(classes).filter(([,c])=>c).map(([ind,c])=>`<button onclick="window.downloadClassListPdf('${esc(ind).replace(/'/g,"\\'")}')" class="bg-white border border-indigo-200 text-indigo-700 font-bold px-3 py-1.5 rounded-lg text-[10px]">${esc(c)}</button>`).join('');
    enhanceSlotRows();
  }

  async function markAuthorizationPaperReceived(code) {
    await f.updateDoc(f.doc(core.db, `${bookingPath()}/${code}`), { authorizationPaperReceived:true, authorizationPaperReceivedAt:Date.now() });
    window.showMessage?.('Consegna documenti registrata.');
  }

  function pdfTable(pdf, title, rows, columns) {
    pdf.setFont('Helvetica','bold'); pdf.setFontSize(15); pdf.setTextColor(30,27,75); pdf.text(title,15,18);
    let y=28; pdf.setFontSize(7.5);
    const widths = columns.map(c=>c.w); const total=widths.reduce((a,b)=>a+b,0); const scale=180/total;
    const drawHeader=()=>{ let x=15; pdf.setFillColor(238,242,255); pdf.rect(15,y,180,7,'F'); pdf.setTextColor(49,46,129); columns.forEach((c,i)=>{pdf.text(c.label,x+1,y+4.7);x+=widths[i]*scale;}); y+=8; };
    drawHeader(); pdf.setFont('Helvetica','normal'); pdf.setTextColor(50,50,60);
    rows.forEach((r,idx)=>{ if(y>280){pdf.addPage();y=15;drawHeader();} let x=15; columns.forEach((c,i)=>{const val=String(c.get(r,idx)??''); const maxW=widths[i]*scale-2; const clipped=val.length>35?val.slice(0,32)+'…':val; pdf.text(clipped,x+1,y+4.5,{maxWidth:maxW});x+=widths[i]*scale;}); pdf.setDrawColor(235,235,240);pdf.line(15,y+6.5,195,y+6.5); y+=8; });
  }

  function activeRowsForAddress(indirizzo) { return bookings.filter(b=>b.indirizzo===indirizzo && (b.type===ACTIVE || b.type===CHECKED)); }

  function downloadClassListPdf(indirizzo) {
    const jsPDF=window.jspdf?.jsPDF; if(!jsPDF)return window.showMessage?.('PDF non disponibile.',true);
    const pdf=new jsPDF('l','mm','a4'); const rows=activeRowsForAddress(indirizzo); const classe=classes[indirizzo]||'Classe da definire';
    pdfTable(pdf,`MiniStage - ${classe}`,rows,[{label:'#',w:5,get:(_,i)=>i+1},{label:'Studente',w:28,get:r=>r.nome},{label:'Percorso',w:32,get:r=>r.indirizzo},{label:'Data',w:16,get:r=>r.stageDate},{label:'Ora',w:18,get:r=>r.stageTime},{label:'Stato',w:20,get:r=>statusLabel(r)},{label:'Email',w:35,get:r=>r.email},{label:'Telefono',w:22,get:r=>r.cellulare}]); pdf.save(`MiniStage_${classe.replace(/[^a-z0-9]+/gi,'_')}.pdf`);
  }

  function downloadAllClassListsPdf() {
    const jsPDF=window.jspdf?.jsPDF; if(!jsPDF)return window.showMessage?.('PDF non disponibile.',true);
    const pdf=new jsPDF('l','mm','a4'); let first=true;
    for(const indirizzo of core.addresses){ const rows=activeRowsForAddress(indirizzo); if(!rows.length)continue; if(!first)pdf.addPage(); first=false; pdfTable(pdf,`MiniStage - ${classes[indirizzo]||indirizzo}`,rows,[{label:'#',w:5,get:(_,i)=>i+1},{label:'Studente',w:30,get:r=>r.nome},{label:'Data',w:18,get:r=>r.stageDate},{label:'Ora',w:18,get:r=>r.stageTime},{label:'Stato',w:22,get:r=>statusLabel(r)},{label:'Email',w:38,get:r=>r.email},{label:'Telefono',w:25,get:r=>r.cellulare}]); }
    if(first){pdf.setFontSize(14);pdf.text('Nessuna prenotazione attiva.',15,20);} pdf.save('MiniStage_Tutte_le_Classi.pdf');
  }

  function downloadWaitlistPdf() {
    const jsPDF=window.jspdf?.jsPDF; if(!jsPDF)return window.showMessage?.('PDF non disponibile.',true);
    const pdf=new jsPDF('l','mm','a4'); const rows=bookings.filter(b=>b.type===WAITLIST).sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
    pdfTable(pdf,'MiniStage - Iscrizioni con riserva',rows,[{label:'#',w:5,get:(_,i)=>i+1},{label:'Studente',w:28,get:r=>r.nome},{label:'Classe',w:25,get:r=>r.classeAssegnata||'Da definire'},{label:'Percorso',w:35,get:r=>r.indirizzo},{label:'Data',w:16,get:r=>r.stageDate},{label:'Ora',w:18,get:r=>r.stageTime},{label:'Pos.',w:8,get:r=>queueFor(r.slotId).findIndex(x=>x.code===r.code)+1},{label:'Email',w:35,get:r=>r.email},{label:'Telefono',w:22,get:r=>r.cellulare}]);
    pdf.save('MiniStage_Iscrizioni_con_Riserva.pdf');
  }

  function enhanceSlotRows() {
    document.querySelectorAll('#slot-management-list button[onclick*="deleteSlot"]').forEach(del=>{
      const tr=del.closest('tr'); if(!tr || tr.querySelector('[data-edit-slot]'))return;
      const m=(del.getAttribute('onclick')||'').match(/deleteSlot\('([^']+)'\)/); if(!m)return;
      const btn=document.createElement('button'); btn.type='button'; btn.dataset.editSlot='1'; btn.textContent='Modifica'; btn.className='text-indigo-600 hover:text-indigo-800 font-bold px-2 py-1 rounded transition'; btn.addEventListener('click',()=>window.editMiniStageSlot(m[1])); del.insertAdjacentElement('beforebegin',btn);
    });
  }

  async function editMiniStageSlot(id) {
    const slot=slots.find(s=>s.id===id); if(!slot)return;
    const day=prompt('Giorno della settimana',slot.day||''); if(day===null)return;
    const dateStr=prompt('Data',slot.dateStr||''); if(dateStr===null)return;
    const time=prompt('Orario',slot.time||''); if(time===null)return;
    const maxInput=prompt('Posti massimi',String(slot.postiMax||caps[slot.indirizzo]||DEFAULT_CAPACITY)); if(maxInput===null)return;
    const max=Math.max(1,parseInt(maxInput)||DEFAULT_CAPACITY);
    await f.updateDoc(f.doc(core.db,`${slotPath()}/${id}`),{day:day.trim(),dateStr:dateStr.trim(),time:time.trim(),postiMax:max});
    window.showMessage?.('Slot aggiornato.');
  }

  async function createSmartphoneScannerLink() {
    const raw = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const expiresAt=Date.now()+8*60*60*1000;
    await f.setDoc(f.doc(core.db,`${scannerPath()}/${hash}`),{active:true,createdAt:Date.now(),expiresAt});
    const url=`${location.origin}${location.pathname}?scanner=${raw}`;
    const box=document.getElementById('mini-scanner-link-box'); if(box){box.classList.remove('hidden');box.innerHTML=`<strong>Link scanner:</strong><br><a class="text-cyan-700 underline" href="${esc(url)}" target="_blank">${esc(url)}</a><br><span class="text-[10px] text-gray-500">Valido 8 ore.</span>`;}
  }

  async function scannerSessionValid(raw) {
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const hash=Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
    const snap=await f.getDoc(f.doc(core.db,`${scannerPath()}/${hash}`));
    return snap.exists() && snap.data()?.active && Number(snap.data()?.expiresAt||0)>Date.now();
  }

  async function processMobileCode(code, feedback) {
    const fresh=await snapshotCollection(bookingPath()); const b=fresh.find(x=>x.code===code);
    if(!b)return feedback('Codice non trovato.',true);
    if(b.type===WAITLIST)return feedback('Studente ancora in lista d’attesa.',true);
    if(b.type===CANCELLED)return feedback('Prenotazione annullata.',true);
    if(b.type===CHECKED)return feedback('Studente già registrato come presente.',true);
    await f.updateDoc(f.doc(core.db,`${bookingPath()}/${code}`),{type:CHECKED,checkInAt:Date.now(),checkInSource:'smartphone'});
    feedback(`Presenza registrata: ${b.nome}`);
  }

  async function initMobileScanner(raw) {
    const valid=await scannerSessionValid(raw).catch(()=>false);
    document.body.innerHTML=`<main class="min-h-screen bg-slate-50 p-4 flex justify-center"><div class="w-full max-w-md space-y-4"><h1 class="text-xl font-black text-indigo-900">Scanner MiniStage</h1><div id="mobile-status" class="p-3 rounded-xl ${valid?'bg-green-100 text-green-800':'bg-red-100 text-red-800'} font-bold text-xs">${valid?'Sessione valida':'Sessione non valida o scaduta'}</div><div id="mobile-reader" class="bg-white rounded-xl overflow-hidden min-h-64"></div><input id="mobile-code" placeholder="MS-123456" class="w-full p-3 border rounded-xl font-mono uppercase"><button id="mobile-manual" class="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl">Registra codice</button><div id="mobile-feedback" class="hidden p-3 rounded-xl text-xs font-bold"></div></div></main>`;
    if(!valid)return;
    const feedback=(msg,err=false)=>{const el=document.getElementById('mobile-feedback');el.className=`p-3 rounded-xl text-xs font-bold ${err?'bg-red-100 text-red-800':'bg-green-100 text-green-800'}`;el.textContent=msg;};
    document.getElementById('mobile-manual').onclick=()=>processMobileCode(document.getElementById('mobile-code').value.trim().toUpperCase(),feedback);
    try {
      mobileScanner=new Html5Qrcode('mobile-reader');
      const cams=await Html5Qrcode.getCameras();
      if(cams.length) await mobileScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:240,height:240}},txt=>{if(/^MS-\d{6}$/.test(txt))processMobileCode(txt,feedback);},()=>{});
    } catch(e){feedback('Fotocamera non disponibile. Usa l’inserimento manuale.',true);}
  }

  function installWrappers() {
    ensureAuthFields();
    const baseOpen=window.openBookingModal;
    const baseClose=window.closeModal;
    const baseRender=window.renderStages;
    const baseReceipt=window.updateReceiptView;
    const baseAdminLogin=window.adminLogin;
    const baseRenderSlots=window.renderSlotManagementTable;
    const baseRenderLists=window.renderDashboardLists;

    window.openBookingModal=function(slotId,indirizzo,day,dateStr,time){ ensureAuthFields(); resetBookingExtras(); const r=baseOpen.call(this,slotId,indirizzo,day,dateStr,time); setModalMode(false); return r; };
    window.openWaitlistModal=function(slotId,indirizzo,day,dateStr,time){ ensureAuthFields(); resetBookingExtras(); const r=baseOpen.call(this,slotId,indirizzo,day,dateStr,time); setModalMode(true); return r; };
    window.confirmBooking=confirmBooking;
    window.closeModal=function(...args){ const r=baseClose.apply(this,args); resetBookingExtras(); return r; };
    window.renderStages=function(...args){ const r=baseRender.apply(this,args); setTimeout(decorateStages,0); return r; };
    window.updateReceiptView=function(data){ const r=baseReceipt.call(this,data); decorateReceipt(data); return r; };
    window.sendAutomaticEmailNotification=sendAutomatic;
    window.adminLogin=function(...args){ const r=baseAdminLogin.apply(this,args); setTimeout(()=>{ensureAdminPanels();renderAdminExtension();},80); return r; };
    window.renderSlotManagementTable=function(...args){ const r=baseRenderSlots.apply(this,args); setTimeout(enhanceSlotRows,0); return r; };
    window.renderDashboardLists=function(...args){ const r=baseRenderLists.apply(this,args); setTimeout(renderAdminExtension,0); return r; };

    window.saveMiniStageClassConfig=saveClassConfig;
    window.markAuthorizationPaperReceived=markAuthorizationPaperReceived;
    window.downloadClassListPdf=downloadClassListPdf;
    window.downloadAllClassListsPdf=downloadAllClassListsPdf;
    window.downloadWaitlistPdf=downloadWaitlistPdf;
    window.editMiniStageSlot=editMiniStageSlot;
    window.createSmartphoneScannerLink=createSmartphoneScannerLink;
  }

  function subscribe() {
    f.onSnapshot(f.collection(core.db, bookingPath()), snap=>{
      bookings=[]; snap.forEach(d=>bookings.push({id:d.id,...d.data()})); bookings.sort((a,b)=>(b.timestamp||0)-(a.timestamp||0)); decorateStages(); renderAdminExtension(); scheduleReconcile(120);
    },err=>console.warn('MiniStage prenotazioni listener',err));
    f.onSnapshot(f.collection(core.db, slotPath()), snap=>{
      slots=[]; snap.forEach(d=>slots.push({id:d.id,...d.data()})); decorateStages(); renderAdminExtension(); scheduleReconcile(160);
    },err=>console.warn('MiniStage slot listener',err));
    f.onSnapshot(f.collection(core.db, capPath()), snap=>{
      caps={}; snap.forEach(d=>{const x=d.data();if(x.indirizzo)caps[x.indirizzo]=Number(x.postiMax||DEFAULT_CAPACITY)}); decorateStages();
    },err=>console.warn('MiniStage capacità listener',err));
    f.onSnapshot(f.collection(core.db, classPath()), snap=>{
      classes={...defaultClasses}; snap.forEach(d=>{const x=d.data();if(x.indirizzo)classes[x.indirizzo]=String(x.classe||'')}); renderAdminExtension();
    },err=>console.warn('MiniStage classi listener',err));
  }

  function revealHomeFallback() {
    setTimeout(()=>{
      const home=document.getElementById('view-home');
      const anyOther=['view-admin','view-receipt','view-scanner-terminal'].some(id=>{const el=document.getElementById(id);return el && !el.classList.contains('hidden')});
      if(home?.classList.contains('hidden') && !anyOther){document.getElementById('loading-spinner')?.classList.add('hidden');home.classList.remove('hidden');try{window.renderStages?.()}catch(_){}}
    },5000);
  }

  async function init() {
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
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(init,0),{once:true}); else setTimeout(init,0);
})();
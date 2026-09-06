(() => {
  'use strict';

  const VERSION = '2026.09-pdf-per-data-v1';
  const ACTIVE = 'prenotazione';
  const WAITLIST = 'lista_attesa';
  const CHECKED = 'entrato';
  const EXITED = 'uscito';
  const CANCELLED = 'cancellazione';

  let core = null;
  let f = null;
  let slots = [];
  let bookings = [];
  let installed = false;

  const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

  const rootPath = (name) => `artifacts/${core.appId}/public/data/${name}`;
  const slotPath = () => rootPath(core.collections.impostazioni);
  const bookingPath = () => rootPath(core.collections.prenotazioni);

  function isoFromAny(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    return m ? `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}` : '';
  }

  function dateIt(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
  }

  function weekdayIt(iso) {
    if (!iso) return '';
    const d = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(d.getTime())) return '';
    const value = new Intl.DateTimeFormat('it-IT', { weekday: 'long' }).format(d);
    return value ? value[0].toUpperCase() + value.slice(1) : '';
  }

  function normalizeSlot(data, id) {
    const raw = data || {};
    const isoDate = isoFromAny(raw.isoDate || raw.date || raw.data || raw.dateStr || '');
    return {
      ...raw,
      id: String(id || raw.id || ''),
      isoDate,
      dateStr: String(raw.dateStr || dateIt(isoDate) || '').trim(),
      day: String(raw.day || raw.giorno || weekdayIt(isoDate) || '').trim(),
      time: String(raw.time || raw.orario || '14:30 - 16:30').trim(),
      indirizzo: String(raw.indirizzo || '').trim()
    };
  }

  function shortAddress(address) {
    const a = String(address || '').trim();
    if (a === 'Liceo Scientifico - Scienze Applicate') return 'Liceo Scienze Applicate';
    if (/curvatura economica/i.test(a)) return 'Liceo Curvatura Economica';
    if (/relazioni internazionali/i.test(a)) return 'RIM';
    if (/logistica/i.test(a)) return 'Logistica';
    if (/costruzion/i.test(a) || /territorio/i.test(a)) return 'CAT';
    if (/moda/i.test(a)) return 'Sistema Moda';
    return a || 'Percorso';
  }

  function statusLabel(type) {
    if (type === CHECKED) return 'Presente';
    if (type === EXITED) return 'Uscito';
    if (type === ACTIVE) return 'Prenotato';
    if (type === WAITLIST) return 'Lista attesa';
    if (type === CANCELLED) return 'Annullato';
    return String(type || '—');
  }

  function rowsForSlot(slotId) {
    return bookings
      .filter(b => b.slotId === slotId && [ACTIVE, CHECKED, EXITED].includes(b.type))
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), 'it', { sensitivity: 'base' }));
  }

  function waitCount(slotId) {
    return bookings.filter(b => b.slotId === slotId && b.type === WAITLIST).length;
  }

  function ensureUi() {
    const page = document.getElementById('mini-page-pdf');
    if (!page) return null;

    const oldClassButtons = document.getElementById('mini-pages-class-pdfs');
    if (oldClassButtons) oldClassButtons.style.display = 'none';

    let block = document.getElementById('mini-pdf-per-date-block');
    if (!block) {
      block = document.createElement('div');
      block.id = 'mini-pdf-per-date-block';
      block.className = 'glass-card p-5 border-l-4 border-indigo-500 space-y-4';
      block.innerHTML = `
        <div>
          <h2 class="text-lg font-black text-indigo-950">PDF per singola data e percorso</h2>
          <p class="text-xs text-gray-500">Ogni data ha un download separato per ciascun MiniStage. I due licei sono sempre distinti: Scienze Applicate e Curvatura Economica non vengono mai uniti.</p>
        </div>
        <div id="mini-pdf-date-groups" class="space-y-3"></div>`;
      page.appendChild(block);
    }
    return document.getElementById('mini-pdf-date-groups');
  }

  function render() {
    const root = ensureUi();
    if (!root) return;

    const sorted = [...slots]
      .filter(s => s.id && s.indirizzo)
      .sort((a, b) => `${a.isoDate || a.dateStr}|${a.indirizzo}|${a.time}`.localeCompare(`${b.isoDate || b.dateStr}|${b.indirizzo}|${b.time}`));

    const groups = new Map();
    for (const slot of sorted) {
      const key = slot.isoDate || isoFromAny(slot.dateStr) || slot.dateStr || 'Senza data';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(slot);
    }

    root.innerHTML = [...groups.entries()].map(([key, group]) => {
      const first = group[0] || {};
      const iso = isoFromAny(key) || first.isoDate;
      const label = `${first.day || weekdayIt(iso)} ${first.dateStr || dateIt(iso)}`.trim() || key;
      const buttons = group.map(slot => {
        const rows = rowsForSlot(slot.id).length;
        const waits = waitCount(slot.id);
        return `<button type="button" onclick="window.downloadMiniStageSlotPdf('${esc(slot.id)}')" class="w-full sm:w-auto text-left bg-white border border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50 text-indigo-800 px-4 py-3 rounded-xl text-[10px] font-black transition shadow-sm">
          <span class="block text-[11px]">Scarica PDF – ${esc(shortAddress(slot.indirizzo))}</span>
          <span class="block mt-1 text-[9px] font-semibold text-gray-500">${esc(slot.time)} · ${rows} partecipanti${waits ? ` · ${waits} in attesa` : ''}</span>
        </button>`;
      }).join('');
      return `<section class="rounded-2xl border border-indigo-100 bg-indigo-50/30 p-4">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div class="min-w-[190px]"><p class="text-[9px] font-black uppercase tracking-wider text-indigo-500">Data MiniStage</p><h3 class="text-sm font-black text-indigo-950">${esc(label)}</h3></div>
          <div class="flex flex-col sm:flex-row sm:flex-wrap gap-2 flex-1 lg:justify-end">${buttons}</div>
        </div>
      </section>`;
    }).join('') || '<p class="text-xs text-gray-400 italic text-center py-6">Nessuna data MiniStage configurata.</p>';
  }

  function sanitizeFileName(value) {
    return String(value || '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 90) || 'MiniStage';
  }

  function drawTable(pdf, rows, startY) {
    const cols = [
      { label: '#', x: 12, w: 8, get: (_, i) => String(i + 1) },
      { label: 'Studente', x: 20, w: 46, get: r => r.nome || '—' },
      { label: 'Codice', x: 66, w: 30, get: r => r.code || r.id || '—' },
      { label: 'Stato', x: 96, w: 25, get: r => statusLabel(r.type) },
      { label: 'E-mail', x: 121, w: 58, get: r => r.email || '—' },
      { label: 'Telefono', x: 179, w: 32, get: r => r.cellulare || '—' },
      { label: 'Uscita', x: 211, w: 52, get: r => r.exitMode === 'autonoma' ? 'Autonoma' : r.exitMode === 'ritiro_adulto' ? 'Ritiro adulto' : '—' }
    ];

    let y = startY;
    const header = () => {
      pdf.setFillColor(238, 242, 255);
      pdf.rect(10, y, 277, 8, 'F');
      pdf.setFont('Helvetica', 'bold');
      pdf.setFontSize(7.5);
      pdf.setTextColor(49, 46, 129);
      cols.forEach(c => pdf.text(c.label, c.x, y + 5.3));
      y += 10;
    };
    header();
    pdf.setFont('Helvetica', 'normal');
    pdf.setTextColor(45, 45, 55);
    pdf.setFontSize(7.2);

    if (!rows.length) {
      pdf.text('Nessun partecipante confermato per questa data e questo percorso.', 12, y + 5);
      return;
    }

    rows.forEach((row, i) => {
      if (y > 194) {
        pdf.addPage();
        y = 12;
        header();
        pdf.setFont('Helvetica', 'normal');
        pdf.setTextColor(45, 45, 55);
        pdf.setFontSize(7.2);
      }
      cols.forEach(c => {
        const raw = String(c.get(row, i) ?? '');
        const clipped = raw.length > 42 ? `${raw.slice(0, 39)}...` : raw;
        pdf.text(clipped, c.x, y + 4.8, { maxWidth: c.w - 2 });
      });
      pdf.setDrawColor(235, 235, 242);
      pdf.line(10, y + 6.5, 287, y + 6.5);
      y += 8;
    });
  }

  function downloadSlotPdf(slotId) {
    const slot = slots.find(s => s.id === slotId);
    if (!slot) {
      window.showMessage?.('Data MiniStage non trovata.', true);
      return;
    }
    const jsPDF = window.jspdf?.jsPDF;
    if (!jsPDF) {
      window.showMessage?.('Generatore PDF non disponibile.', true);
      return;
    }

    const rows = rowsForSlot(slotId);
    const wait = waitCount(slotId);
    const pdf = new jsPDF('l', 'mm', 'a4');
    pdf.setFont('Helvetica', 'bold');
    pdf.setTextColor(30, 27, 75);
    pdf.setFontSize(16);
    pdf.text('IIS Primo Levi - Elenco MiniStage', 10, 14);
    pdf.setFontSize(10.5);
    pdf.text(shortAddress(slot.indirizzo), 10, 23);
    pdf.setFont('Helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(70, 70, 85);
    pdf.text(`Percorso: ${slot.indirizzo}`, 10, 30, { maxWidth: 270 });
    pdf.text(`Data: ${slot.day || weekdayIt(slot.isoDate)} ${slot.dateStr || dateIt(slot.isoDate)}    Orario: ${slot.time}`, 10, 36);
    pdf.text(`Partecipanti confermati/presenti/usciti: ${rows.length}    Lista d'attesa: ${wait}`, 10, 42);
    drawTable(pdf, rows, 48);

    const filename = `MiniStage_${sanitizeFileName(slot.dateStr || slot.isoDate)}_${sanitizeFileName(shortAddress(slot.indirizzo))}.pdf`;
    pdf.save(filename);
  }

  function subscribe() {
    f.onSnapshot(f.collection(core.db, slotPath()), snap => {
      slots = [];
      snap.forEach(d => slots.push(normalizeSlot(d.data(), d.id)));
      render();
    }, err => console.warn('MiniStage PDF per data - date:', err));

    f.onSnapshot(f.collection(core.db, bookingPath()), snap => {
      bookings = [];
      snap.forEach(d => bookings.push({ id: d.id, code: d.data().code || d.id, ...d.data() }));
      render();
    }, err => console.warn('MiniStage PDF per data - prenotazioni:', err));
  }

  function init() {
    if (installed) return;
    core = window.__miniStageCore;
    f = window.firebaseImports;
    if (!core?.db || !core?.collections?.impostazioni || !core?.collections?.prenotazioni || !f?.onSnapshot || !f?.collection) {
      setTimeout(init, 150);
      return;
    }
    if (core.auth && !core.auth.currentUser) {
      setTimeout(init, 150);
      return;
    }
    installed = true;
    window.downloadMiniStageSlotPdf = downloadSlotPdf;
    subscribe();
    const observer = new MutationObserver(() => render());
    observer.observe(document.body, { childList: true, subtree: true });
    window.__MINISTAGE_PDF_DATE_EXTENSION__ = { version: VERSION };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 0), { once: true });
  } else {
    setTimeout(init, 0);
  }
})();

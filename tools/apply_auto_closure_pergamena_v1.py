from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'MISSING {label}')
    return text.replace(old, new, 1)

idx = Path('index.html')
complete = Path('ministage-complete.js')
admin = Path('ministage-admin-console-v2-original.js')
wrapper = Path('ministage-admin-console-v2.js')

html = idx.read_text(encoding='utf-8')
js = complete.read_text(encoding='utf-8')
adm = admin.read_text(encoding='utf-8')
wrap = wrapper.read_text(encoding='utf-8')

# 1) Ricevuta: download PDF diretto, niente finestra di stampa.
html = replace_once(
    html,
    '<button onclick="window.print()" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition shadow-md flex items-center justify-center text-xs">\n                        Stampa o Salva PDF\n                    </button>',
    '<button onclick="window.downloadCurrentMiniStagePdf?.()" class="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl transition shadow-md flex items-center justify-center text-xs">\n                        Scarica PDF\n                    </button>',
    'receipt print button'
)

# Espone gli endpoint Apps Script al motore avanzato senza duplicare URL.
html = replace_once(
    html,
    "            },\n            getBookings: () => allBookings,",
    "            },\n            endpoints: {\n                email: EMAIL_SCRIPT_DEPLOYMENT_URL,\n                cancellation: CANCELLATION_SCRIPT_URL,\n                reminder: REMINDER_SCRIPT_URL,\n                certificate: CERTIFICATE_SCRIPT_URL\n            },\n            getBookings: () => allBookings,",
    'core endpoints'
)
html = html.replace('ministage-complete.js?v=20260906j', 'ministage-complete.js?v=20260906k')
html = html.replace('ministage-admin-console-v2.js?v=20260906n', 'ministage-admin-console-v2.js?v=20260906o')

# 2) Motore principale: stato USCITO, PDF diretto e chiusura +5 minuti.
js = js.replace("const VERSION = '2026.09-parent-release-v6';", "const VERSION = '2026.09-auto-closure-v7';", 1)
js = replace_once(js, "  const CHECKED = 'entrato';\n  const CANCELLED = 'cancellazione';", "  const CHECKED = 'entrato';\n  const EXITED = 'uscito';\n  const CANCELLED = 'cancellazione';", 'EXITED constant')
js = replace_once(js, "  let reconcileTimer = null;\n  let mobileScanner = null;", "  let reconcileTimer = null;\n  let closureTimer = null;\n  let closureRunning = false;\n  let mobileScanner = null;", 'closure vars')

# Stato uscita nelle etichette del motore principale (tutte le occorrenze pertinenti).
js = js.replace("if (b.type === CHECKED) return 'Presente';", "if (b.type === EXITED) return 'Uscito';\n    if (b.type === CHECKED) return 'Presente';")

# Scanner: un codice di uno studente già uscito non deve poter tornare a Presente.
js = replace_once(
    js,
    "            if (booking.type === 'entrato') {\n                window.showScannerFeedback(`Attenzione: ${booking.nome} è già stato marcato come presente.`, true);\n                return;\n            }",
    "            if (booking.type === 'uscito') {\n                window.showScannerFeedback(`MiniStage concluso: ${booking.nome} risulta già uscito.`, true);\n                return;\n            }\n\n            if (booking.type === 'entrato') {\n                window.showScannerFeedback(`Attenzione: ${booking.nome} è già stato marcato come presente.`, true);\n                return;\n            }",
    'legacy scanner exited guard'
)

# Download diretto della ricevuta mostrata a schermo.
download_block = r'''
  async function downloadCurrentMiniStagePdf() {
    const code = String(document.getElementById('receipt-code')?.textContent || '').trim().toUpperCase();
    if (!code) return window.showMessage?.('Codice prenotazione non disponibile.', true);
    return downloadMiniStageBookingPdf(code);
  }
  window.downloadCurrentMiniStagePdf = downloadCurrentMiniStagePdf;

'''
js = replace_once(js, "  async function promoteNext(slot) {", download_block + "  async function promoteNext(slot) {", 'current receipt download')

closure_block = r'''
  function isoDateFromAny(value) {
    const raw = String(value || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    let m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    return '';
  }

  function italyLocalEpoch(iso, hour, minute) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return 0;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const targetUtc = Date.UTC(y, mo - 1, d, Number(hour), Number(minute), 0, 0);
    let guess = targetUtc;
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    });
    for (let i = 0; i < 3; i++) {
      const p = Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(x => x.type !== 'literal').map(x => [x.type, x.value]));
      const localAsUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second || 0));
      const offset = localAsUtc - guess;
      guess = targetUtc - offset;
    }
    return guess;
  }

  function closureDueAt(slot) {
    const iso = isoDateFromAny(slot?.isoDate || slot?.date || slot?.data || slot?.dateStr);
    if (!iso) return 0;
    const matches = [...String(slot?.time || slot?.orario || '').matchAll(/(\d{1,2}):(\d{2})/g)];
    if (!matches.length) return 0;
    const end = matches[matches.length - 1];
    const endAt = italyLocalEpoch(iso, Number(end[1]), Number(end[2]));
    return endAt ? endAt + 5 * 60 * 1000 : 0;
  }

  async function claimCertificateExit(code) {
    const ref = f.doc(core.db, `${bookingPath()}/${code}`);
    return f.runTransaction(core.db, async tx => {
      const snap = await tx.get(ref);
      if (!snap.exists()) return null;
      const data = { id: snap.id, ...snap.data() };
      const now = Date.now();
      if (data.type !== CHECKED || data.certificateSent === true) return null;
      const busy = Number(data.certificateProcessingAt || 0) > now - 2 * 60 * 1000;
      if (busy && data.certificateProcessingOwner !== ownerId) return null;
      tx.set(ref, { certificateProcessingAt: now, certificateProcessingOwner: ownerId, certificateError: '' }, { merge: true });
      return data;
    });
  }

  async function sendFinalCertificate(student) {
    const url = core?.endpoints?.certificate;
    if (!url) throw new Error('Endpoint pergamena non configurato');
    const parts = String(student.nome || '').trim().split(/\s+/).filter(Boolean);
    const first = parts.shift() || '';
    const rest = parts.join(' ');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        email: student.email,
        nome: first,
        cognome: rest,
        codice_prenotazione: student.code,
        data: student.stageDate,
        orario: student.stageTime,
        attivita: student.indirizzo,
        classe_assegnata: resolvedClass(student.indirizzo, student.classeAssegnata),
        tipo: 'attestato_partecipazione',
        stato: 'MINISTAGE CONCLUSO - USCITO'
      })
    });
    if (!response.ok) throw new Error(`Apps Script HTTP ${response.status}`);
  }

  async function processDueClosures() {
    if (closureRunning || !core?.db || !f?.runTransaction) return;
    closureRunning = true;
    try {
      await refreshState();
      const now = Date.now();
      const dueSlots = slots.filter(slot => {
        const due = closureDueAt(slot);
        return due > 0 && now >= due;
      });
      for (const slot of dueSlots) {
        const due = closureDueAt(slot);
        if (slot.active !== false || slot.closed !== true || slot.closureStatus !== 'chiuso') {
          await f.setDoc(f.doc(core.db, `${slotPath()}/${slot.id}`), {
            active: false,
            closed: true,
            closureStatus: 'chiuso',
            closureDueAt: due,
            closedAt: Number(slot.closedAt || 0) || now,
            closureReason: 'fine_ministage_+5min'
          }, { merge: true });
        }
        const entered = bookings.filter(b => b.slotId === slot.id && b.type === CHECKED && b.certificateSent !== true);
        for (const row of entered) {
          const student = await claimCertificateExit(row.code).catch(() => null);
          if (!student) continue;
          const ref = f.doc(core.db, `${bookingPath()}/${student.code}`);
          try {
            await sendFinalCertificate(student);
            const sentAt = Date.now();
            await f.setDoc(ref, {
              type: EXITED,
              exitedAt: sentAt,
              certificateSent: true,
              certificateSentAt: sentAt,
              certificateProcessingAt: 0,
              certificateProcessingOwner: '',
              certificateError: '',
              closureSource: 'automatico_5_minuti_dopo_fine'
            }, { merge: true });
          } catch (err) {
            await f.setDoc(ref, {
              certificateProcessingAt: 0,
              certificateProcessingOwner: '',
              certificateErrorAt: Date.now(),
              certificateError: String(err?.message || err).slice(0, 220)
            }, { merge: true }).catch(() => {});
            console.warn('MiniStage: invio pergamena non completato', student.code, err);
          }
        }
      }
      if (dueSlots.length) {
        await refreshState();
        decorateStages();
        renderAdminExtension();
      }
    } catch (e) {
      console.warn('MiniStage: controllo chiusura automatica non completato', e);
    } finally {
      closureRunning = false;
    }
  }

  function scheduleAutoClosure() {
    if (closureTimer) clearInterval(closureTimer);
    setTimeout(processDueClosures, 900);
    closureTimer = setInterval(processDueClosures, 30000);
  }

  window.runMiniStageAutoClosure = processDueClosures;
  window.getMiniStageClosureDueAt = closureDueAt;

'''
js = replace_once(js, "  function scheduleReconcile(delay=180) {", closure_block + "  function scheduleReconcile(delay=180) {", 'auto closure block')
js = replace_once(js, "      subscribe();\n      window.__MINISTAGE_COMPLETE__.dataReady=true;\n      scheduleReconcile(400);", "      subscribe();\n      window.__MINISTAGE_COMPLETE__.dataReady=true;\n      scheduleReconcile(400);\n      scheduleAutoClosure();", 'auto closure init')

# 3) Area docente a pagine: nuova sezione dedicata a chiusura/pergamene.
adm = adm.replace("const VERSION = '2026.09-docente-pagine-v6';", "const VERSION = '2026.09-docente-pagine-v7';", 1)
adm = replace_once(adm, "  const CHECKED = 'entrato';\n  const CANCELLED = 'cancellazione';", "  const CHECKED = 'entrato';\n  const EXITED = 'uscito';\n  const CANCELLED = 'cancellazione';", 'admin EXITED constant')
adm = adm.replace("if (b.type === CHECKED) return 'Presente';", "if (b.type === EXITED) return 'Uscito';\n    if (b.type === CHECKED) return 'Presente';")
adm = adm.replace("if (b.type === CHECKED) return 'bg-green-100 text-green-800';", "if (b.type === EXITED) return 'bg-teal-100 text-teal-800';\n    if (b.type === CHECKED) return 'bg-green-100 text-green-800';")

old_cards = """          ${pageCard('scanner', 6, 'Scanner accoglienza', 'QR smartphone, sessioni attive e registrazione presenze.', 'border-cyan-500')}\n          ${pageCard('pdf', 7, 'PDF ed elenchi', 'Elenchi ufficiali per classi e lista d’attesa.', 'border-red-500')}\n          ${pageCard('data', 8, 'Gestione dati', 'Operazioni protette di cancellazione e azzeramento.', 'border-slate-700')}"""
new_cards = """          ${pageCard('scanner', 6, 'Scanner accoglienza', 'QR smartphone, sessioni attive e registrazione presenze.', 'border-cyan-500')}\n          ${pageCard('closure', 7, 'Chiusura e pergamene', 'Invio automatico pergamena a +5 minuti, stato Uscito e chiusura MiniStage.', 'border-teal-500')}\n          ${pageCard('pdf', 8, 'PDF ed elenchi', 'Elenchi ufficiali per classi e lista d’attesa.', 'border-red-500')}\n          ${pageCard('data', 9, 'Gestione dati', 'Operazioni protette di cancellazione e azzeramento.', 'border-slate-700')}"""
adm = replace_once(adm, old_cards, new_cards, 'admin page cards')

closure_section = r'''
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

'''
adm = replace_once(adm, "      <section id=\"mini-page-pdf\" data-mini-page=\"pdf\" class=\"hidden space-y-4\">", closure_section + "      <section id=\"mini-page-pdf\" data-mini-page=\"pdf\" class=\"hidden space-y-4\">", 'closure section')

adm = replace_once(adm, "    pdf: ['PDF ed elenchi', 'Generazione degli elenchi ufficiali.'],", "    closure: ['Chiusura e pergamene', 'Invio automatico a +5 minuti e passaggio da Presente a Uscito.'],\n    pdf: ['PDF ed elenchi', 'Generazione degli elenchi ufficiali.'],", 'pageMeta closure')

render_closure = r'''
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

'''
adm = replace_once(adm, "  function renderScanner() {", render_closure + "  function renderScanner() {", 'renderClosure')
adm = replace_once(adm, "    renderAuth();\n    renderScanner();", "    renderAuth();\n    renderClosure();\n    renderScanner();", 'renderAll closure')

# Riepilogo generale: rende visibili anche gli usciti senza confonderli con i presenti attuali.
adm = replace_once(adm, "      const checked = state.bookings.filter(b => b.type === CHECKED);", "      const checked = state.bookings.filter(b => b.type === CHECKED);\n      const exited = state.bookings.filter(b => b.type === EXITED);", 'overview exited var')
adm = replace_once(adm, "['Iscritti attivi', active.length], ['Presenti', checked.length], ['Lista d’attesa', waits.length], ['Annullati', cancelledBookings().length], ['Date attive', state.slots.filter(s => s.active !== false).length], ['Moduli da ritirare', pendingDocs.length]", "['Iscritti attivi', active.length], ['Presenti', checked.length], ['Usciti', exited.length], ['Lista d’attesa', waits.length], ['Annullati', cancelledBookings().length], ['Date attive', state.slots.filter(s => s.active !== false).length], ['Moduli da ritirare', pendingDocs.length]", 'overview cards')

# Wrapper: forza il caricamento della nuova versione della console originale.
wrap = wrap.replace('ministage-admin-console-v2-original.js?v=20260906-appscriptrestore1', 'ministage-admin-console-v2-original.js?v=20260906-autoclose1')

# Verifiche statiche.
assert 'Scarica PDF' in html and 'Stampa o Salva PDF' not in html
assert 'certificate: CERTIFICATE_SCRIPT_URL' in html
assert "const EXITED = 'uscito';" in js
assert 'function processDueClosures()' in js
assert 'closureReason: \'fine_ministage_+5min\'' in js
assert "type: EXITED" in js
assert "window.downloadCurrentMiniStagePdf" in js
assert "pageCard('closure'" in adm
assert 'mini-page-closure' in adm
assert 'renderClosure();' in adm
assert 'Usciti / pergamena inviata' in adm

idx.write_text(html, encoding='utf-8')
complete.write_text(js, encoding='utf-8')
admin.write_text(adm, encoding='utf-8')
wrapper.write_text(wrap, encoding='utf-8')
print('AUTO_CLOSURE_PERGAMENA_PATCH_OK')

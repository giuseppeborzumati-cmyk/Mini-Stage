from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Anchor not found: {label}')
    return text.replace(old, new, 1)

# ---------- index.html ----------
idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
orig_html = html

mobile_css_anchor = """        /* STILI SPECIFICI PER LA STAMPA */"""
mobile_css = """        /* Affidabilita mobile: evita lo zoom automatico di iOS e mantiene target touch adeguati. */
        @media (max-width: 639px) {
            #booking-modal input:not([type=\"checkbox\"]),
            #booking-modal select,
            #manage-booking-modal input {
                font-size: 16px !important;
            }
            #booking-modal button,
            #manage-booking-modal button {
                min-height: 44px;
            }
        }

        /* STILI SPECIFICI PER LA STAMPA */"""
if 'Affidabilita mobile: evita lo zoom automatico di iOS' not in html:
    html = replace_once(html, mobile_css_anchor, mobile_css, 'mobile css')

html = html.replace('id="modal-email" placeholder="Email del Genitore o Studente"', 'id="modal-email" autocomplete="email" inputmode="email" placeholder="Email del Genitore o Studente"')
html = html.replace('id="modal-cellulare" placeholder="Numero di Cellulare (Genitore)"', 'id="modal-cellulare" autocomplete="tel" inputmode="tel" placeholder="Numero di Cellulare (Genitore)"')
html = html.replace('id="input-search-email" type="email" placeholder="Email utilizzata"', 'id="input-search-email" type="email" autocomplete="email" inputmode="email" placeholder="Email utilizzata"')

old_cancel = """                        const docRef = doc(db, `artifacts/${appId}/public/data/${COLLECTION_PRENOTAZIONI}`, booking.code);
                        await updateDoc(docRef, { type: 'cancellazione' });
                        
                        window.sendCancellationEmailNotification(booking);
                        window.setView('receipt', { code: booking.code, type: 'cancellazione', data: booking });
                        window.showMessage(\"La prenotazione è stata annullata.\");"""
new_cancel = """                        const docRef = doc(db, `artifacts/${appId}/public/data/${COLLECTION_PRENOTAZIONI}`, booking.code);
                        const cancelledAt = Date.now();
                        await updateDoc(docRef, { type: 'cancellazione', cancelledAt });
                        const cancelledBooking = { ...booking, type: 'cancellazione', cancelledAt };

                        window.sendCancellationEmailNotification(cancelledBooking);
                        window.setView('receipt', { code: booking.code, type: 'cancellazione', data: cancelledBooking });
                        window.showMessage(\"La prenotazione è stata annullata.\");"""
html = replace_once(html, old_cancel, new_cancel, 'cancellation receipt coherence')

html = html.replace('ministage-complete.js?v=20260906i', 'ministage-complete.js?v=20260906j')
html = html.replace('ministage-admin-console-v2.js?v=20260906i', 'ministage-admin-console-v2.js?v=20260906j')

if html == orig_html:
    raise SystemExit('index.html unchanged')
idx.write_text(html, encoding='utf-8')

# ---------- ministage-complete.js ----------
js = Path('ministage-complete.js')
text = js.read_text(encoding='utf-8')
orig_js = text
text = text.replace("const VERSION = '2026.09-final-hardening-v5';", "const VERSION = '2026.09-parent-release-v6';", 1)

old_class_for = """  function classFor(indirizzo) {
    return classes[indirizzo] || '';
  }
"""
new_class_for = """  function classFor(indirizzo) {
    return classes[indirizzo] || '';
  }

  function resolvedClass(indirizzo, stored = '') {
    const configured = String(classFor(indirizzo) || '').trim();
    if (configured) return configured;
    const saved = String(stored || '').trim();
    return saved && saved.toLowerCase() !== 'da definire' ? saved : 'Da definire';
  }
"""
if 'function resolvedClass(' not in text:
    text = replace_once(text, old_class_for, new_class_for, 'resolvedClass helper')

old_slot = """      if (!slot) throw new Error('SLOT_NOT_FOUND');
      if (slot.active === false) throw new Error('SLOT_INACTIVE');
      const freshCaps = await snapshotCollection(capPath());"""
new_slot = """      if (!slot) throw new Error('SLOT_NOT_FOUND');
      if (slot.active === false) throw new Error('SLOT_INACTIVE');
      const canonicalIndirizzo = String(slot.indirizzo || d.indirizzo || '').trim();
      const canonicalDay = String(slot.day || d.stageDay || '').trim();
      const canonicalDate = String(slot.dateStr || d.stageDate || '').trim();
      const canonicalTime = String(slot.time || d.stageTime || '').trim();
      if (!canonicalIndirizzo || !canonicalDate || !canonicalTime) throw new Error('SLOT_NOT_FOUND');
      const freshCaps = await snapshotCollection(capPath());"""
text = replace_once(text, old_slot, new_slot, 'canonical slot metadata')
text = text.replace('const max = Math.max(1, Number(slot.postiMax || capMap[d.indirizzo] || DEFAULT_CAPACITY));', 'const max = Math.max(1, Number(slot.postiMax || capMap[canonicalIndirizzo] || DEFAULT_CAPACITY));', 1)

old_data = """        slotId: d.slotId,
        indirizzo: d.indirizzo,
        stageDay: d.stageDay,
        stageDate: d.stageDate,
        stageTime: d.stageTime,"""
new_data = """        slotId: d.slotId,
        indirizzo: canonicalIndirizzo,
        stageDay: canonicalDay,
        stageDate: canonicalDate,
        stageTime: canonicalTime,"""
text = replace_once(text, old_data, new_data, 'canonical booking data')
text = text.replace("classeAssegnata: classFor(d.indirizzo) || 'Da definire',", "classeAssegnata: resolvedClass(canonicalIndirizzo),", 1)

# Preferisce sempre la configurazione corrente della Commissione per PDF/e-mail/ricevute.
text = text.replace("res.classeAssegnata || classFor(res.indirizzo) || 'Da definire'", "resolvedClass(res.indirizzo, res.classeAssegnata)")
text = text.replace("res.classeAssegnata || 'Da definire'", "resolvedClass(res.indirizzo, res.classeAssegnata)")
text = text.replace("res.classeAssegnata || 'da definire'", "resolvedClass(res.indirizzo, res.classeAssegnata)")
text = text.replace("next.classeAssegnata || classFor(next.indirizzo) || 'Da definire'", "resolvedClass(next.indirizzo, next.classeAssegnata)")
text = text.replace("b.classeAssegnata || 'Da definire'", "resolvedClass(b.indirizzo, b.classeAssegnata)")
text = text.replace("get:r=>r.classeAssegnata||'Da definire'", "get:r=>resolvedClass(r.indirizzo,r.classeAssegnata)")

# Lista attesa: target touch adeguato anche quando sostituisce il pulsante Prenota.
text = text.replace("bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-extrabold px-4 py-2 rounded-xl transition shadow-md", "bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-extrabold px-4 py-2.5 min-h-[44px] rounded-xl transition shadow-md", 1)

old_save_classes = """  async function saveClassConfig() {
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
"""
new_save_classes = """  async function saveClassConfig() {
    const inputs = document.querySelectorAll('#mini-class-config input[data-class-address]');
    for (const input of inputs) {
      const indirizzo = input.dataset.classAddress;
      const classe = input.value.trim();
      classes[indirizzo] = classe;
      await f.setDoc(f.doc(core.db, `${classPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() });
    }

    // Mantiene coerenti anche prenotazioni e liste d'attesa gia registrate.
    const existing = await snapshotCollection(bookingPath()).catch(() => []);
    for (const b of existing) {
      if (!b?.code || b.type === CANCELLED) continue;
      const currentClass = String(classFor(b.indirizzo) || '').trim();
      const desiredClass = currentClass || 'Da definire';
      if (String(b.classeAssegnata || '') === desiredClass) continue;
      await f.updateDoc(f.doc(core.db, `${bookingPath()}/${b.code}`), {
        classeAssegnata: desiredClass,
        classAssignmentUpdatedAt: Date.now()
      });
    }

    window.showMessage?.('Classi assegnate salvate e prenotazioni aggiornate.');
    await refreshState();
    renderAdminExtension();
  }
"""
text = replace_once(text, old_save_classes, new_save_classes, 'sync class config to bookings')

if text == orig_js:
    raise SystemExit('ministage-complete.js unchanged')
js.write_text(text, encoding='utf-8')

print('FINAL_PARENT_HARDENING_V2_OK')

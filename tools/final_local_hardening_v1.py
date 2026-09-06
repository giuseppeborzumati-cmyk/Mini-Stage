from pathlib import Path

idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
orig = html

# Contatto ufficiale e istruzioni coerenti con accoglienza 14:15.
html = html.replace('Tel: 0362 221234', 'Tel: 0362 224164')
html = html.replace("- Presentarsi all'ingresso principale del plesso scolastico almeno 10 minuti prima dello stage.", "- Presentarsi nell'atrio dell'istituto alle ore 14:15, 15 minuti prima dell'inizio del MiniStage.")

# Lo stato e-mail deve comparire solo quando un invio viene effettivamente avviato.
html = html.replace('id="email-sending-status" class="mb-4 bg-indigo-100', 'id="email-sending-status" class="hidden mb-4 bg-indigo-100', 1)

# Pulsanti pubblici principali più comodi al tocco.
html = html.replace('class="flex-1 text-[11px] font-bold bg-indigo-600', 'class="flex-1 min-h-[44px] text-[11px] font-bold bg-indigo-600', 1)
html = html.replace('class="flex-1 text-[11px] font-bold bg-orange-500', 'class="flex-1 min-h-[44px] text-[11px] font-bold bg-orange-500', 1)
html = html.replace('class="w-full text-[11px] font-bold bg-red-600', 'class="w-full min-h-[44px] text-[11px] font-bold bg-red-600', 1)

# Chart.js è accessorio: se il CDN non risponde, l'area docenti deve rimanere usabile.
old = """        window.updateCharts = function() {\n            const canvas = document.getElementById('reservationsChart');\n            if(!canvas) return;"""
new = """        window.updateCharts = function() {\n            const canvas = document.getElementById('reservationsChart');\n            if(!canvas || typeof window.Chart === 'undefined') return;"""
if old not in html:
    raise SystemExit('chart anchor not found')
html = html.replace(old, new, 1)

# Cache bust.
html = html.replace('ministage-complete.js?v=20260906h', 'ministage-complete.js?v=20260906i')
html = html.replace('ministage-admin-console-v2.js?v=20260906h', 'ministage-admin-console-v2.js?v=20260906i')
if html == orig:
    raise SystemExit('index unchanged')
idx.write_text(html, encoding='utf-8')

js = Path('ministage-complete.js')
text = js.read_text(encoding='utf-8')
orig_js = text
text = text.replace("const VERSION = '2026.09-final-deep-audit-v4';", "const VERSION = '2026.09-final-hardening-v5';")
old = """    if (data.type === CANCELLED) {\n      if (title) title.textContent = 'ISCRIZIONE ANNULLATA';\n      if (msg) msg.innerHTML = '<span class=\"text-red-600 font-extrabold text-sm\">Questa prenotazione è stata annullata.</span>';\n      document.querySelector('[data-mini-auth-download]')?.remove();"""
new = """    if (data.type === CANCELLED) {\n      if (title) title.textContent = 'ISCRIZIONE ANNULLATA';\n      if (msg) msg.innerHTML = '<span class=\"text-red-600 font-extrabold text-sm\">Questa prenotazione è stata annullata.</span>';\n      if (notice) notice.textContent = 'PRENOTAZIONE ANNULLATA: questo codice non è valido per l’accesso al MiniStage.';\n      document.querySelector('[data-mini-auth-download]')?.remove();"""
if old not in text:
    raise SystemExit('cancel notice anchor not found')
text = text.replace(old, new, 1)
if text == orig_js:
    raise SystemExit('complete js unchanged')
js.write_text(text, encoding='utf-8')

adm = Path('ministage-admin-console-v2.js')
a = adm.read_text(encoding='utf-8')
orig_a = a
a = a.replace("const VERSION = '2026.09-admin-console-exit-auth-v2';", "const VERSION = '2026.09-admin-final-hardening-v3';")

old = """  async function saveCapacities() {\n    const inputs = document.querySelectorAll('#mini-v2-capacities [data-mini-cap-address]');\n    for (const input of inputs) {\n      const indirizzo = input.dataset.miniCapAddress;\n      const postiMax = Math.max(1, parseInt(input.value, 10) || 25);\n      await f.setDoc(f.doc(core.db, `${capsPath()}/${indirizzo}`), { indirizzo, postiMax, updatedAt: Date.now() }, { merge: true });\n    }\n    showMessage('Capienze salvate su Firebase.');\n  }"""
new = """  async function saveCapacities() {\n    const inputs = document.querySelectorAll('#mini-v2-capacities [data-mini-cap-address]');\n    for (const input of inputs) {\n      const indirizzo = input.dataset.miniCapAddress;\n      const postiMax = Math.max(1, parseInt(input.value, 10) || 25);\n      const maxOccupied = Math.max(0, ...state.slots.filter(s => s.indirizzo === indirizzo).map(s => state.bookings.filter(b => b.slotId === s.id && (b.type === ACTIVE || b.type === CHECKED)).length));\n      if (postiMax < maxOccupied) {\n        input.value = String(Math.max(maxOccupied, Number(state.caps[indirizzo] || 25)));\n        return showMessage(`Capienza non salvata per ${indirizzo}: ci sono già ${maxOccupied} posti occupati in uno degli slot.`, true);\n      }\n      await f.setDoc(f.doc(core.db, `${capsPath()}/${indirizzo}`), { indirizzo, postiMax, updatedAt: Date.now() }, { merge: true });\n    }\n    showMessage('Capienze salvate su Firebase.');\n  }"""
if old not in a:
    raise SystemExit('capacity anchor not found')
a = a.replace(old, new, 1)

old = """    const active = !!row.querySelector('[data-field=\"active\"]')?.checked;\n    if (!isoDate || !time) return showMessage('Inserisci data e orario.', true);\n    await f.setDoc"""
new = """    const active = !!row.querySelector('[data-field=\"active\"]')?.checked;\n    if (!isoDate || !time) return showMessage('Inserisci data e orario.', true);\n    const liveBookings = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);\n    const scheduleChanged = isoDate !== slotIso(slot) || time !== String(slot.time || '');\n    if (liveBookings.length && scheduleChanged) {\n      renderCalendar();\n      return showMessage(`Data e orario non modificati: questo MiniStage ha già ${liveBookings.length} prenotazioni/richieste. Crea un nuovo slot o gestisci prima gli iscritti.`, true);\n    }\n    const occupied = liveBookings.filter(b => b.type === ACTIVE || b.type === CHECKED).length;\n    if (postiMax < occupied) {\n      renderCalendar();\n      return showMessage(`Capienza non modificata: ci sono già ${occupied} posti occupati.`, true);\n    }\n    const duplicate = state.slots.some(s => s.id !== id && s.indirizzo === slot.indirizzo && slotIso(s) === isoDate && String(s.time || '') === time);\n    if (duplicate) {\n      renderCalendar();\n      return showMessage('Esiste già un MiniStage dello stesso percorso con la stessa data e lo stesso orario.', true);\n    }\n    await f.setDoc"""
if old not in a:
    raise SystemExit('save slot anchor not found')
a = a.replace(old, new, 1)

old = """  async function deleteSlot(id) {\n    if (!confirm('Eliminare questo MiniStage dal calendario?')) return;\n    await f.deleteDoc"""
new = """  async function deleteSlot(id) {\n    const liveBookings = state.bookings.filter(b => b.slotId === id && b.type !== CANCELLED);\n    if (liveBookings.length) return showMessage(`Impossibile eliminare lo slot: sono presenti ${liveBookings.length} prenotazioni/richieste collegate. Puoi disattivarlo senza cancellarlo.`, true);\n    if (!confirm('Eliminare questo MiniStage dal calendario?')) return;\n    await f.deleteDoc"""
if old not in a:
    raise SystemExit('delete slot anchor not found')
a = a.replace(old, new, 1)

old = """    if (!indirizzo || !isoDate || !time) return showMessage('Seleziona indirizzo, data e orario.', true);\n    const id = `SLOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;"""
new = """    if (!indirizzo || !isoDate || !time) return showMessage('Seleziona indirizzo, data e orario.', true);\n    if (state.slots.some(s => s.indirizzo === indirizzo && slotIso(s) === isoDate && String(s.time || '') === time)) return showMessage('Esiste già un MiniStage dello stesso percorso con la stessa data e lo stesso orario.', true);\n    const id = `SLOT-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;"""
if old not in a:
    raise SystemExit('create slot anchor not found')
a = a.replace(old, new, 1)

# Blocca cambio classe per un percorso che ha già prenotazioni non annullate: evita ricevute/e-mail discordanti.
old = """    for (const input of inputs) {\n      const indirizzo = input.dataset.miniClassAddress;\n      const classe = input.value.trim();\n      await f.setDoc(f.doc(core.db, `${classesPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() }, { merge: true });\n    }\n    showMessage('Classi assegnate salvate.');"""
new = """    for (const input of inputs) {\n      const indirizzo = input.dataset.miniClassAddress;\n      const classe = input.value.trim();\n      const previous = String(state.classes[indirizzo] || '');\n      const liveBookings = state.bookings.filter(b => b.indirizzo === indirizzo && b.type !== CANCELLED);\n      if (liveBookings.length && classe !== previous) {\n        input.value = previous;\n        return showMessage(`Classe non modificata per ${indirizzo}: esistono già ${liveBookings.length} prenotazioni/richieste collegate.`, true);\n      }\n      await f.setDoc(f.doc(core.db, `${classesPath()}/${indirizzo}`), { indirizzo, classe, updatedAt: Date.now() }, { merge: true });\n    }\n    showMessage('Classi assegnate salvate.');"""
if old not in a:
    raise SystemExit('classes anchor not found')
a = a.replace(old, new, 1)

if a == orig_a:
    raise SystemExit('admin unchanged')
adm.write_text(a, encoding='utf-8')
print('FINAL_LOCAL_HARDENING_OK')

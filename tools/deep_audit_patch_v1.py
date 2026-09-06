from pathlib import Path

idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
orig = html

html = html.replace("const filteredSlots = stageSlots.filter(s => s.indirizzo === ind);", "const filteredSlots = stageSlots.filter(s => s.indirizzo === ind && s.active !== false);")
html = html.replace('>Ingresso Libero</span>', '>Prenotazione richiesta</span>')
html = html.replace('text-[11px] font-extrabold px-4 py-2 rounded-xl transition shadow-md font-sans', 'text-[11px] font-extrabold px-4 py-2.5 min-h-[44px] rounded-xl transition shadow-md font-sans')

old_msg = 'msgBox.className = `fixed top-4 right-4 text-white p-4 rounded-xl shadow-2xl transition-all duration-300 z-50 transform translate-y-0`;'
new_msg = 'msgBox.className = `fixed top-4 left-4 right-4 sm:left-auto sm:max-w-md text-white p-4 rounded-xl shadow-2xl transition-all duration-300 z-[100] transform translate-y-0 break-words`;'
if old_msg not in html:
    raise SystemExit('showMessage anchor missing')
html = html.replace(old_msg, new_msg)

old_css = '''        .full-screen-code {\n            font-size: 3.2rem;\n            letter-spacing: 0.15em;\n            word-break: break-all;\n            text-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);\n        }'''
new_css = '''        .full-screen-code {\n            font-size: 2rem;\n            letter-spacing: 0.08em;\n            word-break: break-all;\n            overflow-wrap: anywhere;\n            text-shadow: 0 4px 12px rgba(79, 70, 229, 0.15);\n        }\n        @media (min-width: 640px) {\n            .full-screen-code {\n                font-size: 3.2rem;\n                letter-spacing: 0.15em;\n            }\n        }'''
if old_css not in html:
    raise SystemExit('full-screen-code anchor missing')
html = html.replace(old_css, new_css)

old_checkin = '''        window.checkInStudent = async function(code) {\n            const idx = allBookings.findIndex(b => b.code === code);\n            if (idx === -1) return window.showMessage("Iscrizione non trovata.", true);\n\n            try {'''
new_checkin = '''        window.checkInStudent = async function(code) {\n            const idx = allBookings.findIndex(b => b.code === code);\n            if (idx === -1) return window.showMessage("Iscrizione non trovata.", true);\n            const currentBooking = allBookings[idx];\n            if (currentBooking.type === 'lista_attesa') return window.showMessage("Lo studente è ancora in lista d’attesa e non può essere registrato come presente.", true);\n            if (currentBooking.type === 'cancellazione') return window.showMessage("La prenotazione è annullata e non può essere registrata come presente.", true);\n            if (currentBooking.type === 'entrato') return window.showMessage("Lo studente risulta già presente.", true);\n            if (currentBooking.type !== 'prenotazione') return window.showMessage("Stato della prenotazione non valido per il check-in.", true);\n\n            try {'''
if old_checkin not in html:
    raise SystemExit('checkInStudent anchor missing')
html = html.replace(old_checkin, new_checkin)

old_scan = '''            if (booking.type === 'cancellazione') {\n                window.showScannerFeedback(`La prenotazione per ${booking.nome} risulta precedentemente annullata.`, true);\n                return;\n            }\n\n            await window.checkInStudent(code);'''
new_scan = '''            if (booking.type === 'cancellazione') {\n                window.showScannerFeedback(`La prenotazione per ${booking.nome} risulta precedentemente annullata.`, true);\n                return;\n            }\n            if (booking.type === 'lista_attesa') {\n                window.showScannerFeedback(`${booking.nome} è ancora in lista d’attesa e non è ammesso al MiniStage.`, true);\n                return;\n            }\n\n            await window.checkInStudent(code);'''
if old_scan not in html:
    raise SystemExit('scanner anchor missing')
html = html.replace(old_scan, new_scan)

old_lookup = '''            if (inputCode) {\n                booking = allBookings.find(b => b.code === inputCode);\n            } else if (inputName && inputEmail) {\n                booking = allBookings.find(b => b.nome.toLowerCase().includes(inputName) && b.email.toLowerCase() === inputEmail);\n            }'''
new_lookup = '''            if (inputCode) {\n                booking = allBookings.find(b => b.code === inputCode);\n            } else if (inputName && inputEmail) {\n                const matches = allBookings.filter(b => b.nome.toLowerCase().includes(inputName) && b.email.toLowerCase() === inputEmail);\n                if (matches.length > 1) {\n                    return window.showMessage("Sono state trovate più prenotazioni con questi dati. Per evitare di annullare o recuperare quella sbagliata, usa il codice MS della prenotazione interessata.", true);\n                }\n                booking = matches[0] || null;\n            }'''
if old_lookup not in html:
    raise SystemExit('booking lookup anchor missing')
html = html.replace(old_lookup, new_lookup)

old_recovery = '''            } else {\n                window.setView('receipt', { code: booking.code, type: booking.type, data: booking });\n                window.sendAutomaticEmailNotification(booking, true);\n            }'''
new_recovery = '''            } else {\n                window.setView('receipt', { code: booking.code, type: booking.type, data: booking });\n                if (booking.type === 'cancellazione') {\n                    return window.showMessage("Questa prenotazione è annullata: viene mostrato lo stato, ma non viene rigenerato alcun pass valido.", true);\n                }\n                window.sendAutomaticEmailNotification(booking, true);\n            }'''
if old_recovery not in html:
    raise SystemExit('booking recovery anchor missing')
html = html.replace(old_recovery, new_recovery)

html = html.replace('ministage-complete.js?v=20260906f', 'ministage-complete.js?v=20260906g')
html = html.replace('ministage-admin-console-v2.js?v=20260906f', 'ministage-admin-console-v2.js?v=20260906g')

if html == orig:
    raise SystemExit('index unchanged')
idx.write_text(html, encoding='utf-8')

js = Path('ministage-complete.js')
text = js.read_text(encoding='utf-8')
origjs = text
text = text.replace("const VERSION = '2026.09-exit-authorization-v2';", "const VERSION = '2026.09-deep-audit-v3';")
old_slot = "if (!slot) throw new Error('SLOT_NOT_FOUND');"
new_slot = "if (!slot) throw new Error('SLOT_NOT_FOUND');\n      if (slot.active === false) throw new Error('SLOT_INACTIVE');"
if old_slot not in text:
    raise SystemExit('slot anchor missing')
text = text.replace(old_slot, new_slot, 1)

old_valid = "if (!d.slotId || !d.indirizzo || !d.nome || !d.scuola || !d.email || !d.cellulare) return 'Tutti i campi principali sono obbligatori.';\n    if (!/^\\S+@\\S+\\.\\S+$/.test(d.email)) return 'Inserisci un indirizzo e-mail valido.';"
new_valid = "if (!d.slotId || !d.indirizzo || !d.nome || !d.scuola || !d.email || !d.cellulare) return 'Tutti i campi principali sono obbligatori.';\n    if (!/^\\S+@\\S+\\.\\S+$/.test(d.email)) return 'Inserisci un indirizzo e-mail valido.';\n    const phoneDigits = String(d.cellulare).replace(/\\D/g, '');\n    if (phoneDigits.length < 7 || phoneDigits.length > 15) return 'Inserisci un numero di cellulare valido.';\n    if (d.nome.length < 3) return 'Inserisci nome e cognome dello studente.';\n    if (d.parentGuardianName && d.parentGuardianName.length < 3) return 'Inserisci nome e cognome del genitore/tutore.';"
if old_valid not in text:
    raise SystemExit('validation anchor missing')
text = text.replace(old_valid, new_valid, 1)

old_catch = "else if (e.message === 'SLOT_NOT_FOUND') window.showMessage?.('Lo slot non è più disponibile.', true);\n      else window.showMessage?.('Impossibile completare il salvataggio. Riprova.', true);"
new_catch = "else if (e.message === 'SLOT_NOT_FOUND') window.showMessage?.('Lo slot non è più disponibile.', true);\n      else if (e.message === 'SLOT_INACTIVE') window.showMessage?.('Questo MiniStage è stato disattivato e non accetta più prenotazioni.', true);\n      else window.showMessage?.('Impossibile completare il salvataggio. Riprova.', true);"
if old_catch not in text:
    raise SystemExit('catch anchor missing')
text = text.replace(old_catch, new_catch, 1)

old_auto = "async function sendAutomatic(res, isRetrieval = false) {\n    const statusBg = document.getElementById('email-sending-status');"
new_auto = "async function sendAutomatic(res, isRetrieval = false) {\n    if (res?.type === CANCELLED) {\n      window.showMessage?.('Prenotazione annullata: nessun pass valido viene rigenerato o inviato.', true);\n      return;\n    }\n    const statusBg = document.getElementById('email-sending-status');"
if old_auto not in text:
    raise SystemExit('sendAutomatic anchor missing')
text = text.replace(old_auto, new_auto, 1)

old_dl = "if (!fresh) return window.showMessage?.('Prenotazione non trovata.', true);\n      const pdf = fresh.type === WAITLIST ?"
new_dl = "if (!fresh) return window.showMessage?.('Prenotazione non trovata.', true);\n      if (fresh.type === CANCELLED) return window.showMessage?.('Prenotazione annullata: non esiste un pass valido da scaricare.', true);\n      const pdf = fresh.type === WAITLIST ?"
if old_dl not in text:
    raise SystemExit('download anchor missing')
text = text.replace(old_dl, new_dl, 1)

if text == origjs:
    raise SystemExit('js unchanged')
js.write_text(text, encoding='utf-8')
print('DEEP_AUDIT_PATCH_OK')

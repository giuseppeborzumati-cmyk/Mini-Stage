from pathlib import Path

js = Path('ministage-complete.js')
text = js.read_text(encoding='utf-8')
orig = text

# Versione audit finale
text = text.replace("const VERSION = '2026.09-mobile-email-v3';", "const VERSION = '2026.09-final-deep-audit-v4';")

# 1) Reset completo dello stato visuale uscita autonoma
old = """    if (pickup) { pickup.value = ''; pickup.classList.add('hidden'); }\n    if (decl) decl.checked = false;\n  }"""
new = """    if (pickup) { pickup.value = ''; pickup.classList.add('hidden'); }\n    if (decl) decl.checked = false;\n    document.getElementById('mini-exit-notice')?.classList.add('hidden');\n    const declarationText = document.getElementById('mini-declaration-text');\n    if (declarationText) declarationText.textContent = 'Dichiaro che i dati inseriti sono corretti e confermo la modalità di uscita selezionata.';\n  }"""
if old not in text:
    raise SystemExit('reset anchor not found')
text = text.replace(old, new, 1)

# 2) Rifiuta markup nei campi liberi controllati dai genitori (anti-injection base UI)
old = """    if (d.parentGuardianName && d.parentGuardianName.length < 3) return 'Inserisci nome e cognome del genitore/tutore.';\n    if (!d.exitMode || !d.parentGuardianName || !d.parentGuardianRole) return 'Completa la sezione relativa all’uscita.';"""
new = """    if (d.parentGuardianName && d.parentGuardianName.length < 3) return 'Inserisci nome e cognome del genitore/tutore.';\n    const freeTextFields = [d.nome, d.scuola, d.parentGuardianName, d.parentGuardianRole, d.pickupAdultName];\n    if (freeTextFields.some(v => /[<>]/.test(String(v || '')))) return 'I campi di testo contengono caratteri non consentiti.';\n    if (!d.exitMode || !d.parentGuardianName || !d.parentGuardianRole) return 'Completa la sezione relativa all’uscita.';"""
if old not in text:
    raise SystemExit('validation injection anchor not found')
text = text.replace(old, new, 1)

# 3) Cancellazione deve avere precedenza visiva su lista attesa/promozione
old = """    if (res.type === WAITLIST || data.type === WAITLIST) {\n      if (title) title.textContent = 'ISCRIZIONE CON RISERVA';"""
new = """    if (data.type === CANCELLED) {\n      if (title) title.textContent = 'ISCRIZIONE ANNULLATA';\n      if (msg) msg.innerHTML = '<span class=\"text-red-600 font-extrabold text-sm\">Questa prenotazione è stata annullata.</span>';\n      document.querySelector('[data-mini-auth-download]')?.remove();\n    } else if (res.type === WAITLIST || data.type === WAITLIST) {\n      if (title) title.textContent = 'ISCRIZIONE CON RISERVA';"""
if old not in text:
    raise SystemExit('decorate cancellation anchor not found')
text = text.replace(old, new, 1)

old = """      if (res.exitMode === 'autonoma' && res.type !== WAITLIST && !details.querySelector('[data-mini-auth-download]')) details.insertAdjacentHTML('afterend',"""
new = """      if (data.type !== CANCELLED && res.exitMode === 'autonoma' && res.type !== WAITLIST && !document.querySelector('[data-mini-auth-download]')) details.insertAdjacentHTML('afterend',"""
if old not in text:
    raise SystemExit('auth download condition anchor not found')
text = text.replace(old, new, 1)

# 4) Scanner mobile: accetta esclusivamente ACTIVE
old = """    if(b.type===CHECKED)return feedback('Studente già registrato come presente.',true);\n    await f.updateDoc"""
new = """    if(b.type===CHECKED)return feedback('Studente già registrato come presente.',true);\n    if(b.type!==ACTIVE)return feedback('Stato della prenotazione non valido per l’ingresso.',true);\n    await f.updateDoc"""
if old not in text:
    raise SystemExit('scanner strict anchor not found')
text = text.replace(old, new, 1)

# 5) Motore prenotazione non deve dipendere da jsPDF: PDF fallisce separatamente, booking resta protetto
old = """    const ready=core?.db && f?.collection && typeof window.openBookingModal==='function' && typeof window.renderStages==='function' && window.jspdf?.jsPDF;"""
new = """    const ready=core?.db && f?.collection && typeof window.openBookingModal==='function' && typeof window.renderStages==='function';"""
if old not in text:
    raise SystemExit('init readiness anchor not found')
text = text.replace(old, new, 1)

if text == orig:
    raise SystemExit('ministage-complete unchanged')
js.write_text(text, encoding='utf-8')

idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
orig_html = html

# Fallback minimo essenziale se Tailwind CDN tarda/fallisce: hidden deve restare affidabile
style_anchor = """        body {\n            font-family: 'Inter', sans-serif;"""
style_replace = """        .hidden { display: none !important; }\n\n        body {\n            font-family: 'Inter', sans-serif;"""
if style_anchor not in html:
    raise SystemExit('style anchor not found')
html = html.replace(style_anchor, style_replace, 1)

# Link privacy ufficiale nel testo pubblico, senza inventare una nuova informativa
footer_old = """            <footer class=\"w-full flex justify-between items-center py-3 border-t border-indigo-100/50 text-[10px] text-gray-400\">\n                <p>&copy; Commissione Orientamento Primo Levi - Seregno</p>\n                <p>Sistema Convalida Digitale</p>\n            </footer>"""
footer_new = """            <footer class=\"w-full flex flex-col sm:flex-row justify-between items-center gap-2 py-3 border-t border-indigo-100/50 text-[10px] text-gray-500\">\n                <p>&copy; Commissione Orientamento Primo Levi - Seregno</p>\n                <p><a href=\"https://www.leviseregno.edu.it/privacy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"underline font-bold text-indigo-600\">Informativa Privacy dell’Istituto</a></p>\n            </footer>"""
if footer_old not in html:
    raise SystemExit('footer anchor not found')
html = html.replace(footer_old, footer_new, 1)

# Avviso privacy nel modulo, vicino ai dati raccolti
fields_end = """                <input type=\"tel\" id=\"modal-cellulare\" placeholder=\"Numero di Cellulare (Genitore)\" class=\"w-full p-3 border border-gray-100 rounded-xl bg-gray-50 text-xs focus:ring-2 focus:ring-indigo-500\" required>\n            </div>"""
fields_new = """                <input type=\"tel\" id=\"modal-cellulare\" placeholder=\"Numero di Cellulare (Genitore)\" class=\"w-full p-3 border border-gray-100 rounded-xl bg-gray-50 text-xs focus:ring-2 focus:ring-indigo-500\" required>\n                <p class=\"text-[10px] text-gray-500 leading-relaxed\">I dati inseriti sono utilizzati per la gestione del MiniStage. Consulta l’<a href=\"https://www.leviseregno.edu.it/privacy\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"underline font-bold text-indigo-600\">Informativa Privacy ufficiale dell’Istituto</a>.</p>\n            </div>"""
if fields_end not in html:
    raise SystemExit('form privacy anchor not found')
html = html.replace(fields_end, fields_new, 1)

html = html.replace('ministage-complete.js?v=20260906g', 'ministage-complete.js?v=20260906h')
html = html.replace('ministage-admin-console-v2.js?v=20260906g', 'ministage-admin-console-v2.js?v=20260906h')

if html == orig_html:
    raise SystemExit('index unchanged')
idx.write_text(html, encoding='utf-8')
print('FINAL_DEEP_AUDIT_PATCH_OK')

from pathlib import Path

INDEX = Path('index.html')
COMPLETE = Path('ministage-complete.js')
ADMIN_ORIGINAL = Path('ministage-admin-console-v2-original.js')
ADMIN_WRAPPER = Path('ministage-admin-console-v2.js')

html = INDEX.read_text(encoding='utf-8')
complete = COMPLETE.read_text(encoding='utf-8')
admin = ADMIN_ORIGINAL.read_text(encoding='utf-8')
wrapper = ADMIN_WRAPPER.read_text(encoding='utf-8')

STANDARD_KEY = 'Liceo Scientifico - Scienze Applicate'
ECON_KEY = 'Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica'
STANDARD_LABEL = 'Liceo Scientifico Scienze Applicate'
ECON_LABEL = 'Liceo Scientifico Opzione Scienze Applicate - Curvatura Economica'

standard_old = '''                                Liceo Scientifico - Scienze Applicate
                            </span>
                            <span class="text-[9px] text-indigo-500 font-bold tracking-wider uppercase">Liceo</span>
                        </h4>
                        <div class="overflow-y-auto flex-grow compact-scroll space-y-2" id="container-liceo"></div>'''
standard_new = '''                                Liceo Scientifico Scienze Applicate
                            </span>
                            <span class="text-[9px] text-indigo-500 font-bold tracking-wider uppercase">Liceo</span>
                        </h4>
                        <p class="mb-2 rounded-xl bg-indigo-50/70 px-3 py-2 text-[10px] leading-relaxed text-indigo-900 border border-indigo-100">
                            Percorso liceale con competenze avanzate nell’area scientifico-tecnologica, con particolare attenzione a matematica, fisica, chimica, biologia, informatica e alle loro applicazioni.
                        </p>
                        <div class="overflow-y-auto flex-grow compact-scroll space-y-2" id="container-liceo"></div>'''

econ_old = '''                                Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica
                            </span>
                            <span class="text-[9px] text-emerald-600 font-bold tracking-wider uppercase">Liceo</span>
                        </h4>
                        <div class="overflow-y-auto flex-grow compact-scroll space-y-2" id="container-curvatura-economica"></div>'''
econ_new = '''                                Liceo Scientifico Opzione Scienze Applicate - Curvatura Economica
                            </span>
                            <span class="text-[9px] text-emerald-600 font-bold tracking-wider uppercase">Liceo</span>
                        </h4>
                        <p class="mb-2 rounded-xl bg-emerald-50/70 px-3 py-2 text-[10px] leading-relaxed text-emerald-900 border border-emerald-100">
                            Percorso distinto delle Scienze Applicate con <strong>2 ore di Economia</strong> e <strong>1 ora in meno di Scienze naturali</strong> rispetto al percorso ordinario.
                        </p>
                        <div class="overflow-y-auto flex-grow compact-scroll space-y-2" id="container-curvatura-economica"></div>'''

if standard_old in html:
    html = html.replace(standard_old, standard_new, 1)
elif standard_new not in html:
    raise SystemExit('Blocco Liceo Scientifico Scienze Applicate non trovato')

if econ_old in html:
    html = html.replace(econ_old, econ_new, 1)
elif econ_new not in html:
    raise SystemExit('Blocco Curvatura Economica non trovato')

# Etichette di presentazione: le chiavi Firebase restano immutate per non perdere
# date, capienze e prenotazioni gia esistenti.
label_anchor = '''            "Sistema Moda": "container-moda"
        };

        let userId = null;'''
label_insert = '''            "Sistema Moda": "container-moda"
        };

        const INDIRIZZI_LABELS = {
            "Liceo Scientifico - Scienze Applicate": "Liceo Scientifico Scienze Applicate",
            "Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica": "Liceo Scientifico Opzione Scienze Applicate - Curvatura Economica"
        };
        window.getIndirizzoLabel = function(indirizzo) {
            return INDIRIZZI_LABELS[indirizzo] || indirizzo || '';
        };

        let userId = null;'''
if label_anchor in html:
    html = html.replace(label_anchor, label_insert, 1)
elif 'const INDIRIZZI_LABELS = {' not in html:
    raise SystemExit('Punto inserimento etichette indirizzi non trovato')

# I menu amministrativi mostrano i titoli richiesti ma mantengono come value le
# chiavi storiche, cosi i due indirizzi restano separati senza rompere Firebase.
html = html.replace('INDIRIZZI_MAPPING.map(i => `<option value="${i}">${i}</option>`).join(\'\')',
                    'INDIRIZZI_MAPPING.map(i => `<option value="${i}">${window.getIndirizzoLabel(i)}</option>`).join(\'\')')
html = html.replace('<td class="p-3 font-semibold">${s.indirizzo}</td>',
                    '<td class="p-3 font-semibold">${window.getIndirizzoLabel(s.indirizzo)}</td>')
html = html.replace("labels: INDIRIZZI_MAPPING.map(m => m.substring(0, 15) + '...'),",
                    "labels: INDIRIZZI_MAPPING.map(m => window.getIndirizzoLabel(m).substring(0, 22) + '...'),")

# Corregge l'incongruenza tra home e motori avanzati: la Curvatura deve avere
# esattamente la stessa chiave interna della home, altrimenti viene trattata come
# un indirizzo diverso/non configurato.
old_curv = "const CURVATURA = 'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica';"
new_curv = "const CURVATURA = 'Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica';"
if old_curv in complete:
    complete = complete.replace(old_curv, new_curv, 1)
elif new_curv not in complete:
    raise SystemExit('Costante CURVATURA non trovata in ministage-complete.js')

if old_curv in admin:
    admin = admin.replace(old_curv, new_curv, 1)
elif new_curv not in admin:
    raise SystemExit('Costante CURVATURA non trovata nella console docente')

# Versioni/cache: forza i browser a caricare subito i file corretti.
complete = complete.replace("const VERSION = '2026.09-auto-closure-v7';", "const VERSION = '2026.09-licei-separati-v8';", 1)
admin = admin.replace("const VERSION = '2026.09-docente-pagine-v7';", "const VERSION = '2026.09-docente-licei-v8';", 1)
wrapper = wrapper.replace("ministage-admin-console-v2-original.js?v=20260906-autoclose1", "ministage-admin-console-v2-original.js?v=20260906-licei1")
html = html.replace('ministage-complete.js?v=20260906k', 'ministage-complete.js?v=20260906-licei1')
html = html.replace('ministage-admin-console-v2.js?v=20260906o', 'ministage-admin-console-v2.js?v=20260906-licei1')

# Invarianti finali: due contenitori, due chiavi interne distinte e titoli esatti.
assert html.count('id="container-liceo"') == 1
assert html.count('id="container-curvatura-economica"') == 1
assert f'"{STANDARD_KEY}"' in html
assert f'"{ECON_KEY}"' in html
assert STANDARD_LABEL in html
assert ECON_LABEL in html
assert new_curv in complete
assert new_curv in admin
assert STANDARD_KEY != ECON_KEY

INDEX.write_text(html, encoding='utf-8')
COMPLETE.write_text(complete, encoding='utf-8')
ADMIN_ORIGINAL.write_text(admin, encoding='utf-8')
ADMIN_WRAPPER.write_text(wrapper, encoding='utf-8')
print('LICEI_INDIPENDENTI_OK')

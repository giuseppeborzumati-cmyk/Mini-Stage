from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# 1. HTML valido.
if s.startswith('<DOCTYPE html>'):
    s = '<!DOCTYPE html>' + s[len('<DOCTYPE html>'):]
elif s.startswith('!DOCTYPE html>'):
    s = '<!DOCTYPE html>' + s[len('!DOCTYPE html>'):]

# 2. Descrizione MiniStage completa.
old_desc = '''<p class="text-sm text-gray-600 leading-relaxed">
                        I nostri mini-stage offrono ai ragazzi di terza media l'opportunità di assistere alle lezioni curricolari, conoscere i professori e vivere l'ambiente scolastico del nostro istituto. Seleziona lo slot orario desiderato qui sotto per riservare il tuo posto.
                    </p>'''
new_desc = '''<div id="ministage-description" class="mt-3 text-sm text-gray-600 leading-relaxed space-y-2">
                        <h3 class="text-base font-black text-indigo-900">Descrizione dei MiniStage</h3>
                        <p>Partecipa ai nostri <strong>MiniStage</strong>, per vivere da vicino l’esperienza didattica della nostra scuola e conoscere la nostra offerta formativa!</p>
                        <ul class="space-y-1.5 list-disc pl-5">
                            <li><strong>Struttura delle attività:</strong> parteciperai a lezioni pratiche o esperienziali della durata di <strong>2 ore</strong> (dalle 14:30 alle 16:30), tenute dai <strong>docenti delle materie d'indirizzo</strong>.</li>
                            <li><strong>Accoglienza:</strong> l'accoglienza degli studenti si terrà nell'atrio della scuola <strong>15 minuti prima</strong> dell'inizio dell'attività (ore 14:15).</li>
                            <li><strong>Gruppi e Posti Limitati:</strong> le classi saranno formate da un massimo di <strong>25 studenti</strong> per garantire a ciascuno il massimo supporto e coinvolgimento.</li>
                            <li><strong>Conferma dell'iscrizione:</strong> una volta completata la prenotazione, riceverai una <strong>e-mail di conferma</strong> con l'indicazione della classe assegnata.</li>
                        </ul>
                        <div class="mt-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
                            <p><strong>Orario:</strong> 14:30 – 16:30</p>
                            <p class="text-xs text-indigo-700"><em>Accoglienza a partire dalle 14:15 nell'atrio dell'istituto.</em></p>
                        </div>
                        <p class="mt-2"><strong>Disdetta / Annullamento:</strong> in caso di impossibilità a partecipare, ti chiediamo gentilmente di annullare tempestivamente la prenotazione tramite questo sito, per consentire ad altri studenti interessati di scorrere la lista d'attesa e prendere parte all'evento.</p>
                    </div>'''
if 'id="ministage-description"' not in s:
    if old_desc not in s:
        raise SystemExit('Descrizione originale non trovata')
    s = s.replace(old_desc, new_desc, 1)

# 3. Nuovo indirizzo nella Home.
curvatura = 'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica'
if 'id="container-curvatura-economica"' not in s:
    marker = '                    <!-- 2. RIM -->'
    card = '''                    <!-- Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica -->
                    <div class="glass-card p-4 flex flex-col h-[260px]">
                        <h4 class="text-xs font-black text-indigo-900 mb-1.5 pb-1 border-b border-indigo-50 flex items-center justify-between">
                            <span class="flex items-center">
                                <span class="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-2 animate-pulse"></span>
                                Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica
                            </span>
                            <span class="text-[9px] text-emerald-600 font-bold tracking-wider uppercase">Liceo</span>
                        </h4>
                        <div class="overflow-y-auto flex-grow compact-scroll space-y-2" id="container-curvatura-economica"></div>
                    </div>

'''
    if marker not in s:
        raise SystemExit('Punto inserimento curvatura non trovato')
    s = s.replace(marker, card + marker, 1)

# 4. Sistema Moda come Istituto Tecnico (solo etichetta UI; chiave dati resta compatibile).
s = s.replace('''                                Sistema Moda
                            </span>
                            <span class="text-[9px] text-pink-500 font-bold tracking-wider uppercase">Professionale</span>''', '''                                Sistema Moda - Istituto Tecnico
                            </span>
                            <span class="text-[9px] text-pink-500 font-bold tracking-wider uppercase">Tecnico</span>''')
s = s.replace('class="glass-card p-4 flex flex-col h-[260px] md:col-span-2 max-w-2xl mx-auto w-full"', 'class="glass-card p-4 flex flex-col h-[260px]"')

# 5. Nuovo indirizzo nei mapping nativi, quindi anche in filtri e aggiunta manuale slot.
old_addresses = '''        const INDIRIZZI_MAPPING = [
            "Liceo Scientifico - Scienze Applicate",
            "Relazioni Internazionali per il Marketing (RIM)",
            "Logistica - Quadriennale",
            "Costruzione Ambiente e Territorio (CAT)",
            "Sistema Moda"
        ];'''
new_addresses = '''        const INDIRIZZI_MAPPING = [
            "Liceo Scientifico - Scienze Applicate",
            "Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica",
            "Relazioni Internazionali per il Marketing (RIM)",
            "Logistica - Quadriennale",
            "Costruzione Ambiente e Territorio (CAT)",
            "Sistema Moda"
        ];'''
if curvatura not in s[s.find('const INDIRIZZI_MAPPING'):s.find('const CONTAINER_MAPPING')]:
    if old_addresses not in s:
        raise SystemExit('INDIRIZZI_MAPPING originale non trovato')
    s = s.replace(old_addresses, new_addresses, 1)

old_containers = '''        const CONTAINER_MAPPING = {
            "Liceo Scientifico - Scienze Applicate": "container-liceo",
            "Relazioni Internazionali per il Marketing (RIM)": "container-rim",
            "Logistica - Quadriennale": "container-logistica",
            "Costruzione Ambiente e Territorio (CAT)": "container-cat",
            "Sistema Moda": "container-moda"
        };'''
new_containers = '''        const CONTAINER_MAPPING = {
            "Liceo Scientifico - Scienze Applicate": "container-liceo",
            "Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica": "container-curvatura-economica",
            "Relazioni Internazionali per il Marketing (RIM)": "container-rim",
            "Logistica - Quadriennale": "container-logistica",
            "Costruzione Ambiente e Territorio (CAT)": "container-cat",
            "Sistema Moda": "container-moda"
        };'''
if '"Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica": "container-curvatura-economica"' not in s:
    if old_containers not in s:
        raise SystemExit('CONTAINER_MAPPING originale non trovato')
    s = s.replace(old_containers, new_containers, 1)

# 6. 25 posti come valore iniziale/fallback; sempre modificabile dalla Commissione.
s = s.replace('{ indirizzo: ind, postiMax: 5 }', '{ indirizzo: ind, postiMax: 25 }')
s = s.replace('capacitiesConfig[slot.indirizzo] || 5', 'capacitiesConfig[slot.indirizzo] || 25')
s = s.replace('capacitiesConfig[ind] || 5', 'capacitiesConfig[ind] || 25')
s = s.replace('parseInt(el.value) || 5', 'parseInt(el.value) || 25')
s = s.replace('pmax || capacitiesConfig[ind] || 5', 'pmax || capacitiesConfig[ind] || 25')
s = s.replace('capacitiesConfig[s.indirizzo] || 5', 'capacitiesConfig[s.indirizzo] || 25')

# 7. Espone al modulo unico lo STESSO Firebase già inizializzato dall'HTML.
anchor = '        let html5QrScanner = null;'
exposure = '''        let html5QrScanner = null;

        window.__miniStageCore = {
            db,
            auth,
            appId,
            addresses: INDIRIZZI_MAPPING,
            collections: {
                prenotazioni: COLLECTION_PRENOTAZIONI,
                impostazioni: COLLECTION_IMPOSTAZIONI,
                capacita: COLLECTION_CONFIG_CAPACITA,
                promemoria: COLLECTION_CONFIG_PROMEMORIA
            },
            getBookings: () => allBookings,
            getSlots: () => stageSlots,
            getCapacities: () => capacitiesConfig
        };'''
if 'window.__miniStageCore' not in s:
    if anchor not in s:
        raise SystemExit('Punto esposizione Firebase non trovato')
    s = s.replace(anchor, exposure, 1)

# 8. Un solo modulo aggiuntivo.
if '<script src="ministage-complete.js"></script>' not in s:
    s = s.replace('</body>', '    <script src="ministage-complete.js"></script>\n</body>', 1)

# 9. Date: esclusivamente manuali; nessuna delle vecchie date può essere codificata.
for forbidden in ('2026-11-06', '2026-11-20', '06/11/2026', '20/11/2026'):
    if forbidden in s:
        raise SystemExit(f'Data hard-coded non consentita: {forbidden}')

p.write_text(s, encoding='utf-8')
print('PATCH_OK')

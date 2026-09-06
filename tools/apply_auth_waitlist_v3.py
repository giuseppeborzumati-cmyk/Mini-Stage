from pathlib import Path

index = Path('index.html')
complete = Path('ministage-complete.js')

html = index.read_text(encoding='utf-8')
js = complete.read_text(encoding='utf-8')

old_li = '''                            <li><strong>Conferma dell'iscrizione:</strong> una volta completata la prenotazione, riceverai una <strong>e-mail di conferma</strong> con l'indicazione della classe assegnata.</li>'''
new_li = old_li + '''\n                            <li><strong>Uscita autonoma:</strong> se il genitore/tutore autorizza l’uscita autonoma, il PDF di conferma conterrà una <strong>seconda pagina di autorizzazione</strong>. L’autorizzazione dovrà essere <strong>stampata, firmata e portata il giorno del MiniStage</strong>, allegando una <strong>copia del documento di riconoscimento in corso di validità del genitore/tutore</strong>.</li>'''
if old_li not in html:
    raise SystemExit('Punto descrizione MiniStage non trovato')
html = html.replace(old_li, new_li, 1)
html = html.replace('ministage-complete.js?v=20260906c', 'ministage-complete.js?v=20260906d')
html = html.replace('ministage-admin-console-v2.js?v=20260906c', 'ministage-admin-console-v2.js?v=20260906d')

old_notice = '''        <strong>Uscita autonoma:</strong> il PDF inviato con la conferma contiene una seconda pagina di autorizzazione. La pagina deve essere stampata, firmata dal genitore/tutore e consegnata alla scuola.'''
new_notice = '''        <strong>Uscita autonoma:</strong> il PDF inviato con la conferma contiene una seconda pagina di autorizzazione. La pagina deve essere stampata, firmata dal genitore/tutore e portata il giorno del MiniStage insieme a una copia del documento di riconoscimento in corso di validità del genitore/tutore.'''
if old_notice not in js:
    raise SystemExit('Avviso uscita autonoma non trovato')
js = js.replace(old_notice, new_notice, 1)

old_decl = "          ? '<strong>Autorizzo espressamente mio/a figlio/a a lasciare autonomamente l’IIS Primo Levi al termine del MiniStage.</strong> Dichiaro di essere il genitore/tutore indicato e prendo atto che la seconda pagina del PDF ricevuto via e-mail dovrà essere stampata, firmata e consegnata alla scuola.'"
new_decl = "          ? '<strong>Autorizzo espressamente mio/a figlio/a a lasciare autonomamente l’IIS Primo Levi al termine del MiniStage.</strong> Dichiaro di essere il genitore/tutore indicato e prendo atto che la seconda pagina del PDF ricevuto via e-mail dovrà essere stampata, firmata e portata il giorno del MiniStage insieme a una copia del mio documento di riconoscimento in corso di validità.'"
if old_decl not in js:
    raise SystemExit('Dichiarazione uscita autonoma non trovata')
js = js.replace(old_decl, new_decl, 1)

old_pdf = '''      pdf.setFontSize(10); pdf.setFont('Helvetica','normal');
      const text = `Il/La sottoscritto/a ${res.parentGuardianName || '________________'}, in qualità di ${res.parentGuardianRole || '________________'}, AUTORIZZA il/la proprio/a figlio/a ${res.nome || '________________'} a lasciare autonomamente l’IIS Primo Levi di Seregno al termine del MiniStage indicato nella prenotazione.`;
      pdf.text(pdf.splitTextToSize(text,180),15,38);
      pdf.setFont('Helvetica','bold'); pdf.text('Codice prenotazione:',15,72); pdf.setFont('Courier','bold'); pdf.text(res.code,58,72);
      pdf.setFont('Helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(70,70,80);
      pdf.text(pdf.splitTextToSize('La scelta dell’uscita autonoma è stata confermata online al momento della prenotazione. La presente pagina deve comunque essere stampata, firmata in originale dal genitore/tutore e consegnata alla scuola.',180),15,84);
      pdf.setTextColor(30,27,75); pdf.setFontSize(10); pdf.text('Data: ____________________',15,112); pdf.text('Firma autografa del genitore/tutore:',15,135); pdf.line(15,154,100,154);
      pdf.setFontSize(8); pdf.setTextColor(100,100,110); pdf.text(pdf.splitTextToSize('Consegnare il modulo firmato secondo le indicazioni dell’Istituto. Conservare la prima pagina della prenotazione con il codice di accesso.',180),15,169);'''
new_pdf = '''      pdf.setFontSize(10); pdf.setFont('Helvetica','normal');
      pdf.setFont('Helvetica','bold'); pdf.text('Nome e cognome del genitore/tutore:',15,38);
      pdf.setFont('Helvetica','normal'); pdf.text(res.parentGuardianName || '______________________________',78,38);
      pdf.setFont('Helvetica','bold'); pdf.text('Qualifica:',15,47);
      pdf.setFont('Helvetica','normal'); pdf.text(res.parentGuardianRole || '______________________________',34,47);
      const text = `Il/La sottoscritto/a AUTORIZZA il/la proprio/a figlio/a ${res.nome || '________________'} a lasciare autonomamente l’IIS Primo Levi di Seregno al termine del MiniStage indicato nella prenotazione.`;
      pdf.text(pdf.splitTextToSize(text,180),15,59);
      pdf.setFont('Helvetica','bold'); pdf.text('Codice prenotazione:',15,82); pdf.setFont('Courier','bold'); pdf.text(res.code,58,82);
      pdf.setFont('Helvetica','normal'); pdf.setFontSize(9); pdf.setTextColor(70,70,80);
      pdf.text(pdf.splitTextToSize('La scelta dell’uscita autonoma è stata confermata online al momento della prenotazione. La presente pagina deve essere stampata, firmata in originale dal genitore/tutore e portata il giorno del MiniStage.',180),15,94);
      pdf.setTextColor(30,27,75); pdf.setFontSize(10); pdf.text('Data: ____________________',15,124); pdf.text('Firma autografa del genitore/tutore:',15,147); pdf.line(15,166,100,166);
      pdf.setFont('Helvetica','bold'); pdf.setFontSize(9); pdf.setTextColor(120,60,20); pdf.text('ALLEGATO:',15,184);
      pdf.setFont('Helvetica','normal'); pdf.setTextColor(70,70,80); pdf.text(pdf.splitTextToSize('copia del documento di riconoscimento in corso di validità del genitore/tutore.',158),35,184);'''
if old_pdf not in js:
    raise SystemExit('Blocco seconda pagina PDF non trovato')
js = js.replace(old_pdf, new_pdf, 1)

old_message = "    let message = `La prenotazione ${res.code} è confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.${res.exitMode === 'autonoma' ? ' Il PDF allegato contiene come seconda pagina l’autorizzazione all’uscita autonoma: stamparla, firmarla e consegnarla alla scuola.' : ''}`;"
new_message = "    let message = `La prenotazione ${res.code} è confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.${res.exitMode === 'autonoma' ? ' Il PDF allegato contiene come seconda pagina l’autorizzazione all’uscita autonoma: stamparla, firmarla e portarla il giorno del MiniStage insieme a una copia del documento di riconoscimento in corso di validità del genitore/tutore.' : ''}`;"
if old_message not in js:
    raise SystemExit('Messaggio conferma mail non trovato')
js = js.replace(old_message, new_message, 1)

old_promoted = "      message = `Il posto è stato assegnato dalla lista d'attesa. La prenotazione ${res.code} è ora confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.`;"
new_promoted = "      message = `Il posto è stato assegnato dalla lista d'attesa. La prenotazione ${res.code} è ora confermata. Classe assegnata: ${res.classeAssegnata || 'da definire'}.${res.exitMode === 'autonoma' ? ' Il PDF allegato contiene come seconda pagina l’autorizzazione all’uscita autonoma: stamparla, firmarla e portarla il giorno del MiniStage insieme a una copia del documento di riconoscimento in corso di validità del genitore/tutore.' : ''}`;"
if old_promoted not in js:
    raise SystemExit('Messaggio promozione lista attesa non trovato')
js = js.replace(old_promoted, new_promoted, 1)

old_promote = '''  async function promoteNext(slot) {
    const locked = await acquireLock(slot.id);'''
new_promote = '''  async function promoteNext(slot) {
    if (!slot || slot.active === false) return false;
    const locked = await acquireLock(slot.id);'''
if old_promote not in js:
    raise SystemExit('promoteNext non trovato')
js = js.replace(old_promote, new_promote, 1)

old_loop = '''      for (const slot of slots) {
        for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {'''
new_loop = '''      for (const slot of slots) {
        if (slot.active === false) continue;
        for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {'''
if old_loop not in js:
    raise SystemExit('Ciclo reconcile non trovato')
js = js.replace(old_loop, new_loop, 1)

old_caps_sub = '''    f.onSnapshot(f.collection(core.db, capPath()), snap=>{
      caps={}; snap.forEach(d=>{const x=d.data();if(x.indirizzo)caps[x.indirizzo]=Number(x.postiMax||DEFAULT_CAPACITY)}); decorateStages();
    },err=>console.warn('MiniStage capacità listener',err));'''
new_caps_sub = '''    f.onSnapshot(f.collection(core.db, capPath()), snap=>{
      caps={}; snap.forEach(d=>{const x=d.data();if(x.indirizzo)caps[x.indirizzo]=Number(x.postiMax||DEFAULT_CAPACITY)}); decorateStages(); scheduleReconcile(160);
    },err=>console.warn('MiniStage capacità listener',err));'''
if old_caps_sub not in js:
    raise SystemExit('Listener capacità non trovato')
js = js.replace(old_caps_sub, new_caps_sub, 1)

index.write_text(html, encoding='utf-8')
complete.write_text(js, encoding='utf-8')
print('AUTH_WAITLIST_V3_PATCH_OK')

from pathlib import Path

path = Path('index.html')
s = path.read_text(encoding='utf-8')

marker = "        window.openManageBookingModal = function(type) {"
helper = """        window.isManageableBooking = function(booking) {
            return !!booking && (booking.type === 'prenotazione' || booking.type === 'lista_attesa');
        };

"""
if helper not in s:
    if marker not in s:
        raise SystemExit('Marker openManageBookingModal non trovato')
    s = s.replace(marker, helper + marker, 1)

old = """            const intro = document.createElement('p');
            intro.className = 'text-[10px] font-black uppercase tracking-wide text-indigo-800';
            intro.textContent = `${matches.length} prenotazioni trovate - scegli quella interessata`;
            box.appendChild(intro);

            matches.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(booking => {"""
new = """            const eligibleMatches = matches.filter(window.isManageableBooking);
            if (eligibleMatches.length === 0) {
                box.classList.add('hidden');
                return;
            }

            const intro = document.createElement('p');
            intro.className = 'text-[10px] font-black uppercase tracking-wide text-indigo-800';
            intro.textContent = `${eligibleMatches.length} prenotazioni trovate - scegli quella interessata`;
            box.appendChild(intro);

            eligibleMatches.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(booking => {"""
if old not in s:
    raise SystemExit('Blocco renderManageBookingMatches non trovato')
s = s.replace(old, new, 1)

old = """                if (manageActionType === 'cancel' && booking.type === 'cancellazione') {
                    button.textContent = 'Già annullata';
                    button.disabled = true;
                    button.className = 'shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-[10px] font-black text-gray-400 cursor-not-allowed';
                } else {
                    button.textContent = manageActionType === 'cancel' ? 'Cancella' : 'Recupera';
                    button.addEventListener('click', () => window.handleSelectedManageBooking(booking.code));
                }"""
new = """                button.textContent = manageActionType === 'cancel' ? 'Cancella' : 'Recupera';
                button.addEventListener('click', () => window.handleSelectedManageBooking(booking.code));"""
if old in s:
    s = s.replace(old, new, 1)

old = """        window.handleSelectedManageBooking = async function(code) {
            const booking = allBookings.find(b => b.code === code);
            if (!booking) return window.showMessage(\"Prenotazione non più disponibile. Riprova la ricerca.\", true);
            await window.executeManageBookingAction(booking);
        };

        window.executeManageBookingAction = async function(booking) {
            if (manageActionType === 'cancel') {
                if (booking.type === 'cancellazione') {
                    return window.showMessage(\"Questa prenotazione risulta già annullata.\", true);
                }"""
new = """        window.handleSelectedManageBooking = async function(code) {
            const booking = allBookings.find(b => b.code === code && window.isManageableBooking(b));
            if (!booking) return window.showMessage(\"Nessuna prenotazione attiva o in lista d'attesa trovata.\", true);
            await window.executeManageBookingAction(booking);
        };

        window.executeManageBookingAction = async function(booking) {
            if (!window.isManageableBooking(booking)) {
                return window.showMessage(\"Operazione non consentita: sono gestibili solo prenotazioni attive o in lista d'attesa.\", true);
            }
            if (manageActionType === 'cancel') {"""
if old not in s:
    raise SystemExit('Blocco handle/execute non trovato')
s = s.replace(old, new, 1)

old = """            window.closeManageBookingBookingModal();
            window.setView('receipt', { code: booking.code, type: booking.type, data: booking });
            if (booking.type === 'cancellazione') {
                return window.showMessage(\"Questa prenotazione è annullata: viene mostrato lo stato, ma non viene rigenerato alcun pass valido.\", true);
            }
            window.sendAutomaticEmailNotification(booking, true);"""
new = """            window.closeManageBookingBookingModal();
            window.setView('receipt', { code: booking.code, type: booking.type, data: booking });
            window.sendAutomaticEmailNotification(booking, true);"""
if old not in s:
    raise SystemExit('Blocco recupero cancellata non trovato')
s = s.replace(old, new, 1)

old = """            if (inputCode) {
                const booking = allBookings.find(b => b.code === inputCode);
                if (!booking) return window.showMessage(\"Nessuna prenotazione trovata con questo codice.\", true);
                return window.executeManageBookingAction(booking);
            }"""
new = """            if (inputCode) {
                const booking = allBookings.find(b => b.code === inputCode && window.isManageableBooking(b));
                if (!booking) return window.showMessage(\"Nessuna prenotazione attiva o in lista d'attesa trovata con questo codice.\", true);
                return window.executeManageBookingAction(booking);
            }"""
if old not in s:
    raise SystemExit('Ricerca codice non trovata')
s = s.replace(old, new, 1)

old = """            const matches = allBookings.filter(b => {
                const bookingName = String(b.nome || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                const bookingEmail = String(b.email || '').trim().toLowerCase();
                return bookingName.includes(inputName) && bookingEmail === inputEmail;
            });"""
new = """            const matches = allBookings.filter(b => {
                if (!window.isManageableBooking(b)) return false;
                const bookingName = String(b.nome || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                const bookingEmail = String(b.email || '').trim().toLowerCase();
                return bookingName.includes(inputName) && bookingEmail === inputEmail;
            });"""
if old not in s:
    raise SystemExit('Ricerca nome/email non trovata')
s = s.replace(old, new, 1)

s = s.replace(
    'return window.showMessage("Nessuna prenotazione trovata corrispondente ai dati inseriti.", true);',
    'return window.showMessage("Nessuna prenotazione attiva o in lista d\'attesa trovata corrispondente ai dati inseriti.", true);',
    1
)

assert "return !!booking && (booking.type === 'prenotazione' || booking.type === 'lista_attesa');" in s
assert "allBookings.find(b => b.code === inputCode && window.isManageableBooking(b))" in s
assert "if (!window.isManageableBooking(b)) return false;" in s
assert "allBookings.find(b => b.code === code && window.isManageableBooking(b))" in s
assert "if (!window.isManageableBooking(booking))" in s
assert "Questa prenotazione è annullata: viene mostrato lo stato" not in s

path.write_text(s, encoding='utf-8')
print('MANAGE_ACTIVE_ONLY_V2_OK')

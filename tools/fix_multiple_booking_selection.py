from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old_modal = '''                <div class="bg-purple-50/30 p-3.5 rounded-xl border border-purple-100">
                    <label class="block text-[10px] font-extrabold text-purple-700 uppercase mb-1">Cerca con i tuoi Dati</label>
                    <input id="input-search-name" type="text" placeholder="Nome e Cognome Studente" class="w-full p-2.5 mb-2 border border-purple-100 rounded-lg text-xs focus:ring-1 focus:ring-purple-500">
                    <input id="input-search-email" type="email" autocomplete="email" inputmode="email" placeholder="Email utilizzata" class="w-full p-2.5 border border-purple-100 rounded-lg text-xs focus:ring-1 focus:ring-purple-500">
                </div>
            </div>'''

new_modal = '''                <div class="bg-purple-50/30 p-3.5 rounded-xl border border-purple-100">
                    <label class="block text-[10px] font-extrabold text-purple-700 uppercase mb-1">Cerca con Nome e Cognome</label>
                    <input id="input-search-name" type="text" placeholder="Nome e Cognome Studente" class="w-full p-2.5 mb-2 border border-purple-100 rounded-lg text-xs focus:ring-1 focus:ring-purple-500">
                    <input id="input-search-email" type="email" autocomplete="email" inputmode="email" placeholder="Email utilizzata" class="w-full p-2.5 border border-purple-100 rounded-lg text-xs focus:ring-1 focus:ring-purple-500">
                    <p class="mt-2 text-[10px] text-purple-700 leading-relaxed">Se lo studente ha più MiniStage, verranno mostrati qui sotto e potrai scegliere direttamente quello da recuperare o annullare.</p>
                </div>

                <div id="manage-booking-matches" class="hidden space-y-2 rounded-xl border border-indigo-100 bg-indigo-50/30 p-3"></div>
            </div>'''

if old_modal not in s:
    raise SystemExit('Blocco modale gestione non trovato')
s = s.replace(old_modal, new_modal, 1)

start = s.find('        window.openManageBookingModal = function(type) {')
end_marker = "        // Inizializzazione dell'applicazione"
end = s.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Blocco gestione prenotazioni non trovato')

new_logic = '''        window.clearManageBookingMatches = function() {
            const box = document.getElementById('manage-booking-matches');
            if (!box) return;
            box.innerHTML = '';
            box.classList.add('hidden');
        };

        window.openManageBookingModal = function(type) {
            manageActionType = type;
            const title = document.getElementById('manage-modal-title');
            const submitBtn = document.getElementById('btn-submit-action');
            window.clearManageBookingMatches();

            if (type === 'cancel') {
                title.textContent = "Cancella Prenotazione";
                submitBtn.textContent = "Cerca Prenotazione";
                submitBtn.className = "bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-5 rounded-xl transition text-xs shadow-md";
            } else {
                title.textContent = "Recupera la Prenotazione";
                submitBtn.textContent = "Cerca Prenotazione";
                submitBtn.className = "bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-5 rounded-xl transition text-xs shadow-md";
            }

            document.getElementById('manage-booking-modal').classList.remove('hidden');
        };

        window.closeManageBookingBookingModal = function() {
            document.getElementById('manage-booking-modal').classList.add('hidden');
            document.getElementById('input-search-code').value = '';
            document.getElementById('input-search-name').value = '';
            document.getElementById('input-search-email').value = '';
            window.clearManageBookingMatches();
        };

        window.renderManageBookingMatches = function(matches) {
            const box = document.getElementById('manage-booking-matches');
            if (!box) return;
            box.innerHTML = '';

            const intro = document.createElement('p');
            intro.className = 'text-[10px] font-black uppercase tracking-wide text-indigo-800';
            intro.textContent = `${matches.length} prenotazioni trovate - scegli quella interessata`;
            box.appendChild(intro);

            matches.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).forEach(booking => {
                const row = document.createElement('div');
                row.className = 'rounded-xl border border-indigo-100 bg-white p-3 shadow-sm';

                const top = document.createElement('div');
                top.className = 'flex items-start justify-between gap-3';

                const info = document.createElement('div');
                info.className = 'min-w-0 flex-1';

                const name = document.createElement('p');
                name.className = 'text-xs font-black text-indigo-950';
                name.textContent = booking.nome || 'Studente';

                const details = document.createElement('p');
                details.className = 'mt-1 text-[10px] leading-relaxed text-gray-600';
                const when = [booking.stageDay, booking.stageDate, booking.stageTime].filter(Boolean).join(' ');
                details.textContent = `${when || 'Data non indicata'} • ${booking.indirizzo || 'Percorso non indicato'}`;

                const code = document.createElement('p');
                code.className = 'mt-1 text-[10px] font-mono font-bold text-indigo-500';
                code.textContent = booking.code || '';

                info.appendChild(name);
                info.appendChild(details);
                info.appendChild(code);

                const button = document.createElement('button');
                button.type = 'button';
                button.className = manageActionType === 'cancel'
                    ? 'shrink-0 rounded-lg bg-red-600 px-3 py-2 text-[10px] font-black text-white hover:bg-red-700'
                    : 'shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-[10px] font-black text-white hover:bg-indigo-700';

                if (manageActionType === 'cancel' && booking.type === 'cancellazione') {
                    button.textContent = 'Già annullata';
                    button.disabled = true;
                    button.className = 'shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-[10px] font-black text-gray-400 cursor-not-allowed';
                } else {
                    button.textContent = manageActionType === 'cancel' ? 'Cancella' : 'Recupera';
                    button.addEventListener('click', () => window.handleSelectedManageBooking(booking.code));
                }

                top.appendChild(info);
                top.appendChild(button);
                row.appendChild(top);
                box.appendChild(row);
            });

            box.classList.remove('hidden');
        };

        window.handleSelectedManageBooking = async function(code) {
            const booking = allBookings.find(b => b.code === code);
            if (!booking) return window.showMessage("Prenotazione non più disponibile. Riprova la ricerca.", true);
            await window.executeManageBookingAction(booking);
        };

        window.executeManageBookingAction = async function(booking) {
            if (manageActionType === 'cancel') {
                if (booking.type === 'cancellazione') {
                    return window.showMessage("Questa prenotazione risulta già annullata.", true);
                }
                if (!confirm(`Confermi di voler annullare la prenotazione ${booking.code} per ${booking.nome} - ${booking.stageDate || ''} ${booking.indirizzo || ''}?`)) {
                    return;
                }

                try {
                    const docRef = doc(db, `artifacts/${appId}/public/data/${COLLECTION_PRENOTAZIONI}`, booking.code);
                    const cancelledAt = Date.now();
                    await updateDoc(docRef, { type: 'cancellazione', cancelledAt });
                    const cancelledBooking = { ...booking, type: 'cancellazione', cancelledAt };

                    window.closeManageBookingBookingModal();
                    window.sendCancellationEmailNotification(cancelledBooking);
                    window.setView('receipt', { code: booking.code, type: 'cancellazione', data: cancelledBooking });
                    window.showMessage("La prenotazione è stata annullata.");
                } catch(e) {
                    console.error('Errore annullamento prenotazione:', e);
                    window.showMessage("Errore nell'annullamento cloud.", true);
                }
                return;
            }

            window.closeManageBookingBookingModal();
            window.setView('receipt', { code: booking.code, type: booking.type, data: booking });
            if (booking.type === 'cancellazione') {
                return window.showMessage("Questa prenotazione è annullata: viene mostrato lo stato, ma non viene rigenerato alcun pass valido.", true);
            }
            window.sendAutomaticEmailNotification(booking, true);
        };

        window.searchAndHandleBooking = async function() {
            const inputCode = document.getElementById('input-search-code').value.trim().toUpperCase();
            const inputName = document.getElementById('input-search-name').value.trim().toLowerCase().replace(/\\s+/g, ' ');
            const inputEmail = document.getElementById('input-search-email').value.trim().toLowerCase();

            window.clearManageBookingMatches();

            if (inputCode) {
                const booking = allBookings.find(b => b.code === inputCode);
                if (!booking) return window.showMessage("Nessuna prenotazione trovata con questo codice.", true);
                return window.executeManageBookingAction(booking);
            }

            if (!inputName || !inputEmail) {
                return window.showMessage("Inserisci il codice MS oppure Nome e Cognome insieme all'e-mail utilizzata per la prenotazione.", true);
            }

            const matches = allBookings.filter(b => {
                const bookingName = String(b.nome || '').trim().toLowerCase().replace(/\\s+/g, ' ');
                const bookingEmail = String(b.email || '').trim().toLowerCase();
                return bookingName.includes(inputName) && bookingEmail === inputEmail;
            });

            if (matches.length === 0) {
                return window.showMessage("Nessuna prenotazione trovata corrispondente ai dati inseriti.", true);
            }

            if (matches.length === 1) {
                return window.executeManageBookingAction(matches[0]);
            }

            window.renderManageBookingMatches(matches);
            window.showMessage(`Trovate ${matches.length} prenotazioni. Seleziona quella interessata qui sotto.`);
        };

'''

s = s[:start] + new_logic + s[end:]

assert 'Sono state trovate più prenotazioni con questi dati' not in s
assert 'manage-booking-matches' in s
assert 'window.renderManageBookingMatches' in s
assert 'window.executeManageBookingAction' in s
assert 'Trovate ${matches.length} prenotazioni' in s

p.write_text(s, encoding='utf-8')
print('MULTIPLE_BOOKING_SELECTION_PATCH_OK')

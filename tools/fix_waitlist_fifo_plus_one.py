from pathlib import Path

js_path = Path('ministage-complete.js')
idx_path = Path('index.html')

js = js_path.read_text(encoding='utf-8')
idx = idx_path.read_text(encoding='utf-8')

old_version = "const VERSION = '2026.09-licei-separati-v8';"
new_version = "const VERSION = '2026.09-waitlist-fifo-plusone-v9';"
if old_version not in js:
    raise SystemExit('Version marker not found')
js = js.replace(old_version, new_version, 1)

old_queue = """  function queueFor(slotId, source = bookings) {
    return source
      .filter(b => b.slotId === slotId && b.type === WAITLIST)
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  }
"""
new_queue = """  function queueFor(slotId, source = bookings) {
    return source
      .filter(b => b.slotId === slotId && b.type === WAITLIST)
      .sort((a, b) => {
        const byTime = (a.timestamp || 0) - (b.timestamp || 0);
        return byTime || String(a.code || '').localeCompare(String(b.code || ''));
      });
  }
"""
if old_queue not in js:
    raise SystemExit('queueFor block not found')
js = js.replace(old_queue, new_queue, 1)

old_promote_sig = "  async function promoteNext(slot) {"
new_promote_sig = "  async function promoteNext(slot, admissionLimit = null) {"
if old_promote_sig not in js:
    raise SystemExit('promoteNext signature not found')
js = js.replace(old_promote_sig, new_promote_sig, 1)

old_promote_check = """      const max = Math.max(1, Number(slot.postiMax || capMap[slot.indirizzo] || DEFAULT_CAPACITY));
      const queue = queueFor(slot.id, fresh);
      if (!queue.length || active >= max) return false;
      const next = queue[0];
"""
new_promote_check = """      const max = Math.max(1, Number(slot.postiMax || capMap[slot.indirizzo] || DEFAULT_CAPACITY));
      const queue = queueFor(slot.id, fresh);
      const limit = Number.isFinite(Number(admissionLimit)) ? Math.max(max, Number(admissionLimit)) : max;
      if (!queue.length || active >= limit) return false;
      // FIFO rigoroso: si ammette sempre e soltanto il primo nominativo cronologico.
      const next = queue[0];
"""
if old_promote_check not in js:
    raise SystemExit('promoteNext capacity check not found')
js = js.replace(old_promote_check, new_promote_check, 1)

old_reconcile = """  async function reconcileAll() {
    try {
      await refreshState();
      for (const slot of slots) {
        if (slot.active === false) continue;
        for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {
          const fresh = await snapshotCollection(bookingPath());
          if (!queueFor(slot.id, fresh).length) break;
          const cap = capacityFor(slot);
          if (activeFor(slot.id, fresh).length >= cap) break;
          const done = await promoteNext(slot);
          if (!done) break;
        }
      }
      await refreshState();
      decorateStages();
      renderAdminExtension();
    } catch (e) {
      console.warn('MiniStage: scorrimento non completato', e);
    }
  }
"""
new_reconcile = """  async function reconcileAll() {
    try {
      await refreshState();
      for (const slot of slots) {
        if (slot.active === false) continue;

        // Lo scorrimento parte soltanto se esiste almeno un posto realmente libero.
        // Una volta partito, per non spezzare l'ordine della coda è consentito
        // uno sforamento massimo di una persona rispetto alla capienza ufficiale.
        const initialFresh = await snapshotCollection(bookingPath());
        const cap = capacityFor(slot);
        const initialActive = activeFor(slot.id, initialFresh).length;
        const initialQueue = queueFor(slot.id, initialFresh);
        if (!initialQueue.length || initialActive >= cap) continue;

        const admissionLimit = cap + 1;
        for (let i = 0; i < DEFAULT_CAPACITY + 5; i++) {
          const fresh = await snapshotCollection(bookingPath());
          if (!queueFor(slot.id, fresh).length) break;
          if (activeFor(slot.id, fresh).length >= admissionLimit) break;
          const done = await promoteNext(slot, admissionLimit);
          if (!done) break;
        }
      }
      await refreshState();
      decorateStages();
      renderAdminExtension();
    } catch (e) {
      console.warn('MiniStage: scorrimento non completato', e);
    }
  }
"""
if old_reconcile not in js:
    raise SystemExit('reconcileAll block not found')
js = js.replace(old_reconcile, new_reconcile, 1)

old_cache = 'ministage-complete.js?v=20260906-licei1'
new_cache = 'ministage-complete.js?v=20260906-fifo-plusone1'
if old_cache not in idx:
    raise SystemExit('index cache marker not found')
idx = idx.replace(old_cache, new_cache, 1)

# Static guarantees
assert "const admissionLimit = cap + 1;" in js
assert "initialActive >= cap" in js
assert "promoteNext(slot, admissionLimit)" in js
assert "const next = queue[0];" in js
assert "waitlist-fifo-plusone-v9" in js
assert new_cache in idx

js_path.write_text(js, encoding='utf-8')
idx_path.write_text(idx, encoding='utf-8')
print('WAITLIST_FIFO_PLUS_ONE_PATCH_OK')

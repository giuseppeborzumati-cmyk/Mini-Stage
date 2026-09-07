from pathlib import Path

ROOT = Path('.')
NEW = 'LS - Liceo Scientifico opzione Scienze Applicate - Curvatura Economica'
OLD = 'LS - Liceo Scientifico (Scienze Applicate & Curvatura Economica)'
BAD_NEW = 'LS - Liceo Scientifico opzione Scienze Applicate - Liceo Scientifico opzione Scienze Applicate - Curvatura Economica'

changed = []
for path in ROOT.glob('*'):
    if not path.is_file() or path.suffix.lower() not in {'.html', '.js', '.md', '.txt'}:
        continue
    text = path.read_text(encoding='utf-8')
    original = text
    text = text.replace(OLD, NEW)
    text = text.replace(BAD_NEW, NEW)
    text = text.replace('Scienze Applicate & Curvatura Economica', 'Scienze Applicate - Curvatura Economica')
    text = text.replace('Scienze Applicate &amp; Curvatura Economica', 'Scienze Applicate - Curvatura Economica')
    if text != original:
        path.write_text(text, encoding='utf-8')
        changed.append(path.name)

# Rafforza la funzione di etichettatura dell'index per eventuali dati storici provenienti da Firebase.
idx = Path('index.html')
html = idx.read_text(encoding='utf-8')
old_func = """        window.getIndirizzoLabel = function(indirizzo) {\n            if (String(indirizzo || '').trim() === LEGACY_LS_COMBINED_LABEL) return NEW_LS_COMBINED_LABEL;\n            const label = INDIRIZZI_LABELS[indirizzo] || indirizzo || '';\n            return String(label).replace(/Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica/gi, 'Scienze Applicate - Curvatura Economica');\n        };"""
new_func = """        window.getIndirizzoLabel = function(indirizzo) {\n            const raw = String(indirizzo || '').trim();\n            if (!raw) return '';\n            if (/^LS\\s*-\\s*Liceo Scientifico\\s*\\(Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica\\)$/i.test(raw)) return NEW_LS_COMBINED_LABEL;\n            if (raw === LEGACY_LS_COMBINED_LABEL) return NEW_LS_COMBINED_LABEL;\n            const label = INDIRIZZI_LABELS[raw] || raw;\n            return String(label)\n                .replace(/Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica/gi, 'Scienze Applicate - Curvatura Economica')\n                .replace(/LS\\s*-\\s*Liceo Scientifico\\s*\\(Scienze Applicate\\s*-\\s*Curvatura Economica\\)/gi, NEW_LS_COMBINED_LABEL);\n        };"""
if old_func in html:
    html = html.replace(old_func, new_func, 1)
idx.write_text(html, encoding='utf-8')

# Nel pannello docente usa sempre l'etichetta normalizzata anche con record storici.
admin = Path('ministage-admin-console-v2-original.js')
if admin.exists():
    code = admin.read_text(encoding='utf-8')
    marker = """  function showMessage(message, error = false) {\n"""
    helper = """  function displayAddress(value) {\n    const raw = String(value || '').trim();\n    if (typeof window.getIndirizzoLabel === 'function') return window.getIndirizzoLabel(raw);\n    return raw.replace(/Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica/gi, 'Scienze Applicate - Curvatura Economica');\n  }\n\n"""
    if 'function displayAddress(value)' not in code and marker in code:
        code = code.replace(marker, helper + marker, 1)
    # Solo sostituzioni di output visivo; i valori interni/Firebase restano invariati.
    for old_expr in [
        'esc(b.indirizzo)', 'esc(s.indirizzo)', 'esc(slot.indirizzo)', 'esc(a)',
        "esc(b.indirizzo || '—')", "esc(s.indirizzo || 'MiniStage')", "esc(slot.indirizzo || 'Percorso non definito')"
    ]:
        if old_expr.startswith('esc('):
            inner = old_expr[4:-1]
            code = code.replace(old_expr, f'esc(displayAddress({inner}))')
    admin.write_text(code, encoding='utf-8')

# Nei PDF per data normalizza il percorso prima di stamparlo nel PDF.
pdf = Path('ministage-pdf-date-extension.js')
if pdf.exists():
    code = pdf.read_text(encoding='utf-8')
    marker = """  function shortAddress(address) {\n"""
    helper = """  function displayAddress(address) {\n    const raw = String(address || '').trim();\n    if (typeof window.getIndirizzoLabel === 'function') return window.getIndirizzoLabel(raw);\n    return raw.replace(/Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica/gi, 'Scienze Applicate - Curvatura Economica');\n  }\n\n"""
    if 'function displayAddress(address)' not in code and marker in code:
        code = code.replace(marker, helper + marker, 1)
    code = code.replace("pdf.text(`Percorso: ${slot.indirizzo}`, 10, 30, { maxWidth: 270 });", "pdf.text(`Percorso: ${displayAddress(slot.indirizzo)}`, 10, 30, { maxWidth: 270 });")
    pdf.write_text(code, encoding='utf-8')

# Cache bust dei due script modificati.
wrapper = Path('ministage-admin-console-v2.js')
if wrapper.exists():
    code = wrapper.read_text(encoding='utf-8')
    code = code.replace('ministage-pdf-date-extension.js?v=20260906-pdfdate2', 'ministage-pdf-date-extension.js?v=20260907-label1')
    code = code.replace('ministage-admin-console-v2-original.js?v=20260906-licei1', 'ministage-admin-console-v2-original.js?v=20260907-label1')
    wrapper.write_text(code, encoding='utf-8')

# Verifiche: nessuna vecchia dicitura visibile e nessuna nuova dicitura duplicata.
for path in [Path('index.html'), Path('ministage-admin-console-v2-original.js'), Path('ministage-pdf-date-extension.js')]:
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    assert BAD_NEW not in text, f'Dicitura duplicata ancora presente in {path}'
    # OLD può comparire solo dentro regex/compatibilità costruita, non come stringa visibile.
    assert 'Scienze Applicate & Curvatura Economica' not in text, f'Vecchia dicitura visibile ancora presente in {path}'

print('LABEL_NORMALIZED', NEW)
print('FILES_CHANGED', ', '.join(changed) if changed else 'none')

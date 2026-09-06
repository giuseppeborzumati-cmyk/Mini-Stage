from pathlib import Path

TARGETS = [
    Path('index.html'),
    Path('ministage-complete.js'),
    Path('ministage-admin-console-v2-original.js'),
    Path('ministage-admin-console-v2.js'),
    Path('ministage-pdf-date-extension.js'),
]

OLD_PLAIN = 'Scienze Applicate & Curvatura Economica'
OLD_HTML = 'Scienze Applicate &amp; Curvatura Economica'
NEW = 'Scienze Applicate - Curvatura Economica'

for path in TARGETS:
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    text = text.replace(OLD_PLAIN, NEW).replace(OLD_HTML, NEW)

    if path.name == 'index.html':
        old_helper = """        window.getIndirizzoLabel = function(indirizzo) {\n            return INDIRIZZI_LABELS[indirizzo] || indirizzo || '';\n        };"""
        new_helper = """        window.getIndirizzoLabel = function(indirizzo) {\n            const label = INDIRIZZI_LABELS[indirizzo] || indirizzo || '';\n            return String(label).replace(/Scienze Applicate\\s*(?:&|&amp;)\\s*Curvatura Economica/gi, 'Scienze Applicate - Curvatura Economica');\n        };"""
        if old_helper in text:
            text = text.replace(old_helper, new_helper, 1)
        elif 'Scienze Applicate - Curvatura Economica' not in text:
            raise SystemExit('Etichetta liceo attesa non trovata in index.html')

    path.write_text(text, encoding='utf-8')

# Verifica finale: nessuna vecchia etichetta deve restare nei file testuali principali.
for path in TARGETS:
    if not path.exists():
        continue
    text = path.read_text(encoding='utf-8')
    if OLD_PLAIN in text or OLD_HTML in text:
        raise SystemExit(f'Etichetta con & ancora presente in {path}')

print('LICEO_SEPARATOR_NORMALIZED_OK')

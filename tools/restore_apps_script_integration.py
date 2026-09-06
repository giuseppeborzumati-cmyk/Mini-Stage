from pathlib import Path
import re

index_path = Path('index.html')
complete_path = Path('ministage-complete.js')

html = index_path.read_text(encoding='utf-8')
js = complete_path.read_text(encoding='utf-8')

# La versione precedente funzionante chiamava direttamente i Web App Apps Script
# senza mode:'no-cors'. Ripristiniamo solo questo comportamento, senza toccare
# Firebase, prenotazioni, lista d'attesa o area docente.
html_no_cors = html.count("mode: 'no-cors',")
js_no_cors = js.count("mode:'no-cors'")

if html_no_cors != 5:
    raise SystemExit(f'Attese 5 chiamate Apps Script no-cors in index.html, trovate {html_no_cors}')
if js_no_cors != 1:
    raise SystemExit(f'Attesa 1 chiamata no-cors in ministage-complete.js, trovate {js_no_cors}')

html = re.sub(r"(?m)^\s*mode: 'no-cors',\s*\n", '', html)
js = js.replace("method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'},",
                "method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},", 1)

# Manteniamo gli endpoint storici già presenti nella versione funzionante.
expected = [
    "AKfycby3UI3dEPG9OEzOIHmEK7QLIIUMC6b4yopSFm-twGBV6ZLWtVAZTvmfsa7UxKHFOXfqbQ",
    "AKfwcbw1C_uoalaFlcidMvhqz9zMxSXwqj1nVMo7bv3IGYbHis0aum-qoEzpA-Z2PDacgXYLbg",
    "AKfycbytiWMb5UgZrpymmzrPR5VPwbtbcGBmDyPsp7EfC3ShGk_pXl_4Zp6630eTF7cPPbOUJQ",
    "AKfycbw0IExcsXnFcwCYnT-IaVHHXn0FNoZQzd9YZvJyqL9cJZ4Hsp8xjHpV1XIlwrAQ63zlRQ",
]
for token in expected:
    if token not in html:
        raise SystemExit(f'Endpoint storico mancante in index.html: {token}')
if expected[0] not in js:
    raise SystemExit('Endpoint storico conferma/recupero mancante in ministage-complete.js')

# Versione/cache nuova per forzare i browser a caricare il JS ripristinato.
js = re.sub(r"const VERSION = '[^']+';", "const VERSION = '2026.09-appscript-restored-v1';", js, count=1)
html, n = re.subn(r'ministage-complete\.js\?v=[^"\']+',
                  'ministage-complete.js?v=20260906-appscriptrestore1', html, count=1)
if n != 1:
    raise SystemExit('Riferimento cache ministage-complete.js non trovato')

# Verifiche finali statiche.
assert "mode: 'no-cors'," not in html
assert "mode:'no-cors'" not in js
assert "fetch(EMAIL_SCRIPT_DEPLOYMENT_URL, {" in html
assert "fetch(CANCELLATION_SCRIPT_URL, {" in html
assert "await fetch(EMAIL_URL, {" in js
assert "2026.09-appscript-restored-v1" in js
assert "20260906-appscriptrestore1" in html

index_path.write_text(html, encoding='utf-8')
complete_path.write_text(js, encoding='utf-8')
print('APPS_SCRIPT_INTEGRATION_RESTORED')

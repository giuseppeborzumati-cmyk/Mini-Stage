from pathlib import Path

idx = Path('index.html')
js = Path('ministage-complete.js')

html = idx.read_text(encoding='utf-8')
code = js.read_text(encoding='utf-8')

# Tutte le chiamate Apps Script legacy: usa no-cors per evitare che i redirect
# Google Apps Script vengano trattati dal browser mobile come errore CORS.
lines = html.splitlines()
out = []
for i, line in enumerate(lines):
    out.append(line)
    if "method: 'POST'," in line:
        # non duplicare se già corretto
        next_line = lines[i+1] if i + 1 < len(lines) else ''
        if "mode: 'no-cors'" not in next_line:
            indent = line[:len(line)-len(line.lstrip())]
            out.append(indent + "mode: 'no-cors',")
html2 = '\n'.join(out) + ('\n' if html.endswith('\n') else '')
html2 = html2.replace('ministage-complete.js?v=20260906e', 'ministage-complete.js?v=20260906f')
html2 = html2.replace('ministage-admin-console-v2.js?v=20260906e', 'ministage-admin-console-v2.js?v=20260906f')

# Motore avanzato: conferme, riserve, scorrimenti e recupero usano questo invio.
old = "method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},"
new = "method:'POST', mode:'no-cors', headers:{'Content-Type':'text/plain;charset=utf-8'},"
if old not in code:
    raise SystemExit('sendPdfEmail fetch signature not found')
code2 = code.replace(old, new, 1)
code2 = code2.replace("const VERSION = '2026.09-exit-authorization-v2';", "const VERSION = '2026.09-mobile-email-v3';", 1)

# Verifiche statiche richieste
assert "method:'POST', mode:'no-cors'" in code2
assert html2.count("mode: 'no-cors',") >= 4
assert 'max-h-[calc(100dvh-1.5rem)]' in html2
assert 'sticky bottom-0' in html2
assert 'overflow-y-auto overscroll-contain' in html2
assert 'ministage-complete.js?v=20260906f' in html2

idx.write_text(html2, encoding='utf-8')
js.write_text(code2, encoding='utf-8')
print('MOBILE_EMAIL_PATCH_OK')

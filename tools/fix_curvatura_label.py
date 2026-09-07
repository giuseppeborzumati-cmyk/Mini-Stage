from pathlib import Path
import re

js = Path('ministage-complete.js')
idx = Path('index.html')
code = js.read_text(encoding='utf-8')
html = idx.read_text(encoding='utf-8')

marker = "  const CURVATURA = 'Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica';\n"
if marker not in code:
    raise SystemExit('CURVATURA marker not found')

block = """  const CURVATURA_PUBLIC_LABEL = 'Liceo Scienze Applicate - Curvatura Economica';
  const CURVATURA_VISIBLE_VARIANTS = [
    'Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica',
    'Liceo Scientifico - Opzione Scienze Applicate con Curvatura Economica'
  ];

  function curvaturaPublicLabel(value) {
    let out = String(value ?? '');
    CURVATURA_VISIBLE_VARIANTS.forEach(oldLabel => {
      out = out.split(oldLabel).join(CURVATURA_PUBLIC_LABEL);
    });
    return out;
  }

  function refreshCurvaturaVisibleLabel(root = document.body) {
    if (!root) return;
    if (root.nodeType === Node.TEXT_NODE) {
      const next = curvaturaPublicLabel(root.nodeValue || '');
      if (next !== root.nodeValue) root.nodeValue = next;
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(node => {
      const next = curvaturaPublicLabel(node.nodeValue || '');
      if (next !== node.nodeValue) node.nodeValue = next;
    });
  }

  let curvaturaLabelObserver = null;
  function installCurvaturaVisibleLabel() {
    if (!document.body) return;
    refreshCurvaturaVisibleLabel(document.body);
    if (curvaturaLabelObserver) return;
    curvaturaLabelObserver = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        if (mutation.type === 'characterData') {
          refreshCurvaturaVisibleLabel(mutation.target);
          return;
        }
        mutation.addedNodes.forEach(node => refreshCurvaturaVisibleLabel(node));
      });
    });
    curvaturaLabelObserver.observe(document.body, { subtree: true, childList: true, characterData: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCurvaturaVisibleLabel, { once: true });
  } else {
    queueMicrotask(installCurvaturaVisibleLabel);
  }
"""

if 'CURVATURA_PUBLIC_LABEL' not in code:
    code = code.replace(marker, marker + block, 1)

code = code.replace("const VERSION = '2026.09-waitlist-fifo-plusone-v9';", "const VERSION = '2026.09-curvatura-label-v10';", 1)

# Aggiorna soltanto il testo statico visibile della card in homepage; gli identificatori interni restano invariati.
html = html.replace('LSCE - Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica', 'Liceo Scienze Applicate - Curvatura Economica')
html = html.replace('Liceo Scientifico - Opzione Scienze Applicate - Curvatura Economica</span>', 'Liceo Scienze Applicate - Curvatura Economica</span>')
html = re.sub(r'ministage-complete\.js\?v=[^"\']+', 'ministage-complete.js?v=20260907-curvatura1', html, count=1)

js.write_text(code, encoding='utf-8')
idx.write_text(html, encoding='utf-8')

assert 'Liceo Scienze Applicate - Curvatura Economica' in code
assert 'CURVATURA_PUBLIC_LABEL' in code
assert '20260907-curvatura1' in html
print('CURVATURA_LABEL_PATCH_OK')

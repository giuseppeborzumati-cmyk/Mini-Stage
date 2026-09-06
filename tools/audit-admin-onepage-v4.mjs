import fs from 'fs';
import { chromium } from 'playwright';

const html = fs.readFileSync('index.html','utf8');
const m = html.match(/const ADMIN_PASSWORD = '([^']+)'/);
if (!m) throw new Error('ADMIN_PASSWORD_NOT_FOUND');
const password = m[1];
const browser = await chromium.launch({ headless: true });
const viewports = [{name:'mobile',width:390,height:844},{name:'desktop',width:1440,height:1000}];
const reports=[];
for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const pageErrors=[];
  page.on('pageerror', e => pageErrors.push(String(e.message || e)));
  await page.goto(`https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=docente-onepage-${Date.now()}`, { waitUntil:'networkidle', timeout:60000 });
  await page.waitForFunction(() => document.getElementById('conn-badge')?.textContent?.includes('SISTEMA CONNESSO'), null, {timeout:30000});
  await page.getByRole('button',{name:/Accesso Commissione Orientamento/i}).click();
  await page.locator('#admin-password').fill(password);
  await page.getByRole('button',{name:/Entra nella Dashboard/i}).click();
  await page.waitForSelector('#mini-admin-console-v2',{state:'visible',timeout:15000});
  await page.waitForTimeout(1000);
  const data = await page.evaluate(() => {
    const dash=document.getElementById('admin-dashboard');
    const root=document.getElementById('mini-admin-console-v2');
    const visibleLegacy=[...dash.children].filter(el=>el!==root && getComputedStyle(el).display!=='none').length;
    const text=root.innerText;
    return {
      onePage: !!window.__MINISTAGE_ADMIN_CONSOLE_V2__?.onePage,
      version: window.__MINISTAGE_ADMIN_CONSOLE_V2__?.version,
      visibleLegacy,
      hasAdvanced: /strumenti avanzati|altri strumenti/i.test(text),
      blocks: [...root.querySelectorAll('h2')].map(x=>x.textContent.trim()),
      classCards: root.querySelectorAll('#mini-one-classes input[data-one-class]').length,
      pathCards: root.querySelectorAll('#mini-one-path-summary > div').length,
      calendarRows: root.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length,
      dangerousButtons: ['Cancella prenotazione','Cancella lista d’attesa','Cancella totale database','Cancella date','Cancella tutto'].map(label=>({label,count:[...root.querySelectorAll('button')].filter(b=>b.textContent.includes(label)).length})),
      generateButton: [...root.querySelectorAll('button')].some(b=>b.textContent.trim()==='Genera prenotazione'),
      passwordGuardFunctions: ['miniOneCancelBooking','miniOneClearWaitlist','miniOneClearBookings','miniOneClearDates','miniOneClearEverything','miniOneGenerateBooking'].every(k=>typeof window[k]==='function'),
      width: root.scrollWidth,
      viewport: innerWidth
    };
  });
  if (!data.onePage) throw new Error(`${vp.name}: onePage flag missing`);
  if (data.version !== '2026.09-docente-onepage-v4') throw new Error(`${vp.name}: wrong version ${data.version}`);
  if (data.visibleLegacy !== 0) throw new Error(`${vp.name}: legacy visible ${data.visibleLegacy}`);
  if (data.hasAdvanced) throw new Error(`${vp.name}: advanced tools text still visible`);
  if (data.classCards !== 6 || data.pathCards !== 6) throw new Error(`${vp.name}: wrong class/path cards ${data.classCards}/${data.pathCards}`);
  if (!data.generateButton || !data.passwordGuardFunctions) throw new Error(`${vp.name}: admin actions missing`);
  if (data.dangerousButtons.some(x=>x.count<1)) throw new Error(`${vp.name}: dangerous button missing ${JSON.stringify(data.dangerousButtons)}`);
  if (data.width > data.viewport + 2) throw new Error(`${vp.name}: horizontal overflow ${data.width}/${data.viewport}`);
  if (pageErrors.length) throw new Error(`${vp.name}: page errors ${pageErrors.join(' | ')}`);
  reports.push({vp,data,pageErrors});
  await page.close();
}
await browser.close();
console.log('ADMIN_ONEPAGE_AUDIT=' + JSON.stringify(reports));
console.log('ADMIN_ONEPAGE_AUDIT_OK');

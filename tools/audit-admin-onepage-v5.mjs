import fs from 'fs';
import { chromium } from 'playwright';

const html = fs.readFileSync('index.html','utf8');
const match = html.match(/const ADMIN_PASSWORD = '([^']+)'/);
if (!match) throw new Error('ADMIN_PASSWORD_NOT_FOUND');
const password = match[1];

const browser = await chromium.launch({ headless: true });
const viewports = [
  { name:'mobile', width:390, height:844 },
  { name:'desktop', width:1440, height:1000 }
];
const reports = [];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport: { width:vp.width, height:vp.height } });
  const pageErrors = [];
  page.on('pageerror', err => pageErrors.push(String(err?.message || err)));

  await page.goto(`https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=docente-onepage-v5-${Date.now()}`, {
    waitUntil:'domcontentloaded', timeout:60000
  });
  await page.waitForFunction(() => document.getElementById('conn-badge')?.textContent?.includes('SISTEMA CONNESSO'), null, { timeout:30000 });
  await page.getByRole('button', { name:/Accesso Commissione Orientamento/i }).click();
  await page.locator('#admin-password').fill(password);
  await page.getByRole('button', { name:/Entra nella Dashboard/i }).click();
  await page.waitForSelector('#mini-admin-console-v2', { state:'visible', timeout:15000 });
  await page.waitForTimeout(1200);

  const data = await page.evaluate(() => {
    const dash = document.getElementById('admin-dashboard');
    const root = document.getElementById('mini-admin-console-v2');
    const visibleLegacy = [...dash.children].filter(el => el !== root && getComputedStyle(el).display !== 'none').length;
    const text = root?.innerText || '';
    const buttonCount = label => [...root.querySelectorAll('button')].filter(b => b.textContent.includes(label)).length;
    return {
      onePage: !!window.__MINISTAGE_ADMIN_CONSOLE_V2__?.onePage,
      version: window.__MINISTAGE_ADMIN_CONSOLE_V2__?.version || '',
      visibleLegacy,
      hasAdvanced: /Mostra strumenti avanzati|Altri strumenti/i.test(text),
      tabCount: root.querySelectorAll('[data-mini-tab]').length,
      classCards: root.querySelectorAll('#mini-one-classes input[data-one-class]').length,
      pathCards: root.querySelectorAll('#mini-one-path-summary > div').length,
      calendarRows: root.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length,
      blocks: [...root.querySelectorAll('h2')].map(x => x.textContent.trim()),
      buttons: {
        cancelBooking: buttonCount('Cancella prenotazione'),
        clearWaitlist: buttonCount('Cancella lista d’attesa'),
        clearDatabase: buttonCount('Cancella totale database'),
        clearDates: buttonCount('Cancella date'),
        clearAll: buttonCount('Cancella tutto'),
        generate: buttonCount('Genera prenotazione')
      },
      functions: {
        cancelBooking: typeof window.miniOneCancelBooking === 'function',
        clearWaitlist: typeof window.miniOneClearWaitlist === 'function',
        clearDatabase: typeof window.miniOneClearBookings === 'function',
        clearDates: typeof window.miniOneClearDates === 'function',
        clearAll: typeof window.miniOneClearEverything === 'function',
        generate: typeof window.miniOneGenerateBooking === 'function'
      },
      rootScrollWidth: root.scrollWidth,
      innerWidth: window.innerWidth,
      dashboardVisible: getComputedStyle(dash).display !== 'none'
    };
  });

  if (!data.dashboardVisible) throw new Error(`${vp.name}: dashboard not visible`);
  if (!data.onePage || data.version !== '2026.09-docente-onepage-v4') throw new Error(`${vp.name}: one-page version missing ${JSON.stringify(data)}`);
  if (data.visibleLegacy !== 0) throw new Error(`${vp.name}: ${data.visibleLegacy} legacy blocks visible`);
  if (data.hasAdvanced || data.tabCount !== 0) throw new Error(`${vp.name}: advanced/tabs still visible`);
  if (data.classCards !== 6 || data.pathCards !== 6) throw new Error(`${vp.name}: wrong path/class cards ${data.classCards}/${data.pathCards}`);
  if (data.calendarRows < 1) throw new Error(`${vp.name}: calendar empty unexpectedly`);
  if (Object.values(data.buttons).some(v => v < 1)) throw new Error(`${vp.name}: requested button missing ${JSON.stringify(data.buttons)}`);
  if (Object.values(data.functions).some(v => !v)) throw new Error(`${vp.name}: requested function missing ${JSON.stringify(data.functions)}`);
  if (data.rootScrollWidth > data.innerWidth + 2) throw new Error(`${vp.name}: horizontal overflow ${data.rootScrollWidth}/${data.innerWidth}`);
  if (pageErrors.length) throw new Error(`${vp.name}: page errors ${pageErrors.join(' | ')}`);

  reports.push({ viewport:vp, data, pageErrors });
  await page.close();
}

await browser.close();
console.log('ADMIN_ONEPAGE_V5_REPORT=' + JSON.stringify(reports));
console.log('ADMIN_ONEPAGE_V5_OK');

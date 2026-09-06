import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const viewports = [
  { name:'mobile', width:390, height:844 },
  { name:'desktop', width:1440, height:1000 }
];
const reports=[];

for (const vp of viewports) {
  const page = await browser.newPage({ viewport:{ width:vp.width, height:vp.height } });
  const pageErrors=[];
  page.on('pageerror', e => pageErrors.push(String(e?.message || e)));
  await page.goto(`https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=docente-onepage-v6-${Date.now()}`, { waitUntil:'domcontentloaded', timeout:60000 });
  await page.waitForFunction(() => document.getElementById('conn-badge')?.textContent?.includes('SISTEMA CONNESSO'), null, {timeout:30000});
  await page.getByRole('button',{name:/Accesso Commissione Orientamento/i}).click();
  await page.waitForSelector('#mini-admin-console-v2',{timeout:15000});
  await page.evaluate(() => {
    document.getElementById('admin-login')?.classList.add('hidden');
    document.getElementById('admin-dashboard')?.classList.remove('hidden');
  });
  await page.waitForFunction(() => document.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length > 0, null, {timeout:20000});
  await page.waitForFunction(() => document.querySelectorAll('#mini-one-classes input[data-one-class]').length === 6, null, {timeout:10000});
  await page.waitForTimeout(500);

  const data=await page.evaluate(() => {
    const dash=document.getElementById('admin-dashboard');
    const root=document.getElementById('mini-admin-console-v2');
    const visibleLegacy=[...dash.children].filter(el=>el!==root && getComputedStyle(el).display!=='none').length;
    const text=root.innerText;
    const countButton=label=>[...root.querySelectorAll('button')].filter(b=>b.textContent.includes(label)).length;
    return {
      version:window.__MINISTAGE_ADMIN_CONSOLE_V2__?.version || '',
      onePage:!!window.__MINISTAGE_ADMIN_CONSOLE_V2__?.onePage,
      visibleLegacy,
      advancedText:/Mostra strumenti avanzati|Altri strumenti/i.test(text),
      tabCount:root.querySelectorAll('[data-mini-tab]').length,
      classCards:root.querySelectorAll('#mini-one-classes input[data-one-class]').length,
      pathCards:root.querySelectorAll('#mini-one-path-summary > div').length,
      calendarRows:root.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length,
      summaryCards:root.querySelectorAll('#mini-one-summary > div').length,
      blocks:[...root.querySelectorAll('h2')].map(x=>x.textContent.trim()),
      buttons:{
        cancelBooking:countButton('Cancella prenotazione'),
        clearWaitlist:countButton('Cancella lista d’attesa'),
        clearDatabase:countButton('Cancella totale database'),
        clearDates:countButton('Cancella date'),
        clearAll:countButton('Cancella tutto'),
        generate:countButton('Genera prenotazione')
      },
      functions:['miniOneCancelBooking','miniOneClearWaitlist','miniOneClearBookings','miniOneClearDates','miniOneClearEverything','miniOneGenerateBooking'].reduce((o,k)=>(o[k]=typeof window[k]==='function',o),{}),
      rootWidth:root.scrollWidth,
      viewport:innerWidth
    };
  });

  if (!data.onePage || data.version!=='2026.09-docente-onepage-v4') throw new Error(`${vp.name}: wrong one-page version`);
  if (data.visibleLegacy!==0) throw new Error(`${vp.name}: legacy blocks visible ${data.visibleLegacy}`);
  if (data.advancedText || data.tabCount!==0) throw new Error(`${vp.name}: advanced tools or tabs visible`);
  if (data.classCards!==6 || data.pathCards!==6) throw new Error(`${vp.name}: wrong class/path blocks`);
  if (data.calendarRows<1 || data.summaryCards<6) throw new Error(`${vp.name}: data widgets not populated`);
  if (Object.values(data.buttons).some(v=>v<1)) throw new Error(`${vp.name}: requested button missing ${JSON.stringify(data.buttons)}`);
  if (Object.values(data.functions).some(v=>!v)) throw new Error(`${vp.name}: requested handler missing`);
  if (data.rootWidth>data.viewport+2) throw new Error(`${vp.name}: horizontal overflow ${data.rootWidth}/${data.viewport}`);
  if (pageErrors.length) throw new Error(`${vp.name}: page errors ${pageErrors.join(' | ')}`);
  reports.push({viewport:vp,data,pageErrors});
  await page.close();
}
await browser.close();
console.log('ADMIN_ONEPAGE_V6_REPORT='+JSON.stringify(reports));
console.log('ADMIN_ONEPAGE_V6_OK');

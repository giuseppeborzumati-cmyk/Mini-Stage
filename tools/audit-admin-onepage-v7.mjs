import { chromium } from 'playwright';

const browser = await chromium.launch({ headless:true });
const viewports=[{name:'mobile',width:390,height:844},{name:'desktop',width:1440,height:1000}];
const reports=[];

for(const vp of viewports){
  const page=await browser.newPage({viewport:{width:vp.width,height:vp.height}});
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
  await page.goto(`https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=docente-onepage-v7-${Date.now()}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.getElementById('conn-badge')?.textContent?.includes('SISTEMA CONNESSO'),null,{timeout:30000});
  await page.getByRole('button',{name:/Accesso Commissione Orientamento/i}).click();
  await page.waitForSelector('#mini-admin-console-v2',{state:'attached',timeout:15000});
  await page.evaluate(()=>{
    document.getElementById('admin-login')?.classList.add('hidden');
    document.getElementById('admin-dashboard')?.classList.remove('hidden');
  });
  await page.waitForSelector('#mini-admin-console-v2',{state:'visible',timeout:5000});
  await page.waitForFunction(()=>document.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length>0,null,{timeout:20000});
  await page.waitForFunction(()=>document.querySelectorAll('#mini-one-classes input[data-one-class]').length===6,null,{timeout:10000});
  await page.waitForTimeout(400);

  const data=await page.evaluate(()=>{
    const dash=document.getElementById('admin-dashboard');
    const root=document.getElementById('mini-admin-console-v2');
    const buttonCount=label=>[...root.querySelectorAll('button')].filter(b=>b.textContent.includes(label)).length;
    return {
      version:window.__MINISTAGE_ADMIN_CONSOLE_V2__?.version||'',
      onePage:!!window.__MINISTAGE_ADMIN_CONSOLE_V2__?.onePage,
      visibleLegacy:[...dash.children].filter(el=>el!==root&&getComputedStyle(el).display!=='none').length,
      advancedText:/Mostra strumenti avanzati|Altri strumenti/i.test(root.innerText),
      tabs:root.querySelectorAll('[data-mini-tab]').length,
      classCards:root.querySelectorAll('#mini-one-classes input[data-one-class]').length,
      pathCards:root.querySelectorAll('#mini-one-path-summary > div').length,
      calendarRows:root.querySelectorAll('#mini-one-calendar tr[data-one-slot]').length,
      summaryCards:root.querySelectorAll('#mini-one-summary > div').length,
      buttons:{
        cancelBooking:buttonCount('Cancella prenotazione'),
        clearWaitlist:buttonCount('Cancella lista d’attesa'),
        clearDatabase:buttonCount('Cancella totale database'),
        clearDates:buttonCount('Cancella date'),
        clearAll:buttonCount('Cancella tutto'),
        generate:buttonCount('Genera prenotazione')
      },
      functions:['miniOneCancelBooking','miniOneClearWaitlist','miniOneClearBookings','miniOneClearDates','miniOneClearEverything','miniOneGenerateBooking'].every(k=>typeof window[k]==='function'),
      width:root.scrollWidth,
      viewport:innerWidth
    };
  });

  if(!data.onePage||data.version!=='2026.09-docente-onepage-v4')throw new Error(`${vp.name}: versione one-page errata`);
  if(data.visibleLegacy!==0)throw new Error(`${vp.name}: blocchi legacy visibili ${data.visibleLegacy}`);
  if(data.advancedText||data.tabs!==0)throw new Error(`${vp.name}: strumenti avanzati/tab ancora visibili`);
  if(data.classCards!==6||data.pathCards!==6)throw new Error(`${vp.name}: blocchi percorsi/classi errati`);
  if(data.calendarRows<1||data.summaryCards<6)throw new Error(`${vp.name}: dati dashboard non popolati`);
  if(Object.values(data.buttons).some(v=>v<1))throw new Error(`${vp.name}: pulsanti richiesti mancanti ${JSON.stringify(data.buttons)}`);
  if(!data.functions)throw new Error(`${vp.name}: handler amministrativi mancanti`);
  if(data.width>data.viewport+2)throw new Error(`${vp.name}: overflow orizzontale ${data.width}/${data.viewport}`);
  if(pageErrors.length)throw new Error(`${vp.name}: errori pagina ${pageErrors.join(' | ')}`);
  reports.push({viewport:vp,data});
  await page.close();
}
await browser.close();
console.log('ADMIN_ONEPAGE_V7_REPORT='+JSON.stringify(reports));
console.log('ADMIN_ONEPAGE_V7_OK');

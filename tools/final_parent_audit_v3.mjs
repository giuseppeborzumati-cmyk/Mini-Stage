import { chromium } from 'playwright';

const BASE='https://giuseppeborzumati-cmyk.github.io/Mini-Stage/';
const expectedDates=['06/11/2026','20/11/2026'];
const expectedContainers=['container-liceo','container-curvatura-economica','container-rim','container-logistica','container-cat','container-moda'];
const viewports=[
  {name:'small-android',width:360,height:640},
  {name:'standard-mobile',width:390,height:844},
  {name:'large-mobile',width:412,height:915}
];
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=','base64');
const failures=[];
const reports=[];
function assert(cond,msg){ if(!cond) failures.push(msg); }

const browser=await chromium.launch({headless:true});
try {
  for(const vp of viewports){
    let modalMetrics=null;
    let manageMetrics=null;
    const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const page=await context.newPage();
    const pageErrors=[];
    const criticalRequestFailures=[];
    page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
    page.on('requestfailed',req=>{
      const u=req.url();
      if(/ministage-(complete|admin-console-v2)\.js|index\.html|firebasejs|jspdf/i.test(u)) criticalRequestFailures.push(`${u} :: ${req.failure()?.errorText||'failed'}`);
    });
    await page.route('https://script.google.com/**',route=>route.fulfill({status:200,contentType:'text/plain',body:'OK'}));
    await page.route('https://api.qrserver.com/**',route=>route.fulfill({status:200,contentType:'image/png',body:png}));

    const url=`${BASE}?v=parent-audit-v3-${Date.now()}-${vp.width}`;
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.__MINISTAGE_COMPLETE__?.uiReady===true,null,{timeout:30000});
    await page.waitForFunction(()=>window.__MINISTAGE_COMPLETE__?.dataReady===true,null,{timeout:45000});
    await page.waitForTimeout(700);

    const initial=await page.evaluate((expectedContainers)=>{
      const core=window.__miniStageCore;
      const slots=core?.getSlots?.()||[];
      const active=slots.filter(s=>s.active!==false);
      return {
        version:window.__MINISTAGE_COMPLETE__?.version||'',
        connected:document.getElementById('conn-badge')?.textContent||'',
        homeVisible:!!document.getElementById('view-home') && !document.getElementById('view-home').classList.contains('hidden'),
        loaderHidden:document.getElementById('loading-spinner')?.classList.contains('hidden')||false,
        bodyScrollWidth:document.documentElement.scrollWidth,
        innerWidth:window.innerWidth,
        activeSlots:active.map(s=>({id:s.id,indirizzo:s.indirizzo,date:s.dateStr,time:s.time,posti:Number(s.postiMax||0),active:s.active!==false})),
        containers:expectedContainers.map(id=>({id,count:document.getElementById(id)?.children.length||0}))
      };
    },expectedContainers);

    assert(initial.version==='2026.09-parent-release-v6',`${vp.name}: versione JS inattesa ${initial.version}`);
    assert(initial.homeVisible,`${vp.name}: home non visibile`);
    assert(initial.loaderHidden,`${vp.name}: loader ancora visibile`);
    assert(initial.connected.includes('SISTEMA CONNESSO'),`${vp.name}: Firebase non risulta connesso (${initial.connected})`);
    assert(initial.bodyScrollWidth<=initial.innerWidth+2,`${vp.name}: overflow orizzontale home ${initial.bodyScrollWidth}/${initial.innerWidth}`);
    assert(initial.activeSlots.length===12,`${vp.name}: slot attivi attesi 12, trovati ${initial.activeSlots.length}`);
    for(const d of expectedDates) assert(initial.activeSlots.filter(s=>s.date===d).length===6,`${vp.name}: ${d} non ha 6 slot attivi`);
    assert(initial.activeSlots.every(s=>expectedDates.includes(s.date)),`${vp.name}: esiste uno slot attivo fuori dalle due date ufficiali`);
    assert(initial.activeSlots.every(s=>s.time==='14:30 - 16:30'),`${vp.name}: almeno uno slot ha orario diverso da 14:30 - 16:30`);
    assert(initial.activeSlots.every(s=>s.posti===25),`${vp.name}: almeno uno slot non ha capienza 25`);
    for(const c of initial.containers) assert(c.count===2,`${vp.name}: ${c.id} mostra ${c.count} slot invece di 2`);

    const firstAction=page.locator('#view-home button').filter({hasText:/Prenota|Lista d'attesa/i}).first();
    assert(await firstAction.count()===1,`${vp.name}: nessun pulsante Prenota/Lista d'attesa trovato`);
    if(await firstAction.count()){
      await firstAction.click();
      await page.waitForSelector('#booking-modal:not(.hidden)',{timeout:10000});
      modalMetrics=await page.evaluate(()=>{
        const modal=document.getElementById('booking-modal');
        const box=modal?.firstElementChild;
        const confirmBtn=modal?.querySelector('button[onclick="window.confirmBooking()"]');
        const inputs=Array.from(modal?.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]), select')||[]);
        if(box) box.scrollTop=box.scrollHeight;
        const boxRect=box?.getBoundingClientRect();
        const btnRect=confirmBtn?.getBoundingClientRect();
        return {
          modalWidth:boxRect?.width||0, viewport:window.innerWidth,
          scrollHeight:box?.scrollHeight||0, clientHeight:box?.clientHeight||0,
          confirmHeight:btnRect?.height||0,
          confirmVisible:!!(boxRect&&btnRect&&btnRect.bottom<=boxRect.bottom+2&&btnRect.top>=boxRect.top-2),
          fieldFonts:inputs.map(el=>parseFloat(getComputedStyle(el).fontSize||'0'))
        };
      });
      assert(modalMetrics.modalWidth<=modalMetrics.viewport-8,`${vp.name}: modal prenotazione troppo largo`);
      assert(modalMetrics.confirmHeight>=44,`${vp.name}: pulsante conferma sotto 44px`);
      assert(modalMetrics.confirmVisible,`${vp.name}: pulsante conferma non raggiungibile dopo scroll`);
      assert(modalMetrics.fieldFonts.every(n=>n>=16),`${vp.name}: campo mobile font <16px: ${modalMetrics.fieldFonts.join(',')}`);

      await page.locator('#booking-modal button[onclick="window.confirmBooking()"]').click();
      await page.waitForTimeout(150);
      const validationMsg=await page.locator('#message-box').textContent().catch(()=> '');
      assert(/obbligatori/i.test(validationMsg||''),`${vp.name}: validazione campi vuoti non mostrata (${validationMsg})`);

      await page.fill('#modal-nome','Mario Rossi');
      await page.fill('#modal-scuola','Scuola Media Audit');
      await page.fill('#modal-email','audit@example.invalid');
      await page.fill('#modal-cellulare','3331234567');
      await page.selectOption('#mini-exit-mode','autonoma');
      await page.fill('#mini-parent-name','Anna Rossi');
      await page.fill('#mini-parent-role','madre');
      await page.check('#mini-declaration');
      const authState=await page.evaluate(()=>({
        noticeHidden:document.getElementById('mini-exit-notice')?.classList.contains('hidden'),
        noticeText:document.getElementById('mini-exit-notice')?.textContent||'',
        declaration:document.getElementById('mini-declaration-text')?.textContent||''
      }));
      assert(!authState.noticeHidden,`${vp.name}: avviso uscita autonoma non visibile`);
      assert(/documento di riconoscimento/i.test(authState.noticeText),`${vp.name}: avviso uscita autonoma non cita documento`);
      assert(/stampata|stampato/i.test(authState.declaration)&&/firmata|firmato/i.test(authState.declaration),`${vp.name}: dichiarazione uscita autonoma incompleta`);

      await page.selectOption('#mini-exit-mode','ritiro_adulto');
      const pickupState=await page.evaluate(()=>({pickupHidden:document.getElementById('mini-pickup-name')?.classList.contains('hidden'),noticeHidden:document.getElementById('mini-exit-notice')?.classList.contains('hidden')}));
      assert(!pickupState.pickupHidden,`${vp.name}: campo adulto incaricato non appare`);
      assert(pickupState.noticeHidden,`${vp.name}: avviso uscita autonoma resta visibile scegliendo ritiro adulto`);
      await page.locator('#booking-modal button[onclick="window.closeModal()"]').click();
    }

    await page.getByRole('button',{name:/Recupera Prenotazione/i}).click();
    await page.waitForSelector('#manage-booking-modal:not(.hidden)');
    manageMetrics=await page.evaluate(()=>{
      const modal=document.getElementById('manage-booking-modal');
      const box=modal?.firstElementChild;
      const action=document.getElementById('btn-submit-action');
      const fonts=Array.from(modal?.querySelectorAll('input')||[]).map(el=>parseFloat(getComputedStyle(el).fontSize||'0'));
      const r=action?.getBoundingClientRect();
      return {fontSizes:fonts,actionHeight:r?.height||0,width:box?.getBoundingClientRect().width||0,viewport:innerWidth};
    });
    assert(manageMetrics.fontSizes.every(n=>n>=16),`${vp.name}: campi recupero con font <16px`);
    assert(manageMetrics.actionHeight>=44,`${vp.name}: pulsante recupero sotto 44px`);
    assert(manageMetrics.width<=manageMetrics.viewport-8,`${vp.name}: modal recupero troppo largo`);
    await page.fill('#input-search-code','MS-000000');
    await page.locator('#btn-submit-action').click();
    await page.waitForTimeout(150);
    const noBooking=await page.locator('#message-box').textContent().catch(()=> '');
    assert(/Nessuna prenotazione/i.test(noBooking||''),`${vp.name}: ricerca codice inesistente non gestita`);
    await page.locator('#manage-booking-modal button[onclick="window.closeManageBookingBookingModal()"]').click();

    if(vp.width===390){
      const synthetic=await page.evaluate(async()=>{
        const base={code:'MS-999999',type:'prenotazione',slotId:'AUDIT-NO-WRITE',indirizzo:'Liceo Scientifico - Scienze Applicate',stageDay:'Venerdì',stageDate:'06/11/2026',stageTime:'14:30 - 16:30',nome:'Studente Audit',scuola:'Scuola Audit',email:'audit@example.invalid',cellulare:'3331234567',exitMode:'autonoma',parentGuardianName:'Genitore Audit',parentGuardianRole:'genitore',declarationAccepted:true,exitAuthorizationAccepted:true,authorizationPaperReceived:false,classeAssegnata:'1L Liceo Scienze Applicate'};
        try{
          window.setView('receipt',{code:base.code,type:base.type,data:base});
          await window.sendAutomaticEmailNotification(base,false);
          const reserve={...base,code:'MS-999998',type:'lista_attesa'};
          await window.sendAutomaticEmailNotification(reserve,false);
          const promoted={...base,code:'MS-999997',waitlistPromotedAt:Date.now(),waitlistPromotionStatus:'Ammesso da scorrimento'};
          await window.sendAutomaticEmailNotification(promoted,false);
          await window.sendCancellationEmailNotification({...base,code:'MS-999996',type:'cancellazione'});
          return {ok:true,statusHidden:document.getElementById('email-sending-status')?.classList.contains('hidden')};
        }catch(e){return {ok:false,error:String(e?.stack||e)}}
      });
      assert(synthetic.ok,`${vp.name}: generazione PDF/e-mail simulata fallita ${synthetic.error||''}`);
      assert(synthetic.statusHidden,`${vp.name}: banner e-mail resta bloccato dopo invio simulato`);
    }

    await page.goto(`${BASE}?v=admin-mobile-audit-${Date.now()}`,{waitUntil:'domcontentloaded',timeout:60000});
    await page.waitForFunction(()=>window.__MINISTAGE_COMPLETE__?.uiReady===true,null,{timeout:30000});
    await page.getByRole('button',{name:/Accesso Commissione Orientamento/i}).click();
    await page.waitForSelector('#view-admin:not(.hidden)');
    const adminLogin=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth-innerWidth,loginVisible:!!document.getElementById('admin-login')&&!document.getElementById('admin-login').classList.contains('hidden')}));
    assert(adminLogin.overflow<=2,`${vp.name}: overflow orizzontale login Commissione`);
    assert(adminLogin.loginVisible,`${vp.name}: login Commissione non visibile`);

    assert(pageErrors.length===0,`${vp.name}: errori JavaScript non gestiti: ${pageErrors.join(' | ')}`);
    assert(criticalRequestFailures.length===0,`${vp.name}: asset critici falliti: ${criticalRequestFailures.join(' | ')}`);
    reports.push({viewport:vp,initial,modal:modalMetrics,manage:manageMetrics,pageErrors,criticalRequestFailures});
    await context.close();
  }

  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  await page.goto(`${BASE}?scanner=invalid-audit-token-${Date.now()}`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>document.body.innerText.includes('Sessione non valida o scaduta'),null,{timeout:30000});
  const scanner=await page.evaluate(()=>({text:document.body.innerText,overflow:document.documentElement.scrollWidth-innerWidth}));
  assert(/Sessione non valida o scaduta/.test(scanner.text),'scanner: token non valido non rifiutato correttamente');
  assert(scanner.overflow<=2,'scanner: overflow orizzontale su mobile');
  await context.close();

  console.log('FINAL_PARENT_AUDIT_REPORT='+JSON.stringify(reports));
  if(failures.length){console.error('FINAL_PARENT_AUDIT_FAILURES='+JSON.stringify(failures));process.exitCode=2;}
  else console.log('FINAL_PARENT_AUDIT_OK');
} finally { await browser.close(); }

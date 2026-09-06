import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:800}});
try{
  await page.goto('https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=stray-slot-check',{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>window.__MINISTAGE_COMPLETE__?.dataReady===true,null,{timeout:30000});
  const result=await page.evaluate(async()=>{
    const targetId='SLOT-1788684667511-tg3tu';
    const core=window.__miniStageCore, f=window.firebaseImports;
    const slot=(core.getSlots?.()||[]).find(s=>s.id===targetId);
    if(!slot)return {status:'NOT_FOUND'};
    const bookings=(core.getBookings?.()||[]).filter(b=>b.slotId===targetId && b.type!=='cancellazione');
    const exact=slot.indirizzo==='Costruzione Ambiente e Territorio (CAT)' && slot.dateStr==='10/09/2026' && slot.time==='14:30 - 16:30' && Number(slot.postiMax)===1 && slot.active!==false;
    if(!exact)return {status:'MISMATCH',meta:{id:slot.id,date:slot.dateStr,time:slot.time,indirizzo:slot.indirizzo,posti:slot.postiMax,active:slot.active!==false},liveBookingCount:bookings.length};
    if(bookings.length)return {status:'HAS_BOOKINGS',liveBookingCount:bookings.length};
    const path=`artifacts/${core.appId}/public/data/${core.collections.impostazioni}/${targetId}`;
    await f.updateDoc(f.doc(core.db,path),{active:false,auditDisabledAt:Date.now(),auditDisabledReason:'Slot anomalo fuori dalle date ufficiali 06/11/2026 e 20/11/2026'});
    return {status:'DISABLED',liveBookingCount:0};
  });
  console.log('STRAY_SLOT_RESULT='+JSON.stringify(result));
  if(!['DISABLED','NOT_FOUND'].includes(result.status)) process.exitCode=2;
}finally{await browser.close();}

import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const results = [];

for (const vp of [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'desktop', width: 1440, height: 1000 }
]) {
  const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));

  await page.goto(`https://giuseppeborzumati-cmyk.github.io/Mini-Stage/?v=docente-pages-v2-${Date.now()}`, {
    waitUntil: 'domcontentloaded', timeout: 60000
  });
  await page.waitForFunction(() => window.__MINISTAGE_ADMIN_CONSOLE_V2__?.version === '2026.09-docente-pagine-v5', { timeout: 30000 });
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[id^="container-"]')).some(el => /Prenota|Lista d'attesa/.test(el.innerText)), { timeout: 30000 });

  await page.evaluate(() => {
    document.getElementById('loading-spinner')?.classList.add('hidden');
    document.getElementById('view-home')?.classList.add('hidden');
    document.getElementById('view-admin')?.classList.remove('hidden');
    document.getElementById('admin-dashboard')?.classList.remove('hidden');
    document.getElementById('mini-admin-console-v2')?.classList.remove('hidden');
    window.miniTeacherHome();
  });

  await page.waitForSelector('#mini-pages-home:not(.hidden)', { timeout: 15000 });
  const landingCards = await page.locator('#mini-pages-home button[onclick*="miniTeacherOpenPage"]').count();
  if (landingCards !== 8) throw new Error(`${vp.name}: expected 8 landing cards, got ${landingCards}`);

  const pageNames = ['classes','overview','bookings','calendar','auth','scanner','pdf','data'];
  const navChecks = {};
  for (const name of pageNames) {
    await page.evaluate(n => window.miniTeacherOpenPage(n), name);
    await page.waitForTimeout(80);
    navChecks[name] = await page.evaluate(n => ({
      visible: !document.getElementById(`mini-page-${n}`).classList.contains('hidden'),
      visiblePages: Array.from(document.querySelectorAll('[data-mini-page]')).filter(el => !el.classList.contains('hidden')).length
    }), name);
    if (!navChecks[name].visible || navChecks[name].visiblePages !== 1) throw new Error(`${vp.name}: page isolation failed for ${name}`);
  }

  await page.evaluate(() => { window.miniTeacherOpenPage('bookings'); window.miniTeacherBookingSub('active'); });
  const subButtons = await page.locator('[data-book-sub]').count();
  if (subButtons !== 3) throw new Error(`${vp.name}: booking subblocks ${subButtons}`);
  const subChecks = {};
  for (const sub of ['active','wait','cancelled']) {
    await page.evaluate(s => window.miniTeacherBookingSub(s), sub);
    subChecks[sub] = await page.evaluate(s => ({
      visible: !document.getElementById(`mini-book-sub-${s}`).classList.contains('hidden'),
      count: Array.from(document.querySelectorAll('[id^="mini-book-sub-"]')).filter(el => !el.classList.contains('hidden')).length
    }), sub);
    if (!subChecks[sub].visible || subChecks[sub].count !== 1) throw new Error(`${vp.name}: booking subblock isolation failed ${sub}`);
  }

  await page.evaluate(() => window.miniTeacherOpenPage('calendar'));
  await page.waitForFunction(() => document.querySelectorAll('#mini-pages-calendar tr[data-mini-slot]').length > 0, { timeout: 30000 });
  const calendar = await page.evaluate(() => Array.from(document.querySelectorAll('#mini-pages-calendar tr[data-mini-slot]')).map(tr => ({
    id: tr.dataset.miniSlot,
    active: !!tr.querySelector('[data-field="active"]')?.checked,
    date: tr.querySelector('[data-field="date"]')?.value || '',
    time: tr.querySelector('[data-field="time"]')?.value || '',
    cap: Number(tr.querySelector('[data-field="cap"]')?.value || 0),
    occupied: (tr.querySelectorAll('td')[6]?.innerText || '').trim(),
    address: (tr.querySelectorAll('td')[1]?.innerText || '').trim()
  })));

  const publicCards = await page.evaluate(() => Array.from(document.querySelectorAll('[id^="container-"] > div')).map(card => ({
    container: card.parentElement?.id || '',
    text: card.innerText,
    action: Array.from(card.querySelectorAll('button')).map(b => b.innerText).join('|')
  })));

  const capOne = calendar.filter(r => r.cap === 1);
  if (!calendar.every(r => !!r.id)) throw new Error(`${vp.name}: one or more Firebase slots lost document id`);
  for (const testSlot of capOne) {
    const publicMatch = publicCards.find(c => c.text.includes(testSlot.address) || c.text.includes(testSlot.date.split('-').reverse().join('/')));
    if (!publicMatch) throw new Error(`${vp.name}: capacity-1 test slot not rendered publicly (${testSlot.id})`);
    const [occupied] = testSlot.occupied.split('/').map(Number);
    if (occupied >= 1 && !/Lista d'attesa/.test(publicMatch.action)) throw new Error(`${vp.name}: full capacity-1 slot not offering waitlist (${testSlot.id})`);
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error(`${vp.name}: horizontal overflow`);
  if (errors.length) throw new Error(`${vp.name}: page errors ${errors.join(' | ')}`);

  results.push({ viewport: vp, landingCards, navChecks, subChecks, calendarCount: calendar.length, calendar, capOne, publicCards });
  await page.close();
}

await browser.close();
console.log('DOCENTE_PAGES_V2_REPORT=' + JSON.stringify(results));
console.log('DOCENTE_PAGES_V2_OK');
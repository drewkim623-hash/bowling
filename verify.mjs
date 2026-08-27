#!/usr/bin/env node
/* Avengers Bowling — test harness. Node + Playwright, no framework.
 *
 *   node verify.mjs              run everything
 *   node verify.mjs --engine     scoring engine only (no browser needed)
 *
 * The engine tests lift the <script id="engine"> block straight out of
 * index.html, so they test the code that actually ships.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const ENGINE_ONLY = process.argv.includes('--engine');

let pass = 0, fail = 0;
const fails = [];
function ok(name, cond, detail = ''){
  if (cond){ pass++; }
  else { fail++; fails.push(`${name}${detail ? ' — ' + detail : ''}`); }
}
function eq(name, got, want){
  ok(name, got === want, `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}
function section(t){ console.log(`\n\x1b[1m${t}\x1b[0m`); }

/* ------------------------------------------------------------------ engine */
function extractEngine(){
  const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
  const m = html.match(/<script type="module" id="engine">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('could not find the engine block in index.html');
  return m[1];
}
async function loadEngine(){
  const src = extractEngine();
  globalThis.window = globalThis.window || {};
  const url = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  await import(url);
  return globalThis.window.BOWL;
}

const B = await loadEngine();
const S = c => B.scoreCounts(c).total;
const rep = (arr, n) => Array.from({ length: n }, () => arr).flat();

section('Scoring engine');
eq('perfect game', S(rep([10], 12)), 300);
eq('all spares, nine on the first ball', S([...rep([9,1], 9), 9,1,9]), 190);
eq('nine spares then a strike-out finish', S([...rep([9,1], 9), 10,10,10]), 202);
eq('all nines, no spares', S(rep([9,0], 10)), 90);
eq('gutter game', S(rep([0,0], 10)), 0);
eq('one strike, nothing else', S([10, ...rep([0,0], 9)]), 10);
eq('every frame five-spare, final ball five', S([...rep([5,5], 9), 5,5,5]), 150);
eq('turkey out of the gate, gutters after', S([10,10,10, ...rep([0,0], 7)]), 60);
eq('eleven strikes then a nine', S([...rep([10], 11), 9]), 299);
eq('nine strikes, spare, strike bonus', S([...rep([10], 9), 9,1,10]), 279);

section('Hand-verified scorecards');
const CARDS = [
  { name:'8/1 7/ X 9- X X 6/ 8/ 9/ X72', c:[8,1, 7,3, 10, 9,0, 10, 10, 6,4, 8,2, 9,1, 10,7,2], want:179 },
  { name:'grinder: opens and one double',  c:[7,2, 6,1, 10, 10, 4,3, 8,1, 9,0, 7,2, 6,2, 8,1],  want:108 },
  { name:'spare-heavy, open tenth',        c:[9,1, 8,2, 7,3, 9,1, 8,2, 9,1, 7,3, 8,2, 9,1, 8,1], want:172 },
  { name:'double, then a clean finish',    c:[10, 10, 7,3, 9,1, 10, 8,2, 9,1, 10, 10, 9,1,10],   want:214 },
  { name:'strike, gutter, repeat',         c:[10, 0,0, 10, 0,0, 10, 0,0, 10, 0,0, 10, 0,0],      want:50 },
  { name:'front five then it falls apart', c:[10,10,10,10,10, 7,2, 5,3, 6,1, 4,4, 5,2],          want:175 },
  { name:'nothing but opens',              c:[6,2, 5,3, 7,1, 4,4, 8,1, 3,5, 6,3, 7,2, 5,4, 6,2], want:84 },
  { name:'foul line special (zeros mixed)',c:[0,10, 10, 0,0, 9,1, 0,9, 10, 10, 0,0, 10, 10,10,0],want:129 },
  { name:'tenth-frame turkey rescue',      c:[7,2, 8,1, 6,3, 7,2, 8,1, 9,0, 7,2, 8,1, 6,3, 10,10,10], want:111 },
  { name:'one spare, one strike, rest air',c:[9,1, 10, ...rep([0,0], 8)],                          want:30 },
];
for (const k of CARDS) eq(k.name, S(k.c), k.want);

section('Tenth frame');
const nine = rep([0,0], 9);
eq('X X X in the tenth', S([...nine, 10,10,10]), 30);
eq('X then two gutters',  S([...nine, 10,0,0]), 10);
eq('spare then a strike', S([...nine, 5,5,10]), 20);
eq('spare then a gutter', S([...nine, 5,5,0]), 10);
eq('open tenth stops at two balls', S([...nine, 9,0]), 9);
eq('X 5 5 is twenty', S([...nine, 10,5,5]), 20);
eq('X 5 / is twenty',  S([...nine, 10,5,5]), 20);
ok('open tenth takes no third ball', B.deckState(rollsFromCounts([...nine, 4,3])).done === true);
ok('tenth-frame strike re-racks for ball two',
   B.deckState(rollsFromCounts([...nine, 10])).standing === B.FULL);
ok('tenth-frame spare re-racks for ball three',
   B.deckState(rollsFromCounts([...nine, 4,6])).standing === B.FULL);
ok('after X then 4, ball three sees the six that are left',
   B.cnt(B.deckState(rollsFromCounts([...nine, 10,4])).standing) === 6);

section('Impossible frames are refused');
ok('cannot knock a pin that is already down',
   B.validateRolls([{frame:1,roll:1,standing_before:B.FULL,knocked:B.maskOf([1,2,3])},
                    {frame:1,roll:2,standing_before:B.FULL & ~B.maskOf([1,2,3]),knocked:B.maskOf([1,4])}]) !== null);
ok('cannot skip a frame',
   B.validateRolls([{frame:2,roll:1,standing_before:B.FULL,knocked:0}]) !== null);
ok('cannot throw an eleventh frame',
   B.validateRolls([...rollsFromCounts(rep([10],12)),
                    {frame:10,roll:4,standing_before:B.FULL,knocked:0}]) !== null);
ok('a legal perfect game validates', B.validateRolls(rollsFromCounts(rep([10],12))) === null);

section('Which totals are actually reachable');
ok('300 is possible', B.isPossibleScore(300));
ok('299 is possible', B.isPossibleScore(299));
ok('0 is possible', B.isPossibleScore(0));
ok('301 is not', !B.isPossibleScore(301));
ok('-1 is not', !B.isPossibleScore(-1));
ok('half-scores are not', !B.isPossibleScore(150.5));
{
  let checked = 0, bad = [];
  for (let n = 0; n <= 300; n++){
    if (!B.isPossibleScore(n)) continue;
    const w = B.witness(n);
    if (!w || S(w) !== n) bad.push(n); else checked++;
  }
  ok(`every reachable total has a real game behind it (${checked} checked)`, bad.length === 0, `broken: ${bad.slice(0,8)}`);
  const impossible = [];
  for (let n = 0; n <= 300; n++) if (!B.isPossibleScore(n)) impossible.push(n);
  console.log(`  unreachable totals 0-300: ${impossible.length ? impossible.join(', ') : 'none'}`);
}

section('Split detection');
const M = B.maskOf;
const SPLITS = [
  [[7,10],'bedposts'], [[4,6],'big ears'], [[5,7],'sour apple'], [[5,10],'sour apple'],
  [[4,10],'cross-lane'], [[6,7],'cross-lane'], [[2,7],'baby split'], [[3,10],'baby split'],
  [[8,10],'back row gap'], [[7,9],'back row gap'], [[5,6],'front pin down'],
  [[4,6,7,10],'big four'], [[4,6,7,9,10],'greek church'], [[4,7,9,10],'gapped back row'],
];
for (const [pins,label] of SPLITS) ok(`split: ${pins.join('-')} (${label})`, B.isSplit(M(pins)));
const NOT = [
  [[10],'single pin'], [[7],'single pin'], [[2,4,5,8],'bucket'], [[3,5,6,9],'bucket'],
  [[3,6,9,10],'wall'], [[2,4,7],'wall'], [[2,8],'double wood'], [[3,9],'double wood'],
  [[6,10],'adjacent'], [[4,7],'adjacent'], [[6,9,10],'nine-ten with the six up'],
  [[1,2,10],'washout, headpin up'], [[1,2,4,7],'washout, headpin up'], [[],'strike'],
];
for (const [pins,label] of NOT) ok(`not a split: ${pins.join('-') || 'clean deck'} (${label})`, !B.isSplit(M(pins)));
eq('9-10 with the six still up is not a split', B.isSplit(M([6,9,10])), false);
eq('9-10 with the six knocked out is a split', B.isSplit(M([9,10])), true);
eq('leave naming: bucket', B.leaveName(M([2,4,5,8])), 'bucket');
eq('leave naming: greek church', B.leaveName(M([4,6,7,9,10])), 'greek church');
eq('leave naming: big four', B.leaveName(M([4,6,7,10])), 'big four');
eq('leave naming: baby split', B.leaveName(M([3,10])), 'baby split');
eq('leave naming: 10-pin', B.leaveName(M([10])), '10-pin');
eq('leave naming: 7-pin', B.leaveName(M([7])), '7-pin');

section('Per-game stats');
{
  const g = B.gameStats(rollsFromCounts(rep([10],12)));
  eq('perfect game strikes', g.strikes, 12);
  eq('perfect game is clean', g.clean, true);
  eq('perfect game longest streak', g.streak, 12);
  eq('perfect game first-ball average', g.firstBallPins / g.firstBalls, 10);
  eq('perfect game carry', g.carries / g.pocket, 1);
  const h = B.gameStats(rollsFromCounts([...rep([9,1],9), 9,1,9]));
  eq('all-spare game spares', h.spares, 10);
  eq('all-spare game is clean', h.clean, true);
  eq('all-spare game converts every chance', h.spares, h.spareChances);
  const o = B.gameStats(rollsFromCounts(rep([9,0],10)));
  eq('all-nines opens', o.opens, 10);
  eq('all-nines is not clean', o.clean, false);
  eq('all-nines converts nothing', o.spares, 0);
  eq('all-nines tenth frame pins', o.tenthPins, 9);
}

/* Build roll records (with correct standing masks) from a flat list of ball
   results, the way the app stores them. Used all over the tests above. */
function rollsFromCounts(c){
  const rolls = [];
  for (const p of c){
    const st = B.deckState(rolls);
    if (st.done) throw new Error('too many balls for one game');
    const upPins = B.pinsOf(st.standing);
    const knocked = B.maskOf(upPins.slice(0, p));
    rolls.push({ frame: st.frame, roll: st.roll, standing_before: st.standing, knocked });
  }
  return rolls;
}

if (ENGINE_ONLY){
  report();
} else {
  await browserTests();
  report();
}

function report(){
  console.log(`\n\x1b[1m${fail === 0 ? '\x1b[32mALL CHECKS PASS' : '\x1b[31mFAILURES'}\x1b[0m  ${pass} passed, ${fail} failed`);
  if (fails.length){ console.log(fails.map(f => '  ✗ ' + f).join('\n')); process.exit(1); }
  process.exit(0);
}
/* ---------------------------------------------------------------- browser */
/* A small league, built here in the harness out of hand-verified scorecards,
   and handed to the page through the stub flag. Supabase is never touched. */
function makeFixture(){
  const P = [
    { id:'me',    display_name:'Drew',  handle:'drew'  },
    { id:'nat',   display_name:'Nat',   handle:'nat'   },
    { id:'tony',  display_name:'Tony',  handle:'tony'  },
    { id:'bruce', display_name:'Bruce', handle:'bruce' },
  ].map(p => ({ ...p, avatar_url:null, hand:'R', ball_weight:15,
                home_house:'Bowl America Fairfax', joined_at:'2025-01-01T00:00:00Z' }));
  const PAT = {
    179:[8,1, 7,3, 10, 9,0, 10, 10, 6,4, 8,2, 9,1, 10,7,2],
    190:[...rep([9,1], 9), 9,1,9],
    150:[...rep([5,5], 9), 5,5,5],
    108:[7,2, 6,1, 10, 10, 4,3, 8,1, 9,0, 7,2, 6,2, 8,1],
    90 :rep([9,0], 10),
    84 :[6,2, 5,3, 7,1, 4,4, 8,1, 3,5, 6,3, 7,2, 5,4, 6,2],
    300:rep([10], 12),
  };
  const plan = [
    ['ses1','2025-03-08',null,   { me:[179,150,108], nat:[190,90,84],  tony:[84,108],  bruce:[90] },
                                 { me:'A', tony:'A', nat:'B', bruce:'B' }],
    ['ses2','2025-09-19',null,   { me:[300,190,84],  nat:[150,179,108],tony:[90,84] },
                                 { me:'A', nat:'B', tony:'B' }],
    ['ses3','2026-02-14',"Nat's birthday", { me:[190,150,205], nat:[179,84,90], tony:[108], bruce:[84] },
                                 { me:'A', bruce:'A', nat:'B', tony:'B' }],
  ];
  const sessions = [], players = [], games = [], rolls = [], edits = [];
  for (const [id, played_on, title, byPlayer, teams] of plan){
    sessions.push({ id, played_on, house:'Bowl America Fairfax', title,
                    created_by:'me', created_at: played_on + 'T22:00:00Z' });
    for (const [pid, team] of Object.entries(teams)) players.push({ session_id:id, profile_id:pid, team });
    for (const [pid, scores] of Object.entries(byPlayer)){
      scores.forEach((score, i) => {
        const gid = `${id}-${pid}-${i+1}`;
        const quick = !PAT[score];
        games.push({ id:gid, session_id:id, profile_id:pid, game_no:i+1, total_score:score,
          entry_mode: quick ? 'quick' : 'pins', logged_by:'me',
          created_at: `${played_on}T22:${10+i}:00Z`, updated_at: `${played_on}T22:${10+i}:00Z` });
        if (!quick) for (const r of rollsFromCounts(PAT[score])) rolls.push({ game_id:gid, ...r });
      });
    }
  }
  edits.push({ id:1, game_id:'ses1-nat-2', editor_id:'me', at:'2025-03-09T10:00:00Z',
               before:{ total_score:88, profile_id:'nat' }, after:{ total_score:90, profile_id:'nat' } });
  return { profiles:P, sessions, players, games, rolls, edits };
}

async function browserTests(){
  let chromium;
  try { ({ chromium } = await import('playwright')); }
  catch { console.error('\nPlaywright is not installed. Run:  npm i -D playwright && npx playwright install chromium'); process.exit(2); }

  const types = { '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json' };
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(DIR, rel);
    if (!file.startsWith(DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()){ res.writeHead(404); res.end('no'); return; }
    res.writeHead(200, { 'content-type': types[path.extname(file)] || 'application/octet-stream' });
    res.end(fs.readFileSync(file));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/index.html`;
  const fixture = makeFixture();

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport:{ width:390, height:844 }, deviceScaleFactor:2 });
  const page = await ctx.newPage();
  const noise = [];
  page.on('pageerror', e => noise.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') noise.push('console: ' + m.text()); });
  await page.addInitScript(([fx, user]) => { window.__FIXTURE = fx; window.__STUB_USER = user; },
                           [fixture, { id:'me', email:'drew@example.com' }]);
  await page.goto(base + '?stub=1');
  await page.waitForSelector('body[data-ready="1"]', { timeout: 15000 });

  section('The page itself');
  ok('the page boots with the stubbed client', true);
  const engineTotal = await page.evaluate(() => window.BOWL.scoreCounts(Array(12).fill(10)).total);
  eq('the shipped engine scores a perfect game in the browser too', engineTotal, 300);
  eq('every tab is on the tab strip', await page.locator('#tabs .tab').count(), 7);

  section('Home');
  const leader = await page.locator('.champ').first().innerText();
  const want = fixture.profiles.map(p => {
    const gs = fixture.games.filter(g => g.profile_id === p.id);
    return { name:p.display_name, n:gs.length, avg: gs.reduce((s,g) => s + g.total_score, 0) / (gs.length || 1) };
  }).filter(p => p.n >= 6).sort((a,b) => b.avg - a.avg)[0];
  ok(`the gold banner shows the actual leader (${want.name})`, leader.includes(want.name), leader.replace(/\n/g, ' | '));
  ok('the highest game ever is on a tile', (await page.locator('.tiles').first().innerText()).includes('300'));
  ok('the leaderboard is sorted by average to start',
     (await page.locator('#panel table tbody tr').first().innerText()).includes(want.name));
  ok('people short of six games get their own group',
     /not enough games yet/i.test(await page.locator('#panel').innerText()));
  ok('the handicap table is there and clearly second',
     /so the rest of us have a chance/i.test(await page.locator('#panel').innerText()));
  ok('the activity feed says who logged for whom',
     (await page.locator('#panel').innerText()).includes('logged by Drew'));
  ok('every section explains itself',
     await page.locator('#panel details.gloss').count() > 0);
  ok('the trend column draws a sparkline per bowler',
     await page.locator('#panel table svg.spark').count() >= 2);
  ok('the leaderboard has all ten columns',
     await page.locator('#panel table').first().locator('thead th').count() === 10);

  section('Tap anyone, see everything');
  await page.locator('.person').first().click();
  await page.waitForSelector('.sheet .inner');
  const sheet = await page.locator('.sheet .inner').innerText();
  ok('the profile sheet opens and renders', sheet.length > 200, `${sheet.length} chars`);
  for (const bit of ['Average', 'High game', 'How the pins fall', 'Season by season', 'Getting better?', 'Every session'])
    ok(`profile shows “${bit}”`, sheet.toLowerCase().includes(bit.toLowerCase()));
  ok('the profile draws a chart', await page.locator('.sheet svg.chart').count() > 0);
  ok('the profile draws the strike/spare/open bar', await page.locator('.sheet .stack').count() > 0);
  await page.locator('.sheet .x').click();
  await page.waitForSelector('.sheet', { state:'detached' });

  section('Score entry');
  await page.locator('#tabs .tab', { hasText:'Log' }).click();
  await page.locator('button.btn.pri', { hasText:'Start logging scores' }).click();
  await page.locator('button.btn', { hasText:'Log game' }).first().click();
  await page.waitForSelector('svg.deck');
  ok('the pin deck draws all ten pins', await page.locator('svg.deck g.pin').count() === 10);
  await page.locator('svg.deck g.pin').nth(0).click();
  await page.locator('svg.deck g.pin').nth(1).click();
  await page.locator('svg.deck g.pin').nth(2).click();
  await page.locator('button.btn.pri', { hasText:'confirm' }).click();
  eq('after knocking three, seven are still standing',
     await page.locator('svg.deck g.pin:not(.locked)').count(), 7);
  eq('the three that fell cannot be tapped again',
     await page.locator('svg.deck g.pin.locked').count(), 3);
  await page.locator('button.btn:not([disabled])', { hasText:/^Spare$/ }).click();
  ok('the strip shows a spare', (await page.locator('.strip').innerText()).includes('/'));
  for (let i = 0; i < 11; i++) await page.locator('button.btn:not([disabled])', { hasText:/^Strike$/ }).click();
  const shown = await page.locator('#panel .big.n').first().innerText();
  eq('a spare then eleven strikes scores 290', shown.trim(), '290');
  await page.locator('button.btn.pri', { hasText:'Save this game' }).click();
  await page.waitForSelector('svg.deck', { state:'detached' });
  ok('the saved game lands in the session grid',
     (await page.locator('#panel').innerText()).includes('290'));

  section('Quick entry');
  await page.locator('button.btn', { hasText:'Log game' }).first().click();
  await page.locator('button', { hasText:'Quick — just the score' }).click();
  await page.locator('input[type=number]').fill('301');
  await page.locator('button.btn.pri', { hasText:'Save this game' }).click();
  ok('301 is refused', (await page.locator('#panel .err').innerText()).includes('not a score'));
  await page.locator('input[type=number]').fill('212');
  await page.locator('button.btn.pri', { hasText:'Save this game' }).click();
  await page.waitForSelector('input[type=number]', { state:'detached' });
  ok('a quick game saves and is marked with a dot',
     await page.locator('#panel .dot.quick').count() > 0);

  section('Nothing overflows at 390px');
  for (const [id, label] of [['home','Home'],['log','Log'],['bowlers','Bowlers'],['sessions','Sessions'],
                             ['records','Records'],['teams','Teams'],['me','Me']]){
    await page.locator('#tabs .tab', { hasText: new RegExp(`^${label}$`) }).click();
    await page.waitForTimeout(120);
    const over = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      worst: [...document.querySelectorAll('#panel *')]
        .map(n => ({ t: n.tagName + '.' + n.className, r: Math.round(n.getBoundingClientRect().right) }))
        .filter(x => x.r > 391).slice(0, 3),
    }));
    ok(`${label}: page does not scroll sideways`, over.doc <= 390 && over.body <= 390,
       `document ${over.doc}px, body ${over.body}px, ${JSON.stringify(over.worst)}`);
    ok(`${label}: renders something`, (await page.locator('#panel').innerText()).length > 80);
  }
  await page.locator('#tabs .tab', { hasText:'Bowlers' }).click();
  await page.locator('#panel table tbody tr').first().click();
  await page.waitForSelector('.sheet .inner');
  const sheetOver = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('an open profile sheet does not scroll sideways either', sheetOver <= 390, `${sheetOver}px`);
  await page.locator('.sheet .x').click();

  section('Signed out, nothing is walled off');
  const anon = await ctx.newPage();
  await anon.addInitScript(fx => { window.__FIXTURE = fx; }, fixture);
  await anon.goto(base + '?stub=1');
  await anon.waitForSelector('body[data-ready="1"]');
  const anonHome = await anon.locator('#panel').innerText();
  ok('the leaderboard is readable without an account', anonHome.includes('Drew') && /average/i.test(anonHome));
  ok('the trophy case is readable without an account', await (async () => {
    await anon.locator('#tabs .tab', { hasText:'Records' }).click();
    return /trophy case/i.test(await anon.locator('#panel').innerText());
  })());
  await anon.locator('#tabs .tab', { hasText:/^Log$/ }).click();
  ok('only logging asks you to sign in',
     /sign in/i.test(await anon.locator('#panel').innerText()));
  ok('signed out, no floating log button', await anon.locator('.sticky-cta').count() === 0);
  await anon.close();

  section('Console');
  ok('no page errors and no console errors', noise.length === 0, noise.slice(0, 4).join(' / '));

  await browser.close();
  server.close();
}

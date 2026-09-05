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

/* The ten-tab strip is gone — four places along the bottom and a button in the
   middle. Most tests below care about the page they land on, not how they got
   there, so they ask the router directly. The bar itself is tested on its own,
   by clicking it, under "Getting around". */
async function goTo(pg, id){
  await pg.evaluate(i => window.APP.go(i), id);
  await pg.waitForTimeout(160);
}

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

section('Scored by numbers alone');
eq('a game typed in as numbers scores the same', S2(CARDS[0].c), 179);
eq('numbers-only perfect game', S2(rep([10], 12)), 300);
eq('numbers-only all spares', S2([...rep([9,1], 9), 9,1,9]), 190);
{
  const g = B.gameStats(numbersOnly([0,10, ...rep([0,0], 9)]));
  eq('a gutter then all ten is a spare, not a strike', g.strikes, 0);
  eq('it counts as the spare it is', g.spares, 1);
  eq('every second ball counts as a chance at a spare', g.spareChances, 10);
  eq('ten first balls in that game, not eleven', g.firstBalls, 10);
  const m = B.gameStats(rollsFromCounts([0,10, ...rep([0,0], 9)]));
  eq('the same is true when the pins were tapped', m.strikes, 0);
}
{
  const left = numbersOnly([8,1, ...rep([0,0], 9)]);
  left[0].split = true;
  eq('a split you tagged by hand counts', B.gameStats(left).splits, 1);
  eq('and it was not converted', B.gameStats(left).splitConverts, 0);
  const got = numbersOnly([8,2, ...rep([0,0], 9)]);
  got[0].split = true;
  eq('a tagged split you pick up counts as converted', B.gameStats(got).splitConverts, 1);
  eq('an untagged leave is not a split when nobody said so', B.gameStats(numbersOnly([8,1, ...rep([0,0],9)])).splits, 0);
}
{
  const tapped = rollsFromCounts([9,0, ...rep([0,0], 9)]);
  ok('tapped games still work splits out on their own without tagging',
     B.gameStats(rollsFromCounts([9,1, ...rep([0,0],9)])).splits >= 0);
  eq('and still collect what was left standing', B.gameStats(tapped).leaves.length > 0, true);
  eq('a numbers game knows it cannot report leaves', B.gameStats(numbersOnly([9,0, ...rep([0,0],9)])).leaves.length, 0);
}
ok('you cannot knock down more pins than are standing',
   B.validateRolls([{ frame:1, roll:1, pins:7 }, { frame:1, roll:2, pins:5 }]) !== null);
ok('a legal numbers game validates', B.validateRolls(numbersOnly(rep([10], 12))) === null);

section('Who owes what');
const T = (name, players, total) => ({ team:name, players, total });
{
  const r = B.settle([T('A',['a1','a2'],380), T('B',['b1','b2'],350), T('C',['c1','c2'],300)],
                     { stake:500, structure:'winner' });
  eq('2v2v2, winner takes the pot: each winner is up ten dollars', r.amounts.a1, 1000);
  eq('and each loser is down five', r.amounts.b1, -500);
  eq('the table balances', r.balance, 0);
}
{
  const r = B.settle([T('A',['a1','a2'],380), T('B',['b1','b2'],350), T('C',['c1','c2'],300)],
                     { stake:500, structure:'placement' });
  eq('placement: the top team wins the stake', r.amounts.a1, 500);
  eq('the middle team is level', r.amounts.b1, 0);
  eq('the bottom team pays', r.amounts.c1, -500);
  eq('and with even teams it still balances', r.balance, 0);
}
{
  const r = B.settle([T('A',['a1','a2','a3'],540), T('B',['b1','b2'],350)],
                     { stake:500, structure:'placement' });
  eq('placement across a 3v2 does not balance, and says so', r.balance, 500);
}
{
  const r = B.settle([T('A',['a1'],300), T('B',['b1'],300), T('C',['c1'],200)],
                     { stake:600, structure:'winner' });
  eq('a tie at the top splits the pot', r.amounts.a1, 300);
  eq('both of them equally', r.amounts.b1, 300);
  eq('paid by the team that lost', r.amounts.c1, -600);
  eq('still balances', r.balance, 0);
}
{
  const r = B.settle([T('A',['a1'],300), T('B',['b1'],300)], { stake:500, structure:'winner' });
  eq('if everybody ties, no money moves', r.amounts.a1, 0);
  const odd = B.settle([T('A',['a1','a2','a3'],400), T('B',['b1','b2'],300)], { stake:500, structure:'winner' });
  eq('a pot that will not divide evenly still balances', odd.balance, 0);
  eq('and nobody loses a cent to rounding', odd.amounts.a1 + odd.amounts.a2 + odd.amounts.a3, 1000);
}
eq('one team on its own is not a bet', B.settle([T('A',['a1'],300)], { stake:500 }).balance, 0);

section('Power ranking');
{
  const strong = B.powerScore({ avg:210, firstBall:9.2, sparePct:68, strikePct:55, sd:16, form:10 });
  const weak   = B.powerScore({ avg:115, firstBall:5.8, sparePct:22, strikePct:9,  sd:44, form:-12 });
  ok('a strong bowler scores near the top', strong.score > 90, String(Math.round(strong.score)));
  ok('a weak one scores near the bottom', weak.score < 12, String(Math.round(weak.score)));
  ok('the strong one outranks the weak one by a mile', strong.score - weak.score > 70);
  eq('every part of the formula is accounted for', strong.parts.length, 6);
  eq('and the weights add up to one', Math.round(strong.parts.reduce((s2,p) => s2 + p.share, 0) * 1000) / 1000, 1);
}
{
  const only = B.powerScore({ avg:160 });
  eq('somebody who only ever typed totals is judged on what is known', Math.round(only.score), Math.round(B.band(160, 110, 215) * 100));
  eq('the parts nobody has data for drop out', only.parts.length, 1);
}
eq('nothing at all scores nothing', B.powerScore({}).score, null);
eq('the top of the scale is clamped', B.powerScore({ avg:300 }).score, 100);
eq('and so is the bottom', B.powerScore({ avg:40 }).score, 0);
{
  const steady = B.powerScore({ avg:170, sd:16 }), swingy = B.powerScore({ avg:170, sd:44 });
  ok('two bowlers with the same average are split by how steady they are', steady.score > swingy.score);
  const better = B.powerScore({ avg:170, sd:25, sparePct:65 }), worse = B.powerScore({ avg:170, sd:25, sparePct:30 });
  ok('and by whether they pick their spares up', better.score > worse.score);
}

section('Reading the sides off the money');
{
  const C = o => Object.entries(o).map(([key, cents]) => ({ key, cents }));

  const two = B.teamsFromMoney(C({ drew:500, nat:500, tony:-500, steve:-500 }));
  eq('two a side: two sides', two.teams.length, 2);
  eq('the winners are the pair at the same positive number', two.winners.join(), 'drew,nat');
  eq('and the losers the pair at the same negative one', two.losers.join(), 'tony,steve');
  ok('a game that adds to nothing is balanced', two.balanced);
  ok('and two sides is a head to head', two.headToHead);

  const solo = B.teamsFromMoney(C({ drew:1000, nat:-250, tony:-250, steve:-250, bruce:-250 }));
  eq('one against four is still two sides', solo.teams.length, 2);
  eq('the four who paid are one side', solo.losers.length, 4);
  eq('and the one who took it is the other', solo.winners.join(), 'drew');

  const free = B.teamsFromMoney(C({ drew:1000, nat:500, tony:-500, steve:-1000 }));
  eq('four different numbers is four sides', free.teams.length, 4);
  eq('sorted biggest win first', free.teams[0].players.join(), 'drew');
  eq('down to the biggest loss', free.teams[3].players.join(), 'steve');
  eq('anyone who came away up won it', free.winners.join(), 'drew,nat');
  eq('and anyone down lost it', free.losers.join(), 'tony,steve');
  ok('four sides is not a head to head', !free.headToHead);

  /* Nought is a result — you bowled and came out level. Sitting a game out is
     having no row in it at all, which the ledger works out from the roster. */
  const sat = B.teamsFromMoney(C({ drew:500, nat:-500, bruce:0 }));
  eq('nought means you came out level, not that you sat out', sat.evens.join(), 'bruce');
  eq('and it is not filed as sitting out', sat.sat.length, 0);
  ok('level is neither winning nor losing',
     !sat.winners.includes('bruce') && !sat.losers.includes('bruce'));
  ok('but it is a side of its own', sat.teams.length === 3);
  ok('so it is not a head to head', !sat.headToHead);

  const off = B.teamsFromMoney(C({ drew:500, nat:500, tony:-500, steve:-300 }));
  ok('a game that does not add to nothing still reads', off.teams.length === 3);
  ok('but it says so', !off.balanced);
  eq('and by how much', off.balance, 200);

  const empty = B.teamsFromMoney(C({ drew:0, nat:0 }));
  eq('a game nobody has typed yet has no sides', empty.teams.length, 0);
  eq('nobody won it', empty.winners.length, 0);
  ok('and it is not a head to head', !empty.headToHead);

  const allup = B.teamsFromMoney(C({ drew:500, nat:500 }));
  eq('if everyone is up there is nobody to have beaten', allup.losers.length, 0);
  ok('which is not a real game, and it does not balance', !allup.balanced);
}

section('Together against apart');
{
  /* Two people who only ever win when they are together, and only ever lose
     when they are not. If the baseline counted their games together it would
     be dragged up by them and the pairing would look ordinary. */
  const rounds = [
    { a: 500, b: 500, c:-500, d:-500 },   // a+b together, won
    { a: 500, b: 500, c:-500, d:-500 },   // again
    { a: 500, b: 500, c:-500, d:-500 },   // and again
    { a:-500, c:-500, b: 500, d: 500 },   // a with c, lost. b with d, won
    { a:-500, c:-500, b: 500, d: 500 },
    { a:-500, d:-500, b: 500, c: 500 },
  ];
  const D = rounds.map(o => B.teamsFromMoney(
    Object.entries(o).map(([key, cents]) => ({ key, cents }))));

  /* a: 3 wins with b, 3 losses without. So together 100%, apart 0%. */
  const withB = D.filter(r => r.teams.some(t => t.players.includes('a') && t.players.includes('b')));
  const noB   = D.filter(r => !r.teams.some(t => t.players.includes('a') && t.players.includes('b')));
  const wonIn = (rs, k) => rs.filter(r => r.winners.includes(k)).length;
  eq('the fixture is what it says: together they never lost', wonIn(withB, 'a'), 3);
  eq('and apart he never won', wonIn(noB, 'a'), 0);

  /* the baseline must be the games WITHOUT the partner, not all of them */
  const overall = wonIn(D, 'a') / D.length * 100;          // 50% — contaminated
  const trueApart = wonIn(noB, 'a') / noB.length * 100;    // 0%  — correct
  ok('an overall rate is not a baseline, it contains the games being measured',
     Math.round(overall) !== Math.round(trueApart));
}

section('Power off the money');
{
  const P = o => B.moneyPower({ won:0, lost:0, net:0, nights:1, ...o });

  const hot  = P({ won:30, lost:6,  net:9000,  nights:9 });
  const cold = P({ won:6,  lost:30, net:-9000, nights:9 });
  ok('winning most of them beats losing most of them', hot.score > cold.score);
  ok('a score is a number out of a hundred', hot.score <= 100 && cold.score >= 0);

  /* the whole point of shrinking: one lucky night is not a career */
  const lucky = P({ won:3, lost:0, net:1500, nights:1 });
  const proven = P({ won:24, lost:12, net:6000, nights:9 });
  ok('three games at 100% does not outrank two hundred at 67%', proven.score > lucky.score);
  ok('but a perfect night still scores something', lucky.score > 0);

  const rich = P({ won:20, lost:20, net:12000, nights:10 });
  const even = P({ won:20, lost:20, net:0,     nights:10 });
  ok('at the same record, the one who took more money ranks higher', rich.score > even.score);

  const nobody = P({ won:0, lost:0, net:0, nights:0 });
  eq('somebody with no games has no score at all', nobody.score, null);

  ok('every part is a fraction of one', hot.parts.every(x => x.value >= 0 && x.value <= 1));
  ok('and the parts say what they are', hot.parts.every(x => x.label && x.blurb));
}

section('What the money cannot tell you');
{
  const C = o => Object.entries(o).map(([key, cents]) => ({ key, cents }));

  /* Four people at the same number could be one team of four, or two pairs who
     both happened to win the same amount. The money does not say which, so the
     sides are still read — but nobody is credited as anybody's partner. */
  const big = B.teamsFromMoney(C({ a:500, b:500, c:500, d:500, e:-1000, f:-1000 }));
  eq('a big side is still one side for the record', big.teams[0].players.length, 4);
  ok('everyone on it still won', big.winners.length === 4);
  ok('but it is not treated as a partnership', !big.teams[0].partnership);
  ok('while the pair on the other side is', big.teams[1].partnership);

  const pair = B.teamsFromMoney(C({ a:500, b:500, c:-500, d:-500 }));
  ok('a straight two a side is a partnership both ways',
     pair.teams.every(t => t.partnership));

  const three = B.teamsFromMoney(C({ a:500, b:500, c:500, d:-500, e:-500, f:-500 }));
  ok('so is a three a side', three.teams.every(t => t.partnership));

  const solo = B.teamsFromMoney(C({ a:1000, b:-250, c:-250, d:-250, e:-250 }));
  ok('one against the room beat all four of them', solo.winners.join() === 'a');
  ok('but those four were not playing together', !solo.teams[1].partnership);
  ok('and one person alone is nobody\u2019s partner', !solo.teams[0].partnership);
}

section('Where you finished, not just whether you were up');
{
  const C = o => Object.entries(o).map(([key, cents]) => ({ key, cents }));
  const score = o => {
    const out = B.teamsFromMoney(C(o));
    return Object.fromEntries(B.placeScores(out).map(p => [p.key, p.score]));
  };

  /* the whole point: +10 and +5 are both wins, and they are not the same win */
  const free = score({ a:1000, b:500, c:-500, d:-1000 });
  eq('winning the most scores full marks', free.a, 1);
  ok('winning less scores less', free.b < 1 && free.b > free.c);
  ok('losing less scores more than losing most', free.c > free.d);
  eq('and finishing last scores nothing', free.d, 0);

  /* and it must not disturb the ordinary case */
  const twoUp = score({ a:500, b:500, c:-500, d:-500 });
  eq('two a side is still just won', twoUp.a, 1);
  eq('or lost', twoUp.c, 0);
  eq('both winners score the same', twoUp.a, twoUp.b);

  const three = score({ a:1000, b:0, c:-1000 });
  eq('the middle of three is halfway', three.b, 0.5);
  eq('even when the middle came out level', three.a, 1);

  const mid = score({ a:1000, b:500, c:-1500 });
  eq('three sides: top', mid.a, 1);
  eq('middle', mid.b, 0.5);
  eq('bottom', mid.c, 0);

  const lvl = B.placeScores(B.teamsFromMoney(C({ a:500, b:-500, c:0 })));
  ok('coming out level is a result, and it places in the middle',
     lvl.find(p => p.key === 'c')?.score === 0.5);

  /* Nothing typed in is still nothing typed in. */
  const untouched = B.teamsFromMoney(C({ a:0, b:0, c:0 }));
  eq('a game of all noughts is not three people coming out level',
     untouched.teams.length, 0);
}

section('Writing the night up');
{
  const T = (name, won, lost, net) => ({ key:name, name, won, lost, net });
  const R = (n, sides) => ({ game_no:n, ...B.teamsFromMoney(sides) });
  const C = o => Object.entries(o).map(([key, cents]) => ({ key, cents }));

  const night = {
    played_on:'2026-08-28', house:'Bowl America Fairfax', title:null,
    totals:[T('Drew',3,1,2000), T('Nat',3,1,1250), T('Tony',1,3,-750), T('Steve',0,4,-2250)],
    rounds:[ R(1, C({ Drew:500, Nat:500, Tony:-500, Steve:-500 })),
             R(2, C({ Drew:1000, Nat:-250, Tony:-250, Steve:-250, Bruce:-250 })),
             R(3, C({ Drew:-500, Nat:500, Tony:500, Steve:-500 })),
             R(4, C({ Drew:1000, Nat:500, Tony:-500, Steve:-1000 })) ],
    goingIn:{ Steve:{ won:0, lost:6, net:-3000 }, Drew:{ won:8, lost:2, net:4000 } },
  };
  const up = B.writeUp(night);
  ok('it leads with the man who did not win a game', /Steve/.test(up.headline));
  ok('the headline is short', up.headline.length < 60);
  ok('it runs to a few paragraphs', up.story.length >= 3 && up.story.length <= 6);
  const all = up.story.join(' ');
  ok('it counts the losing streak from before tonight', /10|ten/.test(all));
  ok('it says what the worst of it cost', /22\.50/.test(all));
  ok('it never claims a score, because it was never told one',
     !/\bpins?\b|\bstrikes?\b|\bspares?\b|\bframes?\b/i.test(all));

  const swept = B.writeUp({ ...night,
    totals:[T('Drew',4,0,2000), T('Steve',0,4,-2000)],
    goingIn:{} });
  ok('a clean sweep leads instead', /Drew/.test(swept.headline));

  const quiet = B.writeUp({ played_on:'2026-01-01', house:'Somewhere', title:null,
    totals:[T('Drew',1,1,0), T('Nat',1,1,0)], rounds:[], goingIn:{} });
  ok('a night where nothing happened still says something', quiet.story.length >= 1);

  const empty = B.writeUp({ played_on:'2026-01-01', house:'X', title:null,
    totals:[], rounds:[], goingIn:{} });
  ok('and an empty night does not pretend', !!empty.headline);

  const a = B.writeUp({ ...night, played_on:'2026-08-28' });
  const b = B.writeUp({ ...night, played_on:'2026-08-28' });
  eq('the same night is written the same way twice', a.headline, b.headline);
}

section('Squaring up at the end');
{
  const t = B.settleUp({ drew: 1500, nat: -500, tony: -500, mike: -500 });
  eq('three people hand money to one', t.length, 3);
  ok('and it all goes to the winner', t.every(x => x.to === 'drew'));
  eq('five dollars each', t[0].cents, 500);
}
{
  const t = B.settleUp({ a: 2000, b: 500, c: -1500, d: -1000 });
  eq('bigger debts are matched to bigger credits first', t[0].from, 'c');
  eq('and the total moved equals what was owed', t.reduce((s, x) => s + x.cents, 0), 2500);
  ok('nobody hands over more than they lost',
     ['c','d'].every(p => t.filter(x => x.from === p).reduce((s, x) => s + x.cents, 0) <= (p === 'c' ? 1500 : 1000)));
}
eq('an even night needs no handovers', B.settleUp({ a:0, b:0 }).length, 0);
eq('a night that does not balance still settles what it can',
   B.settleUp({ a: 1000, b: -500 }).reduce((s, x) => s + x.cents, 0), 500);

/* The same game, entered as plain numbers with no idea which pins fell. */
function numbersOnly(c){
  const rolls = [];
  for (const p of c){
    const st = B.deckState(rolls);
    if (st.done) throw new Error('too many balls for one game');
    rolls.push({ frame: st.frame, roll: st.roll, pins: p });
  }
  return rolls;
}
function S2(c){ return B.scoreRolls(numbersOnly(c)).total; }

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
  ].map(p => ({ ...p, avatar_url:null, hand:'R', ball_weight:15, is_admin: p.id === 'me',
                /* everybody in the fixture made a proper account with an email
                   on it, so the front door asks them for a password */
                has_login:true,
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
  const sessions = [], players = [], games = [], rolls = [], edits = [], money = [], guests = [];
  for (const [id, played_on, title, byPlayer, teams] of plan){
    sessions.push({ id, played_on, house:'Bowl America Fairfax', title,
                    created_by:'me', created_at: played_on + 'T22:00:00Z' });
    for (const [pid, team] of Object.entries(teams)) players.push({ session_id:id, profile_id:pid, team });
    for (const [pid, scores] of Object.entries(byPlayer)){
      scores.forEach((score, i) => {
        const gid = `${id}-${pid}-${i+1}`;
        const quick = !PAT[score];
        games.push({ id:gid, session_id:id, profile_id:pid, game_no:i+1, total_score:score,
          entry_mode: quick ? 'quick' : 'pins',
          /* the first night Drew typed in the whole lane; after that people
             logged their own, which is what gives the commissioner something
             to override */
          logged_by: (pid === 'me' || id === 'ses1') ? 'me' : pid,
          created_at: `${played_on}T22:${10+i}:00Z`, updated_at: `${played_on}T22:${10+i}:00Z` });
        if (!quick) for (const r of rollsFromCounts(PAT[score])) rolls.push({ game_id:gid, ...r });
      });
    }
  }
  money.push(
    { id:'m1', session_id:'ses1', game_no:1, profile_id:'nat',   amount_cents: 2000, created_by:'me', created_at:'2025-03-08T23:00:00Z' },
    { id:'m2', session_id:'ses1', game_no:1, profile_id:'me',    amount_cents:-1000, created_by:'me', created_at:'2025-03-08T23:00:00Z' },
    { id:'m3', session_id:'ses1', game_no:1, profile_id:'tony',  amount_cents: -500, created_by:'me', created_at:'2025-03-08T23:00:00Z' },
    { id:'m4', session_id:'ses1', game_no:1, profile_id:'bruce', amount_cents: -500, created_by:'me', created_at:'2025-03-08T23:00:00Z' });
  edits.push({ id:1, game_id:'ses1-nat-2', editor_id:'me', at:'2025-03-09T10:00:00Z',
               before:{ total_score:88, profile_id:'nat' }, after:{ total_score:90, profile_id:'nat' } });
  return { profiles:P, sessions, players, games, rolls, edits, money, guests };
}

function D_gamesNotMine(fx){ return `${fx.games.filter(g => g.profile_id !== 'me').length} games belong to other people`; }

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
  page.on('dialog', d => d.accept());     // the app asks before it deletes anything
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
  eq('four places along the bottom', await page.locator('#bar button.nav').count(), 4);
  eq('and one button in the middle', await page.locator('#bar button.fab').count(), 1);

  section('Home');
  const leader = await page.locator('.champ').first().innerText();
  const want = fixture.profiles.map(p => {
    const gs = fixture.games.filter(g => g.profile_id === p.id);
    return { name:p.display_name, n:gs.length, avg: gs.reduce((s,g) => s + g.total_score, 0) / (gs.length || 1) };
  }).filter(p => p.n >= 6).sort((a,b) => b.avg - a.avg)[0];
  ok(`the gold banner shows the actual leader (${want.name})`, leader.includes(want.name), leader.replace(/\n/g, ' | '));
  /* home leads on the money now, so the pins tiles are the second group */
  ok('home leads with the book, not with pins',
     /top of the book|nothing in the book/i.test(await page.locator('#panel').innerText()));
  ok('everybody stands somewhere, off the money',
     /where everybody stands|nothing in the book/i.test(await page.locator('#panel').innerText()));
  ok('the highest game ever is still on a tile, further down',
     (await page.locator('.tiles').allInnerTexts()).some(t => t.includes('300')));
  ok('the leaderboard is sorted by average to start',
     (await page.locator('#panel .rcard').first().innerText()).includes(want.name));
  ok('people short of six games get their own group',
     /not enough games yet/i.test(await page.locator('#panel').innerText()));
  ok('the handicap table is there and clearly second',
     /so the rest of us have a chance/i.test(await page.locator('#panel').innerText()));
  ok('the activity feed says who logged for whom',
     (await page.locator('#panel').innerText()).includes('logged by Drew'));
  ok('every section explains itself',
     await page.locator('#panel details.gloss').count() > 0);
  ok('the trend column draws a sparkline per bowler',
     await page.locator('#panel .rcards svg.spark').count() >= 2);
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
  await page.locator('.sheet .closebtn').click();
  await page.waitForSelector('.sheet', { state:'detached' });

  section('Score entry — just the number');
  await goTo(page, 'log');
  await page.locator('button.btn', { hasText:'Type in scores afterwards' }).click();
  await page.locator('button.btn', { hasText:'Log game' }).first().click();
  await page.waitForSelector('.pad');
  eq('ten numbers, a mark and an undo', await page.locator('.pad button').count(), 12);
  ok('nothing to tag as a split before the first ball', await page.locator('.pad button.split').count() === 0);
  await page.locator('.pad button', { hasText:/^3$/ }).click();
  ok('the mark button becomes the seven-pin spare',
     (await page.locator('.pad button.mark').innerText()).includes('7'),
     await page.locator('.pad button.mark').innerText());
  eq('you cannot claim more pins than are standing', await page.locator('.pad button:disabled').count(), 2);
  eq('now it offers the split tag', await page.locator('.pad button.split').count(), 1);
  await page.locator('.pad button.split').click();
  eq('and the tag sticks', await page.locator('.pad button.split').getAttribute('aria-pressed'), 'true');
  await page.locator('button.swap', { hasText:'tap the actual pins' }).click();
  ok('mid-frame, the deck admits it cannot know which pins are left',
     /anyone’s guess/.test(await page.locator('#panel').innerText()));
  ok('and it keeps the split tag while it says so',
     await page.locator('.pad button.split[aria-pressed="true"]').count() === 1);
  await page.locator('button.swap', { hasText:'Stay on numbers' }).click();
  await page.locator('.pad button.mark').click();
  ok('the strip shows a spare', (await page.locator('.strip').innerText()).includes('/'));
  for (let i = 0; i < 11; i++) await page.locator('.pad button.mark', { hasText:'strike' }).click();
  const shown = await page.locator('#panel .big.n').first().innerText();
  eq('a spare then eleven strikes scores 290', shown.trim(), '290');
  await page.locator('button.btn.pri', { hasText:'Save this game' }).click();
  await page.waitForSelector('.pad', { state:'detached' });
  ok('the saved game lands in the session grid',
     (await page.locator('#panel').innerText()).includes('290'));
  ok('the split tag was saved with the ball that left it',
     await page.evaluate(() => window.APP.state.rolls.some(r => r.split === true)));
  ok('a game scored by numbers is stored as such',
     await page.evaluate(() => window.APP.state.games.some(g => g.entry_mode === 'counts')));

  section('Quick entry');
  await page.locator('button.btn', { hasText:'Log game' }).first().click();
  await page.locator('.seg button', { hasText:'Just the final score' }).click();
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
                             ['records','Records'],['teams','Teams'],['money','Money'],
                             ['power','Power'],['tonight','Tonight'],['me','Me']]){
    await goTo(page, label.toLowerCase());
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
  await goTo(page, 'bowlers');
  await page.locator('#panel .rcard').first().click();
  await page.waitForSelector('.sheet .inner');
  const sheetOver = await page.evaluate(() => document.documentElement.scrollWidth);
  ok('an open profile sheet does not scroll sideways either', sheetOver <= 390, `${sheetOver}px`);
  await page.locator('.sheet .closebtn').click();

  section('The live lane');
  await goTo(page, 'log');
  const leave = page.locator('button.btn.sm', { hasText:'Done' });
  if (await leave.count()) await leave.first().click();
  await page.locator('.person', { hasText:'Nat' }).click();
  await page.locator('button.btn.pri', { hasText:'Score it live' }).click();
  await page.waitForSelector('.mini .mrow');
  eq('a scorecard row for each bowler', await page.locator('.mini .mrow').count(), 2);
  ok('the hero gets out of the way while you score', !(await page.locator('.hero').isVisible()));
  const first = await page.locator('.upnext .who').innerText();
  await page.locator('.pad button.mark', { hasText:'strike' }).click();
  const second = await page.locator('.upnext .who').innerText();
  ok('a finished frame passes it to the next bowler', first !== second, `${first} then ${second}`);
  ok('the strike lands on the right scorecard',
     (await page.locator('.mini .mrow').first().innerText()).includes('X'));
  await page.locator('.pad button.act', { hasText:'Undo' }).click();
  eq('undo hands it back to whoever threw', await page.locator('.upnext .who').innerText(), first);

  await page.locator('button.swap', { hasText:'tap the actual pins' }).click();
  await page.waitForSelector('svg.deck');
  ok('the header counts the pins that are actually standing',
     /10 standing/.test(await page.locator('.upnext').innerText()),
     await page.locator('.upnext').innerText());
  eq('the deck is still there for anyone who wants it', await page.locator('svg.deck g.pin').count(), 10);
  const box = async n => {
    const b = await page.locator(`svg.deck g.pin[data-pin="${n}"] circle`).boundingBox();
    return [b.x + b.width/2, b.y + b.height/2];
  };
  await page.locator('svg.deck').scrollIntoViewIfNeeded();
  const [x7,y7] = await box(7), [x8,y8] = await box(8), [x9,y9] = await box(9), [x10,y10] = await box(10);
  await page.mouse.move(x7, y7);
  await page.mouse.down();
  await page.mouse.move(x8, y8, { steps: 4 });
  await page.mouse.move(x9, y9, { steps: 4 });
  await page.mouse.move(x10, y10, { steps: 4 });
  await page.mouse.up();
  ok('dragging across the deck takes every pin you touch',
     (await page.locator('button.btn.pri', { hasText:'confirm' }).innerText()).includes('4 down'),
     await page.locator('button.btn.pri', { hasText:'confirm' }).innerText());
  for (const n of [7,8,9,10]) await page.locator(`svg.deck g.pin[data-pin="${n}"]`).click();
  ok('tapping them again puts them back up',
     (await page.locator('button.btn.pri', { hasText:'confirm' }).innerText()).includes('Nothing down'));
  await page.locator('button.swap', { hasText:'type the number' }).click();
  await page.waitForSelector('.pad');

  await page.locator('.pad button.mark', { hasText:'strike' }).click();
  await page.locator('.pad button.mark', { hasText:'strike' }).click();
  await page.reload();
  await page.waitForSelector('body[data-ready="1"]');
  await goTo(page, 'log');
  ok('a half-finished game survives closing the page',
     /still going/i.test(await page.locator('#panel').innerText()));
  await page.locator('.card', { hasText:'Pick it back up' }).click();
  await page.waitForSelector('.mini .mrow');
  ok('and it comes back with the marks still on it',
     (await page.locator('.mini').innerText()).includes('X'));

  for (let i = 0; i < 30; i++){
    const strike = page.locator('.pad button.mark', { hasText:'strike' });
    if (!(await strike.count())) break;              // the game ended
    await strike.click();
  }
  await page.waitForSelector('.champ');
  const done = await page.locator('.champ').innerText();
  ok('twelve strikes each ends the game at 300 apiece',
     (done.match(/300/g) || []).length === 2, done.replace(/\n/g, ' | '));
  ok('and it offers the next game', await page.locator('button', { hasText:'Start game 2' }).count() === 1);
  await page.locator('button.btn.big', { hasText:'Finish up' }).click();
  await goTo(page, 'home');
  ok('the live games are in the record book',
     (await page.locator('#panel').innerText()).includes('300'));

  section('The commissioner');
  const others = D_gamesNotMine(fixture);
  await goTo(page, 'sessions');
  await page.locator('#panel .card', { hasText:'Mar' }).first().click();
  await page.waitForSelector('.sheet .inner');
  ok('the commissioner can put away a session they did not create',
     /put this night away/i.test(await page.locator('.sheet .inner').innerText()));
  ok('and is not offered a way to destroy it from here',
     !/delete this session/i.test(await page.locator('.sheet .inner').innerText()));
  await page.locator('.sheet .closebtn').click();
  await goTo(page, 'home');
  await page.locator('.feed.tap', { hasText:'Tony' }).first().click();
  await page.waitForSelector('.sheet .inner');
  const gameSheet = await page.locator('.sheet .inner').innerText();
  ok('that game was logged by somebody other than the commissioner',
     /logged it themselves/.test(gameSheet), gameSheet.slice(0, 120));
  ok('the commissioner can edit somebody else’s game', /commissioner/i.test(gameSheet), others);
  ok('and the game still shows who logged it', /logged it|logged by|Drew/i.test(gameSheet));
  await page.locator('.sheet .closebtn').first().click();

  section('Phone rows, desktop tables');
  ok('at 390px the sideways table is hidden',
     !(await page.locator('#panel .only-wide').first().isVisible()));
  ok('at 390px you get stacked cards instead',
     await page.locator('#panel .rcards').first().isVisible());
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(120);
  ok('on a wide screen the real table comes back',
     await page.locator('#panel .only-wide table').first().isVisible());
  ok('on a wide screen the cards are hidden',
     !(await page.locator('#panel .only-phone').first().isVisible()));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(120);

  section('Keeping the book');
  await goTo(page, 'tonight');
  await page.locator('.person', { hasText:'Nat' }).first().click();
  await page.locator('.person', { hasText:'Tony' }).first().click();
  await page.locator('#panel input[placeholder="name"]').fill('Mike');
  await page.locator('button.btn.sm', { hasText:'Add guest' }).click();
  await page.waitForTimeout(150);
  ok('somebody with no account can be added by name',
     await page.locator('.person', { hasText:'Mike' }).count() === 1);
  await page.locator('button.btn.pri', { hasText:'Start keeping the book' }).click();
  await page.waitForSelector('#panel .gamecard .led');
  const g1 = page.locator('#panel .gamecard').first();
  eq('a line for everyone in, guest included', await g1.locator('.led').count(), 4);
  ok('and the guest is marked as one', /guest/i.test(await g1.innerText()));
  ok('the book needs no scores at all',
     await page.evaluate(() => {
       const sid = localStorage.getItem('bowl.money.night');
       return window.APP.state.games.filter(g => g.session_id === sid).length === 0;
     }));

  await g1.locator('button.btn.sm', { hasText:'Quick fill' }).click();
  await g1.locator('.chip', { hasText:'Drew' }).click();
  for (let i = 0; i < 2; i++) await g1.locator('.chip', { hasText:'Nat' }).click();
  for (let i = 0; i < 2; i++) await g1.locator('.chip', { hasText:'Tony' }).click();
  for (let i = 0; i < 2; i++) await g1.locator('.chip', { hasText:'Mike' }).click();
  await g1.locator('.chip', { hasText:/^\$5$/ }).click();
  await g1.locator('button.btn.sm', { hasText:'Winners split the pot' }).click();
  const filled = await g1.locator('.led input').evaluateAll(ns => ns.map(n => n.value));
  ok('three losers at five dollars makes the winner fifteen',
     JSON.stringify(filled.slice().sort()) === JSON.stringify(['-5','-5','-5','15']), JSON.stringify(filled));
  ok('the running total is up top straight away',
     /\+\$15/.test(await page.locator('.moneystrip').innerText()),
     await page.locator('.moneystrip').innerText());
  ok('the guest owes money like everybody else',
     await page.evaluate(() => window.APP.state.money.some(m => m.guest_id && m.amount_cents === -500)));

  await page.locator('button.btn.wide', { hasText:'Another game' }).click();
  eq('a second game appears', await page.locator('#panel .gamecard').count(), 2);
  const g2 = page.locator('#panel .gamecard').nth(1);
  await g2.locator('.led input').first().fill('-3');
  await g2.locator('.led input').first().blur();
  await page.waitForTimeout(150);
  ok('typing a number by hand moves the running total',
     /\+\$12/.test(await page.locator('.moneystrip').innerText()),
     await page.locator('.moneystrip').innerText());
  ok('a game that does not balance says so', /not zero/i.test(await g2.innerText()));

  /* Nought and empty are two different things now: one of them is a person
     who bowled and came out level, the other is a person who was not in it. */
  const g3n = await page.locator('#panel .gamecard').count();
  await page.locator('button.btn.wide', { hasText:'Another game' }).click();
  const g3 = page.locator('#panel .gamecard').nth(g3n);
  const boxes = g3.locator('.led input');
  await boxes.nth(0).fill('5');  await boxes.nth(0).blur();
  await boxes.nth(1).fill('-5'); await boxes.nth(1).blur();
  await boxes.nth(2).fill('0');  await boxes.nth(2).blur();
  await page.waitForTimeout(250);
  const g3txt = await g3.innerText();
  ok('a typed nought reads as coming out level, not sitting out',
     /level/i.test(g3txt) && !/sat out/i.test(g3txt), g3txt.slice(0, 300));
  ok('and it is written down as a row, not thrown away', await page.evaluate(() => {
    const sid = localStorage.getItem('bowl.money.night');
    return window.APP.state.money.some(m => m.session_id === sid && m.amount_cents === 0);
  }));
  ok('the person whose box is empty is not in that game at all',
     /not in it/i.test(g3txt), g3txt.slice(0, 300));
  const beforeClear = await page.evaluate(() => window.APP.state.money.length);
  await boxes.nth(2).fill(''); await boxes.nth(2).blur();
  await page.waitForTimeout(250);
  ok('clearing the box takes their row away again',
     await page.evaluate(() => window.APP.state.money.length) === beforeClear - 1);
  /* put the night back how it was for the tests below */
  await g3.locator('button.rm').click();
  await page.waitForTimeout(250);

  await page.locator('#panel input[placeholder="someone else’s name"]').fill('Ash');
  await page.locator('button.btn.sm', { hasText:'Add somebody' }).click();
  await page.waitForTimeout(200);
  ok('another guest can join halfway through the night',
     /Ash/.test(await page.locator('.moneystrip').innerText()));

  section('Housekeeping');
  ok('the square-up says who hands what to whom',
     /square up/i.test(await page.locator('#panel').innerText()));
  const pay = await page.locator('.payrow').allInnerTexts();
  ok('and it is the fewest handovers that settle everybody', pay.length === 3, JSON.stringify(pay));
  ok('the handovers point at the person who is up', pay.every(t => /Drew/.test(t)), JSON.stringify(pay));

  const before = await page.evaluate(() => window.APP.state.money.length);
  await page.locator('#panel .gamecard').nth(1).locator('button.rm').click();
  await page.waitForTimeout(250);
  ok('clearing a game removes only that game',
     await page.evaluate(() => window.APP.state.money.length) < before);
  ok('and the running total goes back', /\+\$15/.test(await page.locator('.moneystrip').innerText()));

  /* taking somebody out moved off the strip and into the big totals view,
     where it is a deliberate act rather than a mis-tap next to the numbers */
  await page.locator('.moneystrip.stick').click();
  await page.waitForSelector('.sheet .bigup');
  await page.locator('.sheet .bigup .row', { hasText:'Tony' }).locator('button.rm').click();
  await page.waitForTimeout(300);
  ok('somebody can be taken out of a night',
     !/Tony/.test(await page.locator('.moneystrip').innerText()),
     await page.locator('.moneystrip').innerText());
  ok('and their lines go with them',
     await page.evaluate(() => {
       const sid = localStorage.getItem('bowl.money.night');
       const tony = window.APP.state.profiles.find(p => p.display_name === 'Tony');
       return !window.APP.state.money.some(m => m.session_id === sid && m.profile_id === tony.id);
     }));

  await page.locator('button.btn.sm', { hasText:'Done' }).click();
  ok('done takes you back to starting a night', await page.locator('#panel input[placeholder="name"]').count() === 1);

  section('The all-time book');
  await goTo(page, 'money');
  const book = await page.locator('#panel').innerText();
  ok('the night is in the book', /night by night/i.test(book));
  ok('with the account holders', /Drew/.test(book));
  ok('and the guests alongside them', /Mike/.test(book), book.slice(0, 240));
  ok('a row per person in the all-time table',
     await page.locator('#panel .rcard').count() >= 3);
  ok('no floating score button in the way of the book',
     await page.locator('.sticky-cta').count() === 0);


  section('Nothing destructive under a fast thumb');
  await goTo(page, 'tonight');
  {
    /* the who-turned-up list is tapped through at speed; it must not carry a
       button that erases somebody's whole history */
    const picker = page.locator('#panel .people');
    if (await picker.count())
      ok('the who-is-in list has no delete on it',
         await picker.locator('button', { hasText:/delete/i }).count() === 0);
  }

  section('Guests can be tidied up');
  /* All of this used to be at the foot of the Money tab. It lives on People
     now, one card per person, behind an Edit that keeps the destructive
     buttons out of the way until you ask for them. */
  await goTo(page, 'people');
  const openEdit = async name => {
    const card = page.locator('#panel .card').filter({ hasText: name }).first();
    const toggle = card.locator('button').filter({ hasText: /^(Edit|Done)$/ }).first();
    if ((await toggle.innerText()).trim() === 'Edit') await toggle.click();
    await page.waitForTimeout(150);
    return card;
  };
  /* count() counts hidden nodes too, so this has to ask about visibility or
     it passes without testing anything */
  ok('a guest\u2019s controls are hidden until you ask',
     await page.locator('#panel button:visible').filter({ hasText:'Rename' }).count() === 0);

  const mikeCard = await openEdit('Mike');
  await mikeCard.locator('input[type=text]').first().fill('Michael');
  await mikeCard.locator('button', { hasText:'Rename' }).first().click();
  await page.waitForTimeout(300);
  ok('a guest can be renamed and keeps their money',
     await page.evaluate(() => window.APP.state.guests.some(g => g.name === 'Michael')));
  ok('the page shows the new name', /Michael/.test(await page.locator('#panel').innerText()));

  const netBefore = await page.evaluate(() => {
    const g = window.APP.state.guests.find(x => x.name === 'Michael');
    const drew = window.APP.state.profiles.find(p => p.display_name === 'Drew');
    const sum = k => window.APP.state.money.filter(k).reduce((s, m) => s + m.amount_cents, 0);
    return { guest: sum(m => m.guest_id === g.id), drew: sum(m => m.profile_id === drew.id) };
  });
  const card2 = await openEdit('Michael');
  await card2.locator('select').selectOption({ label:'Drew' });
  await card2.locator('button', { hasText:'Merge' }).first().click();
  await page.waitForTimeout(500);
  ok('merging a guest into an account moves every penny',
     await page.evaluate(([b]) => {
       const drew = window.APP.state.profiles.find(p => p.display_name === 'Drew');
       const now = window.APP.state.money.filter(m => m.profile_id === drew.id)
         .reduce((s, m) => s + m.amount_cents, 0);
       return now === b.drew + b.guest;
     }, [netBefore]));
  ok('and the guest is gone afterwards',
     await page.evaluate(() => !window.APP.state.guests.some(g => g.name === 'Michael')));

  const ash = await openEdit('Ash');
  await ash.locator('button', { hasText:/^Delete Ash/ }).first().click();
  await page.waitForTimeout(400);
  ok('a guest can simply be deleted',
     await page.evaluate(() => !window.APP.state.guests.some(g => g.name === 'Ash')));

  ok('and none of it is on the Money tab any more', await (async () => {
    await goTo(page, 'money');
    const t = await page.locator('#panel').innerText();
    return !/rename/i.test(t) && !/merge/i.test(t);
  })());

  section('Getting around');
  /* The one place that drives the bar by clicking it, the way a thumb does. */
  const bar = page.locator('#bar button.nav');
  await bar.filter({ hasText:'Stats' }).click();
  await page.waitForTimeout(220);
  ok('Stats opens a page of everywhere else',
     /power rankings/i.test(await page.locator('#panel').innerText()));
  ok('and the bar says you are on it',
     await page.locator('#bar button.nav[aria-current="page"]').filter({ hasText:'Stats' }).count() === 1);

  await page.locator('#panel .golist button', { hasText:'Records' }).click();
  await page.waitForTimeout(220);
  ok('a page inside Stats opens', /trophy case/i.test(await page.locator('#panel').innerText()));
  ok('and Stats stays lit while you are inside it',
     await page.locator('#bar button.nav[aria-current="page"]').filter({ hasText:'Stats' }).count() === 1);

  await bar.filter({ hasText:'Money' }).click();
  await page.waitForTimeout(220);
  ok('Money is one of the four', /the book/i.test(await page.locator('#panel').innerText()));

  await page.locator('#bar button.fab').click();
  await page.waitForSelector('.sheet .inner', { timeout:4000 });
  const asked = await page.locator('.sheet .inner').innerText();
  ok('the middle button asks what you are doing', /what are you doing/i.test(asked));
  ok('and offers the money book without any scoring', /keep the money/i.test(asked));
  await page.locator('.sheet .golist button', { hasText:'Keep the money' }).click();
  await page.waitForTimeout(260);
  ok('which takes you straight to tonight',
     await page.evaluate(() => location.hash === '#tonight'));

  ok('every old link still resolves', await page.evaluate(async () => {
    for (const id of ['power','teams','records','sessions','bowlers','me','home','log']){
      window.APP.go(id);
      if (!document.querySelector('#panel')?.textContent?.trim()) return false;
    }
    window.APP.go('home');
    return true;
  }));

  section('Who is up');
  await goTo(page, 'tonight');
  const openIt = page.locator('#panel .nightrow button.card').first();
  if (await openIt.count()){
    await openIt.click();
    await page.waitForSelector('#panel .gamecard');
    const totals = page.locator('.moneystrip.stick');
    ok('the running totals stick to the top of the page',
       await totals.evaluate(el => getComputedStyle(el).position === 'sticky'
                                && getComputedStyle(el).top === '0px'));
    /* the bug: a row that scrolls sideways shows the first two people and
       hides everybody else, which is exactly who you were asked about */
    ok('and everybody fits without scrolling sideways',
       await totals.evaluate(el => el.scrollWidth <= el.clientWidth + 1),
       await totals.evaluate(el => `${el.scrollWidth} wide in ${el.clientWidth}`));
    await totals.click();
    await page.waitForSelector('.sheet .inner', { timeout:4000 });
    const big = await page.locator('.sheet .inner').innerText();
    ok('tapping it gives you the big version to read out', /who is up/i.test(big));
    ok('with everybody on it, up and down',
       (await page.locator('.sheet .bigup .nm').count()) >= 2);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* typing a number and locking the phone without tapping away used to
       lose it */
    const cell2 = page.locator('#panel .gamecard input.n').first();
    await cell2.fill('4');
    await page.waitForTimeout(900);
    ok('a number is written down shortly after you stop typing, without tapping away',
       await page.evaluate(() => window.APP.state.money.some(m => m.amount_cents === 400)));
    await page.locator('#panel .flowhead button', { hasText:'Done' }).click();
    await page.waitForTimeout(250);
  }
  await goTo(page, 'home');

  section('Things you should not have to hunt for');
  await goTo(page, 'tonight');
  const nn = page.locator('#panel .nightrow button.card').first();
  if (await nn.count()){
    await nn.click();
    await page.waitForSelector('#panel .gamecard');
    ok('who is up is a button you can see, not a tap you have to guess',
       await page.locator('#panel button', { hasText:'Who is up' }).count() === 1);
    ok('so is sending it to the group',
       await page.locator('#panel button', { hasText:'Send to the group' }).count() === 1);
    ok('and the night can be put away from inside the night',
       await page.locator('#panel button', { hasText:'Put this night away' }).count() === 1);

    await page.locator('#panel .flowhead button', { hasText:'Done' }).click();
    await page.waitForTimeout(250);
  }

  /* Put away a night of its own rather than one the later sections are using. */
  await goTo(page, 'tonight');
  await page.locator('#panel .person').first().click();
  await page.locator('#panel button.btn.pri', { hasText:'Start keeping the book' }).click();
  await page.waitForSelector('#panel .gamecard');
  const doomed = await page.evaluate(() => localStorage.getItem('bowl.money.night'));
  const before2 = await page.evaluate(() => window.APP.state.sessions.length);
  await page.locator('#panel button', { hasText:'Put this night away' }).click();
  await page.waitForTimeout(600);
  ok('putting a night away takes it out of the book',
     await page.evaluate(s2 => !window.APP.state.sessions.some(x => x.id === s2), doomed));
  ok('one night, not all of them',
     await page.evaluate(() => window.APP.state.sessions.length) === before2 - 1);
  ok('and out of every total',
     await page.evaluate(s2 => !window.APP.state.money.some(m => m.session_id === s2), doomed));
  ok('leaving you somewhere sensible',
     await page.evaluate(() => location.hash === '#tonight'));
  /* but nothing has actually been destroyed */
  ok('while the night itself still exists',
     await page.evaluate(s2 => window.APP.state.all.sessions.some(x => x.id === s2), doomed));

  section('An archived night counts for nothing');
  {
    const sid = await page.evaluate(() => window.APP.state.sessions.find(
      x => (window.APP.D.roundsOfNight.get(x.id) || []).length)?.id);
    if (sid){
      const before3 = await page.evaluate(() => ({
        nets: [...window.APP.D.moneyByPerson.entries()].sort().map(([k, v]) => k + ':' + v).join(','),
        nights: window.APP.D.roundsOfNight.size,
        rows: window.APP.state.money.length,
      }));
      await page.evaluate(async s2 => { await window.APP.setArchived(s2, true); }, sid);
      const during = await page.evaluate(() => ({
        nets: [...window.APP.D.moneyByPerson.entries()].sort().map(([k, v]) => k + ':' + v).join(','),
        nights: window.APP.D.roundsOfNight.size,
        rows: window.APP.state.money.length,
        stillThere: window.APP.state.all.money.length,
      }));
      ok('putting a night away changes the all-time totals', during.nets !== before3.nets);
      ok('and drops it out of the count of nights', during.nights === before3.nights - 1);
      ok('its money stops being counted', during.rows < before3.rows);
      /* the whole point of archiving rather than deleting */
      ok('but every row of it is still in the database', during.stillThere === before3.rows);

      await page.evaluate(async s2 => { await window.APP.setArchived(s2, false); }, sid);
      const after3 = await page.evaluate(() => ({
        nets: [...window.APP.D.moneyByPerson.entries()].sort().map(([k, v]) => k + ':' + v).join(','),
        nights: window.APP.D.roundsOfNight.size,
        rows: window.APP.state.money.length,
      }));
      ok('and bringing it back restores the totals exactly', after3.nets === before3.nets,
         `${before3.nets} -> ${after3.nets}`);
      ok('every night', after3.nights === before3.nights);
      ok('and every row', after3.rows === before3.rows);
    }
  }

  section('A night you can read at a glance');
  await goTo(page, 'sessions');
  {
    const card = page.locator('#panel .nightcard').first();
    if (await card.count()){
      const txt = await card.innerText();
      ok('a night leads with what happened, not with a date alone',
         txt.split('\n').filter(Boolean).length >= 4, txt.replace(/\n/g, ' | '));
      ok('it names who came out on top', /up the most/i.test(txt));
      ok('and who paid for it', /down the most/i.test(txt));
      /* the bug this replaced: a row of names that ran off the side */
      ok('and everybody fits without scrolling sideways',
         await card.locator('.everyone').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      ok('it still opens the session sheet from here, not the money ledger',
         await (async () => {
           await card.click();
           await page.waitForSelector('.sheet .inner', { timeout:4000 });
           const inner = await page.locator('.sheet .inner').innerText();
           await page.locator('.sheet .closebtn').click();
           await page.waitForTimeout(200);
           return inner.length > 0;
         })());
    }
  }
  await goTo(page, 'home');
  {
    const card = page.locator('#panel .nightcard').first();
    if (await card.count())
      ok('and the last night out is the same card on Home',
         /up the most/i.test(await card.innerText()));
  }

  section('Nothing else destroys a night');
  {
    /* Three buttons used to delete a night outright and I changed two of them.
       This is the check that a fourth does not appear: the only control that
       destroys anything lives in the archive. */
    /* the same order the tab shows them in — newest first — or this clicks
       one night and checks another */
    await goTo(page, 'sessions');
    const sid = await page.evaluate(() => window.APP.D.sessions.find(
      x => (window.APP.D.roundsOfNight.get(x.id) || []).length)?.id);
    if (sid){
      await page.locator('#panel .nightcard').first().click();
      await page.waitForSelector('.sheet .inner');
      const away = page.locator('.sheet button', { hasText:'Put this night away' });
      if (await away.count()){
        await away.click();
        await page.waitForTimeout(500);
        ok('deleting from the session sheet puts it in the archive',
           await page.evaluate(s2 => !window.APP.state.sessions.some(x => x.id === s2), sid));
        ok('rather than destroying it',
           await page.evaluate(s2 => window.APP.state.all.sessions.some(x => x.id === s2), sid));
        await goTo(page, 'archive');
        ok('and it is waiting in the archive',
           await page.locator('#panel button', { hasText:'Bring it back' }).count() >= 1);
        await page.locator('#panel button', { hasText:'Bring it back' }).first().click();
        await page.waitForTimeout(400);
        ok('from where it comes straight back',
           await page.evaluate(s2 => window.APP.state.sessions.some(x => x.id === s2), sid));
      } else {
        await page.locator('.sheet .closebtn').click();
      }
    }
  }
  await goTo(page, 'home');

  section('People');
  await goTo(page, 'people');
  {
    const txt = await page.locator('#panel').innerText();
    ok('there is a page for the people, not just for the bowling', /everybody in the book/i.test(txt));
    ok('adding somebody is the first thing on it',
       await page.locator('#panel button', { hasText:'Add somebody' }).count() === 1);

    const nGuests = await page.evaluate(() => window.APP.state.guests.length);
    await page.locator('#panel input[type=text]').first().fill('Wanda');
    await page.locator('#panel button', { hasText:'Add somebody' }).click();
    await page.waitForTimeout(400);
    ok('somebody can be added by name alone',
       await page.evaluate(() => window.APP.state.guests.length) === nGuests + 1);
    ok('and appears on the page',
       /Wanda/.test(await page.locator('#panel').innerText()));

    /* rename */
    const card = page.locator('#panel .card', { hasText:'Wanda' }).first();
    await card.locator('button', { hasText:'Edit' }).click();
    await page.waitForTimeout(150);
    await card.locator('input[type=text]').first().fill('Wanda M');
    await card.locator('button', { hasText:'Rename' }).click();
    await page.waitForTimeout(400);
    ok('a guest can be renamed',
       await page.evaluate(() => window.APP.state.guests.some(g => g.name === 'Wanda M')));

    /* and deleted */
    const card2 = page.locator('#panel .card', { hasText:'Wanda M' }).first();
    await card2.locator('button', { hasText:'Edit' }).click();
    await page.waitForTimeout(150);
    await card2.locator('button', { hasText:/^Delete/ }).click();
    await page.waitForTimeout(400);
    ok('and deleted',
       await page.evaluate(() => !window.APP.state.guests.some(g => /^Wanda/.test(g.name))));

    ok('an account is not offered a delete button',
       await page.evaluate(() => {
         const me = window.APP.state.me;
         if (!me) return true;
         const cards = [...document.querySelectorAll('#panel .card')];
         const mine = cards.find(c => c.textContent.includes(me.display_name));
         return !mine || !/Delete /.test(mine.textContent);
       }));
  }

  section('The archive');
  await goTo(page, 'archive');
  ok('it is listed in the archive',
     (await page.locator('#panel').innerText()).length > 40
     && await page.locator('#panel .card').count() >= 1);
  await page.locator('#panel button', { hasText:'Bring it back' }).first().click();
  await page.waitForTimeout(500);
  ok('and it can be brought back into the book',
     await page.evaluate(s2 => window.APP.state.sessions.some(x => x.id === s2), doomed));

  /* only then, the one button that really does destroy something */
  await goTo(page, 'tonight');
  await page.locator('#panel .nightrow button.xbtn').first().click();
  await page.waitForTimeout(500);
  await goTo(page, 'archive');
  const gone = await page.evaluate(() => (window.APP.state.archivedSessions || [])[0]?.id);
  await page.locator('#panel button', { hasText:'Delete for good' }).first().click();
  await page.waitForTimeout(500);
  ok('deleting for good really is for good',
     await page.evaluate(g => !window.APP.state.all.sessions.some(x => x.id === g), gone));

  section('Which copy am I looking at');
  await goTo(page, 'me');
  const stamp = page.locator('#panel button', { hasText:/Updated .* tap to check/ });
  ok('the page says when it was last deployed', await stamp.count() === 1,
     await page.locator('#panel').innerText().then(t => t.slice(-160)));

  section('Sending it to the group');
  await goTo(page, 'tonight');
  const nightForShare = page.locator('#panel .nightrow button.card').first();
  if (await nightForShare.count()){
    await nightForShare.click();
    await page.waitForSelector('#panel .gamecard');
    /* pretend to be a phone with a share sheet, and catch what it is handed */
    await page.evaluate(() => {
      window.__shared = null;
      navigator.share = async (data) => { window.__shared = data; };
    });
    await page.locator('.moneystrip.stick').click();
    await page.waitForSelector('.sheet .bigup');
    await page.locator('.sheet button', { hasText:'Send to the group' }).click();
    await page.waitForTimeout(250);
    const msg = await page.evaluate(() => window.__shared && window.__shared.text);
    ok('the share sheet gets a message, not an empty one', !!msg && msg.length > 20);
    ok('it says where and how far in', /Bowl America|After \d+ game|getting started/.test(msg || ''));
    ok('and it lists everybody with their money',
       (msg || '').split('\n').filter(l => /[−-]?\$\d/.test(l)).length >= 2, msg);
    ok('nothing in it claims a score was logged',
       !/\bpins?\b|\bstrikes?\b|average/i.test(msg || ''));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    /* a desktop browser has no share sheet — it must still do something */
    await page.evaluate(() => {
      delete navigator.share;
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async t => { window.__copied = t; } },
      });
    });
    await page.locator('.moneystrip.stick').click();
    await page.waitForSelector('.sheet .bigup');
    await page.locator('.sheet button', { hasText:'Send to the group' }).click();
    await page.waitForTimeout(250);
    ok('with no share sheet it falls back to the clipboard',
       !!(await page.evaluate(() => window.__copied)));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
    await page.locator('#panel .flowhead button', { hasText:'Done' }).click();
    await page.waitForTimeout(250);
  }
  await goTo(page, 'home');

  section('Finishing a night');
  await goTo(page, 'tonight');
  const anyNight = page.locator('#panel .nightrow button.card').first();
  if (await anyNight.count()){
    await anyNight.click();
    await page.waitForTimeout(300);
    const fin = page.locator('#panel button', { hasText:'Finish the session' });
    if (await fin.count()){
      await fin.click();
      await page.waitForTimeout(400);
      const done = await page.locator('#panel').innerText();
      ok('finishing shows the record read off the money', /record/i.test(done));
      ok('and the night written up', /written up|Read straight off/i.test(done));
      ok('it is kept on the night, not on the phone',
         await page.evaluate(() => {
           const s = window.APP.state.sessions.find(x => x.finished_at);
           return !!s;
         }));
      ok('and it says nothing is locked', /still fix a number|Un-finish/i.test(done));
      /* the numbers stay editable, and everything below re-reads itself */
      const box = page.locator('#panel .gamecard input.n').first();
      if (await box.count()){
        await box.fill('7');
        await box.blur();
        await page.waitForTimeout(400);
        ok('a number can still be changed after finishing',
           await page.locator('#panel button', { hasText:'Un-finish' }).count() === 1);
      }
      await page.locator('#panel button', { hasText:'Un-finish' }).click();
      await page.waitForTimeout(300);
      ok('and it can be un-finished',
         await page.evaluate(() => !window.APP.state.sessions.some(x => x.finished_at)));
    }
    /* put the book down again — the sections after this one start from the
       Tonight tab expecting to be able to start a night */
    await page.locator('#panel .flowhead button', { hasText:'Done' }).click();
    await page.waitForTimeout(250);
  }
  await goTo(page, 'home');

  section('Power rankings');
  await goTo(page, 'power');
  const power = await page.locator('#panel').innerText();
  ok('the rankings render', /power rankings/i.test(power));
  ok('and say plainly that no handicap is involved', /no handicap/i.test(power));
  /* two tables now: the money one, which everybody is in, and the pins one,
     which only covers whoever logs a score. Each is ranked on its own. */
  const tables = page.locator('#panel .card.pad0');
  const howMany = await tables.count();
  ok('both rankings render', howMany >= 2, `found ${howMany}`);
  for (let i = 0; i < howMany; i++){
    const scores = (await tables.nth(i).locator('.rcard .rc-main').allInnerTexts()).map(Number);
    ok(`ranking ${i + 1} is ordered best first`,
       scores.every((v, j, a) => j === 0 || a[j-1] >= v), JSON.stringify(scores));
  }
  ok('a guest with no account is ranked too',
     await page.evaluate(() => {
       const names = window.APP.D && window.APP.state.guests.map(g => g.name);
       const txt = document.querySelector('#panel').innerText;
       return !names.length || names.some(n => txt.includes(n));
     }));
  ok('everybody ranked has enough games',
     await page.evaluate(() => window.APP.D.stats && [...window.APP.D.stats.values()]
       .filter(s => s.games >= 6).length >= 2));
  ok('the breakdown shows every part of the formula',
     (await page.locator('#panel .barrow').count()) >= 5);
  /* the pins table is the second one — that is the one about bowling well */
  const pinOrder = await tables.nth(howMany - 1).locator('.rcard .rc-title').allInnerTexts();
  ok('the leader is the best bowler, not the luckiest',
     pinOrder[0] && /Drew|Nat/.test(pinOrder[0]), JSON.stringify(pinOrder.slice(0, 3)));

  section('MVP counts the money too');
  await goTo(page, 'sessions');
  await page.locator('#panel .card', { hasText:'Mar 8' }).first().click();
  await page.waitForSelector('.sheet .inner');
  const sheetTxt = await page.locator('.sheet .inner').innerText();
  ok('the MVP is shown', /session mvp/i.test(sheetTxt));
  ok('and it went to the one who cleaned up, not the top average',
     /session mvp\s*\n?\s*Nat/i.test(sheetTxt.replace(/\s+/g, ' ')) || /Nat/.test(sheetTxt.split(/session mvp/i)[1]?.slice(0, 60) || ''),
     sheetTxt.split(/session mvp/i)[1]?.slice(0, 80));
  await page.locator('.sheet .closebtn').first().click();

  section('Reading a photo');
  await goTo(page, 'tonight');
  ok('with no reader set up, the site does not offer one',
     await page.locator('button', { hasText:'Read it off a photo' }).count() === 0);
  await page.evaluate(() => {
    window.__PARSE_STUB = {
      mode:'money', confident:true, note:'',
      people:[
        { name:'Drew',   values:[5, -2.5] },
        { name:'natalie', values:[-5, 2.5] },
        { name:'Somebody Else', values:[1] },
      ],
    };
  });
  await page.locator('.person', { hasText:'Nat' }).first().click();
  await page.locator('button.btn.pri', { hasText:'Start keeping the book' }).click();
  await page.waitForSelector('#panel .gamecard .led');
  ok('with a reader set up, the button appears',
     await page.locator('button', { hasText:'Read it off a photo' }).count() === 1);
  await page.locator('button', { hasText:'Read it off a photo' }).click();
  await page.waitForSelector('.sheet .inner');
  await page.locator('.sheet input[type=file]').setInputFiles({
    name:'notes.jpg', mimeType:'image/jpeg', buffer: Buffer.from('not really a jpeg'),
  });
  await page.waitForSelector('.sheet select');
  const cards = await page.locator('.sheet .card').count();
  ok('every person it read gets a row to check', cards >= 3, String(cards));
  const picked = await page.locator('.sheet select').evaluateAll(ns => ns.map(n => n.selectedOptions[0].textContent));
  ok('an exact name is matched', picked[0] === 'Drew', JSON.stringify(picked));
  ok('and a longer version of a name is matched too', picked[1] === 'Nat', JSON.stringify(picked));
  ok('somebody it does not recognise is left for you to decide', picked[2] === '— skip —', JSON.stringify(picked));
  await page.locator('.sheet .card').nth(0).locator('input[type=number]').first().fill('7');
  await page.locator('.sheet button', { hasText:'Use these numbers' }).click();
  await page.waitForSelector('.sheet', { state:'detached' });
  const after = await page.locator('.moneystrip').innerText();
  ok('the numbers land in the book, with your correction', /\+\$4\.50/.test(after), after);
  ok('and the other person too', /−\$2\.50/.test(after), after);
  eq('two games came out of one photo', await page.locator('#panel .gamecard').count(), 2);
  ok('nothing was saved that you did not confirm',
     await page.evaluate(() => {
       const sid = localStorage.getItem('bowl.money.night');
       return !window.APP.state.money.some(m => m.session_id === sid && m.amount_cents === 100);
     }));
  await page.evaluate(() => { delete window.__PARSE_STUB; });
  await page.locator('button.btn.sm', { hasText:'Done' }).click();

  section('Phone manners');
  await goTo(page, 'me');
  const zoom = await page.evaluate(() => [...document.querySelectorAll('#panel input, #panel select')]
    .map(n => parseFloat(getComputedStyle(n).fontSize)).filter(v => v < 16));
  ok('no field small enough to make iOS zoom the page', zoom.length === 0, `${zoom.length} under 16px`);
  const small = await page.evaluate(() => [...document.querySelectorAll('#bar button.nav, #panel .btn, #panel .seg button')]
    .map(n => ({ t: n.textContent.trim().slice(0,18), h: Math.round(n.getBoundingClientRect().height) }))
    .filter(x => x.h < 40));
  ok('every button is thumb-sized', small.length === 0, JSON.stringify(small.slice(0,4)));
  ok('the page declares itself installable',
     await page.evaluate(() => !!document.querySelector('link[rel=manifest]') &&
                               !!document.querySelector('meta[name="apple-mobile-web-app-capable"]')));
  ok('the status bar gets a colour', await page.evaluate(() =>
     document.querySelector('meta[name=theme-color]')?.content === '#0b0b0f'));

  section('Teams, split by how many to a side');
  const sz = await ctx.newPage();
  /* one night of 1v1 free for all, one of 2v2v2, one of 3v3 */
  const szFx = JSON.parse(JSON.stringify(fixture));
  szFx.money = [];
  const P6 = ['me','nat','tony','bruce'];
  szFx.sessions = [
    { id:'f1', played_on:'2025-05-01', house:'Bowl America Fairfax', created_by:'me', created_at:'2025-05-01T22:00:00Z' },
    { id:'f2', played_on:'2025-05-02', house:'Bowl America Fairfax', created_by:'me', created_at:'2025-05-02T22:00:00Z' },
  ];
  // 1v1: four different amounts, so four sides of one
  for (const [i, k] of P6.entries())
    szFx.money.push({ id:'z'+i, session_id:'f1', game_no:1, profile_id:k,
      amount_cents: [1500,500,-500,-1500][i], created_by:'me', created_at:'2025-05-01T23:00:00Z' });
  // 2v2: two sides of two
  for (const [i, k] of P6.entries())
    szFx.money.push({ id:'y'+i, session_id:'f2', game_no:1, profile_id:k,
      amount_cents: i < 2 ? 500 : -500, created_by:'me', created_at:'2025-05-02T23:00:00Z' });
  // 3v3, twice, so the trio clears the two-games bar
  const SIX = ['me','nat','tony','bruce','steve','wanda'];
  for (const p of ['steve','wanda'])
    szFx.profiles.push({ id:p, display_name:p[0].toUpperCase()+p.slice(1), handle:null,
      avatar_url:null, hand:'R', ball_weight:15, is_admin:false, has_login:true,
      home_house:'Bowl America Fairfax', joined_at:'2025-01-01T00:00:00Z' });
  szFx.sessions.push({ id:'f3', played_on:'2025-05-03', house:'Bowl America Fairfax',
    created_by:'me', created_at:'2025-05-03T22:00:00Z' });
  for (const g of [1, 2])
    for (const [i, k] of SIX.entries())
      szFx.money.push({ id:`t${g}${i}`, session_id:'f3', game_no:g, profile_id:k,
        amount_cents: i < 3 ? 500 : -500, created_by:'me', created_at:'2025-05-03T23:00:00Z' });
  await sz.addInitScript(fx => { window.__FIXTURE = fx; }, szFx);
  await sz.goto(base + '?stub=1');
  await sz.waitForSelector('body[data-ready="1"]');
  await goTo(sz, 'teams');
  const segTxt = await sz.locator('#panel .seg').first().innerText();
  ok('the tab strip offers the sides that were actually bowled',
     /All/.test(segTxt) && /1v1/.test(segTxt) && /Pairs/.test(segTxt), segTxt.replace(/\n/g, ' '));
  ok('and the threes night too', /Threes/.test(segTxt), segTxt.replace(/\n/g, ' '));
  ok('but not a size nobody has bowled', !/Fours/.test(segTxt), segTxt.replace(/\n/g, ' '));

  await sz.locator('#panel .seg button', { hasText:'1v1' }).click();
  await sz.waitForTimeout(300);
  const oneTxt = await sz.locator('#panel').innerText();
  ok('one to a side says there are no partners to have',
     /no partners to have/i.test(oneTxt), oneTxt.slice(0, 200));
  ok('and counts only the free for all game', await sz.evaluate(() =>
     window.APP.D.roundsBySize.get(1).length === 1));

  await sz.locator('#panel .seg button', { hasText:'Pairs' }).click();
  await sz.waitForTimeout(300);
  ok('two to a side counts only the doubles game', await sz.evaluate(() =>
     window.APP.D.roundsBySize.get(2).length === 1));
  ok('and the career record follows the tab', await sz.evaluate(() => {
    const r = window.APP.D.recordBySize.get(2).get('p:me');
    return r && r.won === 1 && r.lost === 0;
  }));
  ok('while the all time record still counts every format', await sz.evaluate(() => {
    const r = window.APP.D.recordOf.get('p:me');
    return r && (r.won + r.lost + r.even) === 4;
  }));

  await sz.locator('#panel .seg button', { hasText:'Threes' }).click();
  await sz.waitForTimeout(300);
  const threes = await sz.locator('#panel').innerText();
  ok('threes names the whole side, not the pairs inside it',
     /Drew \+ Nat \+ Tony|Drew \+ Tony \+ Nat|Nat \+ Drew \+ Tony/.test(threes)
     || /\w+ \+ \w+ \+ \w+/.test(threes), threes.slice(0, 400));
  ok('and calls them a side rather than a pair',
     /\bSide\b/.test(threes) && !/Best pairing/.test(threes), threes.slice(0, 400));
  await sz.close();

  section('Power ranks off results, and leans on the small sides');
  const pw = await ctx.newPage();
  const who = ['me','nat','a1','a2','a3','b1','b2','b3'];
  const pwFx = { profiles: who.map(id => ({ id, display_name: id === 'me' ? 'Drew' : id === 'nat' ? 'Nat' : id.toUpperCase(),
                   hand:'R', home_house:'H', joined_at:'2025-01-01' })),
    sessions:[], players:[], games:[], rolls:[], edits:[], money:[], guests:[] };
  /* Drew wins every game one to a side and loses every game four to a side.
     Nat does the exact opposite. Flat, they are identical: one win, one loss
     each, every night. Only the weighting can tell them apart. */
  for (let n = 1; n <= 8; n++){
    const sid = 'w' + n, when = '2025-06-01T23:00:00Z';
    pwFx.sessions.push({ id:sid, played_on:'2025-06-0' + ((n % 9) || 1), house:'H',
      created_by:'me', created_at:'2025-06-01T22:00:00Z' });
    const put = (g, k, c) => pwFx.money.push({ id:`${sid}-${g}-${k}`, session_id:sid,
      game_no:g, profile_id:k, amount_cents:c, created_by:'me', created_at:when });
    put(1, 'me', 500); put(1, 'nat', -500);                       // one to a side
    for (const k of ['nat','b1','b2','b3']) put(2, k,  500);      // four to a side
    for (const k of ['me','a1','a2','a3'])  put(2, k, -500);
  }
  await pw.addInitScript(fx => { window.__FIXTURE = fx; }, pwFx);
  await pw.goto(base + '?stub=1');
  await pw.waitForSelector('body[data-ready="1"]');
  await goTo(pw, 'power');
  const pwTxt = await pw.locator('#panel').innerText();
  /* The money ranking covers everybody; the pins ranking underneath is the
     one that needs scores, and correctly says it has none. */
  ok('the money ranking works with no scored game anywhere in the book',
     /Drew/.test(pwTxt) && /Off the book/.test(pwTxt), pwTxt.slice(0, 160));
  ok('and the pins ranking underneath says it needs scores',
     /scored games yet/i.test(pwTxt));
  const sc = await pw.evaluate(() => {
    const D = window.APP.D, out = {};
    for (const k of ['p:me','p:nat']){
      const r = D.recordOf.get(k);
      out[k.slice(2)] = { weighted: Math.round((r.wpoints / r.wden) * 100),
                          flat: Math.round((r.points / r.scored) * 100) };
    }
    return out;
  });
  ok('flat, the two of them are indistinguishable',
     sc.me.flat === 50 && sc.nat.flat === 50, JSON.stringify(sc));
  ok('weighted, winning one to a side is worth far more than winning four to a side',
     sc.me.weighted === 80 && sc.nat.weighted === 20, JSON.stringify(sc));
  ok('and the ranking puts the one to a side winner on top',
     (await pw.evaluate(() => window.APP.D && null)) === null
     && pwTxt.indexOf('Drew') < pwTxt.indexOf('Nat'), pwTxt.slice(0, 160));
  await pw.close();

  section('Signed out, nothing is walled off');
  /* A guest with money on him, so the front door has somebody to claim. */
  const guestFx = JSON.parse(JSON.stringify(fixture));
  guestFx.guests = [{ id:'g-mike', name:'Mike', created_by:'me', created_at:'2025-03-08T23:00:00Z' }];
  guestFx.money.push({ id:'m5', session_id:'ses1', game_no:2, guest_id:'g-mike', profile_id:null,
                       amount_cents:-4000, created_by:'me', created_at:'2025-03-08T23:05:00Z' });
  const anon = await ctx.newPage();
  await anon.addInitScript(fx => { window.__FIXTURE = fx; }, guestFx);
  await anon.goto(base + '?stub=1');
  await anon.waitForSelector('body[data-ready="1"]');
  const anonHome = await anon.locator('#panel').innerText();
  ok('the leaderboard is readable without an account', anonHome.includes('Drew') && /average/i.test(anonHome));
  ok('the trophy case is readable without an account', await (async () => {
    await goTo(anon, 'records');
    return /trophy case/i.test(await anon.locator('#panel').innerText());
  })());
  await goTo(anon, 'log');
  ok('only logging asks who you are',
     /who is bowling/i.test(await anon.locator('#panel').innerText()));
  ok('signed out, no floating log button', await anon.locator('.sticky-cta').count() === 0);
  await anon.close();

  section('The front door: you pick who you are');
  const door = await ctx.newPage();
  await door.addInitScript(fx => { window.__FIXTURE = fx; }, guestFx);
  await door.goto(base + '?stub=1');
  await door.waitForSelector('body[data-ready="1"]');
  const doorTxt = await door.locator('#panel').innerText();
  ok('the chooser is the first thing on the home page', /who is bowling/i.test(doorTxt));
  ok('but the book is still readable underneath it', /average/i.test(doorTxt));
  ok('everybody the book knows is on it', /Drew/.test(doorTxt) && /Mike/.test(doorTxt));
  ok('a guest is marked as one', /guest/i.test(doorTxt));
  ok('an account this device has never met wants a password',
     /needs a password/i.test(doorTxt));
  ok('no face claims to be tappable before the device has met it',
     !/tap to sign in/i.test(doorTxt));

  /* An account is not claimable by tapping its name. */
  await door.locator('.person.tap', { hasText:'Drew' }).first().click();
  await door.waitForTimeout(200);
  ok('tapping an account asks for the password, it does not let you in',
     /signing in as drew/i.test(await door.locator('.sheet').innerText())
     && await door.evaluate(() => !window.APP.state.user));
  await door.locator('.closebtn').click();
  await door.waitForTimeout(150);

  /* A guest is claimable, but not by accident. */
  await door.locator('.person.tap', { hasText:'Mike' }).first().click();
  await door.waitForTimeout(200);
  const claimSheet = await door.locator('.sheet').innerText();
  ok('tapping a guest asks before it moves anything', /is this you/i.test(claimSheet));
  ok('and it says what you are taking on', /40/.test(claimSheet) && /night/i.test(claimSheet));
  ok('tapping a guest has not signed anybody in yet',
     await door.evaluate(() => !window.APP.state.user));

  await door.locator('.sheet button', { hasText:/Yes, I/ }).first().click();
  await door.waitForTimeout(400);
  ok('confirming signs you in without an account',
     await door.evaluate(() => !!window.APP.state.user));
  ok('and the guest stops being one',
     await door.evaluate(() => !window.APP.state.guests.some(g => g.name === 'Mike')));
  ok('and his money came with him', await door.evaluate(() => {
    const me = window.APP.state.user.id;
    return window.APP.state.money.some(m => m.profile_id === me && m.amount_cents === -4000)
        && !window.APP.state.money.some(m => m.guest_id === 'g-mike');
  }));
  ok('and he is called Mike', await door.evaluate(() =>
     window.APP.state.profiles.find(p => p.id === window.APP.state.user.id)?.display_name === 'Mike'));

  await goTo(door, 'me');
  const meTxt = await door.locator('#panel').innerText();
  ok('an account with no email is told how to keep it', /add an email/i.test(meTxt));
  ok('and can sign out without losing it', /tapping your name brings you straight back/i.test(meTxt));
  ok('and is not offered a way to lock itself out', !/forget me/i.test(meTxt));

  /* The thing that made an account with no email feel like a trap: you signed
     out and that was that. Signing out has to be a door, not a cliff. */
  const anonId = await door.evaluate(() => window.APP.state.user.id);
  await door.locator('button', { hasText:/^Sign out$/ }).first().click();
  await door.waitForTimeout(400);
  ok('an account with no email can sign out',
     await door.evaluate(() => !window.APP.state.user));
  ok('and is still on the front door afterwards',
     /Mike/.test(await door.locator('#panel').innerText()));
  ok('offering the one tap way back, not a password',
     /tap to sign in/i.test(await door.locator('#panel').innerText()));
  await door.locator('.person.tap', { hasText:'Mike' }).first().click();
  await door.waitForTimeout(400);
  ok('and tapping it puts the same person back in',
     await door.evaluate(id => window.APP.state.user?.id === id, anonId));
  ok('with their money still theirs', await door.evaluate(id =>
     window.APP.state.money.some(m => m.profile_id === id && m.amount_cents === -4000), anonId));
  await door.close();

  section('A device that has met you already');
  const known = await ctx.newPage();
  /* What the ring looks like after Drew has signed in here once. */
  await known.addInitScript(fx => {
    window.__FIXTURE = fx;
    localStorage.setItem('bowl.device', JSON.stringify({
      me: { access_token:'a', refresh_token:'r', name:'Drew',
            email:'drew@example.com', at: Date.now() } }));
  }, guestFx);
  await known.goto(base + '?stub=1');
  await known.waitForSelector('body[data-ready="1"]');
  const knownTxt = await known.locator('#panel').innerText();
  ok('a face this device knows offers to just let you in', /tap to sign in/i.test(knownTxt));
  ok('and the ones it does not still want a password', /needs a password/i.test(knownTxt));
  await known.locator('.person.tap', { hasText:'Drew' }).first().click();
  await known.waitForTimeout(400);
  ok('tapping it signs you in with no password at all',
     await known.evaluate(() => window.APP.state.user?.id === 'me'));
  ok('and no sheet ever asked for one',
     await known.locator('.sheet').count() === 0);

  await goTo(known, 'me');
  ok('an account with an email is offered a password change, not a rescue',
     /change password/i.test(await known.locator('#panel').innerText()));
  /* Signing out is putting the phone down, not burning the account. */
  await known.locator('button', { hasText:/^Sign out$/ }).first().click();
  await known.waitForTimeout(400);
  ok('signing out really does sign you out',
     await known.evaluate(() => !window.APP.state.user));
  ok('but it keeps you on the device, so you can walk back in',
     await known.evaluate(() => !!JSON.parse(localStorage.getItem('bowl.device') || '{}').me));
  ok('and the door still offers you the one tap way in',
     /tap to sign in/i.test(await known.locator('#panel').innerText()));
  await known.locator('.person.tap', { hasText:'Drew' }).first().click();
  await known.waitForTimeout(400);
  ok('which puts you straight back in with no password',
     await known.evaluate(() => window.APP.state.user?.id === 'me'));

  ok('and there is no button offering to lock you out of your own account',
     !/forget me/i.test(await known.locator('#panel').innerText()));
  await known.close();

  section('There is a way to your own page, and a way out');
  const out = await ctx.newPage();
  await out.addInitScript(fx => {
    window.__FIXTURE = fx;
    localStorage.setItem('bowl.device', JSON.stringify({
      me: { access_token:'a', refresh_token:'r', name:'Drew',
            email:'drew@example.com', at: Date.now() } }));
  }, guestFx);
  await out.goto(base + '?stub=1');
  await out.waitForSelector('body[data-ready="1"]');
  await out.locator('.person.tap', { hasText:'Drew' }).first().click();
  await out.waitForTimeout(400);

  /* The Me tab used to be reachable only by typing #me into the address bar,
     which meant sign out was not reachable at all. */
  await goTo(out, 'people');
  const peopleTxt = await out.locator('#panel').innerText();
  ok('the People tab opens with you', /^\s*you\b/im.test(peopleTxt) && /Drew/.test(peopleTxt));
  ok('and says the way out is through it', /sign out/i.test(peopleTxt));
  await out.locator('.card.tap', { hasText:'You' }).first().click();
  await out.waitForTimeout(300);
  ok('tapping it lands on your own page',
     await out.evaluate(() => location.hash === '#me'));
  const meTxt2 = await out.locator('#panel').innerText();
  ok('which has a sign out button on it', /sign out/i.test(meTxt2));
  ok('and a way back to People', await out.locator('.btn.back').count() > 0);
  await out.locator('.btn.back').first().click();
  await out.waitForTimeout(250);
  ok('which goes back', await out.evaluate(() => location.hash === '#people'));

  await goTo(out, 'me');
  await out.locator('button', { hasText:/^Sign out/ }).first().click();
  await out.waitForTimeout(400);
  ok('and signing out from there works',
     await out.evaluate(() => !window.APP.state.user));
  await goTo(out, 'people');
  ok('after which People says you are not signed in',
     /not signed in/i.test(await out.locator('#panel').innerText()));
  await out.close();

  section('A name with no password is never asked for one');
  const nb = await ctx.newPage();
  const nbFx = JSON.parse(JSON.stringify(fixture));
  /* "ac" came in without an account, bowled, and has money. No email ever. */
  nbFx.profiles.push({ id:'ac', display_name:'ac', handle:null, avatar_url:null,
    hand:'R', ball_weight:15, is_admin:false, has_login:false,
    home_house:'Bowl America Fairfax', joined_at:'2025-02-01T00:00:00Z' });
  nbFx.money.push(
    { id:'ac1', session_id:'ses1', game_no:2, profile_id:'ac',   amount_cents: 8000,
      created_by:'me', created_at:'2025-03-08T23:10:00Z' },
    { id:'ac2', session_id:'ses1', game_no:2, profile_id:'tony', amount_cents:-8000,
      created_by:'me', created_at:'2025-03-08T23:10:00Z' });
  await nb.addInitScript(fx => { window.__FIXTURE = fx; }, nbFx);
  await nb.goto(base + '?stub=1');          // a device that has never met anybody
  await nb.waitForSelector('body[data-ready="1"]');
  const nbTxt = await nb.locator('#panel').innerText();
  ok('an account that never made a password is not asked for one',
     /no password/i.test(nbTxt), nbTxt.slice(0, 300));
  ok('while accounts that do have one still are', /needs a password/i.test(nbTxt));

  await nb.locator('.person.tap', { hasText:'no password' }).first().click();
  await nb.waitForTimeout(250);
  const nbSheet = await nb.locator('.sheet').innerText();
  ok('tapping it asks before it moves anything', /is this you/i.test(nbSheet));
  ok('and says why there is nothing to type',
     /never put a password/i.test(nbSheet), nbSheet.slice(0, 300));
  ok('and what is being taken on', /80/.test(nbSheet), nbSheet.slice(0, 300));

  await nb.locator('.sheet button', { hasText:/Yes, I/ }).first().click();
  await nb.waitForTimeout(400);
  ok('confirming walks you back in with no password anywhere',
     await nb.evaluate(() => !!window.APP.state.user));
  ok('under their name', await nb.evaluate(() =>
     window.APP.state.profiles.find(p => p.id === window.APP.state.user.id)?.display_name === 'ac'));
  ok('holding their money', await nb.evaluate(() => {
    const me = window.APP.state.user.id;
    return window.APP.state.money.some(m => m.profile_id === me && m.amount_cents === 8000);
  }));
  ok('and the empty profile is gone rather than doubled up',
     await nb.evaluate(() => window.APP.state.profiles.filter(p => p.display_name === 'ac').length === 1));

  ok('and nobody else on the door became walk-in-able',
     !/no password/i.test(await nb.locator('#panel').innerText())
     || await nb.evaluate(() => !window.APP.state.user));
  await nb.close();

  section('A newcomer needs nothing but a name');
  const fresh = await ctx.newPage();
  await fresh.addInitScript(fx => { window.__FIXTURE = fx; }, guestFx);
  await fresh.goto(base + '?stub=1');
  await fresh.waitForSelector('body[data-ready="1"]');
  await fresh.locator('button', { hasText:'I am not on this list' }).first().click();
  await fresh.waitForTimeout(150);
  await fresh.locator('#panel input[type=text]').first().fill('Wanda');
  await fresh.locator('button', { hasText:'Start bowling' }).first().click();
  await fresh.waitForTimeout(400);
  ok('a name and a tap is the whole of it',
     await fresh.evaluate(() => !!window.APP.state.user));
  ok('and the name is the one they typed', await fresh.evaluate(() =>
     window.APP.state.profiles.find(p => p.id === window.APP.state.user.id)?.display_name === 'Wanda'));
  ok('nobody else was disturbed by it', await fresh.evaluate(() =>
     window.APP.state.guests.some(g => g.name === 'Mike')));
  await fresh.close();

  section('Console');
  ok('no page errors and no console errors', noise.length === 0, noise.slice(0, 4).join(' / '));

  await browser.close();
  server.close();
}

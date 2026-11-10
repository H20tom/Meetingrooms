'use strict';

// Functionele smoke-test tegen een draaiende instantie.
// Gebruik:  node server/scripts/smoke-test.js [basis-url]
// Standaard http://localhost:8080 (de dev-server).
//
// Draai dit NOOIT tegen productie: de test maakt en verwijdert meetings in
// echte ruimtes. Hij weigert dan ook te draaien tegen een niet-lokale host
// tenzij ALLOW_REMOTE=1 is gezet.

const BASE = process.argv[2] || 'http://localhost:8080';
const ROOM = process.env.TEST_ROOM || 'bundled';

if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(BASE) && process.env.ALLOW_REMOTE !== '1') {
  console.error(`Weigert te draaien tegen ${BASE}. Zet ALLOW_REMOTE=1 als je dit echt wilt.`);
  process.exit(2);
}

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

async function api(path, { method = 'GET', body, cookie } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* geen JSON-body */ }
  return { status: res.status, json, headers: res.headers };
}

const iso = (d) => new Date(d).toISOString();
const inMinutes = (m) => new Date(Date.now() + m * 60000);

async function cleanup() {
  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });
  const r = await api(`/api/rooms/${ROOM}/scheduled`);
  for (const m of (r.json && r.json.data) || []) {
    await api(`/api/rooms/${ROOM}/scheduled/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
  }
}

async function main() {
  console.log(`Smoke-test tegen ${BASE} (ruimte: ${ROOM})`);
  await cleanup();

  // ---------------------------------------------------------------- basis
  section('Basis');
  const health = await api('/healthz');
  check('healthz meldt db up', health.json && health.json.ok === true && health.json.db === 'up',
    JSON.stringify(health.json));

  const rooms = await api('/api/rooms');
  const list = (rooms.json && rooms.json.data) || [];
  check('4 ruimtes', list.length === 4, `kreeg ${list.length}`);
  check('Edu Lab heet Edu Lab', list.some((r) => r.id === 'aquarium' && r.name === 'Edu Lab'),
    JSON.stringify(list.map((r) => r.name)));

  // -------------------------------------------------------- data-exposure
  section('Data-exposure');
  const qp = await api('/api/users/quickpick');
  const users = (qp.json && qp.json.data) || [];
  check('quickpick geeft gebruikers', users.length > 0);
  check('quickpick lekt geen e-mail', users.every((u) => u.email === undefined),
    JSON.stringify(users[0]));
  check('quickpick lekt geen rol', users.every((u) => u.role === undefined));
  check('quickpick lekt geen hash', users.every((u) => !('pin_hash' in u) && !('password_hash' in u)));

  const usersNoAuth = await api('/api/users');
  check('/api/users zonder sessie is 401', usersNoAuth.status === 401, `status ${usersNoAuth.status}`);

  const histNoAuth = await api('/api/history');
  check('/api/history zonder sessie is 401', histNoAuth.status === 401, `status ${histNoAuth.status}`);

  // -------------------------------------------------------------- boeken
  section('Boeken en status');
  const start = await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 30, email: 'smoke@h20.gg', name: 'Smoke Test', title: 'Testmeeting' },
  });
  check('meeting starten lukt', start.json && start.json.ok === true, JSON.stringify(start.json));

  const st = await api(`/api/rooms/${ROOM}/status`);
  const s = st.json && st.json.data;
  check('status is busy', s && s.status === 'busy', JSON.stringify(s));
  check('minutesLeft ongeveer 30', s && s.minutesLeft >= 29 && s.minutesLeft <= 30, `kreeg ${s && s.minutesLeft}`);

  const ext = await api(`/api/rooms/${ROOM}/extend`, { method: 'POST', body: { addMin: 15 } });
  check('verlengen lukt', ext.json && ext.json.ok === true, JSON.stringify(ext.json));
  const st2 = await api(`/api/rooms/${ROOM}/status`);
  check('verlengen telt door', st2.json.data.minutesLeft >= 44, `kreeg ${st2.json.data.minutesLeft}`);

  // ------------------------------------------------------------ titel-XSS
  section('Titel-sanitisatie');
  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });
  await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 10, email: 'smoke@h20.gg', title: '<img src=x onerror=alert(1)>Hoi' },
  });
  const xs = await api(`/api/rooms/${ROOM}/status`);
  const title = xs.json.data.title || '';
  check('titel bevat geen < of >', !/[<>]/.test(title), JSON.stringify(title));

  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });
  const longTitle = 'A'.repeat(500);
  await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 10, email: 'smoke@h20.gg', title: longTitle },
  });
  const lt = await api(`/api/rooms/${ROOM}/status`);
  check('titel wordt afgekapt op 120 tekens', (lt.json.data.title || '').length <= 120,
    `lengte ${(lt.json.data.title || '').length}`);
  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });

  // ---------------------------------------------------------- boeken op id
  section('Boeken via userId');
  const someone = users[0];
  const byId = await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 10, userId: someone.id, title: 'Via userId' },
  });
  check('boeken met userId lukt', byId.json && byId.json.ok === true, JSON.stringify(byId.json));
  const stId = await api(`/api/rooms/${ROOM}/status`);
  check('server vult e-mail zelf in', !!(stId.json.data.email && stId.json.data.email.includes('@')),
    JSON.stringify(stId.json.data.email));
  check('server vult naam zelf in', stId.json.data.name === someone.name,
    `${stId.json.data.name} vs ${someone.name}`);
  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });

  const bogus = await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 10, userId: 'u-bestaat-echt-niet' },
  });
  check('onbekend userId wordt geweigerd',
    bogus.json && bogus.json.ok === false && bogus.json.reason === 'unknown-user',
    JSON.stringify(bogus.json));

  // --------------------------------------------------------- invoervalidatie
  section('Invoervalidatie');
  const cases = [
    ['duur 0', { durationMin: 0, email: 'a@b.nl' }],
    ['duur negatief', { durationMin: -60, email: 'a@b.nl' }],
    ['duur als tekst', { durationMin: '30; DROP TABLE rooms', email: 'a@b.nl' }],
    ['duur enorm', { durationMin: 99999999, email: 'a@b.nl' }],
    ['duur ontbreekt', { email: 'a@b.nl' }],
    ['e-mail ongeldig', { durationMin: 30, email: 'geen-email' }],
    ['e-mail ontbreekt', { durationMin: 30 }],
    ['lege body', {}],
  ];
  for (const [label, body] of cases) {
    const r = await api(`/api/rooms/${ROOM}/start`, { method: 'POST', body });
    const rejected = r.json && r.json.ok === false;
    check(`weigert ${label}`, rejected, `status ${r.status} ${JSON.stringify(r.json)}`);
    if (!rejected) await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });
  }

  const badRoom = await api('/api/rooms/bestaat-niet/start', {
    method: 'POST',
    body: { durationMin: 30, email: 'a@b.nl' },
  });
  check('weigert onbekende ruimte', badRoom.json && badRoom.json.ok === false,
    `status ${badRoom.status} ${JSON.stringify(badRoom.json)}`);

  // -------------------------------------------------------------- plannen
  section('Plannen en conflicten');
  const pStart = inMinutes(120);
  const pEnd = inMinutes(180);
  const plan = await api(`/api/rooms/${ROOM}/schedule`, {
    method: 'POST',
    body: { startAt: iso(pStart), endAt: iso(pEnd), email: 'smoke@h20.gg', title: 'Gepland' },
  });
  check('inplannen lukt', plan.json && plan.json.ok === true, JSON.stringify(plan.json));
  const planId = plan.json && plan.json.meeting && plan.json.meeting.id;

  const overlap = await api(`/api/rooms/${ROOM}/schedule`, {
    method: 'POST',
    body: { startAt: iso(inMinutes(150)), endAt: iso(inMinutes(210)), email: 'smoke@h20.gg' },
  });
  check('overlappende planning geweigerd', overlap.json && overlap.json.ok === false,
    JSON.stringify(overlap.json));

  const past = await api(`/api/rooms/${ROOM}/schedule`, {
    method: 'POST',
    body: { startAt: iso(inMinutes(-120)), endAt: iso(inMinutes(-60)), email: 'smoke@h20.gg' },
  });
  check('planning in het verleden geweigerd', past.json && past.json.ok === false,
    JSON.stringify(past.json));

  const reversed = await api(`/api/rooms/${ROOM}/schedule`, {
    method: 'POST',
    body: { startAt: iso(inMinutes(300)), endAt: iso(inMinutes(240)), email: 'smoke@h20.gg' },
  });
  check('eindtijd voor starttijd geweigerd', reversed.json && reversed.json.ok === false,
    JSON.stringify(reversed.json));

  const tooLong = await api(`/api/rooms/${ROOM}/start`, {
    method: 'POST',
    body: { durationMin: 180, email: 'smoke@h20.gg' },
  });
  check('start die over een planning heen loopt wordt geweigerd',
    tooLong.json && tooLong.json.ok === false && !!tooLong.json.conflictWith,
    JSON.stringify(tooLong.json));
  check('geweigerde start noemt het maximum',
    tooLong.json && typeof tooLong.json.maxMinutes === 'number',
    JSON.stringify(tooLong.json));
  if (tooLong.json && tooLong.json.ok) await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });

  if (planId) {
    const del = await api(`/api/rooms/${ROOM}/scheduled/${encodeURIComponent(planId)}`, { method: 'DELETE' });
    check('geplande meeting verwijderen lukt', del.json && del.json.ok === true, JSON.stringify(del.json));
  }

  // ------------------------------------------------------- gelijktijdigheid
  section('Gelijktijdigheid');
  await cleanup();
  const burst = await Promise.all(
    Array.from({ length: 8 }, (_, i) => api(`/api/rooms/${ROOM}/start`, {
      method: 'POST',
      body: { durationMin: 30, email: `race${i}@h20.gg`, title: `Race ${i}` },
    })),
  );
  const okCount = burst.filter((r) => r.json && r.json.ok === true).length;
  check('8 gelijktijdige starts leveren precies 1 boeking op', okCount === 1,
    `${okCount} van de 8 slaagden — de laatste overschrijft de vorige`);
  await api(`/api/rooms/${ROOM}/end`, { method: 'POST' });

  // ------------------------------------------------------------ 404 en body
  section('Randgevallen');
  const nf = await api('/api/bestaat-niet');
  check('onbekend endpoint geeft 404', nf.status === 404, `status ${nf.status}`);

  const huge = await fetch(`${BASE}/api/rooms/${ROOM}/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ durationMin: 30, email: 'a@b.nl', title: 'x'.repeat(200000) }),
  }).then((r) => r.status).catch(() => 'netwerkfout');
  check('te grote body wordt geweigerd', huge === 413 || huge === 400,
    `status ${huge} (dev-server heeft geen body-limiet; productie via server/index.js wel)`);

  await cleanup();

  // ------------------------------------------------------------- resultaat
  console.log(`\n${passed} geslaagd, ${failed} gefaald`);
  if (failures.length) {
    console.log('\nGefaald:');
    for (const f of failures) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error('\nTest afgebroken:', err);
  process.exit(2);
});

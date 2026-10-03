// Tests for the push server.
//   1. Unit: our aes128gcm output decrypts with http_ece (an independent
//      implementation), and the VAPID JWT verifies with the public key.
//   2. End-to-end (needs `wrangler dev` on :8787 with ALLOW_ANY_PUSH_HOST=1):
//      schedule → a mock push service receives an encrypted push on time;
//      cancel → nothing arrives; bad origin / endsAt are rejected.
import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import ece from 'http_ece';
import { encryptPayload, sendPush, b64urlDecode } from '../src/worker.js';

const results = [];
const check = (name, ok, extra) => { results.push({ name, ok: !!ok }); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : '')); };

// A fake browser push subscription: an ECDH key pair + auth secret.
function makeSubscription(endpoint) {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    ua, auth,
    sub: { endpoint, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } }
  };
}
const decrypt = (s, body) => ece.decrypt(Buffer.from(body), { version: 'aes128gcm', privateKey: s.ua, authSecret: s.auth }).toString();

const vars = Object.fromEntries(fs.readFileSync('.dev.vars', 'utf8').trim().split('\n').map((l) => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).replace(/^'(.*)'$/, '$1')];
}));
const toml = fs.readFileSync('wrangler.toml', 'utf8');
const env = {
  VAPID_PRIVATE_JWK: vars.VAPID_PRIVATE_JWK,
  VAPID_PUBLIC_KEY: toml.match(/VAPID_PUBLIC_KEY = "([^"]+)"/)[1],
  VAPID_SUBJECT: 'https://original2412.github.io/lift/'
};

// ---------- unit ----------
{
  const s = makeSubscription('https://example.invalid/x');
  const msg = JSON.stringify({ web_push: 8030, notification: { title: 'Rest over', body: 'Bench · set 2: 60 kg × 8' } });
  const body = await encryptPayload(s.sub.keys, new TextEncoder().encode(msg));
  let out = null;
  try { out = decrypt(s, body); } catch (e) { out = 'ERR ' + e.message; }
  check('aes128gcm payload decrypts with http_ece', out === msg, out === msg ? '' : out);
}
{
  // Capture what sendPush would send, then verify the VAPID signature.
  let captured;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => { captured = { url, init }; return new Response('', { status: 201 }); };
  const s = makeSubscription('https://web.push.apple.com/QXBwbGU');
  await sendPush(s.sub, '{"hi":1}', env);
  globalThis.fetch = realFetch;
  const auth = captured.init.headers.Authorization;
  const [, jwt, k] = auth.match(/^vapid t=([^,]+), k=(.+)$/);
  const [h, c, sig] = jwt.split('.');
  const pub = b64urlDecode(k);
  const key = crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: Buffer.from(pub.slice(1, 33)).toString('base64url'), y: Buffer.from(pub.slice(33)).toString('base64url') }, format: 'jwk' });
  const ok = crypto.verify('sha256', Buffer.from(h + '.' + c), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url'));
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  check('VAPID JWT signature verifies', ok);
  check('VAPID aud = push service origin', claims.aud === 'https://web.push.apple.com', claims.aud);
  check('headers: aes128gcm + TTL + urgency', captured.init.headers['Content-Encoding'] === 'aes128gcm' && captured.init.headers.TTL && captured.init.headers.Urgency === 'high');
  check('encrypted body decrypts', decrypt(s, captured.init.body) === '{"hi":1}');
}

// ---------- end-to-end against wrangler dev ----------
const BASE = 'http://127.0.0.1:8787';
const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ORIGIN = 'https://original2412.github.io';
const up = await fetch(BASE, { method: 'OPTIONS' }).then(() => true, () => false);
if (!up) {
  console.log('SKIP end-to-end: wrangler dev not running on :8787');
} else {
  const received = [];
  const mock = http.createServer((req, res) => {
    if (req.url === '/certs') {
      const jwk = rsa.publicKey.export({ format: 'jwk' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [Object.assign(jwk, { kid: 'k1', alg: 'RS256', use: 'sig' })] }));
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ at: Date.now(), path: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(201); res.end(); });
  });
  await new Promise((r) => mock.listen(8199, '127.0.0.1', r));
  const post = (path, data, origin = ORIGIN) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(data) });

  const s1 = makeSubscription('http://127.0.0.1:8199/device1');
  const endsAt = Date.now() + 2500;
  const r1 = await post('/schedule', { id: 'testdevice1', subscription: s1.sub, endsAt, title: 'Rest over — next set', body: 'Bench Press · set 2: 60 kg × 8', url: ORIGIN + '/lift/#/workout' });
  check('schedule accepted', r1.status === 200 && r1.headers.get('access-control-allow-origin') === ORIGIN);

  const s2 = makeSubscription('http://127.0.0.1:8199/device2');
  await post('/schedule', { id: 'testdevice2', subscription: s2.sub, endsAt: Date.now() + 2000, body: 'x' });
  const rc = await post('/cancel', { id: 'testdevice2' });
  check('cancel accepted', rc.status === 200);

  // reschedule device 3 (+15s style): only the later time should fire
  const s3 = makeSubscription('http://127.0.0.1:8199/device3');
  await post('/schedule', { id: 'testdevice3', subscription: s3.sub, endsAt: Date.now() + 1500, body: 'old' });
  await post('/schedule', { id: 'testdevice3', subscription: s3.sub, endsAt: Date.now() + 3500, body: 'new' });

  check('wrong origin rejected', (await post('/schedule', { id: 'testdevice9', subscription: s1.sub, endsAt }, 'https://evil.example')).status === 403);
  check('endsAt too far rejected', (await post('/schedule', { id: 'testdevice9', subscription: s1.sub, endsAt: Date.now() + 3600e3 })).status === 400);
  check('bad id rejected', (await post('/schedule', { id: 'x', subscription: s1.sub, endsAt })).status === 400);

  // ---- backups ----
  const bid = crypto.randomBytes(32).toString('hex');
  const box = (n) => ({ v: 1, gz: true, iv: 'aXY=', data: 'ciphertext-' + n, t: Date.now() + n });
  const put = (id, body, origin = ORIGIN) => fetch(BASE + '/backup/' + id, { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: origin }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  const get = (id, origin = ORIGIN) => fetch(BASE + '/backup/' + id, { headers: { Origin: origin } });
  check('backup: missing → 404', (await get(bid)).status === 404);
  check('backup: put #1', (await put(bid, box(1))).status === 200);
  check('backup: put #2', (await put(bid, box(2))).status === 200);
  const g = await get(bid);
  check('backup: get returns latest', g.status === 200 && (await g.json()).data === 'ciphertext-2');
  check('backup: wrong origin rejected', (await get(bid, 'https://evil.example')).status === 403);
  check('backup: bad id path → 404', (await get('not-a-hash')).status === 404);
  check('backup: wrong shape rejected', (await put(bid, { hello: 1 })).status === 400);
  check('backup: oversize rejected', (await put(bid, JSON.stringify(Object.assign(box(3), { data: 'x'.repeat(1900 * 1024) })))).status === 413);
  const g2 = await get(bid);
  check('backup: rejected writes left it intact', (await g2.json()).data === 'ciphertext-2');

  // ---- Google sign-in (a fake Google: our own RSA key served as JWKS by the mock) ----
  const CLIENT = vars.GOOGLE_CLIENT_ID;
  const signIdToken = (claims, key = rsa.privateKey, kid = 'k1') => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' })).toString('base64url');
    const c = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const s = crypto.sign('sha256', Buffer.from(h + '.' + c), key).toString('base64url');
    return h + '.' + c + '.' + s;
  };
  const claims = (o) => Object.assign({ iss: 'https://accounts.google.com', aud: CLIENT, sub: 'user-a', email: 'a@example.com', name: 'A', nonce: 'n1', exp: Math.floor(Date.now() / 1000) + 600 }, o);
  const callback = async (idToken, state) => {
    const r = await fetch(BASE + '/auth/callback', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ id_token: idToken, state }) });
    return { status: r.status, loc: r.headers.get('location') || '' };
  };
  const okA = await callback(signIdToken(claims()), 'n1');
  const tokenA = (okA.loc.match(/#\/signin\/(.+)$/) || [])[1];
  check('signin: valid token → redirect to app with session', okA.status === 302 && !!tokenA && okA.loc.startsWith(vars.APP_URL), okA.loc.slice(0, 60));
  check('signin: wrong nonce rejected', /signin-error\/nonce/.test((await callback(signIdToken(claims()), 'other')).loc));
  check('signin: wrong client rejected', /signin-error\/wrong/.test((await callback(signIdToken(claims({ aud: 'someone-else' })), 'n1')).loc));
  check('signin: expired rejected', /signin-error\/expired/.test((await callback(signIdToken(claims({ exp: 1000 })), 'n1')).loc));
  const evil = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  check('signin: forged signature rejected', /signin-error\/bad%20signature/.test((await callback(signIdToken(claims(), evil.privateKey), 'n1')).loc));

  const me = (method, token, body) => fetch(BASE + '/me/data', { method, headers: Object.assign({ Origin: ORIGIN, 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: body && JSON.stringify(body) });
  check('me: no session → 401', (await me('GET')).status === 401);
  check('me: tampered session → 401', (await me('GET', tokenA.slice(0, -2) + 'xx')).status === 401);
  check('me: nothing yet → 404', (await me('GET', tokenA)).status === 404);
  check('me: put', (await me('PUT', tokenA, { v: 2, t: 1, data: { workouts: [{ id: 'w1' }] } })).status === 200);
  const got = await me('GET', tokenA);
  check('me: get back own data', got.status === 200 && (await got.json()).data.workouts[0].id === 'w1');
  const tokenB = ((await callback(signIdToken(claims({ sub: 'user-b', nonce: 'n2' })), 'n2')).loc.match(/#\/signin\/(.+)$/) || [])[1];
  check('me: another user sees none of it', (await me('GET', tokenB)).status === 404);
  check('me: bad shape rejected', (await me('PUT', tokenA, { hello: 1 })).status === 400);

  await new Promise((r) => setTimeout(r, 6000));
  mock.close();

  const d1 = received.filter((x) => x.path === '/device1');
  check('device1 got exactly one push', d1.length === 1, 'count=' + d1.length);
  if (d1.length) {
    const late = d1[0].at - endsAt;
    check('push arrived on time (0–1500 ms after endsAt)', late >= -100 && late < 1500, 'late=' + late + 'ms');
    const payload = JSON.parse(decrypt(s1, d1[0].body));
    check('payload is declarative web push with body', payload.web_push === 8030 && payload.notification.body === 'Bench Press · set 2: 60 kg × 8', JSON.stringify(payload));
    check('authorization is vapid', /^vapid t=/.test(d1[0].headers.authorization));
  }
  check('cancelled device got nothing', received.filter((x) => x.path === '/device2').length === 0);
  const d3 = received.filter((x) => x.path === '/device3');
  check('rescheduled device got only the newer push', d3.length === 1 && JSON.parse(decrypt(s3, d3[0].body)).notification.body === 'new', 'count=' + d3.length);
}

const failed = results.filter((r) => !r.ok).length;
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed');
process.exit(failed ? 1 : 0);

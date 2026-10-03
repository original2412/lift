// Lift push server — sends a Web Push when a rest timer ends.
//
// iOS never runs a web app in the background, so the page can't alert you
// itself. Instead, when a rest starts the app POSTs its end time here; a
// Durable Object (one per device) sets an alarm and, when it fires, sends an
// encrypted Web Push (RFC 8291 aes128gcm + VAPID) to the device.
//
// Routes (JSON, CORS-restricted to ALLOWED_ORIGIN):
//   POST /schedule { id, subscription, endsAt, title, body, url }
//   POST /cancel   { id }
//   GET  /backup/<id>          → latest encrypted backup (404 if none)
//   PUT  /backup/<id> <json>   → store a new one (previous kept as a fallback)
//
// Backups are encrypted on the phone with a key derived from the user's
// recovery code; <id> is a hash of that code. This server only ever sees
// ciphertext and can't link a backup to a person.
//
// Google sign-in (OpenID Connect, implicit id_token + form_post):
//   POST /auth/callback          ← Google posts { id_token, state }; we verify
//                                  it and redirect to APP_URL#/signin/<session>
//   GET  /me/data                → this user's synced data (404 if none)
//   PUT  /me/data <json>         → replace it (previous kept as a fallback)
// Sessions are HMAC-signed tokens (SESSION_SECRET), sent as a Bearer header.
//
// Secrets: VAPID_PRIVATE_JWK (JSON JWK, P-256). Vars: VAPID_PUBLIC_KEY
// (base64url raw), VAPID_SUBJECT, ALLOWED_ORIGIN.

const MAX_AHEAD_MS = 15 * 60 * 1000;
const MAX_BACKUP_BYTES = 1800 * 1024; // under the 2 MB Durable Object value limit
// Only relay to real push services, so this can't be used to POST elsewhere.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/
];

export default {
  async fetch(req, env) {
    const path = new URL(req.url).pathname;
    // Google posts this as a top-level form navigation (no Origin to check)
    if (path === '/auth/callback' && req.method === 'POST') return authCallback(req, env);

    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origin not allowed' }, 403, cors);

    if (path === '/me/data') return meData(req, env, cors);
    const bm = path.match(/^\/backup\/([a-f0-9]{64})$/);
    if (bm) return backupRoute(req, env, bm[1], cors);
    if (req.method !== 'POST') return json({ error: 'not found' }, 404, cors);

    let d;
    try { d = await req.json(); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
    if (typeof d.id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(d.id)) return json({ error: 'bad id' }, 400, cors);
    const stub = env.REST.get(env.REST.idFromName(d.id));

    if (path === '/cancel') {
      await stub.fetch('https://do/cancel', { method: 'POST' });
      return json({ ok: true }, 200, cors);
    }
    if (path !== '/schedule') return json({ error: 'not found' }, 404, cors);

    const err = validateSchedule(d, env);
    if (err) return json({ error: err }, 400, cors);
    await stub.fetch('https://do/schedule', {
      method: 'POST',
      body: JSON.stringify({
        subscription: d.subscription,
        endsAt: d.endsAt,
        title: String(d.title || 'Rest over').slice(0, 80),
        body: String(d.body || '').slice(0, 160),
        url: typeof d.url === 'string' ? d.url.slice(0, 200) : ''
      })
    });
    return json({ ok: true }, 200, cors);
  }
};

async function backupRoute(req, env, id, cors) {
  const stub = env.BACKUP.get(env.BACKUP.idFromName(id));
  if (req.method === 'GET') {
    const res = await stub.fetch('https://do/get');
    return new Response(res.body, { status: res.status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors) });
  }
  if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405, cors);
  const text = await req.text();
  if (text.length > MAX_BACKUP_BYTES) return json({ error: 'backup too large' }, 413, cors);
  let d;
  try { d = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
  // shape only — the content is ciphertext we can't (and shouldn't) inspect
  if (d.v !== 1 || typeof d.iv !== 'string' || typeof d.data !== 'string' || typeof d.t !== 'number') {
    return json({ error: 'bad backup' }, 400, cors);
  }
  await stub.fetch('https://do/put', { method: 'POST', body: text });
  return json({ ok: true }, 200, cors);
}

// ---------------- Google sign-in + per-user data ----------------

const SESSION_DAYS = 365;
let jwksCache = null; // { keys, at }

async function authCallback(req, env) {
  const app = env.APP_URL;
  const back = (frag) => Response.redirect(app + '#/' + frag, 302);
  let form;
  try { form = await req.formData(); } catch (e) { return back('signin-error/bad-request'); }
  const idToken = form.get('id_token'), state = form.get('state');
  if (!idToken || !state) return back('signin-error/' + encodeURIComponent(form.get('error') || 'cancelled'));
  let claims;
  try { claims = await verifyGoogleIdToken(String(idToken), env); } catch (e) {
    return back('signin-error/' + encodeURIComponent(e.message));
  }
  // the app put a random nonce in `state` and in the request; they must match
  if (claims.nonce !== String(state)) return back('signin-error/nonce');
  const token = await signSession({ sub: claims.sub, email: claims.email || '', name: claims.name || '' }, env);
  return back('signin/' + token);
}

export async function verifyGoogleIdToken(jwt, env) {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('malformed token');
  const header = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1])));
  if (header.alg !== 'RS256') throw new Error('bad alg');
  const jwk = (await googleKeys(env)).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), utf8(parts[0] + '.' + parts[1]));
  if (!ok) throw new Error('bad signature');
  if (claims.iss !== 'accounts.google.com' && claims.iss !== 'https://accounts.google.com') throw new Error('bad issuer');
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error('wrong client');
  if (!(claims.exp * 1000 > Date.now())) throw new Error('expired');
  if (!claims.sub) throw new Error('no subject');
  return claims;
}

async function googleKeys(env) {
  if (jwksCache && Date.now() - jwksCache.at < 3600e3) return jwksCache.keys;
  const res = await fetch(env.GOOGLE_JWKS_URL || 'https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('keys unavailable');
  jwksCache = { keys: (await res.json()).keys, at: Date.now() };
  return jwksCache.keys;
}

async function hmacKey(env) {
  return crypto.subtle.importKey('raw', utf8(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(user, env) {
  const body = b64urlEncode(utf8(JSON.stringify(Object.assign({}, user, { exp: Date.now() + SESSION_DAYS * 864e5 }))));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(env), utf8(body)));
  return body + '.' + b64urlEncode(sig);
}

async function readSession(req, env) {
  const m = (req.headers.get('Authorization') || '').match(/^Bearer ([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64urlDecode(m[2]), utf8(m[1]));
  if (!ok) return null;
  const s = JSON.parse(new TextDecoder().decode(b64urlDecode(m[1])));
  return s.exp > Date.now() && s.sub ? s : null;
}

async function meData(req, env, cors) {
  const s = await readSession(req, env);
  if (!s) return json({ error: 'signed out' }, 401, cors);
  const stub = env.BACKUP.get(env.BACKUP.idFromName('google:' + s.sub));
  if (req.method === 'GET') {
    const res = await stub.fetch('https://do/get');
    return new Response(res.body, { status: res.status, headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, cors) });
  }
  if (req.method !== 'PUT') return json({ error: 'method not allowed' }, 405, cors);
  const text = await req.text();
  if (text.length > MAX_BACKUP_BYTES) return json({ error: 'data too large' }, 413, cors);
  let d;
  try { d = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, cors); }
  if (d.v !== 2 || typeof d.t !== 'number' || !d.data || typeof d.data !== 'object') return json({ error: 'bad data' }, 400, cors);
  await stub.fetch('https://do/put', { method: 'POST', body: text });
  return json({ ok: true }, 200, cors);
}

// One per backup id. Keeps the latest backup and the one before it, so a
// bad upload (say, an empty phone) can still be rolled back.
export class Backup {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/get') {
      const cur = await this.state.storage.get('cur');
      return cur ? new Response(cur) : new Response('{"error":"not found"}', { status: 404 });
    }
    if (path === '/put') {
      const text = await req.text();
      const cur = await this.state.storage.get('cur');
      if (cur) await this.state.storage.put('prev', cur);
      await this.state.storage.put('cur', text);
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }
}

export class RestAlarm {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    if (path === '/schedule') {
      const job = await req.json();
      await this.state.storage.put('job', job);
      await this.state.storage.setAlarm(job.endsAt);
      return new Response('ok');
    }
    if (path === '/cancel') {
      await this.state.storage.deleteAlarm();
      await this.state.storage.delete('job');
      return new Response('ok');
    }
    return new Response('not found', { status: 404 });
  }

  async alarm() {
    const job = await this.state.storage.get('job');
    if (!job) return;
    await this.state.storage.delete('job');
    // Declarative Web Push (Safari 18.4+) shows this without waking the
    // service worker; other browsers get it in the worker's push event.
    const payload = JSON.stringify({
      web_push: 8030,
      notification: {
        title: job.title,
        body: job.body,
        navigate: job.url || this.env.ALLOWED_ORIGIN,
        silent: false
      }
    });
    const res = await sendPush(job.subscription, payload, this.env);
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      console.log('push failed', res.status, await res.text());
    }
  }
}

function validateSchedule(d, env) {
  const s = d.subscription;
  if (!s || typeof s.endpoint !== 'string' || !s.keys || typeof s.keys.p256dh !== 'string' || typeof s.keys.auth !== 'string') {
    return 'bad subscription';
  }
  // ALLOW_ANY_PUSH_HOST is only for local tests against a mock push service.
  const devAnyHost = env.ALLOW_ANY_PUSH_HOST === '1';
  let host;
  try {
    const u = new URL(s.endpoint);
    if (u.protocol !== 'https:' && !devAnyHost) return 'bad endpoint';
    host = u.hostname;
  } catch (e) { return 'bad endpoint'; }
  const allowed = devAnyHost || PUSH_HOSTS.some((re) => re.test(host));
  if (!allowed) return 'endpoint not a push service';
  const now = Date.now();
  if (typeof d.endsAt !== 'number' || d.endsAt < now - 5000 || d.endsAt > now + MAX_AHEAD_MS) return 'bad endsAt';
  return null;
}

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map((o) => new URL(o.trim()).origin);
  const h = { 'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Vary': 'Origin' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: Object.assign({ 'Content-Type': 'application/json' }, headers) });
}

// ---------------- Web Push: VAPID + aes128gcm (RFC 8291 / 8188 / 8292) ----------------

export async function sendPush(subscription, payload, env) {
  const endpoint = new URL(subscription.endpoint);
  const body = await encryptPayload(subscription.keys, new TextEncoder().encode(payload));
  const jwt = await vapidJwt(endpoint.origin, env);
  return fetch(subscription.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '120',
      'Urgency': 'high',
      'Authorization': 'vapid t=' + jwt + ', k=' + env.VAPID_PUBLIC_KEY
    },
    body
  });
}

export async function encryptPayload(keys, plaintext) {
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);

  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, asKeys.privateKey, 256));

  // IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0" || ua_pub || as_pub, 32)
  const keyInfo = concat(utf8('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, utf8('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, utf8('Content-Encoding: nonce\0'), 12);

  const padded = concat(plaintext, new Uint8Array([2])); // 0x02 = last record
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, padded));

  const rs = new Uint8Array(4);
  new DataView(rs.buffer).setUint32(0, 4096);
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function vapidJwt(audience, env) {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64urlEncode(utf8(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: env.VAPID_SUBJECT
  })));
  const key = await crypto.subtle.importKey('jwk', JSON.parse(env.VAPID_PRIVATE_JWK), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, utf8(header + '.' + claims)));
  return header + '.' + claims + '.' + b64urlEncode(sig);
}

async function hkdf(salt, ikm, info, len) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, len * 8));
}

function utf8(s) { return new TextEncoder().encode(s); }

function concat(...parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export function b64urlEncode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

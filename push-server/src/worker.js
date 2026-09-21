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
//
// Secrets: VAPID_PRIVATE_JWK (JSON JWK, P-256). Vars: VAPID_PUBLIC_KEY
// (base64url raw), VAPID_SUBJECT, ALLOWED_ORIGIN.

const MAX_AHEAD_MS = 15 * 60 * 1000;
// Only relay to real push services, so this can't be used to POST elsewhere.
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /\.notify\.windows\.com$/
];

export default {
  async fetch(req, env) {
    const cors = corsHeaders(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method !== 'POST') return json({ error: 'not found' }, 404, cors);
    if (!cors['Access-Control-Allow-Origin']) return json({ error: 'origin not allowed' }, 403, cors);

    const path = new URL(req.url).pathname;
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
  const h = { 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' };
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

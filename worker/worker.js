// Rams Gallery — Cloudflare Worker: daftar foto, thumbnail, pembayaran Midtrans, download berkunci.
// Secrets: SA_EMAIL, SA_KEY, MIDTRANS_SERVER_KEY_SANDBOX/_PROD, MIDTRANS_CLIENT_KEY_SANDBOX/_PROD | KV: ORDERS
// Harga, jumlah gratis, mode sandbox/production & per-album diatur dari admin (Firestore settings/payment + albums).
// Vars: FIREBASE_PROJECT_ID, ALLOWED_ORIGIN; cadangan bila Firestore tak terbaca: PRICE_PER_PHOTO, FREE_PER_ALBUM, FREE_PER_IP, MIDTRANS_PROD
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = s => b64u(new TextEncoder().encode(s));
let tok = { v: '', exp: 0 };

async function gToken(env) {
  if (tok.exp > Date.now() + 60000) return tok.v;
  const now = Math.floor(Date.now() / 1000);
  const h = enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const c = enc(JSON.stringify({ iss: env.SA_EMAIL, scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const pem = env.SA_KEY.replace(/\\n/g, '\n').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(pem), ch => ch.charCodeAt(0)), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(h + '.' + c)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: h + '.' + c + '.' + sig }) });
  const d = await r.json();
  if (!d.access_token) throw new Error('Google auth gagal');
  tok = { v: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return tok.v;
}
const g = async (env, url) => fetch(url, { headers: { authorization: 'Bearer ' + await gToken(env) } });

async function listFolder(env, folder) {
  let files = [], pt = '';
  do {
    const q = encodeURIComponent(`'${folder}' in parents and mimeType contains 'image/' and trashed=false`);
    const r = await g(env, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${encodeURIComponent('nextPageToken,files(id,name)')}&pageSize=1000&orderBy=name${pt ? '&pageToken=' + pt : ''}`);
    if (!r.ok) throw new Error('Folder tidak bisa dibaca (sudah di-share ke service account?)');
    const d = await r.json();
    files = files.concat(d.files || []); pt = d.nextPageToken || '';
  } while (pt);
  return files;
}

const mt = prod => prod
  ? { snap: 'https://app.midtrans.com/snap/v1/transactions', api: 'https://api.midtrans.com', js: 'https://app.midtrans.com/snap/snap.js' }
  : { snap: 'https://app.sandbox.midtrans.com/snap/v1/transactions', api: 'https://api.sandbox.midtrans.com', js: 'https://app.sandbox.midtrans.com/snap/snap.js' };
const sKey = (env, prod) => (prod ? env.MIDTRANS_SERVER_KEY_PROD : env.MIDTRANS_SERVER_KEY_SANDBOX) || env.MIDTRANS_SERVER_KEY;
const cKey = (env, prod) => (prod ? env.MIDTRANS_CLIENT_KEY_PROD : env.MIDTRANS_CLIENT_KEY_SANDBOX) || env.MIDTRANS_CLIENT_KEY;
const basic = (env, prod) => 'Basic ' + btoa(sKey(env, prod) + ':');

// ── Pengaturan dari admin (Firestore REST, baca publik) ──
const fsVal = v => 'stringValue' in v ? v.stringValue : 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'booleanValue' in v ? v.booleanValue : null;
const fsObj = f => Object.fromEntries(Object.entries(f || {}).map(([k, v]) => [k, fsVal(v)]));
const folderOf = u => { const m = (u || '').match(/folders\/([\w-]+)/) || (u || '').match(/[?&]id=([\w-]+)/); return m ? m[1] : null; };
let fsCache = { t: 0, s: {}, albums: [] };
async function loadFs(env) {
  if (Date.now() - fsCache.t < 30000) return fsCache;
  try {
    const base = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const [r1, r2] = await Promise.all([fetch(base + '/settings/payment'), fetch(base + '/albums?pageSize=300')]);
    const s = r1.ok ? fsObj((await r1.json()).fields) : {};
    const albums = r2.ok ? ((await r2.json()).documents || []).map(d => fsObj(d.fields)) : [];
    if (r1.ok || r2.ok) fsCache = { t: Date.now(), s, albums };
  } catch (e) { /* pakai cache lama / nilai cadangan env */ }
  return fsCache;
}
const num = (v, d) => (v === null || v === undefined || v === '' || isNaN(Number(v))) ? d : Number(v);
async function payCfg(env, folder) {
  const { s, albums } = await loadFs(env);
  const free = num(s.free, num(env.FREE_PER_ALBUM, 5));
  const c = { price: num(s.price, num(env.PRICE_PER_PHOTO, 0)), free, freeIp: num(s.freeIp, num(env.FREE_PER_IP, free * 3)),
    enabled: s.enabled !== false, prod: s.mode ? s.mode === 'production' : env.MIDTRANS_PROD === 'true' };
  const al = folder && albums.find(a => folderOf(a.drive) === folder);
  if (al) { if (al.payMode === 'free') c.enabled = false; else if (al.payMode === 'custom') c.price = num(al.payPrice, c.price); }
  if (!c.enabled) c.price = 0;
  return c;
}
const TTL = { expirationTtl: 7 * 86400 };
const freeKey = o => `free:${o.folder}:${o.vid}`;
const ipKey = o => `freeip:${o.folder}:${o.ip}`;

async function markPaid(env, id, o) {
  if (o.status === 'paid') return o;
  o.status = 'paid';
  if (o.free) {
    for (const k of [freeKey(o), ipKey(o)]) { const u = Number(await env.ORDERS.get(k)) || 0; await env.ORDERS.put(k, String(u + o.free)); }
  }
  await env.ORDERS.put('order:' + id, JSON.stringify(o), TTL);
  return o;
}
async function refresh(env, id) {
  const o = await env.ORDERS.get('order:' + id, 'json');
  if (!o) return null;
  if (o.status === 'pending') {
    const d = await (await fetch(`${mt(o.prod).api}/v2/${id}/status`, { headers: { authorization: basic(env, o.prod) } })).json();
    const s = d.transaction_status;
    if ((s === 'settlement' || (s === 'capture' && d.fraud_status === 'accept')) && Number(d.gross_amount) === o.amount) await markPaid(env, id, o);
    else if (['expire', 'cancel', 'deny', 'failure'].includes(s)) { o.status = 'failed'; await env.ORDERS.put('order:' + id, JSON.stringify(o), TTL); }
  }
  return o;
}

export default {
  async fetch(req, env) {
    const cors = { 'access-control-allow-origin': env.ALLOWED_ORIGIN || '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type' };
    const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'content-type': 'application/json' } });
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const url = new URL(req.url), p = url.pathname;
    try {
      if (p === '/config') {
        const c = await payCfg(env, url.searchParams.get('folder'));
        return json({ enabled: c.enabled, freeLimit: c.free, pricePerPhoto: c.price, clientKey: cKey(env, c.prod), snapUrl: mt(c.prod).js });
      }

      if (p === '/list') {
        const f = url.searchParams.get('folder') || '';
        if (!/^[\w-]+$/.test(f)) return json({ error: 'folder salah' }, 400);
        return json(await listFolder(env, f));
      }

      if (p.startsWith('/thumb/')) {
        const id = p.slice(7), w = Math.min(Number(url.searchParams.get('w')) || 400, 1000);
        const m = await (await g(env, `https://www.googleapis.com/drive/v3/files/${id}?fields=thumbnailLink`)).json();
        if (!m.thumbnailLink) return new Response('not found', { status: 404, headers: cors });
        // file privat: thumbnailLink harus diambil dengan kredensial (bukan tanpa login)
        const img = await fetch(m.thumbnailLink.replace(/=s\d+.*$/, '=w' + w), { headers: { authorization: 'Bearer ' + await gToken(env) } });
        if (!img.ok) return new Response('thumb gagal', { status: 502, headers: cors });
        return new Response(img.body, { headers: { ...cors, 'content-type': img.headers.get('content-type') || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
      }

      if (p === '/checkout' && req.method === 'POST') {
        const { folder, ids, vid } = await req.json();
        if (!/^[\w-]+$/.test(folder || '') || !Array.isArray(ids) || !ids.length || ids.length > 1000 || !vid) return json({ error: 'permintaan tidak valid' }, 400);
        const valid = new Set((await listFolder(env, folder)).map(f => f.id));
        const sel = [...new Set(ids)];
        if (!sel.every(i => valid.has(i))) return json({ error: 'ada foto yang bukan dari album ini' }, 400);
        const c = await payCfg(env, folder), PRICE = c.price;
        const o = { folder, vid, ip: req.headers.get('CF-Connecting-IP') || 'unknown', ids: sel, status: 'pending', prod: c.prod };
        const usedVid = Number(await env.ORDERS.get(freeKey(o))) || 0, usedIp = Number(await env.ORDERS.get(ipKey(o))) || 0;
        const freeLeft = Math.max(0, Math.min(c.free - usedVid, c.freeIp - usedIp));
        o.free = PRICE === 0 ? 0 : Math.min(freeLeft, sel.length);
        const paidN = sel.length - o.free;
        o.amount = paidN * PRICE;
        const id = 'RG-' + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 8);
        if (o.amount === 0) { await env.ORDERS.put('order:' + id, JSON.stringify(o), TTL); await markPaid(env, id, o); return json({ mode: 'free', orderId: id }); }
        const r = await fetch(mt(c.prod).snap, { method: 'POST', headers: { authorization: basic(env, c.prod), 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ transaction_details: { order_id: id, gross_amount: o.amount }, item_details: [{ id: 'foto', price: PRICE, quantity: paidN, name: `Download ${paidN} foto` }] }) });
        const d = await r.json();
        if (!d.token) return json({ error: 'Midtrans gagal: ' + (d.error_messages || []).join(', ') }, 502);
        await env.ORDERS.put('order:' + id, JSON.stringify(o), TTL);
        return json({ mode: 'pay', orderId: id, snapToken: d.token, amount: o.amount });
      }

      if (p.startsWith('/order/')) {
        const o = await refresh(env, p.slice(7));
        return o ? json({ status: o.status }) : json({ error: 'order tidak ditemukan' }, 404);
      }

      if (p === '/midtrans-webhook' && req.method === 'POST') {
        const n = await req.json();
        const sha = async k => [...new Uint8Array(await crypto.subtle.digest('SHA-512', new TextEncoder().encode(n.order_id + n.status_code + n.gross_amount + k)))].map(b => b.toString(16).padStart(2, '0')).join('');
        const keys = [sKey(env, true), sKey(env, false)].filter(Boolean);
        if (!(await Promise.all(keys.map(sha))).includes(n.signature_key)) return json({ error: 'signature salah' }, 403);
        await refresh(env, n.order_id);
        return json({ ok: true });
      }

      if (p.startsWith('/file/')) {
        const id = p.slice(6), o = await env.ORDERS.get('order:' + (url.searchParams.get('order') || ''), 'json');
        if (!o || o.status !== 'paid' || !o.ids.includes(id)) return json({ error: 'tidak diizinkan' }, 403);
        const r = await g(env, `https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
        if (!r.ok) { const d = await r.json().catch(() => ({})); return json({ error: 'file gagal diambil dari Drive (' + r.status + '): ' + (d.error?.message || d.error?.errors?.[0]?.reason || 'tanpa detail') }, 502); }
        return new Response(r.body, { headers: { ...cors, 'content-type': r.headers.get('content-type') || 'application/octet-stream' } });
      }
      return json({ error: 'not found' }, 404);
    } catch (e) { return json({ error: e.message || 'server error' }, 500); }
  }
};

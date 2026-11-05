const enc = new TextEncoder();
const COOKIE = 'kbytecell_pdv_session';
const MAX_AGE = 60 * 60 * 24 * 14;

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  s += '='.repeat((4 - s.length % 4) % 4);
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
async function sign(value, secret) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(value))));
}
function constantTimeEqual(a, b) {
  const aa = enc.encode(a), bb = enc.encode(b);
  let diff = aa.length ^ bb.length;
  const n = Math.max(aa.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (aa[i % (aa.length || 1)] || 0) ^ (bb[i % (bb.length || 1)] || 0);
  return diff === 0;
}
export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers } });
}
export async function body(request) {
  try { return await request.json(); } catch { return null; }
}
export function cookieValue(request) {
  const raw = request.headers.get('Cookie') || '';
  const item = raw.split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='));
  return item ? decodeURIComponent(item.slice(COOKIE.length + 1)) : '';
}
export async function makeSession(env, user) {
  const payload = b64url(enc.encode(JSON.stringify({ user, exp: Math.floor(Date.now() / 1000) + MAX_AGE })));
  const token = payload + '.' + await sign(payload, env.SESSION_SECRET);
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Strict`;
}
export async function authorized(request, env) {
  const token = cookieValue(request);
  if (!token || !env.SESSION_SECRET) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expected = await sign(parts[0], env.SESSION_SECRET);
  if (!constantTimeEqual(parts[1], expected)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(unb64url(parts[0])));
    return data.user === env.PDV_USER && data.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}
export function clearCookie() {
  return `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;
}

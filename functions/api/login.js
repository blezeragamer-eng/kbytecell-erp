import { body, json, makeSession } from './_lib.js';

export async function onRequestPost({ request, env }) {
  if (!env.DB || !env.PDV_USER || !env.PDV_PASSWORD || !env.SESSION_SECRET) return json({ error: 'Configuração incompleta no Cloudflare.' }, 503);
  const data = await body(request);
  if (!data || typeof data.user !== 'string' || typeof data.password !== 'string') return json({ error: 'Informe usuário e senha.' }, 400);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM login_attempts WHERE attempted_at < ?').bind(now - 900).run();
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND attempted_at > ?').bind(ip, now - 900).first();
  if ((row?.n || 0) >= 8) return json({ error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
  await env.DB.prepare('INSERT INTO login_attempts (ip, attempted_at) VALUES (?, ?)').bind(ip, now).run();
  const ok = data.user === env.PDV_USER && data.password === env.PDV_PASSWORD;
  if (!ok) return json({ error: 'Usuário ou senha incorretos.' }, 401);
  await env.DB.prepare('DELETE FROM login_attempts WHERE ip = ?').bind(ip).run();
  return json({ ok: true }, 200, { 'Set-Cookie': await makeSession(env, env.PDV_USER) });
}

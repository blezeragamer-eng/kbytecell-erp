import { authorized, json } from './_lib.js';
export async function onRequestGet({ request, env }) {
  return (await authorized(request, env)) ? json({ ok: true }) : json({ error: 'Não autenticado.' }, 401);
}

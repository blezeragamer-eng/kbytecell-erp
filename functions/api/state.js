import { authorized, body, json } from './_lib.js';

const EMPTY = { cfg: { nome: 'Minha Loja', doc: '', end: '', tel: '' }, prods: [], vendas: [], clientes: [], seq: 1 };
export async function onRequestGet({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: 'Não autenticado.' }, 401);
  const row = await env.DB.prepare('SELECT version, state_json FROM pdv_state WHERE id = 1').first();
  if (!row) return json({ initialized: false, version: 0, state: EMPTY });
  try { return json({ initialized: true, version: row.version, state: JSON.parse(row.state_json) }); }
  catch { return json({ error: 'Dados do PDV inválidos no banco.' }, 500); }
}
export async function onRequestPut({ request, env }) {
  if (!(await authorized(request, env))) return json({ error: 'Não autenticado.' }, 401);
  const data = await body(request);
  if (!data || !Number.isInteger(data.version) || !data.state || !Array.isArray(data.state.prods) || !Array.isArray(data.state.vendas) || !Array.isArray(data.state.clientes)) return json({ error: 'Formato de dados inválido.' }, 400);
  const raw = JSON.stringify(data.state);
  if (raw.length > 900000) return json({ error: 'Dados muito grandes para esta operação.' }, 413);
  const current = await env.DB.prepare('SELECT version, state_json FROM pdv_state WHERE id = 1').first();
  if (!current) {
    if (data.version !== 0) return json({ error: 'Conflito de sincronização.' }, 409);
    await env.DB.prepare('INSERT OR IGNORE INTO pdv_state (id, version, state_json, updated_at) VALUES (1, 1, ?, CURRENT_TIMESTAMP)').bind(raw).run();
  } else {
    const result = await env.DB.prepare('UPDATE pdv_state SET version = version + 1, state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1 AND version = ?').bind(raw, data.version).run();
    if (!result.meta?.changes) {
      const latest = await env.DB.prepare('SELECT version, state_json FROM pdv_state WHERE id = 1').first();
      return json({ error: 'Outro aparelho atualizou os dados. Sincronizando alterações.', version: latest.version, state: JSON.parse(latest.state_json) }, 409);
    }
  }
  const latest = await env.DB.prepare('SELECT version, state_json FROM pdv_state WHERE id = 1').first();
  return json({ ok: true, version: latest.version, state: JSON.parse(latest.state_json) });
}


import { authorized, body, json } from './_lib.js';

const money = n => Math.round((Number(n) || 0) * 100) / 100;

export async function onRequestPost({ request, env }) {
  if (!(await authorized(request, env))) {
    return json({ error: 'Não autenticado.' }, 401);
  }

  const data = await body(request);

  if (
    !data ||
    typeof data.requestId !== 'string' ||
    !data.requestId ||
    data.requestId.length > 100 ||
    !Array.isArray(data.items) ||
    !data.items.length ||
    data.items.length > 100
  ) {
    return json({ error: 'Dados da venda inválidos.' }, 400);
  }

  const items = new Map();

  for (const item of data.items) {
    const id = String(item.id || '');
    const q = Number(item.q);

    if (!id || !Number.isInteger(q) || q < 1 || q > 9999) {
      return json({ error: 'Produto ou quantidade inválida.' }, 400);
    }

    items.set(id, (items.get(id) || 0) + q);
  }

  for (let attempt = 0; attempt < 12; attempt++) {
    const row = await env.DB.prepare(
      'SELECT version, state_json FROM pdv_state WHERE id = 1'
    ).first();

    if (!row) {
      return json({ error: 'PDV ainda não inicializado.' }, 409);
    }

    let state;

    try {
      state = JSON.parse(row.state_json);
    } catch {
      return json({ error: 'Dados do PDV inválidos.' }, 500);
    }

    if (!Array.isArray(state.prods) || !Array.isArray(state.vendas)) {
      return json({ error: 'Estrutura do PDV inválida.' }, 500);
    }

    // Evita registrar duas vezes a mesma solicitação.
    const previous = state.vendas.find(
      v => v.id === data.requestId
    );

    if (previous) {
      return json({
        ok: true,
        duplicate: true,
        sale: previous,
        version: row.version,
        state
      });
    }

    const saleItems = [];
    let subtotal = 0;

    for (const [id, q] of items) {
      const product = state.prods.find(p => String(p.id) === id);

      if (!product) {
        return json({ error: 'Um produto não foi encontrado. Atualize o PDV.' }, 409);
      }

      if (!Number.isFinite(Number(product.est)) || Number(product.est) < q) {
        return json({
          error: 'Estoque insuficiente para ' + product.nome + '. Atualize o PDV.',
          version: row.version,
          state
        }, 409);
      }

      const price = money(product.preco);
      const cost = money(product.custo);

      if (price < 0 || cost < 0) {
        return json({ error: 'Preço ou custo inválido.' }, 400);
      }

      subtotal = money(subtotal + price * q);

      saleItems.push({
        nome: product.nome,
        preco: price,
        custo: cost,
        q
      });
    }

    const discount = Math.min(
      subtotal,
      Math.max(0, money(data.discount))
    );

    const total = money(subtotal - discount);

    let payments = Array.isArray(data.payments)
      ? data.payments
      : [];

    if (!payments.length) {
      payments = [{ m: 'Dinheiro', v: total }];
    }

    if (payments.length > 10) {
      return json({ error: 'Quantidade de pagamentos inválida.' }, 400);
    }

    payments = payments.map(p => ({
      m: String(p.m || '').slice(0, 40),
      v: money(p.v)
    }));

    if (payments.some(p => !p.m || p.v < 0)) {
      return json({ error: 'Pagamento inválido.' }, 400);
    }

    const paid = money(payments.reduce((sum, p) => sum + p.v, 0));

    if (paid < total) {
      return json({ error: 'Valor pago menor que o total.' }, 400);
    }

    if (
      paid > total &&
      !payments.some(p => p.m === 'Dinheiro')
    ) {
      return json({ error: 'Somente dinheiro pode gerar troco.' }, 400);
    }

    const clientId = String(data.clientId || '');

    if (
      clientId &&
      !(state.clientes || []).some(c => c.id === clientId)
    ) {
      return json({ error: 'Cliente não encontrado. Atualize o PDV.' }, 409);
    }

    // Numeração sequencial, independente da data.
    const oldNumbers = state.vendas
      .map(v => Number(v.n))
      .filter(n => Number.isSafeInteger(n) && n > 0 && n <= 999999);

    const lastNumber = Math.max(
      0,
      Number(state.seq) - 1 || 0,
      ...oldNumbers
    );

    const receiptNumber = lastNumber + 1;

    if (receiptNumber > 999999) {
      return json({ error: 'Limite de numeração de recibos atingido.' }, 400);
    }

    // Baixa o estoque diretamente no estado mais recente do banco.
    for (const [id, q] of items) {
      const product = state.prods.find(p => String(p.id) === id);
      product.est = Number(product.est) - q;
    }

    const sale = {
      id: data.requestId,
      n: receiptNumber,
      t: Date.now(),
      cli: clientId,
      pagos: payments,
      pag: payments.map(p => p.m).join(' + '),
      sub: subtotal,
      desc: discount,
      total,
      itens: saleItems,
      troco: Math.max(0, money(paid - total))
    };

    state.vendas.unshift(sale);
    state.seq = receiptNumber + 1;

    const raw = JSON.stringify(state);

    if (raw.length > 900000) {
      return json({ error: 'Dados muito grandes.' }, 413);
    }

    // Só uma venda por versão consegue confirmar.
    const result = await env.DB.prepare(
      `UPDATE pdv_state
       SET version = version + 1,
           state_json = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = 1 AND version = ?`
    ).bind(raw, row.version).run();

    if (result.meta?.changes) {
      return json({
        ok: true,
        sale,
        version: row.version + 1,
        state
      });
    }
  }

  return json({
    error: 'O estoque foi atualizado por outro aparelho. Atualize e tente novamente.'
  }, 409);
}

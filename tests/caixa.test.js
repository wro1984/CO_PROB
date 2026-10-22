// Conversa com a caixa de entrada (Worker): pedido de acesso, andamento e inscrição de push.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

globalThis.self = globalThis;
const PSCaixa = require('../caixa.js');

function fetchFalso(respostas) {
  const chamadas = [];
  PSCaixa._fetch = async (url, op) => {
    chamadas.push({ url, op, corpo: JSON.parse(op.body) });
    const r = respostas.shift();
    if (r instanceof Error) throw r;
    return { ok: r.status < 400, status: r.status, json: async () => r.corpo };
  };
  return chamadas;
}

test('sem endereço configurado a caixa fica desligada e nenhuma chamada é feita', async () => {
  globalThis.PS_CONFIG = { caixa: '' };
  assert.equal(PSCaixa.configurada(), false);
  const c = fetchFalso([]);
  const e = await PSCaixa.solicitar({ matricula: 'A1' }).catch(x => x);
  assert.equal(e.code, 'sem_caixa');
  assert.equal(c.length, 0);
});

test('solicitar, consultar e inscrever mandam o corpo certo para a rota certa', async () => {
  globalThis.PS_CONFIG = { caixa: 'https://caixa.workers.dev/' };
  assert.equal(PSCaixa.configurada(), true);
  const c = fetchFalso([{ status: 201, corpo: { protocolo: 'PS-ABC', token: 't' } }, { status: 200, corpo: { status: 'aprovado', motivo: null } }, { status: 202, corpo: { ok: true } }]);
  const r = await PSCaixa.solicitar({ matricula: 'A1', nome: 'Ana', email: 'a@x.com', justificativa: 'j', extra: 'ignorado' });
  assert.deepEqual(r, { protocolo: 'PS-ABC', token: 't' });
  assert.deepEqual([c[0].url, c[0].op.method, c[0].op.headers['Content-Type']], ['https://caixa.workers.dev/solicitar', 'POST', 'application/json']);
  assert.deepEqual(c[0].corpo, { matricula: 'A1', nome: 'Ana', email: 'a@x.com', justificativa: 'j' });
  assert.equal((await PSCaixa.consultar({ protocolo: 'PS-ABC', token: 't', lixo: 1 })).status, 'aprovado');
  assert.deepEqual(c[1].corpo, { protocolo: 'PS-ABC', token: 't' });
  await PSCaixa.inscreverPush({ id: 'i', endpoint: 'e', p256dh: 'p', auth: 'a', mac: 'm', lixo: 1 });
  assert.equal(c[2].url, 'https://caixa.workers.dev/push/inscrever');
  assert.deepEqual(c[2].corpo, { id: 'i', endpoint: 'e', p256dh: 'p', auth: 'a', mac: 'm' });
});

test('erros: o texto vem da caixa, o código HTTP fica no erro e falha de rede vira mensagem clara', async () => {
  globalThis.PS_CONFIG = { caixa: 'https://caixa.workers.dev' };
  fetchFalso([{ status: 400, corpo: { erro: 'Matrícula inválida.' } }, { status: 429, corpo: { erro: 'Muitos pedidos agora.' } },
    { status: 404, corpo: { erro: 'Pedido não encontrado.' } }, { status: 500, corpo: {} }, new TypeError('Failed to fetch')]);
  let e = await PSCaixa.solicitar({}).catch(x => x);
  assert.deepEqual([e.status, e.message], [400, 'Matrícula inválida.']);
  e = await PSCaixa.solicitar({}).catch(x => x);
  assert.equal(e.status, 429);
  e = await PSCaixa.consultar({}).catch(x => x);
  assert.equal(e.status, 404);
  e = await PSCaixa.consultar({}).catch(x => x);
  assert.match(e.message, /Falha \(500\)/);
  e = await PSCaixa.consultar({}).catch(x => x);
  assert.equal(e.code, 'rede');
  assert.match(e.message, /Sem conexão/);
});

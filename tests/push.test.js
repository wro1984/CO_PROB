// Inscrição de push (push.js) e o evento `push` do service worker (sw.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

globalThis.self = globalThis;
const PSPush = require('../push.js');

function sub(endpoint = 'https://fcm.googleapis.com/fcm/send/x', chave = null) {
  return { options: chave ? { applicationServerKey: Buffer.from(chave, 'base64url') } : undefined, toJSON: () => ({ endpoint, keys: { p256dh: 'P', auth: 'A' } }), desfeita: false, async unsubscribe() { this.desfeita = true; return true; } };
}
function regFalso({ existente = null, falhaPrimeira = false } = {}) {
  const r = { assinatura: existente, criadas: [] };
  r.pushManager = {
    async getSubscription() { return r.assinatura; },
    async subscribe(op) {
      if (falhaPrimeira && r.assinatura && !r.criadas.length && !r.assinatura.desfeita) { r.criadas.push('falhou'); throw new Error('InvalidStateError'); }
      r.criadas.push(op); r.assinatura = sub(); return r.assinatura;
    },
  };
  return r;
}
const cripto = { macInscricao: async (seg, e, p, a) => `mac(${Buffer.from(seg).toString('hex')}|${e}|${p}|${a})` };
const caixaFalsa = () => { const c = { env: [], configurada: () => true, inscreverPush: async d => { c.env.push(d); } }; return c; };
const CHAVE = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';

test('urlB64ParaBytes decodifica a chave VAPID (65 bytes)', () => {
  assert.equal(PSPush.urlB64ParaBytes(CHAVE).length, 65);
});

test('disponivel exige caixa, chave, segredo e Push API', () => {
  const ok = { caixa: { configurada: () => true }, segredo: new Uint8Array(32), chave: CHAVE,
    janela: { navigator: { serviceWorker: {} }, PushManager: {}, Notification: {} } };
  assert.equal(PSPush.disponivel(ok), true);
  for (const mud of [{ caixa: { configurada: () => false } }, { caixa: null }, { segredo: null }, { chave: null },
    { janela: { navigator: {}, PushManager: {}, Notification: {} } }, { janela: { navigator: { serviceWorker: {} }, Notification: {} } }]) {
    assert.equal(PSPush.disponivel({ ...ok, ...mud }), false, JSON.stringify(Object.keys(mud)));
  }
});

test('registrar: cria a inscrição com a chave do MAPI e entrega com a prova', async () => {
  const reg = regFalso(), caixa = caixaFalsa();
  const r = await PSPush.registrar({ reg, chave: CHAVE, segredo: Buffer.from('segredo'), cred: { id: 'ID1', salt: 'S1' }, caixa, cripto, forcar: false, guardado: '' });
  assert.deepEqual([r.ok, r.registrou], [true, true]);
  assert.equal(reg.criadas[0].userVisibleOnly, true);
  assert.equal(reg.criadas[0].applicationServerKey.length, 65);
  assert.deepEqual(caixa.env[0], { id: 'ID1', endpoint: 'https://fcm.googleapis.com/fcm/send/x', p256dh: 'P', auth: 'A',
    mac: `mac(${Buffer.from('segredo').toString('hex')}|https://fcm.googleapis.com/fcm/send/x|P|A)` });
  assert.equal(r.marca, `https://fcm.googleapis.com/fcm/send/x|${CHAVE}|S1`);
});

test('registrar não repete o que já foi entregue, mas repete se a inscrição, a chave ou o salt mudaram', async () => {
  const caixa = caixaFalsa();
  const base = { chave: CHAVE, segredo: Buffer.from('s'), cred: { id: 'ID1', salt: 'S1' }, caixa, cripto, forcar: false };
  const guardado = `https://fcm.googleapis.com/fcm/send/x|${CHAVE}|S1`;
  let r = await PSPush.registrar({ ...base, reg: regFalso({ existente: sub() }), guardado });
  assert.deepEqual([r.registrou, caixa.env.length], [false, 0]);
  r = await PSPush.registrar({ ...base, reg: regFalso({ existente: sub('https://fcm.googleapis.com/fcm/send/outro') }), guardado });
  assert.equal(r.registrou, true);
  r = await PSPush.registrar({ ...base, cred: { id: 'ID1', salt: 'S2' }, reg: regFalso({ existente: sub() }), guardado });
  assert.equal(r.registrou, true);
  r = await PSPush.registrar({ ...base, forcar: true, reg: regFalso({ existente: sub() }), guardado });
  assert.equal(r.registrou, true);
});

test('chave pública do MAPI mudou: desfaz a inscrição velha e cria outra', async () => {
  const outraChave = Buffer.alloc(65, 9).toString('base64url');
  const velha = sub('https://fcm.googleapis.com/fcm/send/x', outraChave), reg = regFalso({ existente: velha }), caixa = caixaFalsa();
  const r = await PSPush.registrar({ reg, chave: CHAVE, segredo: Buffer.from('s'), cred: { id: 'I', salt: 'S' }, caixa, cripto, forcar: false, guardado: '' });
  assert.equal(r.registrou, true);
  assert.equal(velha.desfeita, true);
  assert.equal(reg.criadas.length, 1);
  assert.equal(caixa.env.length, 1);
  // mesma chave: reaproveita a inscrição que já existe
  const boa = sub('https://fcm.googleapis.com/fcm/send/x', CHAVE), reg2 = regFalso({ existente: boa });
  await PSPush.registrar({ reg: reg2, chave: CHAVE, segredo: Buffer.from('s'), cred: { id: 'I', salt: 'S' }, caixa: caixaFalsa(), cripto, forcar: true, guardado: '' });
  assert.equal(boa.desfeita, false);
  assert.equal(reg2.criadas.length, 0);
});

test('se o navegador recusar a inscrição nova por causa da chave, desfaz a velha e tenta de novo', async () => {
  const velha = sub(), reg = regFalso({ existente: velha, falhaPrimeira: true });
  // sem como saber a chave da velha (options ausente): o primeiro subscribe falha e o segundo passa
  reg.pushManager.getSubscription = async () => (reg.assinatura && !reg.assinatura.desfeita ? reg.assinatura : null);
  reg.assinatura = null;
  const original = reg.pushManager.subscribe;
  let n = 0;
  reg.pushManager.subscribe = async op => { if (!n++) { reg.assinatura = velha; throw new Error('InvalidStateError'); } return original(op); };
  const caixa = caixaFalsa();
  const r = await PSPush.registrar({ reg, chave: CHAVE, segredo: Buffer.from('s'), cred: { id: 'I', salt: 'S' }, caixa, cripto, forcar: true, guardado: '' });
  assert.equal(r.registrou, true);
  assert.equal(velha.desfeita, true);
});

test('desinscrever apaga a inscrição e nunca levanta', async () => {
  const s = sub();
  assert.equal(await PSPush.desinscrever(regFalso({ existente: s })), true);
  assert.equal(s.desfeita, true);
  assert.equal(await PSPush.desinscrever(regFalso()), true);
  assert.equal(await PSPush.desinscrever(null), true);
  assert.equal(await PSPush.desinscrever({ pushManager: { getSubscription: async () => { throw new Error('x'); } } }), false);
});

// ---- sw.js: evento push
function carregarSw() {
  const ouvintes = {}, avisos = [];
  const self_ = {
    addEventListener: (n, f) => { ouvintes[n] = f; },
    registration: { showNotification: async (t, o) => { avisos.push({ t, o }); } },
    clients: { matchAll: async () => [], openWindow: async () => {} },
    location: { href: 'https://x.github.io/app/' },
  };
  const ctx = { self: self_, caches: {}, fetch: async () => {}, URL, Response, console, location: { origin: 'https://x.github.io' } };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), ctx);
  return { ouvintes, avisos };
}
const evento = dados => { const e = { esperas: [], waitUntil(p) { e.esperas.push(p); } }; if (dados !== undefined) e.data = { json: () => JSON.parse(dados), text: () => dados }; return e; };

test('sw: o evento push mostra o aviso do MAPI', async () => {
  const { ouvintes, avisos } = carregarSw();
  const e = evento(JSON.stringify({ t: 'Problemas Sistêmicos', b: 'SISTEMA EXEMPLO A: ABERTO → FECHADO', tag: 'ps-mudancas', u: './' }));
  ouvintes.push(e);
  await Promise.all(e.esperas);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].t, 'Problemas Sistêmicos');
  assert.equal(avisos[0].o.body, 'SISTEMA EXEMPLO A: ABERTO → FECHADO');
  assert.equal(avisos[0].o.tag, 'ps-mudancas');
  assert.equal(avisos[0].o.renotify, true);
  assert.equal(avisos[0].o.icon, 'icons/icon-192.png');
});

test('sw: push vazio ou com texto solto também mostra aviso (nunca fica sem mostrar)', async () => {
  const { ouvintes, avisos } = carregarSw();
  for (const d of [undefined, 'texto solto, não é JSON', '{}']) {
    const e = evento(d); ouvintes.push(e); await Promise.all(e.esperas);
  }
  assert.equal(avisos.length, 3);
  assert.equal(avisos[0].t, 'Problemas Sistêmicos');
  assert.equal(avisos[1].o.body, 'texto solto, não é JSON');
  assert.equal(avisos[2].o.tag, 'ps-push');
});

test('sw: dados.json nunca passa pelo cache do service worker', async () => {
  const { ouvintes } = carregarSw();
  let respondeu = false;
  ouvintes.fetch({ request: { method: 'GET', url: 'https://x.github.io/app/dados.json?t=1', mode: 'cors' }, respondWith: () => { respondeu = true; } });
  assert.equal(respondeu, false);
});

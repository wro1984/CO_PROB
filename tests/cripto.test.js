// Confere, em Node, que o cripto.js abre o pacote que o MAPI cifra (tests/fixtures/pacote.json, gerado por
// tests/gerar_fixture_sis_app.py do repositório do MAPI) e que recusa o que deve recusar.
//   node --test tests/
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

globalThis.self = globalThis;                       // o módulo usa `self` (navegador)
const PSCripto = require('../cripto.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
const txt = b => new TextDecoder().decode(b);
const clone = o => JSON.parse(JSON.stringify(o));

test('abre com o código sorteado, com ou sem hífen, em qualquer caixa', async () => {
  for (const chave of ['ABCD-2345-EFGH-6789', 'abcd2345efgh6789', ' abcd 2345 efgh 6789 ']) {
    const r = await PSCripto.entrar(clone(fx.pacote), 'a0001', chave);
    assert.equal(txt(r.dados), fx.esperado.dados);
    assert.equal(txt(r.notificacoes), fx.esperado.notificacoes);
    assert.equal(r.cred.matricula, 'A0001');
  }
});

test('chave com acento e símbolos vale igual à sem acento (mesma normalização do MAPI)', async () => {
  for (const chave of ['Girassól 2026!', 'girassol2026', 'GIRASSOL-2026']) {
    const r = await PSCripto.entrar(clone(fx.pacote), ' b0002 ', chave);
    assert.equal(txt(r.dados), fx.esperado.dados);
  }
});

test('chave errada e matrícula sem acesso dão a mesma mensagem (não revela quem tem acesso)', async () => {
  const errada = await PSCripto.entrar(clone(fx.pacote), 'A0001', 'ZZZZ-2345-EFGH-6789').catch(e => e);
  const semAcesso = await PSCripto.entrar(clone(fx.pacote), 'X9999', 'ABCD-2345-EFGH-6789').catch(e => e);
  assert.equal(errada.code, 'codigo');
  assert.equal(semAcesso.code, 'codigo');
  assert.equal(errada.message, semAcesso.message);
});

test('credencial guardada abre de novo; acesso removido ou chave trocada derruba', async () => {
  const { cred } = await PSCripto.entrar(clone(fx.pacote), 'A0001', 'ABCD-2345-EFGH-6789');
  const r = await PSCripto.abrir(clone(fx.pacote), cred);
  assert.equal(txt(r.dados), fx.esperado.dados);
  const removido = clone(fx.pacote); delete removido.acessos[cred.id];
  assert.equal((await PSCripto.abrir(removido, cred).catch(e => e)).code, 'sem_acesso');
  const trocado = clone(fx.pacote); trocado.acessos[cred.id].salt = Buffer.from('outro-salt-16byt').toString('base64');
  assert.equal((await PSCripto.abrir(trocado, cred).catch(e => e)).code, 'sem_acesso');
});

test('pacote adulterado ou fora do formato é recusado', async () => {
  const ruim = clone(fx.pacote);
  const ct = Buffer.from(ruim.dados.ct, 'base64'); ct[0] ^= 1; ruim.dados.ct = ct.toString('base64');
  assert.equal((await PSCripto.entrar(ruim, 'A0001', 'ABCD-2345-EFGH-6789').catch(e => e)).code, 'corrompido');
  for (const mexe of [p => { p.app = 'co-painel'; }, p => { p.v = 2; }, p => { p.kdf.iter = 10; },
    p => { p.kdf.iter = 99999999; }, p => { delete p.dados; }, p => { delete p.acessos; }]) {
    const p = clone(fx.pacote); mexe(p);
    assert.equal((await PSCripto.entrar(p, 'A0001', 'ABCD-2345-EFGH-6789').catch(e => e)).code, 'formato');
  }
});

test('sem o campo notificacoes o app abre só os dados', async () => {
  const p = clone(fx.pacote); delete p.notificacoes;
  const r = await PSCripto.entrar(p, 'A0001', 'ABCD-2345-EFGH-6789');
  assert.equal(r.notificacoes, null);
  assert.equal(txt(r.dados), fx.esperado.dados);
});

test('id da matrícula usa o prefixo do app (diferente do NS Painel)', async () => {
  assert.ok(fx.pacote.acessos[await PSCripto.idDe('A0001')]);
  assert.equal(await PSCripto.idDe(' a0001 '), await PSCripto.idDe('A0001'));
});

test('sem IndexedDB nada é guardado em aberto (o cofre devolve null)', async () => {
  assert.equal(await PSCripto.selar({ a: 1 }), null);
  assert.equal(await PSCripto.abrirSelo('c1.x.y'), null);
  assert.equal(await PSCripto.lerCred(), null);
});

test('segredo de push e chave pública VAPID saem do pacote; a prova (MAC) é igual à do MAPI', async () => {
  const r = await PSCripto.entrar(clone(fx.pacote), 'A0001', 'ABCD-2345-EFGH-6789');
  assert.equal(r.pushChave, fx.esperado.push_chave);
  assert.equal(Buffer.from(r.pushSecret).toString('hex'), fx.esperado.push_secret_a0001);
  const m = fx.esperado.mac;
  assert.equal(await PSCripto.macInscricao(r.pushSecret, m.endpoint, m.p256dh, m.auth), m.mac);
  assert.notEqual(await PSCripto.macInscricao(r.pushSecret, m.endpoint + 'x', m.p256dh, m.auth), m.mac);
  const outra = await PSCripto.entrar(clone(fx.pacote), 'B0002', 'Girassól 2026!');
  assert.notEqual(Buffer.from(outra.pushSecret).toString('hex'), fx.esperado.push_secret_a0001);   // cada pessoa tem o seu
});

test('pacote sem push (ou com tk estragado) continua abrindo os dados', async () => {
  const sem = clone(fx.pacote); delete sem.push; for (const a of Object.values(sem.acessos)) delete a.tk;
  const r = await PSCripto.entrar(sem, 'A0001', 'ABCD-2345-EFGH-6789');
  assert.deepEqual([r.pushSecret, r.pushChave], [null, null]);
  assert.equal(txt(r.dados), fx.esperado.dados);
  const ruim = clone(fx.pacote); const id = await PSCripto.idDe('A0001'); ruim.acessos[id].tk.ct = Buffer.from('lixo-lixo-lixo-lixo-lixo-lixo-12').toString('base64');
  const r2 = await PSCripto.entrar(ruim, 'A0001', 'ABCD-2345-EFGH-6789');
  assert.equal(r2.pushSecret, null);
  assert.equal(txt(r2.dados), fx.esperado.dados);
});

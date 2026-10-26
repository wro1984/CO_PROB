// Login único: o app abre o dados.json pela credencial que o HUB guardou no aparelho (campo `hub` do pacote, gerado
// por sis_app.montar_pacote(acessos_hub=...) do MAPI: tests/fixtures/pacote_hub.json, dados inventados).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { webcrypto } = require('crypto');
if (!globalThis.crypto) globalThis.crypto = webcrypto;
globalThis.self = globalThis;                       // o módulo usa `self` (navegador)
const P = require('../cripto.js');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote_hub.json'), 'utf8'));
const S = crypto.subtle, enc = new TextEncoder();

// a credencial como o HUB guarda (cripto.js do HUB): id do HUB, CryptoKey não extraível e o salt do HUB
async function credDoHub(chave = fx.hub.chave, salt = fx.hub.salt) {
  const base = await S.importKey('raw', enc.encode(P.normCodigo(chave)), 'PBKDF2', false, ['deriveKey']);
  const k = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(fx.hub.salt, 'base64'), iterations: fx.hub.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const id = Buffer.from(await S.digest('SHA-256', enc.encode('hub:' + fx.hub.matricula))).toString('hex');
  return { via: 'hub', id, matricula: fx.hub.matricula, chave: k, salt };
}

test('abre os chamados, as notificações e o segredo de aviso pela credencial do HUB', async () => {
  const c = await P.abrir(fx.pacote, await credDoHub());
  assert.strictEqual(new TextDecoder().decode(c.dados), fx.esperado.dados);
  assert.strictEqual(new TextDecoder().decode(c.notificacoes), fx.esperado.notificacoes);
  // aviso com o app fechado: o segredo de aviso do HUB e a chave pública vêm junto
  assert.strictEqual(Buffer.from(c.pushSecret).toString('base64'), fx.esperado.push_secret);
  assert.strictEqual(c.pushChave, fx.esperado.push_chave);
});

test('perfil do HUB sem este app: sem_acesso com aviso claro', async () => {
  const semHub = JSON.parse(JSON.stringify(fx.pacote)); delete semHub.hub;
  const e = await P.abrir(semHub, await credDoHub()).catch(x => x);
  assert.strictEqual(e.code, 'sem_acesso');
  assert.match(e.message, /perfil no HUB/);
});

test('chave do HUB trocada (salt novo) ou chave errada: sem_acesso', async () => {
  const outroSalt = await P.abrir(fx.pacote, await credDoHub(fx.hub.chave, 'b3V0cm8tc2FsdC0xNmJ5dA==')).catch(x => x);
  assert.strictEqual(outroSalt.code, 'sem_acesso');
  const errada = await P.abrir(fx.pacote, await credDoHub('outra-chave-qualquer')).catch(x => x);
  assert.strictEqual(errada.code, 'sem_acesso');
});

test('a credencial própria do app continua funcionando (o login antigo não muda)', async () => {
  const fx1 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));
  const a = fx1.acessos_teste[0];
  const ent = await P.entrar(fx1.pacote, a.matricula, a.chave);
  const de_novo = await P.abrir(fx1.pacote, ent.cred);
  assert.ok(de_novo.dados.length > 0);
});

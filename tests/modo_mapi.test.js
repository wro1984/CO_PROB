// Modo MAPI (?mapi): o app aberto dentro do "HUB de Apps" do MAPI recebe os chamados e as notificações por mensagem, sem login, sem baixar o
// dados.json, sem service worker e sem aviso no celular. Confere o código (o desenho em si é o mesmo do app).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('só entra no modo MAPI dentro de um quadro e com ?mapi na URL', () => {
  assert.match(app, /const MODO_MAPI = window\.parent !== window && new URLSearchParams\(location\.search\)\.has\('mapi'\)/);
});

test('no modo MAPI o início não lê credencial, não registra service worker nem mostra o login', () => {
  const ini = app.slice(app.indexOf('async function iniciar()'));
  const mapi = ini.slice(0, ini.indexOf('$(\'loginForm\')'));
  assert.match(mapi, /if \(MODO_MAPI\) \{/);
  assert.match(mapi, /addEventListener\('message', receberDoMapi\)/);
  assert.ok(!/lerCred|credDoHub|serviceWorker|mostrarLogin/.test(mapi));
  assert.ok(ini.indexOf('serviceWorker') > ini.indexOf('$(\'loginForm\')'));        // o registro do service worker vem depois, fora do modo MAPI
});

test('só aceita a mensagem da janela pai e só do tipo certo; o pedido leva só o aviso', () => {
  const f = app.slice(app.indexOf('let pedidoMapi'), app.indexOf('async function pollMapi'));
  assert.match(f, /e\.source !== window\.parent/);
  assert.match(f, /e\.data\.tipo !== 'co-prob:dados'/);
  assert.match(f, /postMessage\(\{ tipo: 'co-prob:pronto', versao: VERSION \}, '\*'\)/);
  assert.ok(!/cred|matricula|sistemas/i.test(f.match(/postMessage\([^)]*\)/)[0]));
});

test('a conferência no modo MAPI usa o pedido (não baixa arquivo) e não guarda o pacote no aparelho', () => {
  assert.match(app, /if \(MODO_MAPI\) return pollMapi\(manual\)/);
  const p = app.slice(app.indexOf('async function pollMapi'), app.indexOf('/* ---------- conferência periódica'));
  assert.ok(!/getText|fetch\(|localStorage|PSPush/.test(p));
  assert.match(app, /if \(!MODO_MAPI\) S\.saveErr = !save\(K\.pkg/);                  // sem texto dos chamados em texto aberto no aparelho
  assert.match(app, /if \(MODO_MAPI\) return true;     \/\/ sem pacote guardado/);
});

test('sem sino, sem botão do HUB e sem sair no modo MAPI', () => {
  assert.match(html, /body\.modo-mapi #btHub,body\.modo-mapi #btBell,body\.modo-mapi #btSair\{display:none !important\}/);
});

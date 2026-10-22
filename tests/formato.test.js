// Confere que o app lê os TXT no formato que o MAPI gera (tests/fixtures/pacote.json): chamados (app.js) e
// notificações (notif.js).
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const raiz = path.join(__dirname, '..');
const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote.json'), 'utf8'));

// ---- notif.js (IIFE que põe PSNotif em window)
function carregarNotif() {
  const win = {};
  const ctx = { window: win, document: { getElementById: () => null, addEventListener() {}, createElement: () => ({}) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, history: {}, setTimeout, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'notif.js'), 'utf8'), ctx);
  return win.PSNotif;
}

// ---- app.js: extrai só parseDate e parseTxt (o resto mexe no DOM)
function extrai(src, nome) {
  const i = src.indexOf('function ' + nome + '(');
  assert.ok(i >= 0, nome);
  let n = 0, j = src.indexOf('{', i);
  for (let k = j; k < src.length; k++) { if (src[k] === '{') n++; else if (src[k] === '}' && --n === 0) return src.slice(i, k + 1); }
  throw new Error('chave sem fecho: ' + nome);
}
function carregarParse() {
  const src = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8');
  const req = src.match(/const REQUIRED = [^\n]*;/)[0];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`const pad = n => String(n).padStart(2, '0'); ${req} ${extrai(src, 'parseDate')} ${extrai(src, 'parseTxt')}; this.parseTxt = parseTxt;`, ctx);
  return ctx.parseTxt;
}

test('o app lê o TXT dos chamados que o MAPI gera', () => {
  const p = carregarParse()(fx.esperado.dados);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.warns.length, 0);
  assert.equal(p.rows.length, 2);
  const r = p.rows.find(x => x.ID === '311');
  assert.equal(r.SISTEMA, 'SISTEMA EXEMPLO A');
  assert.equal(r.STATUS, 'ABERTO');
  assert.equal(r.CHAMADO, 'INC0000001');
  assert.equal(r.TIPO_FALHA, 'INDISPONIBILIDADE PARCIAL');
  assert.equal(r.GRUPOS_IMPACTADOS, 'CENTRALIZADA, CENTRO DE OPERAÇÕES');
  assert.equal(JSON.stringify([r._ini.getFullYear(), r._ini.getMonth(), r._ini.getDate(), r._ini.getHours(), r._ini.getMinutes()]), '[2026,9,20,8,22]');
  assert.equal(r._fim, null);
  const f = p.rows.find(x => x.ID === '310');
  assert.equal(f._fim.getHours(), 14);
  assert.equal(f.TIPO_FALHA, 'INTERMITÊNCIA');
});

test('o app lê as notificações que o MAPI gera (escapes, datas, obrigatória)', () => {
  const N = carregarNotif();
  const r = N.ler(fx.esperado.notificacoes);
  assert.equal(r.ok, true, r.err);
  assert.equal(r.avisos.length, 0);
  assert.equal(r.itens.length, 2);
  const a = r.itens.find(x => x.id === '1');
  assert.equal(a.tipo, 'CRITICO');
  assert.equal(a.obrig, true);
  assert.equal(a.ativo, true);
  assert.equal(a.titulo, 'Portal fora do ar');
  assert.equal(a.texto, 'O {b}Portal{/b} caiu {pink}agora{/pink}.\n\nContorno: {link=https://exemplo.com}site{/link}\\fim tab');
  assert.equal(a.ini.getHours(), 8);
  assert.equal(a.fim, null);
  const b = r.itens.find(x => x.id === '2');
  assert.equal(b.tipo, 'INFORMACAO');
  assert.equal(b.obrig, false);
  assert.equal(b.titulo, 'Aviso com acentuação: ação, coração');
  assert.equal(b.fim.getDate(), 1);
  assert.match(N.html(a.texto), /<strong>Portal<\/strong>/);
  assert.match(N.html(a.texto), /<a href="https:\/\/exemplo.com"/);
});

test('arquivo só com o cabeçalho = nenhuma notificação (sem erro)', () => {
  const N = carregarNotif();
  const cab = fx.esperado.notificacoes.split('\n')[0] + '\n';
  const r = N.ler(cab);
  assert.equal(r.ok, true);
  assert.equal(r.itens.length, 0);
});

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
  const idOk = src.match(/const idOk = [^\n]*;/)[0];
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(`const pad = n => String(n).padStart(2, '0'); ${req} ${idOk} ${extrai(src, 'parseDate')} ${extrai(src, 'splitTsv')} ${extrai(src, 'parseTxt')}; this.parseTxt = parseTxt;`, ctx);
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
  // estágio gerado pelo MAPI: campo entre aspas com quebra de linha e aspas internas, lido inteiro e sem criar chamado falso
  assert.equal(r.ESTAGIO, 'Chamado aberto e encaminhado.\nEquipe realizando "análise" inicial.');
  assert.equal(p.rows.find(x => x.ID === '310').ESTAGIO, '');
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

// ---- campos entre aspas, como o Oracle SQL Developer exporta (ESTAGIO tem quebra de linha)
const CAB = 'ID\tSISTEMA\tCHAMADO\tSTATUS\tESTAGIO\tDATA_INICIO\tDATA_FIM';
const linha = (id, est) => [id, 'SISTEMA X', 'INC1', 'ABERTO', est, '20/10/26 08:22:00,000000000', ''].join('\t');

test('campo entre aspas com quebra de linha, tabulação e aspas não quebra o arquivo', () => {
  const est = '"Chamado aberto.\r\nEquipe com ""análise"" inicial\tok"';
  const p = carregarParse()([CAB, linha('401', est), linha('402', ''), ''].join('\r\n'));
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows.length, 2);
  const r = p.rows.find(x => x.ID === '401');
  assert.match(r.ESTAGIO, /^Chamado aberto\./);
  assert.match(r.ESTAGIO, /\n/);                              // a quebra de linha fica no texto
  assert.match(r.ESTAGIO, /"análise"/);                       // "" vira uma aspa
  assert.match(r.ESTAGIO, /\tok$/);
  assert.equal(p.rows.find(x => x.ID === '402').ESTAGIO, '');
  assert.equal(p.warns.length, 0);
});

test('aspas sem fechamento (arquivo cortado) é recusado com mensagem clara', () => {
  const p = carregarParse()([CAB, linha('401', '"texto que nunca fecha'), linha('402', '')].join('\n'));
  assert.equal(p.ok, false);
  assert.match(p.err, /aspas sem fechamento/);
});

test('sem a coluna ESTAGIO o app lê normalmente', () => {
  const sem = 'ID\tSISTEMA\tCHAMADO\tSTATUS\tDATA_INICIO\tDATA_FIM\n401\tSISTEMA X\tINC1\tABERTO\t20/10/26 08:22:00,000000000\t\n';
  const p = carregarParse()(sem);
  assert.equal(p.ok, true, p.err);
  assert.equal(p.rows.length, 1);
  assert.ok(!p.rows[0].ESTAGIO);
});

test('registro com ID inválido ou número de colunas diferente do cabeçalho é ignorado com aviso', () => {
  const p = carregarParse()([CAB, linha('401', ''), linha('com espaco', ''), '403\tSISTEMA X\tINC1'].join('\n'));
  assert.equal(p.ok, true, p.err);
  assert.equal(JSON.stringify(p.rows.map(r => r.ID)), '["401"]');
  assert.ok(p.warns.length >= 1);
});

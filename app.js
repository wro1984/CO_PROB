/* Problemas Sistêmicos — andamento dos chamados em tempo real
   Fonte: dados.json, publicado pelo MAPI e CRIPTOGRAFADO (o site é público). Só abre quem tem acesso aprovado no MAPI:
   matrícula + chave. Dentro dele vão o sistemas.txt (TXT do SQL Developer, separado por tabulação, cabeçalho na
   1ª linha) e, opcionalmente, o notificacao.txt. O app confere o arquivo a cada minuto e registra toda mudança de
   status por ID. O que fica no aparelho é o pacote cifrado e um cofre cifrado com chave do aparelho. */
'use strict';

const VERSION = '1.41.0';
const POLL_MS = 60 * 1000;           // conferência do arquivo
const TICK_MS = 5 * 1000;            // relógio dos tempos em andamento
const RECENT_MS = 60 * 60 * 1000;    // selo NOVO / ALTERAÇÕES vale por 1 hora
const LOG_MAX = 300;                 // mudanças guardadas no aparelho
// histórico: ao entrar mostra o mês atual e o anterior; depois, um mês por vez ("Mostrar mês de Agosto")
const MESES_LONGO = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const REQUIRED = ['ID', 'SISTEMA', 'STATUS', 'DATA_INICIO'];
const KNOWN = ['ID', 'SISTEMA', 'CHAMADO', 'STATUS', 'CRITICIDADE', 'EVOLUCAO', 'SEGMENTO', 'IMPACTO_OPERACIONAL', 'ESTAGIO',
  'DATA_INICIO', 'DATA_FIM', 'TIPO_FALHA', 'GRUPOS_RESPONSAVEIS', 'GRUPOS_IMPACTADOS', 'AREA_ACIONADA',
  'ALERTA_ENVIADO', 'DATA_ATUALIZACAO', 'DADO_ATUALIZADO', 'TEMPO_DECORRIDO'];
// campos acompanhados: mudança em QUALQUER campo do chamado entra em "Últimas mudanças" e marca o card
// (ficam de fora só os de controle, que mudam a toda atualização: DATA_ATUALIZACAO, DADO_ATUALIZADO, TEMPO_DECORRIDO, FLAG)
const TRACK = [['SISTEMA', 'Sistema'], ['CHAMADO', 'Chamado'], ['STATUS', 'Status'], ['CRITICIDADE', 'Criticidade'], ['EVOLUCAO', 'Evolução'], ['SEGMENTO', 'Segmento'],
  ['IMPACTO_OPERACIONAL', 'Impacto'], ['DATA_INICIO', 'Início'], ['DATA_FIM', 'Fim'], ['TIPO_FALHA', 'Tipo de falha'], ['GRUPOS_RESPONSAVEIS', 'Grupos responsáveis'],
  ['GRUPOS_IMPACTADOS', 'Grupos impactados'], ['AREA_ACIONADA', 'Área acionada'], ['ALERTA_ENVIADO', 'Alerta enviado'], ['ESTAGIO', 'Estágio']];

// colunas que continuam sendo lidas (mudanças, conferência), mas não aparecem nos cards nem no detalhe
const OCULTAS = ['FLAG', 'TEMPO_DECORRIDO', 'DADO_ATUALIZADO', 'DATA_ATUALIZACAO'];

const K = { pkg: 'ps.pkg', cofre: 'ps.cofre', bell: 'ps.bell', pushReg: 'ps.pushReg', pedido: 'ps.pedido' };
// o que versões anteriores (sem login) guardavam em texto aberto no aparelho: é migrado para o cofre e apagado.
// Os cards fixados (alfinete) também ficam só no cofre cifrado: aqui não existe mais dado do chamado em texto aberto.
const LEGADO = ['ps.data', 'ps.snap', 'ps.log', 'ps.notif', 'ps.pins'];

/* ---------- armazenamento no aparelho ---------- */
function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

/* ---------- utilidades ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

// datas do Oracle: "20/10/26 08:22:00,000000000" (também aceita 20/10/2026 08:22 e 2026-10-20 08:22:00)
// devolve Date, null (vazio) ou undefined (inválida)
function parseDate(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  let y, mo, d, h = 0, mi = 0, se = 0;
  if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0); }
  else {
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (!m) return undefined;
    y = +m[1]; mo = +m[2]; d = +m[3]; h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return undefined;
  const dt = new Date(y, mo - 1, d, h, mi, se);
  if (dt.getMonth() !== mo - 1 || dt.getDate() !== d) return undefined;
  return dt;
}
const fHM = d => d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '–';
const fDM = d => d ? pad(d.getDate()) + '/' + pad(d.getMonth() + 1) : '–';
const fFull = d => d ? fDM(d) + '/' + String(d.getFullYear()).slice(2) + ' ' + fHM(d) : '–';
const dayKey = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const sameDay = (a, b) => a && b && dayKey(a) === dayKey(b);
function fDur(ms) {
  if (!(ms >= 0)) return '–';
  const t = Math.floor(ms / 60000);
  if (t < 1) return '<1 min';
  if (t < 60) return t + ' min';
  if (t < 1440) { const h = Math.floor(t / 60), m = t % 60; return h + 'h' + (m ? ' ' + pad(m) + 'min' : ''); }
  const d = Math.floor(t / 1440), h = Math.floor((t % 1440) / 60);
  return d + 'd' + (h ? ' ' + h + 'h' : '');
}
function fAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return 'há ' + s + ' s';
  const m = Math.floor(s / 60);
  if (m < 60) return 'há ' + m + ' min';
  return 'há ' + fDur(ms);
}
function dayLabel(d, now) {
  const y = new Date(now); y.setDate(y.getDate() - 1);
  const base = DIAS[d.getDay()] + ', ' + d.getDate() + ' ' + MESES[d.getMonth()];
  if (sameDay(d, now)) return 'Hoje · ' + base;
  if (sameDay(d, y)) return 'Ontem · ' + base;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/* ---------- regras do chamado ---------- */
const up = s => String(s || '').trim().toUpperCase();
function isOpen(r) {
  const s = up(r.STATUS);
  if (s === 'INDEVIDO' || s === 'FECHADO') return false;
  if (s === 'ABERTO') return true;
  return !r._fim;   // status desconhecido: aberto enquanto não tiver fim
}
const isInd = r => up(r.STATUS) === 'INDEVIDO';
function tipo(r) {
  const t = up(r.TIPO_FALHA);
  if (t.includes('TOTAL')) return { k: 'total', c: 'var(--fTotal)', n: 'Indisp. total', longo: 'Indisponibilidade total' };
  if (t.includes('PARCIAL')) return { k: 'parcial', c: 'var(--fParcial)', n: 'Indisp. parcial', longo: 'Indisponibilidade parcial' };
  if (t.includes('INTERMIT')) return { k: 'interm', c: 'var(--fInterm)', n: 'Intermitência', longo: 'Intermitência' };
  if (t.includes('LENTID')) return { k: 'lent', c: 'var(--fLent)', n: 'Lentidão', longo: 'Lentidão' };
  const n = r.TIPO_FALHA ? cap(r.TIPO_FALHA) : 'Sem tipo';
  return { k: 'outro', c: 'var(--fOutro)', n, longo: n };
}
function cap(s) { s = String(s || '').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
function critClass(c) {
  const n = parseInt(String(c || '').replace(/\D/g, ''), 10);
  if (n <= 1) return 'alta';
  if (n === 2) return 'media';
  return '';
}
const critRank = c => { const n = parseInt(String(c || '').replace(/\D/g, ''), 10); return isNaN(n) ? 9 : n; };
// aberto = falha (vermelho); fechado e indevido = neutro; outros status = em atenção
function stClass(s) { s = up(s); return s === 'ABERTO' ? 'a' : s === 'FECHADO' || s === 'INDEVIDO' || !s ? '' : 'e'; }
const statusTag = s => `<span class="st ${stClass(s)}">${esc(s || '—')}</span>`;

/* ---------- leitura do arquivo ---------- */
// Separa o arquivo em registros e campos (tabulação), respeitando aspas como o Oracle SQL Developer exporta:
// campo entre aspas pode ter quebra de linha, tabulação e aspas ("" = uma aspa). Devolve { regs: [{ v, ln }], aberto }.
function splitTsv(text) {
  const t = String(text || '').replace(/^\uFEFF/, ''), regs = [];
  let campo = '', reg = [], ln = 1, ini = 1, i = 0, n = t.length;
  const fechaReg = () => { reg.push(campo); campo = ''; if (reg.length > 1 || reg[0].trim() !== '') regs.push({ v: reg, ln: ini }); reg = []; };
  while (i < n) {
    const ch = t[i];
    if (ch === '"' && campo === '') {          // campo entre aspas
      i++;
      while (true) {
        if (i >= n) return { regs, aberto: ini };   // aspas sem fechamento: arquivo cortado ou estrutura quebrada
        const c = t[i];
        if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i += 2; continue; } i++; break; }
        if (c === '\r' && t[i + 1] === '\n') { campo += '\n'; i += 2; ln++; continue; }
        if (c === '\n' || c === '\r') ln++;
        campo += c === '\r' ? '\n' : c; i++;
      }
      continue;
    }
    if (ch === '\t') { reg.push(campo); campo = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') { if (ch === '\r' && t[i + 1] === '\n') i++; i++; fechaReg(); ln++; ini = ln; continue; }
    campo += ch; i++;
  }
  if (campo !== '' || reg.length) fechaReg();
  return { regs, aberto: 0 };
}
function parseTxt(text) {
  const sp = splitTsv(text);
  if (sp.aberto) return { ok: false, err: `aspas sem fechamento a partir da linha ${sp.aberto} (arquivo cortado ou com a estrutura quebrada)` };
  const lines = sp.regs;
  if (lines.length < 2) return { ok: false, err: 'arquivo vazio ou só com o cabeçalho' };
  const cols = lines[0].v.map(c => c.trim().toUpperCase());
  const miss = REQUIRED.filter(c => !cols.includes(c));
  if (miss.length) return { ok: false, err: 'faltam as colunas ' + miss.join(', ') + ' (o arquivo precisa ser separado por tabulação)' };
  // estrutura: registro com número de colunas diferente do cabeçalho = algum campo livre quebrou a linha sem aspas
  const tortos = lines.slice(1).filter(l => l.v.length !== cols.length);
  if (tortos.length && tortos.length > Math.max(2, (lines.length - 1) * 0.05)) return { ok: false, err: `${tortos.length} registros com número de colunas diferente do cabeçalho (a partir da linha ${tortos[0].ln}): estrutura quebrada; mantidos os últimos dados válidos` };
  const warns = [];
  const byId = new Map();
  for (let i = 1; i < lines.length; i++) {
    const v = lines[i].v;
    const r = {};
    cols.forEach((c, j) => { r[c] = (v[j] == null ? '' : v[j]).trim(); });
    const ln = lines[i].ln;
    if (v.length !== cols.length) warns.push(`Linha ${ln} (ID ${r.ID || '?'}): ${v.length} colunas, o cabeçalho tem ${cols.length}`);
    if (!r.ID) { warns.push(`Linha ${ln}: sem ID, ignorada`); continue; }
    if (!idOk(r.ID)) { warns.push(`Linha ${ln}: ID inválido ("${r.ID.slice(0, 30)}…"), ignorada`); continue; }
    r._ini = parseDate(r.DATA_INICIO);
    if (!r._ini) { warns.push(`Linha ${ln} (ID ${r.ID}): DATA_INICIO inválida ("${r.DATA_INICIO}"), ignorada`); continue; }
    r._fim = parseDate(r.DATA_FIM);
    if (r._fim === undefined) { warns.push(`Linha ${ln} (ID ${r.ID}): DATA_FIM inválida ("${r.DATA_FIM}"), tratada como sem fim`); r._fim = null; }
    if (r._fim && r._fim < r._ini) { warns.push(`ID ${r.ID}: DATA_FIM antes do início, tratada como sem fim`); r._fim = null; }
    r._upd = parseDate(r.DATA_ATUALIZACAO) || null;
    const prev = byId.get(r.ID);
    if (prev) {
      warns.push(`ID ${r.ID} repetido no arquivo: ficou a linha com a atualização mais recente`);
      if ((r._upd || 0) < (prev._upd || 0)) continue;
    }
    byId.set(r.ID, r);
  }
  const rows = [...byId.values()];
  if (!rows.length) return { ok: false, err: 'nenhuma linha válida' };
  return { ok: true, rows, cols, warns };
}

/* ---------- comparação por ID ---------- */
function snapOf(rows) {
  const s = {};
  rows.forEach(r => { const o = { U: r.DATA_ATUALIZACAO || '', SIS: r.SISTEMA, INC: r.CHAMADO || '' }; for (const [f] of TRACK) if (f in r) o[f] = r[f] || ''; s[r.ID] = o; });
  return s;
}
function diff(prev, rows, at) {
  const out = [];
  if (!prev || !Object.keys(prev).length) return out;
  const seen = new Set();
  for (const r of rows) {
    seen.add(r.ID);
    const p = prev[r.ID];
    const base = { at, id: r.ID, sis: r.SISTEMA, inc: r.CHAMADO || '' };
    if (!p) { out.push({ ...base, kind: 'novo', st: r.STATUS, evo: r.EVOLUCAO || '', est: r.ESTAGIO || '' }); continue; }   // est: 1º estágio (histórico de estágios)
    const ch = [];
    for (const [f, label] of TRACK) {
      if (!(f in p)) continue;   // campo que a cópia anterior ainda não guardava (ex.: depois de atualizar o app): não é mudança
      const a = p[f] || '', b = r[f] || '';
      if (a !== b) ch.push({ f, label, de: a, para: b });
    }
    if (ch.length) out.push({ ...base, kind: 'muda', ch });
    else if ((p.U || '') !== (r.DATA_ATUALIZACAO || '')) out.push({ ...base, kind: 'dados' });
  }
  const gone = Object.keys(prev).filter(id => !seen.has(id));
  if (gone.length > 3) out.push({ at, kind: 'saiu-varios', n: gone.length, ids: gone.slice(0, 50) });
  else gone.forEach(id => out.push({ at, id, sis: prev[id].SIS, inc: prev[id].INC, kind: 'saiu' }));
  return out;
}

/* ---------- busca do arquivo ---------- */
// No GitHub Pages, lê direto do repositório pela API (sem o cache de ~10 min do Pages).
// A conferência usa ETag: quando nada mudou, a resposta é 304 e não gasta a cota da API.
function ghRepo() {
  const h = location.hostname;
  if (!/\.github\.io$/i.test(h)) return null;
  if (new URLSearchParams(location.search).get('fonte') === 'arquivo') return null;
  const owner = h.split('.')[0];
  const first = location.pathname.split('/').filter(Boolean)[0];
  const repo = first && !/\.html?$/i.test(first) ? first : owner + '.github.io';
  return { owner, repo };
}
async function fetchApi(gh, arquivo, etag) {
  const url = `https://api.github.com/repos/${gh.owner}/${gh.repo}/contents/${arquivo}`;
  const headers = { Accept: 'application/vnd.github.raw' };
  if (etag) headers['If-None-Match'] = etag;
  const res = await fetch(url, { headers, cache: 'no-store' });
  if (res.status === 304) return { same: true, source: 'api' };
  if (res.status === 404) return { ausente: true, source: 'api' };   // arquivo não existe no repositório
  if (!res.ok) {
    const reset = +res.headers.get('X-RateLimit-Reset');
    const e = new Error('API ' + res.status);
    e.retryAt = reset ? reset * 1000 : Date.now() + 10 * 60 * 1000;
    throw e;
  }
  return { text: await res.text(), etag: res.headers.get('ETag') || '', source: 'api' };
}
async function fetchFile(arquivo) {
  const res = await fetch(arquivo + '?t=' + Date.now(), { cache: 'no-store' });
  if (res.status === 404) return { ausente: true, source: 'arquivo' };
  if (!res.ok) throw new Error('arquivo ' + res.status);
  return { text: await res.text(), source: 'arquivo' };
}
async function getText(arquivo, etag) {
  const gh = ghRepo();
  if (gh && Date.now() >= S.apiPauseUntil) {
    try { return await fetchApi(gh, arquivo, etag); }
    catch (e) { S.apiPauseUntil = e.retryAt || Date.now() + 10 * 60 * 1000; }
  }
  return fetchFile(arquivo);
}
/* ---------- estado ---------- */
const S = {
  rows: [], cols: [], warns: [],
  text: '', etag: '', source: '', loadedAt: 0, checkedAt: 0,
  net: 'init',            // ok | off | init
  fileErr: '',            // erro do último arquivo recebido (mantém o anterior)
  saveErr: false,         // falha ao guardar no aparelho
  goneWarn: 0,
  log: [],
  snap: null,
  cred: null,             // credencial do aparelho (chave da pessoa, não extraível)
  pushSecret: null, pushChave: null, pushAtivo: false,   // aviso no celular (vem do pacote; só em memória)
  pkgText: '',            // dados.json (cifrado) da última leitura
  apiPauseUntil: 0,
  busy: false,
  filter: 'todos', q: '', fSis: '', histCorte: null, feedAll: false,
  tab: 'oc', sheet: null,       // sheet: {mode:'det'|'list', id, list:{titulo, sub, ids, onClose}}
};
if (!Array.isArray(S.log)) S.log = [];
S.pins = [];   // cards fixados, o mais recente primeiro (vem do cofre cifrado; ver restaurar/guardar)
S.pend = [];   // sino ligado: atualizações ainda sem Ciente, a mais recente primeiro (também só no cofre cifrado)
S.pendMostrado = 0;   // quantas já foram mostradas nesta sessão (Fechar não reabre sem novidade)
S.atSel = [];         // IDs selecionados na janela Atualizações ([] = todos)
S.atMulti = false;    // modo seleção múltipla (botão +)
// limpeza de restos de leitura errada: versões antigas (antes da 1.30) partiam o arquivo quando um campo livre
// tinha quebra de linha, e pedaços de texto viravam "chamados" (ID = texto). ID válido não tem espaço nem aspas.
const idOk = id => /^[^\s"]{1,30}$/.test(String(id == null ? '' : id));
function limparRestos() {
  try {
    if (S.snap && Object.keys(S.snap).some(k => !idOk(k))) { S.snap = null; S.limparSaiu = true; }   // cópia de comparação corrompida: recomeça do próximo arquivo, sem mudanças falsas
    S.log = S.log.filter(c => c.id == null ? (c.kind !== 'saiu-varios' || (c.ids || []).every(idOk)) : idOk(c.id));
    S.pins = (Array.isArray(S.pins) ? S.pins : []).filter(idOk);
    S.pend = (Array.isArray(S.pend) ? S.pend : []).filter(c => c.id == null ? (c.kind !== 'saiu-varios' || (c.ids || []).every(idOk)) : idOk(c.id));
  } catch (e) { /* segue sem limpar */ }
}

function applyText(text, meta, fromStore) {
  const p = parseTxt(text);
  if (!p.ok) return p;
  S.rows = p.rows; S.cols = p.cols; S.warns = p.warns; S.text = text;
  if (S.limparSaiu) {   // depois de cópia corrompida: "saiu do arquivo" de chamado que continua no arquivo era falso
    S.limparSaiu = false;
    const tem = new Set(p.rows.map(r => r.ID)), antes = S.log.length;
    S.log = S.log.filter(c => !((c.kind === 'saiu' && tem.has(c.id)) || (c.kind === 'saiu-varios' && (c.ids || []).length && c.ids.every(i => tem.has(i)))));
    if (S.log.length !== antes) guardarCofre();
  }
  if (meta) { S.etag = meta.etag || S.etag; S.source = meta.source || S.source; S.loadedAt = meta.loadedAt || S.loadedAt; }
  if (!fromStore) {
    const at = new Date().toISOString();
    const changes = diff(S.snap, p.rows, at);
    const many = changes.find(c => c.kind === 'saiu-varios');
    S.goneWarn = many ? many.n : 0;
    if (changes.length) { S.log = changes.concat(S.log).slice(0, LOG_MAX); announce(changes); }
    S.snap = snapOf(p.rows);
  } else if (!S.snap) {
    S.snap = snapOf(p.rows);
  }
  return p;
}

/* ---------- acesso: login, pacote cifrado e cofre do aparelho ---------- */
const dec = bytes => new TextDecoder().decode(bytes);

// Abre o dados.json com a credencial e aplica: chamados (applyText) e notificações.
// Devolve {ok} | {ok:false, err} | {ok:false, semAcesso:true, err}
async function aplicarPacote(pkgText, meta, fromStore) {
  let pacote;
  try { pacote = JSON.parse(pkgText); } catch (e) { return { ok: false, err: 'dados.json inválido (não é um JSON)' }; }
  let campos;
  try { campos = await PSCripto.abrir(pacote, S.cred); }
  catch (e) {
    if (e.code === 'sem_acesso') return { ok: false, semAcesso: true, err: e.message };
    return { ok: false, err: e.message || 'não consegui abrir o dados.json' };
  }
  const p = applyText(dec(campos.dados), meta, fromStore);
  if (!p.ok) return p;
  S.pkgText = pkgText;
  S.pushSecret = campos.pushSecret; S.pushChave = campos.pushChave;
  sincronizarPush();
  if (window.PSNotif && PSNotif.versao === VERSION) PSNotif.aplicar(campos.notificacoes == null ? null : dec(campos.notificacoes), meta);
  return p;
}

// guarda no aparelho: o pacote (já cifrado) e o cofre (mudanças vistas), cifrado com a chave do aparelho
let cofreT = 0;
function guardar() {
  S.saveErr = !save(K.pkg, { text: S.pkgText, etag: S.etag, source: S.source, loadedAt: S.loadedAt });
  guardarCofre();
}
// só o cofre (mudanças vistas, cards fixados e atualizações sem Ciente): usado também quando a pessoa fixa ou solta um card
function guardarCofre() {
  clearTimeout(cofreT);
  cofreT = setTimeout(async () => {
    const selo = await PSCripto.selar({ snap: S.snap, log: S.log, pins: S.pins, pend: S.pend });
    try { if (selo) localStorage.setItem(K.cofre, selo); } catch (e) { /* sem espaço: o pacote guardado basta */ }
  }, 300);
}

// apaga TUDO o que este app guardou no aparelho (sair, ou acesso removido) e volta para a tela de entrada
async function limparAparelho() {
  try { if (window.PSPush && 'serviceWorker' in navigator) await PSPush.desinscrever(await navigator.serviceWorker.getRegistration()); } catch (e) { /* segue */ }
  try { await PSCripto.apagarTudo(); } catch (e) { /* segue */ }
  try { Object.keys(localStorage).filter(k => k.startsWith('ps.')).forEach(k => localStorage.removeItem(k)); } catch (e) { /* segue */ }
}
async function sair() {
  if (!confirm('Sair deste aparelho? Os dados guardados nele serão apagados e você precisará da matrícula e da chave para entrar de novo.')) return;
  await limparAparelho();
  location.reload();
}
async function perderAcesso(msg) {
  const peloHub = S.cred && S.cred.via === 'hub';
  await limparAparelho();     // só o que é DESTE app: a credencial do HUB fica (sair de tudo é no HUB)
  try {
    sessionStorage.setItem('ps.msgLogin', msg || 'Seu acesso foi removido.');
    // entrou pelo HUB e o perfil não tem este app: na recarga não tenta o HUB de novo (senão recarregaria sem parar)
    if (peloHub) sessionStorage.setItem('ps.ignorarHub', String(Date.now()));
  } catch (e) { /* segue */ }
  location.reload();
}
// credencial do HUB, a não ser logo depois de ela ter sido recusada (ver perderAcesso)
async function credDoHub() {
  try {
    const t = +sessionStorage.getItem('ps.ignorarHub') || 0;
    if (Date.now() - t < 15000) return null;
    sessionStorage.removeItem('ps.ignorarHub');
  } catch (e) { /* segue */ }
  return PSCripto.lerCredHub();
}

function mostrarLogin(msg) {
  document.body.classList.add('ps-login');
  $('login').hidden = false;
  let aviso = msg || '';
  try { const m = sessionStorage.getItem('ps.msgLogin'); if (m) { aviso = aviso || m; sessionStorage.removeItem('ps.msgLogin'); } } catch (e) { /* segue */ }
  $('loginErro').textContent = aviso;
  $('loginMat').focus();
}
function esconderLogin() { document.body.classList.remove('ps-login'); $('login').hidden = true; }

async function fazerLogin(ev) {
  ev.preventDefault();
  const mat = $('loginMat').value, chave = $('loginChave').value, erro = $('loginErro'), btn = $('loginBtn');
  erro.textContent = '';
  if (!String(mat).trim() || !String(chave).trim()) { erro.textContent = 'Informe a matrícula e a chave.'; return; }
  if (!PSCripto.codigoValido(chave)) { erro.textContent = 'A chave está incompleta. Confira o que você recebeu.'; return; }
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    let r;
    try { r = await getText('dados.json', ''); }
    catch (e) { throw new Error('Sem conexão. Para entrar pela primeira vez o aparelho precisa estar na internet.'); }
    if (r.ausente || !r.text) throw new Error('O app ainda não tem dados publicados. Fale com o administrador.');
    let pacote;
    try { pacote = JSON.parse(r.text); } catch (e) { throw new Error('Os dados publicados estão ilegíveis. Tente de novo em instantes.'); }
    const ent = await PSCripto.entrar(pacote, mat, chave);
    S.cred = ent.cred;
    let guardou = true;
    try { await PSCripto.salvarCred(ent.cred); } catch (e) { guardou = false; }
    save(K.pkg, { text: r.text, etag: r.etag || '', source: r.source, loadedAt: Date.now() });
    $('loginChave').value = '';
    await entrarNoApp();
    if (!guardou) toast('Este navegador não deixou guardar o acesso: ao fechar o app você vai precisar entrar de novo.', false, 7000);
  } catch (e) {
    erro.textContent = e.message || 'Não foi possível entrar.';
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
}

/* ---------- conferência periódica ---------- */
async function poll(manual) {
  if (S.busy || !S.cred) return;
  S.busy = true;
  $('btRefresh').classList.add('spin');
  try {
    const r = await getText('dados.json', S.etag);
    if (r.ausente) throw new Error('dados.json não encontrado');
    S.net = 'ok';
    S.checkedAt = Date.now();
    if (r.same || r.text === S.pkgText) {
      if (r.etag) S.etag = r.etag;
      if (manual) toast('Nenhuma mudança desde a última conferência.');
    } else {
      const p = await aplicarPacote(r.text, { etag: r.etag, source: r.source, loadedAt: Date.now() }, false);
      if (p.semAcesso) { await perderAcesso(p.err); return; }       // acesso removido ou chave trocada no MAPI
      if (!p.ok) {
        S.fileErr = p.err;
        if (r.etag) S.etag = r.etag;   // não insiste no mesmo arquivo com erro
      } else { S.fileErr = ''; guardar(); }
      render();
    }
  } catch (e) {
    S.net = 'off';
    if (manual) toast('Sem conexão. Mostrando a última cópia guardada.');
  } finally {
    S.busy = false;
    $('btRefresh').classList.remove('spin');
    renderSync(); renderBanners();
  }
}

/* ---------- avisos de mudança ---------- */
function changeText(c) {
  if (c.kind === 'novo') return `${c.sis}: novo chamado (${c.st}${c.evo ? ' · ' + c.evo : ''})`;
  if (c.kind === 'muda') {
    const st = c.ch.find(x => x.f === 'STATUS'), ev = c.ch.find(x => x.f === 'EVOLUCAO');
    if (st) return `${c.sis}: ${st.de || '—'} → ${st.para || '—'}`;
    if (ev) return `${c.sis}: ${ev.para || 'evolução alterada'}`;
    return `${c.sis}: ${c.ch.map(x => x.label.toLowerCase()).join(', ')} alterado`;
  }
  if (c.kind === 'saiu') return `${c.sis}: saiu do arquivo`;
  if (c.kind === 'saiu-varios') return `${c.n} chamados saíram do arquivo`;
  return `${c.sis}: dados atualizados`;
}
function announce(changes) {
  const imp = changes.filter(c => c.kind !== 'dados');
  if (!imp.length) return;
  const sino = load(K.bell, false);
  if (sino) { S.pend = imp.concat(S.pend).slice(0, PEND_MAX); guardarCofre(); renderBell(); }
  if (!(sino && podeAbrirAtual())) toast(imp.length === 1 ? changeText(imp[0]) : imp.length + ' mudanças nos chamados · toque para ver', true);
  if (sino) setTimeout(() => abrirAtualizacoes(false), 50);
  if (document.hidden && !S.pushAtivo && sino && 'Notification' in window && Notification.permission === 'granted') {
    const title = imp.length === 1 ? changeText(imp[0]) : imp.length + ' mudanças nos chamados';
    const body = imp.length === 1 ? (imp[0].inc || '') : imp.slice(0, 4).map(changeText).join('\n');
    const opt = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'ps-mudancas', renotify: true };
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then(reg => reg.showNotification(title, opt)).catch(() => { try { new Notification(title, opt); } catch (e) {} });
    } else { try { new Notification(title, opt); } catch (e) {} }
  }
}
let toastT;
function toast(msg, toFeed, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.onclick = () => { t.classList.remove('show'); if (toFeed) { setTab('oc'); $('feed').scrollIntoView({ behavior: 'smooth', block: 'center' }); } };
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), ms || 5000);
}


/* ---------- desenho ---------- */
function unionMs(list, from, to) {
  const iv = list.map(([a, b]) => [Math.max(a, from), Math.min(b, to)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let tot = 0, cs = -1, ce = -1;
  for (const [a, b] of iv) {
    if (a > ce) { if (ce > cs) tot += ce - cs; cs = a; ce = b; } else if (b > ce) ce = b;
  }
  if (ce > cs) tot += ce - cs;
  return tot;
}
const endOf = (r, now) => (r._fim ? r._fim.getTime() : (isOpen(r) ? now : r._ini.getTime()));
function recentKind(id, now) {
  for (const c of S.log) {
    if (now - Date.parse(c.at) > RECENT_MS) break;
    if (c.id === id && (c.kind === 'novo' || c.kind === 'muda')) return c.kind;
  }
  return '';
}
const ordemAtivas = (open = openRows()) => S.pins.map(id => open.find(r => r.ID === id)).filter(Boolean).concat(open.filter(r => !S.pins.includes(r.ID)));
const openRows = () => S.rows.filter(isOpen).sort((a, b) => critRank(a.CRITICIDADE) - critRank(b.CRITICIDADE) || a._ini - b._ini);

// linha de chamado (Chamados de hoje, Histórico e listas do Painel)
// ID da solicitação no sistêmico: cápsula só com borda, à esquerda do nome do sistema (todas as listas)
const idCap = id => id ? `<span class="idc num" title="ID ${esc(id)}">${esc(id)}</span>` : '';
function hiRow(r, now, comDia) {
  const t = tipo(r), ind = isInd(r), ab = isOpen(r);
  const d0 = comDia ? fDM(r._ini) + ' ' : '';
  const range = `${d0}${fHM(r._ini)}`;   // só o início (o fim fica no detalhe)
  const du = ab ? `<span data-since="${r._ini.getTime()}">${fDur(now - r._ini)}</span>` : r._fim ? fDur(r._fim - r._ini) : '–';
  const st = ab ? 'em andamento' : ind ? 'Indevido' : cap(r.EVOLUCAO || r.STATUS);
  return `<button class="hi k-${t.k}${ind ? ' ind' : ''}${ab ? ' aberto' : ''}" data-id="${esc(r.ID)}" style="--fc:${t.c}"><span class="bar"></span>
    <div style="min-width:0"><div class="s">${idCap(r.ID)}<span class="nm">${esc(r.SISTEMA)}</span></div><div class="d num"><span class="dr">${range}</span><span class="cap-t k-${t.k}">${esc(t.longo)}</span></div></div>
    <div class="du num">${du}<small>${esc(st)}</small></div></button>`;
}

/* ---- 1) Ocorrências: ativas (cards grandes) + ocorrências de hoje + últimas alterações ---- */
function renderOpen() {
  const now = Date.now();
  const open = openRows();
  $('ctOpen').textContent = open.length;
  $('ctOpen').classList.toggle('hot', open.length > 0);
  const bd = $('navBd'); bd.hidden = !open.length; bd.textContent = open.length;
  if (!open.length) {
    const last = S.rows.filter(r => !isInd(r) && r._fim).sort((a, b) => b._fim - a._fim)[0];
    $('open').innerHTML = `<div class="calm-card" role="status"><div class="cc-top"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg><div class="cc-tx"><b>Nenhuma ocorrência ativa</b><span>Todos os sistemas operando.</span></div></div>` +
      (last ? `<div class="ult"><small>Último normalizado:</small><div class="us"><span class="cc-id num">${esc(last.ID)}</span><span class="cc-nm">${esc(last.SISTEMA)} · ${sameDay(last._fim, new Date()) ? 'hoje' : fDM(last._fim)} às ${fHM(last._fim)}</span></div></div>` : '') + `</div>`;
    return;
  }
  const ordem = ordemAtivas(open);
  $('open').innerHTML = ordem.map(r => {
    const t = tipo(r), rk = recentKind(r.ID, now), fx = S.pins.includes(r.ID), al = r.ALERTA_ENVIADO === '1';
    const ini = sameDay(r._ini, new Date()) ? 'hoje' : fDM(r._ini);
    const seg = segTxt(r.SEGMENTO);
    return `<button class="oc k-${t.k}${rk ? ' com-selo' : ''}${fx ? ' fixo' : ''}" data-id="${esc(r.ID)}">
      <div class="h"><span class="sis" title="${esc(r.SISTEMA)}">${esc(r.SISTEMA)}</span>
        <span class="pin${fx ? ' on' : ''}" role="button" tabindex="0" data-pin="${esc(r.ID)}" aria-pressed="${fx}" aria-label="${fx ? 'Desafixar' : 'Fixar no topo'}" title="${fx ? 'Desafixar' : 'Fixar no topo'}">${PIN_SVG}</span>
        <span class="cap-id num" title="ID da solicitação no sistêmico">ID ${esc(r.ID)}</span></div>
      ${r.IMPACTO_OPERACIONAL ? `<div class="imp">${esc(r.IMPACTO_OPERACIONAL)}</div>` : ''}
      <div class="tl"><span class="cap-t k-${t.k}">${esc(t.longo)}</span>${seg ? `<span class="para">para <b>${esc(seg)}</b></span>` : ''}</div>
      <div class="ft"><div class="timer num"><small>aberto há</small><span class="tm" role="button" tabindex="0" data-crono="${esc(r.ID)}" aria-label="Tempo decorrido: abrir o cronômetro" title="Tempo decorrido"><span class="crn">${CRONO_SVG}</span><span data-since="${r._ini.getTime()}">${fDur(now - r._ini)}</span></span></div>
        <div class="when">${r.ESTAGIO ? `<span class="evo tem-est" role="button" tabindex="0" data-est="${esc(r.ID)}" aria-label="${esc(r.EVOLUCAO || 'Estágio')}: ver ${nEst(r) > 1 ? `os ${nEst(r)} estágios` : 'o estágio'}" title="Ver o estágio">${INFO_SVG}<span>${esc(r.EVOLUCAO || 'Estágio')}</span><span class="est-n num" aria-hidden="true">${nEst(r)}</span></span>` : r.EVOLUCAO ? `<span class="evo">${esc(r.EVOLUCAO)}</span>` : ''}<span class="ini num">início ${ini} ${fHM(r._ini)}</span></div></div>
      ${barraDia(r, now)}
      ${rk ? `<span class="selo" role="button" tabindex="0" data-log="${esc(r.ID)}" aria-label="${rk === 'novo' ? 'Novo' : 'Alterações'}: ver a última mudança" title="Ver a última mudança">${rk === 'novo' ? 'NOVO' : 'ALTERAÇÕES'}</span>` : ''}
      ${al ? `<span class="alrt" role="button" tabindex="0" data-alerta="${esc(r.ID)}" aria-label="Alerta enviado" title="Alerta enviado">${SIRENE_SVG}</span>` : ''}
    </button>`;
  }).join('');
}
// alfinete (fixar card) e sirene (alerta enviado): traço fino, no estilo das letras
const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 17v5"/><path class="pc" d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>';
const SIRENE_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18v-5a5 5 0 0 1 10 0v5"/><path d="M5 21a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1z"/><path d="M12 2v1.5M3.5 6.5l1.2 1M20.5 6.5l-1.2 1"/><path d="M10 13a2 2 0 0 1 2-2"/></svg>';
// fixar/desafixar: quem é fixado vai para o topo (o último fixado fica em cima); desafixado volta à ordem normal
function alternarPin(id) {
  const i = S.pins.indexOf(id);
  if (i >= 0) S.pins.splice(i, 1); else S.pins.unshift(id);
  if (S.rows.length) S.pins = S.pins.filter(x => S.rows.some(r => r.ID === x));   // tira IDs que saíram do arquivo
  guardarCofre();
  renderOpen();
  if (i < 0) { const c = document.querySelector(`#open .oc[data-id="${CSS.escape(id)}"]`); if (c) { c.classList.add('subiu'); setTimeout(() => c.classList.remove('subiu'), 700); } }
}
// janela informativa do alerta enviado
const AL = { aberto: false, hist: false, ignorarPop: false };
// janela informativa (mesma caixa para o alerta enviado e para as últimas mudanças do card)
function abrirInfo(titulo, corpo, icone, acoes, faixa) {
  clearInterval(AL.tick); AL.tipo = '';
  clearTimeout(toastT); $('toast').classList.remove('show');   // o balão não fica por cima da janela
  let bg = $('alBg');
  if (!bg) {
    bg = document.createElement('div'); bg.id = 'alBg'; bg.className = 'nt-bg'; bg.hidden = true;
    bg.innerHTML = '<div class="nt t-INFORMACAO" id="alBox" role="dialog" aria-modal="true" aria-labelledby="alTit" tabindex="-1"></div>';
    bg.addEventListener('click', e => { if (e.target === bg) fecharAlerta(); });
    document.body.appendChild(bg);
  }
  const ic = icone != null ? icone : (window.PSNotif && PSNotif.icone ? PSNotif.icone('INFORMACAO') : '');
  $('alBox').className = 'nt ' + (faixa || (icone != null ? 't-INTERROGACAO' : 't-INFORMACAO'));   // compartilhar: faixa roxa do app; avisos: verde de informação
  $('alBox').innerHTML = `<div class="nt-h">${ic ? `<span class="nt-ic">${ic}</span>` : ''}<h3 id="alTit">${titulo}</h3></div>
    <div class="nt-corpo">${corpo}</div>
    <div class="nt-acoes">${acoes || ''}<button class="nt-bt" id="alX" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg><span>Fechar</span></button></div>`;
  $('alX').onclick = () => fecharAlerta();
  bg.hidden = false; document.body.classList.add('al-on'); document.documentElement.classList.add('trava');
  if (!AL.aberto) { try { history.pushState({ alerta: 1 }, ''); AL.hist = true; } catch (e) { AL.hist = false; } }
  AL.aberto = true;
  $('alBox').scrollTop = 0;
  $('alBox').focus({ preventScroll: true });
}
function abrirAlerta(id) {
  const r = S.rows.find(x => x.ID === id); if (!r) return;
  abrirInfo('Alerta enviado', `<p class="al-sis"><span class="idc num">${esc(r.ID)}</span> <b>${esc(r.SISTEMA)}</b></p>
      <p>Foi enviado um <b>alerta</b> para <b>reforçar a solicitação com a área responsável</b>${r.AREA_ACIONADA && r.AREA_ACIONADA !== 'undefined' ? ` (<b>${esc(r.AREA_ACIONADA)}</b>)` : ''}.</p>
      <p>O chamado continua em acompanhamento até ser normalizado.</p>`, `<span class="ic-verm">${SIRENE_SVG}</span>`, '', 't-CRITICO');
}
// cronômetro: tempo decorrido correndo a cada segundo, em horas acumuladas (ex.: 74:12:05), + análise do histórico
const CRONO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2h4"/><path d="m12 14 3-3"/><circle cx="12" cy="14" r="8"/></svg>';
function relogio(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function abrirCrono(id) {
  const r = S.rows.find(x => x.ID === id); if (!r) return;
  const now = Date.now(), ini = r._ini.getTime(), open = isOpen(r);
  const fim = () => open ? Date.now() : endOf(r, Date.now());
  abrirInfo('Tempo decorrido', `<p class="al-sis"><span class="idc num">${esc(r.ID)}</span> <b>${esc(r.SISTEMA)}</b></p>
      <div class="crono"><div class="cr-n num" id="crN" aria-live="off">${relogio(fim() - ini)}</div>
        <div class="cr-u"><span>horas</span><span>min</span><span>seg</span></div>
        <div class="cr-d">${open ? 'aberto' : 'durou'} desde ${fFull(r._ini)} · ${fDur(fim() - ini)}</div></div>
      ${analiseHtml(r, now, true)}
      ${ultimasOcorr(r, now)}`, icoRoxo(CRONO_SVG));
  if (open) AL.tick = setInterval(() => { const e = $('crN'); if (!e || !AL.aberto) { clearInterval(AL.tick); return; } e.textContent = relogio(Date.now() - ini); }, 1000);
}
// últimas 3 ocorrências do mesmo problema (mesmo sistema e tipo de falha), sem repetir nome/tipo: só os números
function ultimasOcorr(r, now) {
  const k = tipo(r).k, sis = up(r.SISTEMA);
  const ant = S.rows.filter(x => x.ID !== r.ID && up(x.SISTEMA) === sis && tipo(x).k === k && !isInd(x) && x._ini <= r._ini).sort((a, b) => b._ini - a._ini).slice(0, 3);
  const exp = x => window.PSPainel ? PSPainel.msExpediente({ ini: x._ini, fimCalc: new Date(endOf(x, now)) }) : null;
  return `<h5 class="uo-t">Últimas ocorrências</h5>` + (ant.length
    ? `<table class="uo"><thead><tr><th>Data e hora</th><th>Tempo decorrido</th><th>Impacto no CO</th></tr></thead><tbody>${ant.map(x => { const e = exp(x);
        return `<tr data-uo="${esc(x.ID)}" tabindex="0" role="button" aria-label="Ver o detalhe da ocorrência de ${fDM(x._ini)} às ${fHM(x._ini)}" title="Ver o detalhe"><td class="num">${fDM(x._ini)}/${String(x._ini.getFullYear()).slice(2)} ${fHM(x._ini)}</td><td class="num">${fDur(endOf(x, now) - x._ini)}${isOpen(x) ? ' <small>em andamento</small>' : ''}</td><td class="num">${e == null ? '—' : e ? fDur(e) : 'fora do expediente'}</td></tr>`; }).join('')}</tbody></table>
      <p class="uo-obs">Impacto no CO = tempo dentro do expediente (08h–21h). Toque numa linha para ver o detalhe.</p>`
    : `<p class="uo-vazio">Não há ocorrências anteriores deste problema na base.</p>`);
}
// linha das últimas ocorrências / item das Atualizações: abre o detalhe POR CIMA da janela.
// A janela continua aberta embaixo; ao fechar o detalhe você volta para ela. Ela só fecha no botão Fechar (ou Ciente).
function abrirOcorrencia(id) {
  if (!S.rows.some(r => r.ID === id)) return;
  if (AL.aberto) document.body.classList.add('sheet-sobre');
  openSheet(id);
  if (!S.sheet) document.body.classList.remove('sheet-sobre');
}
// estágio: texto livre do operador para o campo; só vale enquanto o chamado está aberto
const INFO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M12 16v-5M12 8h.01"/></svg>';
const resumoEst = t => String(t || '').replace(/\s+/g, ' ').trim() || '—';
// histórico de estágios do chamado (mais recente primeiro), montado com as mudanças que este aparelho registrou:
// o 1º estágio vem do "novo chamado"; cada troca de ESTAGIO entra com a hora em que foi vista.
// Se o aparelho só conheceu o chamado depois de aberto, o estágio anterior à 1ª troca vista entra sem hora ("antes de …").
function estagios(r) {
  const ev = S.log.filter(c => c.id === r.ID && ((c.kind === 'muda' && c.ch.some(y => y.f === 'ESTAGIO')) || (c.kind === 'novo' && c.est)));
  const out = ev.map(c => c.kind === 'novo' ? { txt: c.est, at: new Date(c.at) } : (y => ({ txt: y.para, at: new Date(c.at), de: y.de }))(c.ch.find(y => y.f === 'ESTAGIO')));
  const velho = out[out.length - 1];
  if (velho && velho.de && !ev.some(c => c.kind === 'novo')) out.push({ txt: velho.de, antes: velho.at });
  const atual = String(r.ESTAGIO || '').trim();
  if (atual && (!out.length || String(out[0].txt || '').trim() !== atual)) out.unshift({ txt: r.ESTAGIO, at: r._upd || null });
  const lim = t => String(t || '').replace(/\s+/g, ' ').trim();
  return out.filter(x => lim(x.txt)).filter((x, i, a) => i === 0 || lim(x.txt) !== lim(a[i - 1].txt));
}
const nEst = r => r.ESTAGIO ? Math.max(1, estagios(r).length) : 0;
const dataHora = d => `${fDM(d)}/${String(d.getFullYear()).slice(2)} ${fHM(d)}`;
function abrirEstagio(id) {
  const r = S.rows.find(x => x.ID === id); if (!r || !r.ESTAGIO) return;
  const h = estagios(r), n = h.length;
  abrirInfo(`Estágio${n > 1 ? ` <span class="nt-cont num">(${n})</span>` : ''}`, `<p class="al-sis"><span class="idc num">${esc(r.ID)}</span> <b>${esc(r.SISTEMA)}</b></p>
      <div class="est-st"><b>${esc(r.EVOLUCAO || cap(r.STATUS))}</b></div>
      <ol class="est-hist">${h.map((x, i) => `<li${i ? '' : ' class="atual"'}><div class="est-qd num">${x.at ? dataHora(x.at) : x.antes ? `antes de ${dataHora(x.antes)}` : ''}${i ? '' : '<span class="est-at">atual</span>'}</div><div class="est-tx">${esc(x.txt)}</div></li>`).join('')}</ol>`,
    `<span class="ic-roxo ic-info">${INFO_SVG}</span>`);
}
// selo NOVO / ALTERAÇÕES: mostra só a mudança mais recente desse chamado (a que o selo está anunciando)
function abrirLog(id) {
  const r = S.rows.find(x => x.ID === id); if (!r) return;
  const now = Date.now(), ult = S.log.find(c => c.id === id && (c.kind === 'novo' || c.kind === 'muda')) || S.log.find(c => c.id === id);
  abrirInfo(ult && ult.kind === 'novo' ? 'Novo chamado' : 'Última mudança', `<p class="al-sis"><span class="idc num">${esc(r.ID)}</span> <b>${esc(r.SISTEMA)}</b></p>` +
    (ult ? `<div class="feed log-jan">${feedItem(ult, now, true).replace(/data-id="[^"]*"/, 'disabled')}</div>` : '<p>Nenhuma mudança registrada neste aparelho.</p>'));
}
function fecharAlerta(porHistorico) {
  if (!AL.aberto) return;
  AL.aberto = false; AL.tipo = ''; clearInterval(AL.tick); $('alBg').hidden = true; document.body.classList.remove('al-on');
  if (!document.body.matches('.nt-on, .sheet-on')) document.documentElement.classList.remove('trava');
  if (!porHistorico && AL.hist) { AL.ignorarPop = true; history.back(); }
  AL.hist = false;
}

// segmentos afetados: "B2B, B2C, CAMPO" → "B2B, B2C e CAMPO"
function segTxt(s) {
  const l = String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  return l.length < 2 ? (l[0] || '') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
}
// barra do dia (expediente 08h–21h de HOJE): trecho que o chamado ocupou hoje, até agora.
// Chamado que vem de ontem começa a contar às 08h de hoje. Atualiza ao vivo (tick).
const EXP_INI = 8, EXP_FIM = 21;
const POS14 = ((14 - EXP_INI) / (EXP_FIM - EXP_INI) * 100).toFixed(2);   // marca das 14h na barra
function trechoHoje(iniMs, now) {
  const d = new Date(now), a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), EXP_INI).getTime(), b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), EXP_FIM).getTime();
  const s = Math.max(iniMs, a), e = Math.min(now, b);
  const tot = b - a;
  return { l: e > s ? (s - a) / tot * 100 : 0, w: e > s ? (e - s) / tot * 100 : 0, ms: Math.max(0, e - s), antes: now < a, deOntem: iniMs < new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() };
}
function barraDiaTxt(x) {
  if (x.antes) return 'expediente começa às 08h';
  if (!x.ms) return 'fora do expediente hoje';
  return `${fDur(x.ms)} hoje no expediente${x.deOntem ? ' · vem de antes de hoje' : ''}`;
}
function barraDia(r, now) {
  const x = trechoHoje(r._ini.getTime(), now);
  return `<div class="dbar" data-dia="${r._ini.getTime()}" role="img" aria-label="Ocupação de hoje das 08h às 21h: ${barraDiaTxt(x)}">
      <div class="trk"><span class="m14" style="left:${POS14}%"></span><span class="fill" style="left:${x.l.toFixed(2)}%;width:${x.w.toFixed(2)}%"></span></div>
      <div class="esc num"><span>08h</span><span class="dtx">${barraDiaTxt(x)}</span><span>21h</span></div></div>`;
}
// chamados de hoje: abertos hoje, encerrados hoje ou ainda em andamento (os abertos primeiro)
function renderHoje() {
  const now = Date.now();
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const list = S.rows.filter(r => r._ini >= d0 || isOpen(r) || (r._fim && r._fim >= d0))
    .sort((a, b) => (isOpen(b) - isOpen(a)) || b._ini - a._ini);
  $('ctHoje').textContent = list.length;   // mesma cápsula de contagem de "Ocorrências ativas"
  $('hoje').innerHTML = list.length ? `<div class="lst">${list.map(r => hiRow(r, now, !sameDay(r._ini, new Date(now)))).join('')}</div>`
    : `<div class="lst"><div class="empty okt">Nenhum chamado hoje.</div></div>`;
}

// completo = true (janela do selo e "Mudanças registradas" do detalhe): o estágio aparece inteiro, com as quebras de linha; nas listas fica abreviado numa linha
function feedItem(c, now, completo) {
  const d = new Date(c.at);
  const hr = `<div class="hr num">${fHM(d)}${sameDay(d, new Date(now)) ? '' : `<small>${fDM(d)}</small>`}</div>`;
  let tx;
  const nome = `<span class="fn">${idCap(c.id)}<span class="fs">${esc(c.sis)}</span></span>`;
  // cada campo que mudou vira uma linha "• Campo: valor que entrou" (sem o valor anterior)
  const li = (rot, val, cls) => `<li${cls ? ` class="${cls}"` : ''}><b>${esc(rot)}${val != null ? ':' : ''}</b>${val != null ? ' ' + esc(val) : ''}</li>`;
  const valor = x => {
    if (!x.para) return x.f === 'DATA_FIM' ? 'retirado' : '—';
    if (x.f === 'DATA_FIM' || x.f === 'DATA_INICIO') { const f = parseDate(x.para); return f ? fDM(f) + ' ' + fHM(f) : x.para; }
    if (x.f === 'TIPO_FALHA') return tipo({ TIPO_FALHA: x.para }).longo;
    if (x.f === 'CRITICIDADE') return x.para;
    if (x.f === 'ALERTA_ENVIADO') return x.para === '1' ? 'Sim' : x.para === '0' ? 'Não' : x.para;
    if (x.f === 'STATUS' || x.f === 'EVOLUCAO') return cap(x.para);
    return x.para;   // demais campos: como vieram no arquivo
  };
  let itens;
  if (c.kind === 'novo') itens = '<li class="novo"><span class="cap-novo">Novo chamado</span></li>' + li('Status', cap(c.st)) + (c.evo ? li('Evolução', cap(c.evo)) : '');
  else if (c.kind === 'muda') itens = c.ch.map(x => x.f === 'ESTAGIO' ? (completo ? li('Estágio', String(x.para || '').trim() || '—', 'est est-full') : li('Estágio', resumoEst(x.para), 'est')) : li(x.label, valor(x))).join('');
  else if (c.kind === 'dados') itens = li('Dados do chamado atualizados');
  else if (c.kind === 'saiu') itens = li('Saiu do arquivo');
  if (c.kind === 'saiu-varios') tx = `<span class="fs">${c.n} chamados saíram do arquivo</span><ul class="lg">${li('IDs', c.ids.slice(0, 12).join(', ') + (c.ids.length > 12 ? '…' : ''))}</ul>`;
  else tx = `${nome}<ul class="lg">${itens}</ul>`;
  const clickable = c.id && S.rows.some(r => r.ID === c.id);
  return `<button class="fi" ${clickable ? `data-id="${esc(c.id)}"` : 'disabled'}>${hr}<div class="tx">${tx}</div></button>`;
}
function renderFeed() {
  const now = Date.now();
  const list = S.feedAll ? S.log : S.log.slice(0, 5);
  $('btFeed').hidden = S.log.length <= 5;
  $('btFeed').textContent = S.feedAll ? 'Ver menos' : 'Ver todas';
  $('ctFeed').textContent = S.log.length;   // total de alterações registradas (mesma cápsula das outras seções)
  $('feed').innerHTML = list.length ? list.map(c => feedItem(c, now)).join('')
    : `<div class="empty">As mudanças de status aparecem aqui assim que acontecerem. O app confere o arquivo a cada minuto.</div>`;
}

/* ---- 2) Histórico: busca, filtro por sistema e por tipo de falha ---- */
const CHIPS = [['todos', 'Todos'], ['total', 'Indisp. total', 'var(--fTotal)'], ['parcial', 'Indisp. parcial', 'var(--fParcial)'], ['interm', 'Intermitência', 'var(--fInterm)'], ['lent', 'Lentidão', 'var(--fLent)'], ['ind', 'Indevidos']];
function renderChips() {
  $('chips').innerHTML = CHIPS.map(([k, n, c]) => `<button class="chip" data-f="${k}" aria-pressed="${S.filter === k}"${c ? ` style="--fc:${c}"` : ''}>${c ? '<i></i>' : ''}${n}</button>`).join('');
}
// lista própria de sistemas: nome à esquerda, quantidade de ocorrências (sem indevidos) na cápsula à direita
const CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
function sisContagem() {
  const cont = new Map();
  S.rows.forEach(r => { if (!isInd(r)) cont.set(r.SISTEMA, (cont.get(r.SISTEMA) || 0) + 1); else if (!cont.has(r.SISTEMA)) cont.set(r.SISTEMA, 0); });
  return cont;
}
const somaOc = cont => [...cont.values()].reduce((a, n) => a + n, 0);   // total de ocorrências (sem indevidos)
function renderSisSelect() {
  const cont = sisContagem();
  if (S.fSis && !cont.has(S.fSis)) S.fSis = '';
  const aberto = !$('pickL').hidden;
  const f = $('pickF');
  f.classList.toggle('on', !!S.fSis);
  f.innerHTML = (S.fSis ? `<button class="pick-x" id="pickX" aria-label="Remover filtro de sistema" title="Remover filtro">✕</button>` : '') +
    `<button class="pick-b" id="pickB" aria-haspopup="listbox" aria-expanded="${aberto}" aria-controls="pickL">` +
    (S.fSis ? `<span class="nm">${esc(S.fSis)}</span><span class="qtd">${cont.get(S.fSis)}</span>` : `<span class="nm">Todos os sistemas</span><span class="qtd">${somaOc(cont)}</span>`) + CHEV + `</button>`;
  if (aberto) renderSisLista(cont);
}
function renderSisLista(cont) {
  cont = cont || sisContagem();
  const nomes = [...cont.keys()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
  $('pickL').innerHTML = `<button class="pick-o todos" role="option" data-sis="" aria-selected="${!S.fSis}"><span class="nm">Todos os sistemas</span><span class="qtd">${somaOc(cont)}</span></button>` +
    nomes.map(n => `<button class="pick-o" role="option" data-sis="${esc(n)}" aria-selected="${n === S.fSis}"><span class="nm">${esc(n)}</span><span class="qtd">${cont.get(n)}</span></button>`).join('');
}
function abrirSis() {
  renderSisLista();
  $('pickL').hidden = false;
  $('pickB').setAttribute('aria-expanded', 'true');
  const sel = $('pickL').querySelector('[aria-selected="true"]');
  if (sel) { sel.scrollIntoView({ block: 'nearest' }); sel.focus({ preventScroll: true }); }
}
function fecharSis() {
  if ($('pickL').hidden) return;
  $('pickL').hidden = true;
  const b = $('pickB'); if (b) b.setAttribute('aria-expanded', 'false');
}
function setSis(n) {
  S.fSis = n; S.histCorte = null;
  fecharSis(); renderSisSelect(); renderHist();
}
function renderHist() {
  const now = new Date();
  const q = S.q.trim().toLowerCase();
  let list = S.rows.slice();
  if (S.fSis) list = list.filter(r => r.SISTEMA === S.fSis);
  if (S.filter === 'ind') list = list.filter(isInd);
  else if (S.filter !== 'todos') list = list.filter(r => tipo(r).k === S.filter);
  if (q) list = list.filter(r => [r.ID, r.SISTEMA, r.CHAMADO, r.IMPACTO_OPERACIONAL, r.EVOLUCAO, r.AREA_ACIONADA, r.TIPO_FALHA, r.SEGMENTO, r.STATUS].join(' ').toLowerCase().includes(q));
  list.sort((a, b) => b._ini - a._ini);
  const val = list.filter(r => !isInd(r));
  const ms = val.reduce((a, r) => a + (endOf(r, now.getTime()) - r._ini), 0);
  $('hres').innerHTML = list.length ? `<span>${list.length} chamado${list.length > 1 ? 's' : ''}${list.length - val.length ? ` (${list.length - val.length} indevido${list.length - val.length > 1 ? 's' : ''})` : ''}</span><span>${fDur(ms)} somados</span>` : '';
  const groups = [];
  for (const r of list) {
    const k = dayKey(r._ini);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, d: r._ini, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  if (!groups.length) { $('hist').innerHTML = `<div class="day"><div class="empty">${q || S.filter !== 'todos' || S.fSis ? 'Nada encontrado com esse filtro.' : 'Sem chamados no arquivo.'}</div></div>`; return; }
  // corte = 1º dia do mês mais antigo exibido (padrão: mês anterior ao atual).
  // Se o filtro não tiver nada nesses meses, começa pelo mês mais recente que tiver chamado.
  const mesDe = d => new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  let corte = S.histCorte != null ? S.histCorte : new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
  corte = Math.min(corte, mesDe(groups[0].d));
  const shown = groups.filter(g => g.d.getTime() >= corte);
  const prox = groups[shown.length];   // 1º dia ainda escondido: o mês dele é o próximo a mostrar
  const rotMes = d => MESES_LONGO[d.getMonth()] + (d.getFullYear() !== now.getFullYear() ? ' de ' + d.getFullYear() : '');
  $('hist').innerHTML = shown.map(g => {
    const v = g.rows.filter(r => !isInd(r));
    const d0 = new Date(g.d); d0.setHours(0, 0, 0, 0);
    const dms = unionMs(v.map(r => [r._ini.getTime(), endOf(r, Date.now())]), d0.getTime(), d0.getTime() + 864e5);
    return `<div class="day"><div class="dh"><b>${esc(dayLabel(g.d, now))}</b><span class="num">${g.rows.length} chamado${g.rows.length > 1 ? 's' : ''}${dms ? ' · ' + fDur(dms) : ''}</span></div>` +
      g.rows.map(r => hiRow(r, Date.now(), false)).join('') + `</div>`;
  }).join('') + (prox ? `<button class="more" id="btMore" data-corte="${mesDe(prox.d)}">Mostrar mês de ${rotMes(prox.d)}</button>` : '');
}

/* ---- 3) Painel ---- */
function itensPainel(now) {
  return S.rows.map(r => ({ id: r.ID, sistema: r.SISTEMA, tipo: up(r.TIPO_FALHA), ini: r._ini, fimCalc: new Date(endOf(r, now)), indevido: isInd(r), aberto: isOpen(r) }));
}
function renderPainel() {
  const root = $('pgPainel');
  if (!window.PSPainel || PSPainel.versao !== VERSION) { root.innerHTML = `<div class="banner bad">O painel está numa versão diferente do app. Feche e abra o app de novo para atualizar.</div>`; return; }
  if (!S.rows.length) { root.innerHTML = `<div class="card empty">Sem dados para o painel.</div>`; return; }
  const now = Date.now();
  const inicio = S.rows.reduce((m, r) => (!m || r._ini < m ? r._ini : m), null);
  PSPainel.render({ root, now, inicio, itens: itensPainel(now), rerender: renderPainel, abrirLista: openList });
  S.painelAt = now;
}

/* ---- topo, avisos e dados ---- */
function renderSync() {
  const dot = $('syncDot'), tx = $('syncTx');
  dot.className = 'dot';
  if (!S.rows.length) { dot.classList.add(S.net === 'off' ? 'err' : 'off'); tx.textContent = S.net === 'off' ? 'Sem conexão e sem cópia guardada' : 'Carregando…'; return; }
  if (S.fileErr) { dot.classList.add('err'); tx.textContent = 'Arquivo novo com erro · mostrando os últimos dados válidos'; return; }
  if (S.net === 'off') { dot.classList.add('off'); tx.textContent = 'Sem conexão · cópia de ' + fFull(new Date(S.loadedAt)); return; }
  if (S.net === 'init') { dot.classList.add('off'); tx.textContent = 'Conferindo… · cópia de ' + fFull(new Date(S.loadedAt)); return; }
  dot.classList.add('live');
  tx.textContent = 'Ao vivo · conferido ' + fAgo(Date.now() - S.checkedAt);
}
function renderBanners() {
  const b = [];
  if (S.saveErr) b.push(['bad', '<b>Não foi possível guardar os dados no aparelho.</b> O app funciona, mas sem internet ele não terá a última cópia e o registro de mudanças pode se perder. Libere espaço do navegador ou saia da aba anônima.']);
  if (S.fileErr) b.push(['bad', `<b>O arquivo recebido tem erro:</b> ${esc(S.fileErr)}. O app continua com os últimos dados válidos${S.loadedAt ? ' (de ' + fFull(new Date(S.loadedAt)) + ')' : ''}.`]);
  if (S.goneWarn) b.push(['warn', `<b>${S.goneWarn} chamados sumiram do arquivo de uma vez.</b> Confira se o arquivo veio completo.`]);
  // erros (vermelho) e alerta de chamados sumidos ficam no topo; avisos de leitura vão para o fim da página
  $('banners').innerHTML = b.map(([c, h]) => `<div class="banner ${c}">${h}</div>`).join('');
  const ws = S.warns.concat(window.PSNotif ? PSNotif.avisos() : []);
  $('avisos').innerHTML = !ws.length ? '' : `<div class="banner warn"><details><summary>${ws.length} aviso${ws.length > 1 ? 's' : ''} na leitura dos arquivos · ver</summary><ul class="warnlist">${ws.slice(0, 50).map(w => `<li>${esc(w)}</li>`).join('')}${ws.length > 50 ? `<li>… e mais ${ws.length - 50}</li>` : ''}</ul></details></div>`;
}

/* ---- páginas ---- */
const TABS = { oc: 'pgOc', hist: 'pgHist', painel: 'pgPainel' };
function renderTab() {
  if (S.tab === 'oc') { renderOpen(); renderHoje(); renderFeed(); }
  else if (S.tab === 'hist') { renderSisSelect(); renderChips(); renderHist(); }
  else renderPainel();
}
function setTab(t) {
  if (!TABS[t] || t === S.tab) return;
  S.tab = t;
  if (t === 'painel' && window.PSPainel && PSPainel.recolher) PSPainel.recolher();   // matriz de sistemas sempre começa fechada
  Object.entries(TABS).forEach(([k, id]) => { $(id).hidden = k !== t; });
  $('btShare').hidden = t !== 'oc';
  document.querySelectorAll('#tabs button').forEach(b => { const on = b.dataset.v === t; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
  renderTab();
  window.scrollTo(0, 0);
}
function render() {
  renderSync(); renderBanners();
  renderOpen();               // também mantém o número no menu de baixo
  renderTab();
  if (S.sheet) refreshSheet();
}

function tick() {
  const now = Date.now();
  if (S.pend.length && load(K.bell, false)) abrirAtualizacoes(false);
  document.querySelectorAll('[data-since]').forEach(el => { el.textContent = fDur(now - +el.dataset.since); });
  document.querySelectorAll('[data-ago]').forEach(el => { el.textContent = fAgo(now - +el.dataset.ago); });
  document.querySelectorAll('[data-dia]').forEach(el => {
    const x = trechoHoje(+el.dataset.dia, now), f = el.querySelector('.fill');
    f.style.left = x.l.toFixed(2) + '%'; f.style.width = x.w.toFixed(2) + '%';
    el.querySelector('.dtx').textContent = barraDiaTxt(x);
    el.setAttribute('aria-label', 'Ocupação de hoje das 08h às 21h: ' + barraDiaTxt(x));
  });
  renderSync();
  if (window.PSNotif) PSNotif.atualizar();   // notificação entra/sai na hora certa pelas datas
  if (S.tab === 'oc' && S.rows.length) renderHoje();
  // painel com chamado em andamento: redesenha a cada minuto (o tempo do aberto cresce)
  if (S.tab === 'painel' && !S.sheet && S.rows.some(isOpen) && now - (S.painelAt || 0) >= 60000) {
    const y = window.scrollY; renderPainel(); window.scrollTo(0, y);
  }
}

/* ---------- folha: lista (do Painel) e detalhe ---------- */
function showSheet() {
  $('sheetBg').style.display = 'block';
  document.body.classList.add('sheet-on'); document.documentElement.classList.add('trava');
  requestAnimationFrame(() => $('sheet').classList.add('show'));
  history.pushState({ sheet: 1 }, '');
}
function openSheet(id) {
  const novo = !S.sheet;
  S.sheet = { mode: 'det', id, list: null };
  if (!refreshSheet()) { S.sheet = null; return; }
  $('sheet').scrollTop = 0;   // detalhe sempre começa do topo
  if (novo) showSheet();
}
function openList(titulo, sub, ids, onClose) {
  const novo = !S.sheet;
  S.sheet = { mode: 'list', id: null, list: { titulo, sub, ids, onClose } };
  refreshSheet();
  if (novo) showSheet();
}
function refreshSheet() {
  const sh = S.sheet; if (!sh) return false;
  if (sh.mode === 'list') { drawList(sh.list); return true; }
  return drawDet(sh.id, sh.list);
}
function drawList(l) {
  const now = Date.now();
  const rows = l.ids.map(id => S.rows.find(r => r.ID === id)).filter(Boolean);
  $('sheet').innerHTML = `<button class="fechar" id="shX" aria-label="Fechar" title="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <h3 id="shTitle">${esc(l.titulo)}</h3><div class="sub">${esc(l.sub)}</div>
    <div class="lst">${rows.map(r => hiRow(r, now, true)).join('') || '<div class="empty">Os chamados dessa lista não estão mais no arquivo.</div>'}</div>`;
  $('shX').onclick = () => history.back();
  $('sheet').scrollTop = 0;
}
function drawDet(id, list) {
  const r = S.rows.find(x => x.ID === id);
  if (!r) return false;
  const now = Date.now(), t = tipo(r), open = isOpen(r);
  const yn = v => (v === '1' ? 'Sim' : v === '0' ? 'Não' : esc(v || '—'));
  const row = (k, v) => v ? `<dt>${k}</dt><dd>${v}</dd>` : '';
  const extra = S.cols.filter(c => !KNOWN.includes(c) && !OCULTAS.includes(c));
  const hist = S.log.filter(c => c.id === id);
  const msExp = window.PSPainel ? PSPainel.msExpediente({ ini: r._ini, fimCalc: new Date(endOf(r, now)) }) : null;
  $('sheet').innerHTML = `<button class="fechar" id="shX" aria-label="Fechar" title="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
    <button class="shr" id="shShare" aria-label="Compartilhar as informações do chamado" title="Compartilhar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg></button>
    ${list ? '<button class="volta" id="shVolta">‹ Voltar à lista</button>' : ''}
    <h3 id="shTitle" class="dt-h"><span class="nm">${esc(r.SISTEMA)}</span><span class="cap-id num" title="ID da solicitação no sistêmico">ID ${esc(r.ID)}</span><span class="stl"><span class="cap-t k-${t.k}">${esc(t.longo)}</span>${statusTag(r.STATUS)}</span></h3>
    <div class="big">
      ${temChamado(r.CHAMADO)
      ? `<button class="cham" id="shCham" data-cham="${esc(r.CHAMADO)}" aria-label="Copiar o chamado ${esc(r.CHAMADO)}"><span class="tx"><small>Chamado</small><b>${esc(r.CHAMADO)}</b></span><span class="cp" title="Copiar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span></button>`
      : `<div class="cham sem"><span class="tx"><small>Chamado</small><b>Sem chamado</b></span></div>`}
      <div><small>Duração</small><b class="num" ${open ? `data-since="${r._ini.getTime()}"` : ''}>${fDur(endOf(r, now) - r._ini)}</b></div>
      <div><small>Início</small><b class="num">${fFull(r._ini)}</b></div>
      <div><small>Fim</small><b class="num">${r._fim ? fFull(r._fim) : (open ? 'em andamento' : '—')}</b></div>
    </div>
    <dl class="kv">
      ${row('Segmento', esc(r.SEGMENTO))}
      ${msExp != null ? row('No expediente (08h–21h)', msExp ? fDur(msExp) : 'fora do expediente') : ''}
      ${row('Área acionada', esc(r.AREA_ACIONADA))}
      ${row('Grupos responsáveis', esc(r.GRUPOS_RESPONSAVEIS))}
      ${row('Grupos impactados', esc(r.GRUPOS_IMPACTADOS))}
      ${row('Evolução', esc(r.EVOLUCAO))}
      ${row('Impacto', esc(r.IMPACTO_OPERACIONAL))}
      ${'ALERTA_ENVIADO' in r ? row('Alerta enviado', yn(r.ALERTA_ENVIADO)) : ''}
      ${open && r.ESTAGIO ? `<dt>Estágio</dt><dd class="est">${esc(r.ESTAGIO)}</dd>` : ''}
    </dl>
    ${extra.length ? `<h4>Outras colunas</h4><dl class="kv">${extra.map(c => row(esc(c), esc(r[c]) || '—')).join('')}</dl>` : ''}
    <h4>Mudanças registradas</h4>
    ${hist.length ? `<div class="feed">${hist.map(c => feedItem(c, now, true).replace(/data-id="[^"]*"/, 'disabled')).join('')}</div>` : '<div class="empty" style="padding:0">Nenhuma mudança registrada neste aparelho.</div>'}
    ${analiseHtml(r, now)}`;
  $('shX').onclick = () => history.back();
  $('shShare').onclick = () => compartilhar(r);
  if ($('shCham')) $('shCham').onclick = () => copiarChamado($('shCham').dataset.cham);
  if (list) $('shVolta').onclick = () => { S.sheet = { mode: 'list', id: null, list }; refreshSheet(); };
  return true;
}
/* ---------- compartilhar (WhatsApp, Teams, Outlook...) ----------
   Título em *negrito* (WhatsApp); depois tipo de falha · status · ID e a lista do chamado até "Alerta enviado".
   Mudanças registradas e análise do histórico não entram. */
function textoCompartilhar(r, now = Date.now()) {
  const t = tipo(r), open = isOpen(r);
  const msExp = window.PSPainel ? PSPainel.msExpediente({ ini: r._ini, fimCalc: new Date(endOf(r, now)) }) : null;
  const yn = v => (v === '1' ? 'Sim' : v === '0' ? 'Não' : (v || '—'));
  const lin = [];
  const add = (k, v) => { if (v != null && String(v).trim() !== '') lin.push(`${k}: ${v}`); };
  add('Chamado', temChamado(r.CHAMADO) ? r.CHAMADO : 'Sem chamado');
  add('Início', fFull(r._ini));
  add('Fim', r._fim ? fFull(r._fim) : (open ? 'em andamento' : '—'));
  add('Duração', fDur(endOf(r, now) - r._ini));
  if (msExp != null) add('No expediente (08h–21h)', msExp ? fDur(msExp) : 'fora do expediente');
  add('Segmento', r.SEGMENTO);
  add('Área acionada', r.AREA_ACIONADA);
  add('Grupos responsáveis', r.GRUPOS_RESPONSAVEIS);
  add('Grupos impactados', r.GRUPOS_IMPACTADOS);
  add('Evolução', r.EVOLUCAO);
  add('Impacto', r.IMPACTO_OPERACIONAL);
  if ('ALERTA_ENVIADO' in r) add('Alerta enviado', yn(r.ALERTA_ENVIADO));
  return `*${r.SISTEMA}*\n${t.longo} · ${cap(r.STATUS)} · ID ${r.ID}\n\n${lin.join('\n')}`;
}
async function compartilhar(r) {
  const texto = textoCompartilhar(r);
  if (navigator.share) {
    try { await navigator.share({ title: `${r.SISTEMA} · ID ${r.ID}`, text: texto }); return; }
    catch (e) { if (e && e.name === 'AbortError') return; }   // a pessoa cancelou: nada a fazer
  }
  let ok = false;
  try { await navigator.clipboard.writeText(texto); ok = true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = texto; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); ok = document.execCommand('copy'); ta.remove(); } catch (e2) { ok = false; }
  }
  toast(ok ? 'Informações do chamado copiadas. Cole no WhatsApp, Teams ou Outlook.' : 'Não foi possível compartilhar neste aparelho.', false, ok ? 3500 : 5000);
}
/* ---------- compartilhar o painel (imagem dos cards) ou o app (QR Code e link) ---------- */
// endereço do app para compartilhar: o de onde ele está rodando (sem #, ?, nem nome de arquivo), ou o `appUrl` de config.js
const APP_LINK = (() => {
  const cfg = window.PS_CONFIG && window.PS_CONFIG.appUrl;
  if (cfg && /^https:\/\//.test(cfg)) return cfg.replace(/\/?$/, '/');
  try { return new URL('./', location.href).href; } catch (e) { return location.href.split(/[?#]/)[0]; }
})();
const ICO = {
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
  painel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-4.5-4.5L6 21"/></svg>',
  app: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>',
  copiar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  baixar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>',
  conversa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>',
  equipe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17.5" cy="9" r="2.5"/><path d="M16 14.2a5 5 0 0 1 6 4.8"/></svg>',
  email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 6 9 7 9-7"/></svg>',
  voltar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>'
};
const icoRoxo = svg => `<span class="ic-roxo">${svg}</span>`;
function menuCompartilhar() {
  abrirInfo('Compartilhar', `<div class="cp-op">
      <button class="cp-it" id="cpPainel"><span class="ci">${ICO.painel}</span><span><b>Compartilhar painel</b><small>Imagem das ocorrências ativas + link do app</small></span></button>
      <button class="cp-it" id="cpApp"><span class="ci">${ICO.app}</span><span><b>Compartilhar app</b><small>QR Code e link para abrir o app</small></span></button>
    </div>`, icoRoxo(ICO.share));
  $('cpPainel').onclick = () => compartilharPainel();
  $('cpApp').onclick = () => compartilharApp();
}
const BT_VOLTAR = `<button class="nt-bt" id="cpVolta" aria-label="Voltar">${ICO.voltar}<span>Voltar</span></button>`;
function ligarVoltar() { const v = $('cpVolta'); if (v) v.onclick = () => menuCompartilhar(); }
async function copiarTexto(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (e) {
    try { const ta = document.createElement('textarea'); ta.value = t; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
  }
}
// ---- app: QR Code, link, copiar e redes
function compartilharApp() {
  const msg = 'Problemas Sistêmicos: acompanhe em tempo real os problemas sistêmicos e o andamento dos chamados.';
  const tx = encodeURIComponent(msg + '\n' + APP_LINK);
  abrirInfo('Compartilhar app', `<div class="cp-app">
      <img class="qr" src="icons/qrcode.svg" width="176" height="176" alt="QR Code do app Problemas Sistêmicos">
      <div class="lk"><span class="num" id="cpLink">${APP_LINK}</span></div>
      <button class="cp-copiar" id="cpCopiar">${ICO.copiar}<span>Copiar link</span></button>
      <div class="cp-redes">
        <a class="cp-rede" id="cpWa" href="https://wa.me/?text=${tx}" target="_blank" rel="noopener">${ICO.conversa}<span>WhatsApp</span></a>
        <button class="cp-rede" id="cpTeams" title="Copia o link e abre o aplicativo do Teams">${ICO.equipe}<span>Teams</span></button>
        <a class="cp-rede" id="cpMail" href="mailto:?subject=${encodeURIComponent('App Problemas Sistêmicos')}&body=${tx}">${ICO.email}<span>Outlook</span></a>
      </div>
      ${navigator.share ? `<button class="cp-mais" id="cpMais">${ICO.share}<span>Outras opções</span></button>` : ''}
    </div>`, icoRoxo(ICO.app), BT_VOLTAR);
  ligarVoltar();
  // Teams da empresa bloqueia o compartilhamento pela web (pede login no navegador):
  // copia o link e abre o aplicativo do Teams pelo atalho próprio dele (msteams:); a pessoa só escolhe a conversa e cola
  $('cpTeams').onclick = async () => {
    const ok = await copiarTexto(APP_LINK);
    toast(ok ? 'Link copiado. Cole na conversa do Teams.' : 'Não foi possível copiar. Link: ' + APP_LINK, false, ok ? 6000 : 8000);
    const a = document.createElement('a'); a.href = 'msteams://'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  };
  $('cpCopiar').onclick = async () => { const ok = await copiarTexto(APP_LINK); toast(ok ? 'Link do app copiado.' : 'Não foi possível copiar. Link: ' + APP_LINK, false, ok ? 2500 : 6000); };
  if ($('cpMais')) $('cpMais').onclick = async () => { try { await navigator.share({ title: 'Problemas Sistêmicos', text: msg, url: APP_LINK }); } catch (e) { /* cancelado */ } };
}
// ---- painel: imagem dos cards (desenhada no canvas, igual em qualquer aparelho) + link
function quebraLinhas(ctx, texto, larg, max) {
  const pal = String(texto || '').split(/\s+/).filter(Boolean), out = []; let lin = '';
  for (const p of pal) { const t = lin ? lin + ' ' + p : p; if (ctx.measureText(t).width <= larg || !lin) lin = t; else { out.push(lin); lin = p; } }
  if (lin) out.push(lin);
  if (max && out.length > max) { out.length = max; let u = out[max - 1]; while (u && ctx.measureText(u + '…').width > larg) u = u.slice(0, -1); out[max - 1] = u.trimEnd() + '…'; }
  return out;
}
function corta(ctx, t, larg) { if (ctx.measureText(t).width <= larg) return t; while (t && ctx.measureText(t + '…').width > larg) t = t.slice(0, -1); return t + '…'; }
function pilula(ctx, x, y, w, h, fundo, borda) { ctx.beginPath(); ctx.roundRect(x, y, w, h, h / 2); if (fundo) { ctx.fillStyle = fundo; ctx.fill(); } if (borda) { ctx.strokeStyle = borda; ctx.lineWidth = 1.5; ctx.stroke(); } }
const COR_TIPO = { total: '#D61F4F', parcial: '#F2603E', interm: '#FF9901', lent: '#FFC629', outro: '#7d7190' };
function desenharPainel(now = Date.now()) {
  const W = 540, P = 16, CW = W - 2 * P, ESC = 2, FONTE = 'system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif';
  const f = (peso, tam) => `${peso} ${tam}px ${FONTE}`;
  const ativos = ordemAtivas(), d = new Date(now);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  // 1ª passada: mede a altura de cada card
  const cards = ativos.map(r => {
    const t = tipo(r), seg = segTxt(r.SEGMENTO);
    ctx.font = f(400, 14); const imp = r.IMPACTO_OPERACIONAL ? quebraLinhas(ctx, r.IMPACTO_OPERACIONAL, CW - 32, 2) : [];
    ctx.font = f(700, 12); const capW = ctx.measureText(t.longo).width + 22;
    ctx.font = f(400, 13); const paraW = seg ? ctx.measureText('para ' + seg).width : 0;
    const tipoLinhas = seg && capW + 8 + paraW > CW - 32 ? 2 : 1;
    const h = 16 + 24 + imp.length * 19 + 8 + tipoLinhas * 24 + 10 + 44 + 14;
    return { r, t, seg, imp, capW, tipoLinhas, h };
  });
  const TOPO = 86, RODAPE = 54, VAZIO = 96;
  const H = TOPO + (cards.length ? cards.reduce((s, c) => s + c.h + 14, 0) : VAZIO + 14) + RODAPE;
  cv.width = W * ESC; cv.height = H * ESC; ctx.scale(ESC, ESC);
  ctx.fillStyle = '#F1ECF6'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 72); g.addColorStop(0, '#52227a'); g.addColorStop(.6, '#642A90'); g.addColorStop(1, '#8549b5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 72);
  ctx.fillStyle = '#fff'; ctx.font = f(800, 21); ctx.textBaseline = 'alphabetic'; ctx.fillText('Problemas Sistêmicos', P, 32);
  ctx.font = f(500, 13); ctx.globalAlpha = .9;
  ctx.fillText(`Ocorrências ativas: ${ativos.length} · ${fDM(d)}/${d.getFullYear()} às ${fHM(d)}`, P, 54); ctx.globalAlpha = 1;
  let y = TOPO;
  const sombra = () => { ctx.shadowColor = 'rgba(58,22,88,.10)'; ctx.shadowBlur = 16; ctx.shadowOffsetY = 4; }, semSombra = () => { ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; };
  if (!cards.length) {
    sombra(); ctx.fillStyle = '#EEF7DC'; ctx.beginPath(); ctx.roundRect(P, y, CW, VAZIO, 20); ctx.fill(); semSombra();
    ctx.fillStyle = '#5F8A12'; ctx.font = f(800, 17); ctx.fillText('Nenhuma ocorrência ativa', P + 20, y + 42);
    ctx.font = f(400, 13); ctx.fillText('Todos os sistemas operando.', P + 20, y + 64);
    y += VAZIO + 14;
  }
  for (const c of cards) {
    const { r, t } = c, x = P + 16, lw = CW - 32;
    sombra(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(P, y, CW, c.h, 20); ctx.fill(); semSombra();
    let yy = y + 16;
    // ID à direita (cápsula com borda), nome do sistema à esquerda
    ctx.font = f(700, 12); const idT = 'ID ' + r.ID, idW = ctx.measureText(idT).width + 20;
    pilula(ctx, x + lw - idW, yy, idW, 22, null, '#1f1530'); ctx.fillStyle = '#1f1530'; ctx.fillText(idT, x + lw - idW + 10, yy + 15.5);
    ctx.font = f(800, 18); ctx.fillText(corta(ctx, r.SISTEMA, lw - idW - 12), x, yy + 17);
    yy += 24;
    ctx.font = f(400, 14); ctx.fillStyle = '#1f1530'; c.imp.forEach(l => { ctx.fillText(l, x, yy + 15); yy += 19; });
    yy += 8;
    pilula(ctx, x, yy, c.capW, 22, COR_TIPO[t.k] || COR_TIPO.outro); ctx.font = f(700, 12);
    ctx.fillStyle = t.k === 'interm' || t.k === 'lent' ? '#2b1a00' : '#fff'; ctx.fillText(t.longo, x + 11, yy + 15.5);
    if (c.seg) { ctx.fillStyle = '#1f1530'; ctx.font = f(400, 13); const px = c.tipoLinhas === 2 ? x : x + c.capW + 8, py = c.tipoLinhas === 2 ? yy + 24 : yy; ctx.fillText('para ' + c.seg, px, py + 15.5); }
    yy += c.tipoLinhas * 24 + 10;
    ctx.fillStyle = '#5b5068'; ctx.font = f(600, 11); ctx.fillText('aberto há', x, yy + 10);
    ctx.fillStyle = '#1f1530'; ctx.font = f(800, 19); ctx.fillText(fDur(now - r._ini), x, yy + 33);
    const ini = (sameDay(r._ini, d) ? 'hoje' : fDM(r._ini)) + ' ' + fHM(r._ini);
    ctx.font = f(400, 12); ctx.fillStyle = '#5b5068'; const iniT = 'início ' + ini; ctx.fillText(iniT, x + lw - ctx.measureText(iniT).width, yy + 36);
    if (r.EVOLUCAO) { ctx.font = f(700, 11.5); const ev = corta(ctx, r.EVOLUCAO, lw * .6), ew = ctx.measureText(ev).width + 18; pilula(ctx, x + lw - ew, yy, ew, 20, '#EEE6F5'); ctx.fillStyle = '#1f1530'; ctx.fillText(ev, x + lw - ew + 9, yy + 14); }
    if (r.ALERTA_ENVIADO === '1') {   // sirene na quina superior direita, como no card
      const cx = P + CW - 3, cy = y + 1; ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fillStyle = '#D61F4F'; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.save(); ctx.translate(cx - 7.5, cy - 7.5); ctx.scale(15 / 24, 15 / 24); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ['M7 18v-5a5 5 0 0 1 10 0v5', 'M5 21a1 1 0 0 1-1-1v-1a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1z', 'M12 2v1.5M3.5 6.5l1.2 1M20.5 6.5l-1.2 1'].forEach(p => ctx.stroke(new Path2D(p))); ctx.restore();
    }
    y += c.h + 14;
  }
  ctx.fillStyle = '#5b5068'; ctx.font = f(600, 12); const rod = 'Acompanhe no app: ' + APP_LINK.replace(/^https:\/\//, '').replace(/\/$/, '');
  ctx.fillText(rod, (W - ctx.measureText(rod).width) / 2, H - 22);
  return cv;
}
function dataUrlParaBlob(u) { const [cab, b64] = u.split(','), bin = atob(b64), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return new Blob([arr], { type: cab.slice(5, cab.indexOf(';')) }); }
function compartilharPainel() {
  const now = Date.now(), d = new Date(now), url = desenharPainel(now).toDataURL('image/png');
  const nome = `problemas-sistemicos_${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}_${fHM(d).replace(':', '')}.png`;
  const n = openRows().length;
  const texto = `Problemas Sistêmicos: ${n ? n + ' ocorrência' + (n > 1 ? 's' : '') + ' ativa' + (n > 1 ? 's' : '') : 'nenhuma ocorrência ativa'} em ${fDM(d)} às ${fHM(d)}.\n${APP_LINK}`;
  let arq = null; try { arq = new File([dataUrlParaBlob(url)], nome, { type: 'image/png' }); } catch (e) { arq = null; }
  const podeArq = !!(arq && navigator.canShare && navigator.canShare({ files: [arq] }));
  abrirInfo('Compartilhar painel', `<div class="cp-pre"><img id="cpImg" src="${url}" alt="Imagem das ocorrências ativas"></div>
      <p class="cp-obs">${podeArq ? 'A imagem vai junto com o link do app.' : 'Este aparelho não envia imagem direto: baixe a imagem e copie o link para colar junto.'}</p>
      <div class="cp-acts">${podeArq ? `<button class="cp-copiar" id="cpEnviar">${ICO.share}<span>Compartilhar</span></button>` : ''}
        <a class="cp-copiar sec" id="cpBaixar" href="${url}" download="${nome}">${ICO.baixar}<span>Baixar imagem</span></a>
        <button class="cp-copiar sec" id="cpCopLink">${ICO.copiar}<span>Copiar link</span></button></div>`, icoRoxo(ICO.painel), BT_VOLTAR);
  ligarVoltar();
  if ($('cpEnviar')) $('cpEnviar').onclick = async () => { try { await navigator.share({ files: [arq], title: 'Problemas Sistêmicos', text: texto }); } catch (e) { /* cancelado */ } };
  $('cpCopLink').onclick = async () => { const ok = await copiarTexto(APP_LINK); toast(ok ? 'Link do app copiado.' : 'Não foi possível copiar. Link: ' + APP_LINK, false, ok ? 2500 : 6000); };
}

/* ---------- análise do histórico (detalhe) ----------
   Amostra: todo o arquivo (6 meses fechados + o mês atual), mesmo SISTEMA e mesmo tipo de falha.
   Tempo = duração total (início → fim) dos chamados encerrados; indevidos ficam fora.
   Frequência = dias da base ÷ ocorrências (inclui as em andamento). */
function analise(r, now) {
  const k = tipo(r).k, sis = up(r.SISTEMA);
  const mesmos = S.rows.filter(x => up(x.SISTEMA) === sis && tipo(x).k === k && !isInd(x));
  const fech = mesmos.filter(x => x._fim).map(x => ({ x, ms: x._fim - x._ini })).sort((a, b) => a.ms - b.ms);
  const ini0 = S.rows.reduce((m, x) => (!m || x._ini < m ? x._ini : m), null);
  const base0 = ini0 ? new Date(ini0.getFullYear(), ini0.getMonth(), 1) : null;   // 1º dia do mês mais antigo da base
  const dias = base0 ? Math.max(1, (now - base0) / 864e5) : 0;
  const media = fech.length ? fech.reduce((a, f) => a + f.ms, 0) / fech.length : null;
  return { n: mesmos.length, nFech: fech.length, media, menor: fech[0] || null, maior: fech[fech.length - 1] || null, base0, dias };
}
function freqTxt(a, curto) {
  if (!a.n || !a.base0) return '';
  if (curto) {   // janela do cronômetro: frase curta
    const dd = Math.round(a.dias), iv = a.dias / a.n;
    if (a.n === 1) return `Primeira ocorrência na base (${dd} dias).`;
    if (iv < 1) return `Média de <b>${(a.n / a.dias).toFixed(1).replace('.', ',')} por dia</b> (${a.n} em ${dd} dias).`;
    const d = Math.round(iv);
    return `Média a cada <b>${d} dia${d > 1 ? 's' : ''}</b> (${a.n} em ${dd} dias).`;
  }
  const intervalo = a.dias / a.n;
  const periodo = `${a.n} ocorrência${a.n > 1 ? 's' : ''} em ${Math.round(a.dias)} dias de base`;
  if (a.n === 1) return `Primeira ocorrência desse problema na base (${Math.round(a.dias)} dias).`;
  if (intervalo < 1) return `Esse problema ocorre em média <b>${(a.n / a.dias).toFixed(1).replace('.', ',')} vezes por dia</b> (${periodo}).`;
  const d = Math.round(intervalo);
  return `Esse problema ocorre em média <b>a cada ${d} dia${d > 1 ? 's' : ''}</b> (${periodo}).`;
}
function analiseHtml(r, now, semTitulo) {
  const t = tipo(r), a = analise(r, now);
  const quando = f => `<small class="qd">${fDM(f.x._ini)}/${String(f.x._ini.getFullYear()).slice(2)}</small>`;
  let cmp = '';
  if (isOpen(r) && a.media != null) {
    const aberto = now - r._ini;
    const sit = aberto > a.maior.ms ? (semTitulo ? 'ultrapassou o maior tempo da base' : 'já passou do maior tempo da base') : aberto > a.media ? 'acima da média' : 'dentro da média';
    cmp = `<p class="an-cmp ${aberto > a.media ? 'acima' : ''}">${semTitulo ? `Aberto há <b>${fDur(aberto)}</b>: ${sit}.` : `Este chamado está aberto há <b>${fDur(aberto)}</b>: ${sit}.`}</p>`;
  }
  const corpo = !a.nFech ? `<div class="empty" style="padding:0">Ainda não há chamado encerrado de ${esc(r.SISTEMA)} com ${esc(t.longo.toLowerCase())} na base para calcular os tempos.</div>`
    : `<div class="an-box">
        <div><small><span class="sl">Tempo </span>médio</small><b class="num">${fDur(a.media)}</b></div>
        <div><small>Maior<span class="sl"> tempo</span></small><b class="num">${fDur(a.maior.ms)}</b>${quando(a.maior)}</div>
        <div><small>Menor<span class="sl"> tempo</span></small><b class="num">${fDur(a.menor.ms)}</b>${quando(a.menor)}</div>
      </div>${cmp}`;
  return `${semTitulo ? '' : '<h4>Análise do histórico</h4>'}
    <div class="an">
      <div class="an-t">${esc(r.SISTEMA)} · <span class="tf" style="--fc:${t.c}"><i></i>${esc(t.longo)}</span></div>
      ${corpo}
      ${a.n ? `<p class="an-fq">${freqTxt(a, semTitulo)}</p>` : ''}
      ${semTitulo ? '' : `<p class="an-base">Base: ${a.nFech} chamado${a.nFech === 1 ? '' : 's'} encerrado${a.nFech === 1 ? '' : 's'} desse sistema com esse tipo de falha${a.base0 ? `, de ${fDM(a.base0)}/${String(a.base0.getFullYear()).slice(2)} até hoje` : ''} · tempo total do início ao fim · indevidos fora.</p>`}
    </div>`;
}
/* ---------- copiar o número do chamado ---------- */
const temChamado = c => !!String(c || '').trim() && !/^sem\s+chamado$/i.test(String(c).trim());
async function copiarChamado(c) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(c); ok = true; } } catch (e) {}
  if (!ok) {   // navegador sem a API: cópia pelo método antigo
    try {
      const ta = document.createElement('textarea');
      ta.value = c; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, c.length);
      ok = document.execCommand('copy'); ta.remove();
    } catch (e) { ok = false; }
  }
  toast(ok ? `Chamado ${c} copiado` : `Não foi possível copiar. Chamado: ${c}`, false, ok ? 2500 : 6000);
}
function closeSheet() {
  const l = S.sheet && S.sheet.list;
  S.sheet = null;
  $('sheet').classList.remove('show'); $('sheet').scrollTop = 0;
  $('sheetBg').style.display = 'none';
  const sobre = document.body.classList.contains('sheet-sobre');
  document.body.classList.remove('sheet-on', 'sheet-sobre'); if (!document.body.matches('.nt-on, .al-on')) document.documentElement.classList.remove('trava');
  if (sobre && AL.aberto && $('alBox')) $('alBox').focus({ preventScroll: true });   // volta para a janela que estava embaixo
  if (l && l.onClose) l.onClose();
}

/* ---------- avisos no aparelho ---------- */
function renderBell() {
  const on = !!load(K.bell, false), n = on ? S.pend.length : 0;
  $('btBell').classList.toggle('on', on);
  $('btBell').setAttribute('aria-pressed', on ? 'true' : 'false');
  let bd = $('bellBd'); if (!bd) { bd = document.createElement('span'); bd.id = 'bellBd'; bd.className = 'nbd num'; $('btBell').appendChild(bd); }
  bd.hidden = !n; bd.textContent = n > 99 ? '99+' : n;
  $('btBell').title = on ? (n ? `${n} atualização${n > 1 ? 'ões' : ''} sem Ciente` : 'Atualizações detalhadas ligadas (toque para desligar)') : 'Ligar atualizações detalhadas';
}
// push disponível: caixa configurada + chave e segredo vindos do pacote + navegador com Push API
const pushOk = () => !!(window.PSPush && PSPush.disponivel({ caixa: window.PSCaixa, segredo: S.pushSecret, chave: S.pushChave }));
async function registrarPush(forcar) {
  const reg = await navigator.serviceWorker.ready;
  const r = await PSPush.registrar({ reg, chave: S.pushChave, segredo: S.pushSecret, cred: S.cred, caixa: PSCaixa, cripto: PSCripto,
    forcar, guardado: load(K.pushReg, '') });
  if (r.registrou) save(K.pushReg, r.marca);
  S.pushAtivo = true;
  return r;
}
// com o sino ligado, confere a cada abertura/atualização se o aparelho continua inscrito (a inscrição pode mudar)
async function sincronizarPush() {
  try {
    if (!load(K.bell, false) || !pushOk() || Notification.permission !== 'granted') { if (!load(K.bell, false)) S.pushAtivo = false; return; }
    await registrarPush(false);
  } catch (e) { S.pushAtivo = false; }
  renderBell();
}
// O sino liga as duas coisas juntas: a janela "Atualizações" (com o app aberto) e, quando o MAPI
// publicou o push e o navegador permite, o aviso no celular mesmo com o app fechado.
async function ligarPush() {
  if (!('Notification' in window)) return 'sem';
  let p = Notification.permission;
  if (p === 'default') { try { p = await Notification.requestPermission(); } catch (e) { p = 'denied'; } }
  if (p !== 'granted') return 'bloqueado';
  if (!pushOk()) return 'sem';   // sem push publicado: avisa na barra só com o app aberto em segundo plano
  try { await registrarPush(true); return 'push'; }
  catch (e) { S.pushAtivo = false; return 'falhou:' + (e.message || 'tente de novo'); }
}
async function desligarPush() {
  if (!S.pushAtivo && !load(K.pushReg, '')) return;
  try { await PSPush.desinscrever(await navigator.serviceWorker.ready); } catch (e) { /* segue */ }
  try { localStorage.removeItem(K.pushReg); } catch (e) { /* segue */ }
  S.pushAtivo = false;
}
async function toggleBell() {
  if (load(K.bell, false)) {
    if (S.pend.length) { abrirAtualizacoes(true); return; }   // tem atualização sem Ciente: mostra a janela
    desligarSino(); return;
  }
  if (!save(K.bell, true)) { toast('Não foi possível guardar essa escolha no aparelho.'); return; }
  S.pend = []; S.pendMostrado = 0; guardarCofre(); renderBell();
  const r = await ligarPush();
  renderBell();
  if (r === 'push') toast('Atualizações ligadas: cada mudança abre uma janela para você confirmar, e o celular avisa mesmo com o app fechado. O aviso pode levar alguns minutos para valer.', false, 7000);
  else if (r.startsWith('falhou:')) toast('Atualizações ligadas no app, mas não consegui ligar o aviso com o app fechado: ' + r.slice(7) + '. Se estiver no iPhone, abra o app pela tela de início.', false, 7000);
  else toast('Atualizações detalhadas ligadas: cada mudança abre uma janela para você confirmar.', false, 4500);
}
function desligarSino() {
  save(K.bell, false); S.pend = []; S.pendMostrado = 0; guardarCofre(); renderBell();
  desligarPush();
  toast('Atualizações desligadas (também o aviso com o app fechado). Você continua vendo o resumo das mudanças.', false, 4500);
}
// janela "Atualizações": mesma caixa das outras janelas, com o sino; junta tudo até o Ciente
const PEND_MAX = 100;
const SINO_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
function podeAbrirAtual() {
  return !document.hidden && !S.sheet && !(window.PSNotif && PSNotif.aberto()) && (!AL.aberto || AL.tipo === 'atual');
}
function abrirAtualizacoes(manual) {
  if (!load(K.bell, false) || !S.pend.length) return;
  const aberta = AL.aberto && AL.tipo === 'atual';
  if (aberta ? (S.sheet || document.hidden) : !podeAbrirAtual()) return;   // detalhe por cima ou outra janela aberta: espera
  if (!manual && S.pend.length <= S.pendMostrado) return;   // nada novo: não redesenha (a rolagem fica onde está)
  if (aberta && manual) return;                             // já está aberta
  if (!aberta) { S.atSel = []; S.atMulti = false; }         // janela nova começa sem filtro
  desenharAtual(aberta);
}
// cápsulas dos IDs acima da lista: bolinha com o número de atualizações encostada no canto (como a do sino);
// tocar filtra; com o filtro ligado aparece o + à direita: ligado, cada ID tocado entra (ou sai) da seleção
const MAIS_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
const X_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';
function atualIds() {
  const cont = new Map();
  S.pend.forEach(c => { if (c.id) cont.set(c.id, (cont.get(c.id) || 0) + 1); });   // ordem: mais recente primeiro
  if (!cont.size) return '';
  const sel = new Set(S.atSel), tem = sel.size > 0;
  return `<div class="at-ids${tem ? ' com-filtro' : ''}" role="group" aria-label="Filtrar por chamado">${tem ? `<button class="at-limpa" data-atf="" aria-label="Remover filtro" title="Remover filtro">${X_SVG}</button>` : ''}<div class="at-caps">${
    [...cont].map(([id, n]) => { const on = sel.has(id);
      return `<button class="at-ch${on ? ' on' : ''}" data-atf="${esc(id)}" aria-pressed="${on}" aria-label="Chamado ${esc(id)}: ${n} atualizaç${n > 1 ? 'ões' : 'ão'}${on ? ' (selecionado; toque para tirar)' : ''}"><span class="idc num">${esc(id)}</span><span class="at-n num" aria-hidden="true">${n}</span></button>`; }).join('')}</div>${
    tem ? `<button class="at-mais${S.atMulti ? ' on' : ''}" id="atMais" aria-pressed="${S.atMulti}" aria-label="${S.atMulti ? 'Seleção múltipla ligada: toque para desligar' : 'Selecionar vários chamados'}" title="${S.atMulti ? 'Seleção múltipla ligada' : 'Selecionar vários'}">${MAIS_SVG}</button>` : ''}</div>`;
}
const listaIds = l => l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + ' e ' + l[l.length - 1];
// desenha a janela; manter = já estava aberta (mantém na tela os itens que estavam sendo lidos)
function desenharAtual(manter) {
  S.atSel = S.atSel.filter(id => S.pend.some(c => c.id === id));
  if (!S.atSel.length) S.atMulti = false;
  const bx = $('alBox'), y = manter && bx ? bx.scrollTop : 0, h0 = manter && bx ? bx.scrollHeight : 0;
  const now = Date.now(), n = S.pend.length, sel = new Set(S.atSel);
  const lista = sel.size ? S.pend.filter(c => sel.has(c.id)) : S.pend;
  const qt = lista.length > 1 ? `estas ${lista.length} atualizações` : 'esta atualização';
  const sub = !sel.size ? 'Mudanças nos chamados desde o último Ciente. Toque num ID para filtrar ou num item para ver o detalhe.'
    : S.atMulti ? `Seleção múltipla: ${sel.size > 1 ? `chamados <b>${listaIds(S.atSel.map(esc))}</b>` : `chamado <b>${esc(S.atSel[0])}</b>`}. Toque em outros IDs para juntar. O Ciente confirma só ${qt}.`
    : `Mostrando só o chamado <b>${esc(S.atSel[0])}</b>. O Ciente confirma só ${qt}. Toque no + para selecionar vários.`;
  abrirInfo(`Atualizações <span class="nt-cont num">(${n})</span>`,
    `<p class="at-sub">${sub}</p>
      ${atualIds()}
      <div class="feed log-jan at-lista">${lista.map(c => feedItem(c, now)).join('')}</div>
      <button class="at-desl" id="atDesl">Desligar atualizações detalhadas</button>`,
    icoRoxo(SINO_SVG), `<button class="nt-bt nt-ciente" id="atCiente">${CHECK_SVG}<span>Ciente</span></button>`);
  AL.tipo = 'atual'; S.pendMostrado = n;
  if (manter && y > 4) $('alBox').scrollTop = y + ($('alBox').scrollHeight - h0);
  $('alBox').querySelectorAll('[data-atf]').forEach(b => b.onclick = () => {
    const id = b.dataset.atf;
    if (!id) { S.atSel = []; S.atMulti = false; }                                         // ✕: tira tudo
    else if (S.atMulti) S.atSel = S.atSel.includes(id) ? S.atSel.filter(x => x !== id) : S.atSel.concat(id);   // vários: junta / tira
    else S.atSel = S.atSel[0] === id ? [] : [id];                                          // um só: troca / tira
    desenharAtual(false);
  });
  const mais = $('atMais');
  if (mais) mais.onclick = () => {
    S.atMulti = !S.atMulti;
    if (!S.atMulti && S.atSel.length > 1) S.atSel = S.atSel.slice(0, 1);   // desligou: fica só o primeiro escolhido
    desenharAtual(false);
  };
  $('atCiente').onclick = () => {
    if (S.atSel.length) {   // filtrado: Ciente só no que está na tela; os outros continuam
      const fora = new Set(S.atSel);
      S.pend = S.pend.filter(c => !fora.has(c.id)); guardarCofre(); S.atSel = []; S.atMulti = false; S.pendMostrado = S.pend.length; renderBell();
      if (S.pend.length) desenharAtual(false); else fecharAlerta();
      return;
    }
    S.pend = []; guardarCofre(); S.pendMostrado = 0; renderBell(); fecharAlerta();
  };
  $('atDesl').onclick = () => { fecharAlerta(); desligarSino(); };
}

/* ---------- pedido de acesso (pela caixa de entrada; o MAPI busca e o administrador decide) ---------- */
let pedidoT = 0;
const PEDIDO_TEXTO = {
  pendente: 'Seu pedido foi recebido e está em análise. Quando for aprovado, a chave de acesso chega por e-mail. Esta tela atualiza sozinha.',
  aprovado: 'Pedido aprovado! A chave de acesso foi enviada para o e-mail informado. Use-a na tela de entrada.',
  recusado: 'Seu pedido foi recusado.',
  revogado: 'Este acesso foi removido.'
};
function mostrarCard(qual) {
  $('loginCard').hidden = qual !== 'login';
  $('pedidoCard').hidden = qual !== 'pedido';
  clearTimeout(pedidoT);
}
function abrirPedido() {
  mostrarCard('pedido');
  const p = load(K.pedido, null);
  if (p && p.protocolo) { desenharPedido(p, null); atualizarPedido(); } else { $('pedidoForm').hidden = false; $('pedidoStatus').hidden = true; $('pedidoErro').textContent = ''; $('pedMat').focus(); }
}
function voltarLogin(mat) { mostrarCard('login'); if (mat) $('loginMat').value = mat; $('loginErro').textContent = ''; }
function desenharPedido(p, s) {
  $('pedidoForm').hidden = true; $('pedidoStatus').hidden = false;
  $('pedProto').textContent = p.protocolo;
  const st = s ? s.status : 'pendente';
  const selo = $('pedSelo');
  selo.textContent = { pendente: 'Em análise', aprovado: 'Aprovado', recusado: 'Recusado', revogado: 'Removido' }[st] || st;
  selo.className = 'selo ' + (PEDIDO_TEXTO[st] ? st : 'pendente');
  $('pedMsg').textContent = (PEDIDO_TEXTO[st] || '') + (s && s.motivo ? ' Motivo: ' + s.motivo : '');
  $('pedEntrar').hidden = st !== 'aprovado';
  $('pedNovo').hidden = !(st === 'recusado' || st === 'revogado');
  $('pedErro').textContent = '';
}
async function atualizarPedido() {
  const p = load(K.pedido, null);
  if (!p) return;
  clearTimeout(pedidoT);
  try {
    const s = await PSCaixa.consultar(p);
    desenharPedido(p, s);
    if (s.status === 'pendente') pedidoT = setTimeout(() => { if (!$('pedidoCard').hidden && !document.hidden) atualizarPedido(); else if (!$('pedidoCard').hidden) pedidoT = setTimeout(atualizarPedido, 20000); }, 20000);
  } catch (e) {
    if (e.status === 404) { try { localStorage.removeItem(K.pedido); } catch (x) { /* segue */ } abrirPedido(); return; }   // pedido antigo, já apagado da caixa
    $('pedErro').textContent = e.message;
    pedidoT = setTimeout(atualizarPedido, 30000);
  }
}
async function enviarPedido(ev) {
  ev.preventDefault();
  const d = { matricula: $('pedMat').value, nome: $('pedNome').value, email: $('pedEmail').value, justificativa: $('pedJust').value };
  const erro = $('pedidoErro'), btn = $('pedidoBtn');
  erro.textContent = '';
  if (!d.matricula.trim() || !d.nome.trim() || !d.email.trim()) { erro.textContent = 'Informe matrícula, nome e e-mail.'; return; }
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    const r = await PSCaixa.solicitar(d);
    save(K.pedido, { protocolo: r.protocolo, token: r.token, matricula: PSCripto.normMatricula(d.matricula) });
    $('pedidoForm').reset();
    abrirPedido();
  } catch (e) {
    erro.textContent = e.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar pedido';
  }
}
function iniciarPedido() {
  if (!window.PSCaixa || !PSCaixa.configurada()) return;
  $('loginPedir').hidden = false; $('loginSemCaixa').hidden = true;
  $('loginPedir').onclick = abrirPedido;
  $('pedidoForm').addEventListener('submit', enviarPedido);
  $('pedVoltar').onclick = () => voltarLogin();
  $('pedVoltar2').onclick = () => voltarLogin();
  $('pedAtualizar').onclick = atualizarPedido;
  $('pedEntrar').onclick = () => voltarLogin((load(K.pedido, null) || {}).matricula);
  $('pedNovo').onclick = () => { try { localStorage.removeItem(K.pedido); } catch (e) { /* segue */ } abrirPedido(); };
}

/* ---------- início ---------- */
// versões anteriores guardavam dados em texto aberto: traz o registro de mudanças para o cofre e apaga o resto
function migrarLegado() {
  let snap = null, log = null;
  try { snap = JSON.parse(localStorage.getItem('ps.snap') || 'null'); log = JSON.parse(localStorage.getItem('ps.log') || 'null'); } catch (e) { /* ignora */ }
  if (snap && typeof snap === 'object' && !S.snap) S.snap = snap;
  if (Array.isArray(log) && !S.log.length) S.log = log.slice(0, LOG_MAX);
  try { LEGADO.forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignora */ }
}

// pacote guardado + cofre -> memória (sem internet o app abre com a última cópia)
async function restaurar() {
  let cofre = null;
  try { cofre = await PSCripto.abrirSelo(localStorage.getItem(K.cofre)); } catch (e) { /* sem cofre */ }
  if (cofre) { S.snap = cofre.snap || null; S.log = Array.isArray(cofre.log) ? cofre.log : []; S.pins = Array.isArray(cofre.pins) ? cofre.pins : []; S.pend = Array.isArray(cofre.pend) ? cofre.pend : []; }
  migrarLegado();
  limparRestos();
  const pk = load(K.pkg, null);
  if (pk && pk.text) {
    const p = await aplicarPacote(pk.text, { etag: pk.etag, source: pk.source, loadedAt: pk.loadedAt }, true);
    if (p.semAcesso) { await perderAcesso(p.err); return false; }
    if (!p.ok) { S.pkgText = ''; S.etag = ''; }
  }
  return true;
}

async function entrarNoApp() {
  if (!(await restaurar())) return;
  if (S.pkgText) guardar();         // garante o cofre (e leva para ele o que veio da versão anterior)
  esconderLogin();
  montar();
}

let montado = false;
function montar() {
  if (montado) { render(); poll(); return; }
  montado = true;
  render(); renderBell();
  if (window.PSNotif && PSNotif.versao === VERSION) { PSNotif.iniciar(); $('btNotif').onclick = () => PSNotif.tocarBotao(); renderBanners(); }
  if (S.cred && S.cred.via === 'hub') {
    // entrou pelo HUB: sair de todos os apps é no HUB; aqui o link leva para lá
    $('btSair').textContent = 'entrou pelo HUB';
    $('btSair').onclick = () => { location.href = '/'; };
  } else $('btSair').onclick = sair;
  $('quem').textContent = S.cred ? S.cred.matricula : '';

  document.addEventListener('click', e => {
    const pn = e.target.closest('[data-pin]');
    if (pn) { e.preventDefault(); alternarPin(pn.dataset.pin); return; }
    const ale = e.target.closest('[data-alerta]');
    if (ale) { e.preventDefault(); abrirAlerta(ale.dataset.alerta); return; }
    const uo = e.target.closest('[data-uo]');
    if (uo) { e.preventDefault(); abrirOcorrencia(uo.dataset.uo); return; }
    const cr = e.target.closest('[data-crono]');
    if (cr) { e.preventDefault(); abrirCrono(cr.dataset.crono); return; }
    const es = e.target.closest('[data-est]');
    if (es) { e.preventDefault(); abrirEstagio(es.dataset.est); return; }
    const lg = e.target.closest('[data-log]');
    if (lg) { e.preventDefault(); abrirLog(lg.dataset.log); return; }
    const it = e.target.closest('[data-id]');
    if (it && !it.disabled) {
      if (it.closest('#sheet')) {   // item da lista do Painel: abre o detalhe com "Voltar à lista"
        if (S.sheet && S.sheet.mode === 'list') { S.sheet = { mode: 'det', id: it.dataset.id, list: S.sheet.list }; refreshSheet(); $('sheet').scrollTop = 0; }
        return;
      }
      if (it.closest('#pgOc') || it.closest('#pgHist')) { openSheet(it.dataset.id); return; }
      if (it.closest('#alBox')) { abrirOcorrencia(it.dataset.id); return; }
    }
    const ch = e.target.closest('#chips .chip');
    if (ch) { S.filter = ch.dataset.f; S.histCorte = null; renderChips(); renderHist(); return; }
    if (e.target.id === 'btMore') { S.histCorte = +e.target.dataset.corte; renderHist(); }
  });
  document.querySelectorAll('#tabs button').forEach(b => b.onclick = () => setTab(b.dataset.v));
  $('btFeed').onclick = () => { S.feedAll = !S.feedAll; renderFeed(); };
  $('btRefresh').onclick = () => poll(true);
  $('btShare').onclick = () => menuCompartilhar();
  $('btBell').onclick = toggleBell;
  let qT; $('q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { S.q = e.target.value; S.histCorte = null; renderHist(); }, 150); });
  $('pick').addEventListener('click', e => {
    if (e.target.closest('#pickX')) { e.stopPropagation(); setSis(''); return; }
    if (e.target.closest('#pickB')) { $('pickL').hidden ? abrirSis() : fecharSis(); return; }
    const o = e.target.closest('.pick-o'); if (o) setSis(o.dataset.sis);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#pick')) fecharSis(); }, true);
  $('pickL').addEventListener('keydown', e => {
    const os = [...$('pickL').querySelectorAll('.pick-o')], i = os.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = os[Math.max(0, Math.min(os.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) n.focus(); }
    if (e.key === 'Escape') { e.stopPropagation(); fecharSis(); $('pickB').focus(); }
  });
  $('sheetBg').onclick = () => history.back();
  // Enter/Espaço no alfinete e na sirene (estão dentro do card)
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const x = e.target.closest && e.target.closest('[data-pin], [data-alerta], [data-log], [data-crono], [data-est], [data-uo]');
    if (x) { e.preventDefault(); e.stopPropagation(); x.click(); }
  }, true);
  window.addEventListener('popstate', () => {
    if (AL.ignorarPop) { AL.ignorarPop = false; return; }
    if (S.sheet && document.body.classList.contains('sheet-sobre')) { closeSheet(); return; }   // detalhe aberto por cima da janela: fecha só o detalhe
    if (AL.aberto) { fecharAlerta(true); return; }
    if (window.PSNotif && PSNotif.consumirPop()) return;          // a própria janela de notificação voltou o histórico
    if (window.PSNotif && PSNotif.aberto()) { PSNotif.fechar(true); return; }
    if (S.sheet) closeSheet();
  });
  document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (S.sheet && document.body.classList.contains('sheet-sobre')) history.back(); else if (AL.aberto) fecharAlerta(); else if (window.PSNotif && PSNotif.aberto()) PSNotif.fechar(); else if (S.sheet) history.back(); });
  if (window.PSPainel) PSPainel.gesto($('pgPainel'), () => S.tab === 'painel');

  document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - S.checkedAt > 15000) poll(); });
  window.addEventListener('online', () => poll());
  setInterval(() => { if (!document.hidden || load(K.bell, false)) poll(); }, POLL_MS);
  setInterval(tick, TICK_MS);
  poll();

}

async function iniciar() {
  $('ver').textContent = VERSION;
  $('loginForm').addEventListener('submit', fazerLogin);
  iniciarPedido();
  $('loginVer').onclick = () => { const i = $('loginChave'); i.type = i.type === 'password' ? 'text' : 'password'; $('loginVer').textContent = i.type === 'password' ? 'mostrar' : 'ocultar'; };
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!PSCripto.temCripto) { mostrarLogin('Este navegador não tem criptografia. Abra o app pelo endereço https.'); return; }
  S.cred = await PSCripto.lerCred();
  if (!S.cred) S.cred = await credDoHub();   // login único: quem já entrou no HUB neste aparelho não digita de novo
  if (!S.cred) {
    // sem acesso (ex.: saiu no HUB): dados guardados de antes não ficam no aparelho. O pedido de acesso em andamento fica.
    try {
      if (localStorage.getItem(K.pkg) || localStorage.getItem(K.cofre)) {
        try { if (window.PSPush && 'serviceWorker' in navigator) await PSPush.desinscrever(await navigator.serviceWorker.getRegistration()); } catch (e) { /* segue */ }
        await PSCripto.apagarTudo();
        localStorage.removeItem(K.pkg); localStorage.removeItem(K.cofre); localStorage.removeItem(K.pushReg);
      }
    } catch (e) { /* segue */ }
    mostrarLogin(); return;
  }
  await entrarNoApp();
}
if (!window.PSCripto || PSCripto.versao !== VERSION || !window.PSCaixa || PSCaixa.versao !== VERSION || !window.PSPush || PSPush.versao !== VERSION) {
  document.body.innerHTML = '<p style="padding:24px;font:16px system-ui">O app está numa versão diferente da dos arquivos de segurança. Feche e abra o app de novo para atualizar.</p>';
} else iniciar();

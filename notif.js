/* Problemas Sistêmicos — Notificações (notificacao.txt, que vem dentro do dados.json cifrado)
   Formato: UTF-8, tabulação, cabeçalho na 1ª linha, 1 notificação por linha.
   Colunas: ID, TIPO, TITULO, TEXTO, DATA_INICIO, DATA_FIM, OBRIGATORIO, STATUS, DATA_ATUALIZACAO.
   TEXTO: quebra de linha como \n, barra invertida como \\; marcações {b} {i} {s} {m} {roxo} {verde} {laranja} {pink} {link=…}…{/link}.
   Vale só STATUS = ATIVO e dentro das datas (sem início = já vale; sem fim = vale até alguém desativar). */
(function () {
  'use strict';
  const VERSAO = '1.18.0';
  const K = { lidas: 'ps.notif.lidas' };
  const OBRIG = ['ID', 'TIPO', 'TITULO', 'TEXTO'];
  const TAGS = ['b', 'i', 's', 'm', 'roxo', 'verde', 'laranja', 'pink', 'link'];
  const ORDEM = { CRITICO: 0, AVISO: 1, INFORMACAO: 2, INTERROGACAO: 3 };
  const NOME = { CRITICO: 'Crítico', AVISO: 'Aviso', INFORMACAO: 'Informação', INTERROGACAO: 'Interrogação' };
  const COR = { CRITICO: '#D61F4F', AVISO: '#FFC629', INFORMACAO: '#5F8A12', INTERROGACAO: '#642A90' };
  // ícones no estilo do MsgBox do VBA, nas cores do app
  const SVG = (c, r) => `<svg class="nt-ico" viewBox="0 0 36 36" role="img" aria-label="${r}">${c}</svg>`;
  const ICONE = {
    CRITICO: SVG('<circle cx="18" cy="18" r="17" fill="#D61F4F"/><path d="M12 12l12 12M24 12L12 24" stroke="#fff" stroke-width="4" stroke-linecap="round"/>', 'Crítico'),
    AVISO: SVG('<path d="M18 2.5c1.1 0 2.1.6 2.7 1.6l14.2 25c1.1 2-.3 4.4-2.6 4.4H3.7c-2.3 0-3.7-2.4-2.6-4.4l14.2-25c.6-1 1.6-1.6 2.7-1.6z" fill="#FFC629" stroke="#E0A800" stroke-width="1"/><path d="M18 12v10" stroke="#3a2a00" stroke-width="3.6" stroke-linecap="round"/><circle cx="18" cy="27.5" r="2.1" fill="#3a2a00"/>', 'Aviso'),
    INTERROGACAO: SVG('<circle cx="18" cy="18" r="17" fill="#642A90"/><path d="M13.5 13.6a4.6 4.6 0 1 1 6.3 4.3c-1.2.5-1.8 1.4-1.8 2.6v1" fill="none" stroke="#fff" stroke-width="3.4" stroke-linecap="round"/><circle cx="18" cy="26.4" r="2.1" fill="#fff"/>', 'Interrogação'),
    INFORMACAO: SVG('<circle cx="18" cy="18" r="17" fill="#5F8A12"/><path d="M18 9v11" stroke="#fff" stroke-width="3.8" stroke-linecap="round"/><circle cx="18" cy="26" r="2.2" fill="#fff"/>', 'Informação'),
  };

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const semAcento = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toUpperCase();
  const load = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };

  // ---------- leitura ----------
  const desescapar = t => String(t || '').replace(/\\(.)/g, (m, c) => c === 'n' ? '\n' : c === 't' ? ' ' : c);
  // devolve Date, null (vazio) ou undefined (inválida). Aceita 2026-10-21 10:30[:00] e 21/10/2026 10:30
  function data(s) {
    s = String(s || '').trim(); if (!s) return null;
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/), y, mo, d, h, mi, se;
    if (m) [, y, mo, d, h, mi, se] = m;
    else { m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?$/); if (!m) return undefined; [, d, mo, y, h, mi, se] = m; }
    const dt = new Date(+y, +mo - 1, +d, +(h || 0), +(mi || 0), +(se || 0));
    return dt.getMonth() === +mo - 1 && dt.getDate() === +d ? dt : undefined;
  }
  function ler(txt) {
    const avisos = [];
    const linhas = String(txt).replace(/^﻿/, '').split(/\r?\n/);
    while (linhas.length && !linhas[linhas.length - 1].trim()) linhas.pop();
    if (!linhas.length) return { ok: true, itens: [], avisos };            // arquivo vazio = nenhuma notificação
    const H = linhas[0].split('\t').map(semAcento);
    const falta = OBRIG.filter(c => !H.includes(c));
    if (falta.length) return { ok: false, err: `faltam as colunas ${falta.join(', ')} (o arquivo precisa ser separado por tabulação, com cabeçalho)` };
    const porId = new Map();
    for (let i = 1; i < linhas.length; i++) {
      const l = linhas[i]; if (!l.trim()) continue;
      const c = l.split('\t'), g = k => { const j = H.indexOf(k); return j < 0 ? '' : (c[j] || ''); };
      const id = g('ID').trim(), ln = `notificacao.txt, linha ${i + 1}${id ? ` (ID ${id})` : ''}`;
      if (c.length !== H.length) { avisos.push(`${ln}: ${c.length} colunas em vez de ${H.length}; ignorada`); continue; }
      if (!id) { avisos.push(`${ln}: sem ID; ignorada`); continue; }
      let tipo = semAcento(g('TIPO'));
      if (!(tipo in ORDEM)) { avisos.push(`${ln}: TIPO "${g('TIPO')}" desconhecido; mostrada como Informação`); tipo = 'INFORMACAO'; }
      const ini = data(g('DATA_INICIO')), fim = data(g('DATA_FIM')), upd = data(g('DATA_ATUALIZACAO'));
      if (ini === undefined || fim === undefined) { avisos.push(`${ln}: data inválida; ignorada`); continue; }
      if (ini && fim && fim <= ini) { avisos.push(`${ln}: DATA_FIM antes da DATA_INICIO; ignorada`); continue; }
      const it = { id, tipo, titulo: g('TITULO').trim(), texto: desescapar(g('TEXTO')), ini, fim, obrig: semAcento(g('OBRIGATORIO')).startsWith('S'),
        ativo: semAcento(g('STATUS') || 'ATIVO') !== 'INATIVO', versao: g('DATA_ATUALIZACAO').trim() || g('TITULO') + '|' + g('TEXTO'), upd: upd || null };
      const ant = porId.get(id);
      if (ant) { avisos.push(`notificacao.txt: ID ${id} repetido; vale a linha com a atualização mais recente`); if ((it.upd || 0) < (ant.upd || 0)) continue; }
      porId.set(id, it);
    }
    return { ok: true, itens: [...porId.values()], avisos };
  }

  // ---------- marcações -> HTML (seguro) ----------
  function tokens(txt) {
    const re = /\{(\/?)([a-z]+)(?:=([^}\n]*))?\}/g, out = []; let last = 0, m;
    while ((m = re.exec(txt))) {
      if (!TAGS.includes(m[2]) || (m[1] && m[3] != null) || (m[3] != null && m[2] !== 'link')) continue;
      if (m.index > last) out.push({ t: 'txt', v: txt.slice(last, m.index) });
      out.push({ t: m[1] ? 'fecha' : 'abre', n: m[2], arg: m[3], raw: m[0] });
      last = re.lastIndex;
    }
    if (last < txt.length) out.push({ t: 'txt', v: txt.slice(last) });
    const pilha = [];
    out.forEach((k, i) => {
      if (k.t === 'abre') pilha.push(i);
      else if (k.t === 'fecha') { const top = pilha.length ? out[pilha[pilha.length - 1]] : null; if (top && top.n === k.n) { top.ok = k.ok = true; k.par = pilha.pop(); } }
    });
    return out;
  }
  function url(u) { u = String(u || '').trim(); if (!u) return null; if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = 'https://' + u; return /^(https?:|mailto:)/i.test(u) ? u : null; }
  function html(txt) {
    const tk = tokens(txt), ab = { b: '<strong>', i: '<em>', s: '<s>', m: '<code>' }, fe = { b: '</strong>', i: '</em>', s: '</s>', m: '</code>' };
    return tk.map(k => {
      if (k.t === 'txt') return esc(k.v).replace(/\n/g, '<br>');
      if (!k.ok) return esc(k.raw);                                         // marcação sem par: mostra como texto
      if (k.n === 'link') { const u = url((k.t === 'abre' ? k : tk[k.par]).arg); return k.t === 'abre' ? (u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">` : '<span>') : (u ? '</a>' : '</span>'); }
      if (ab[k.n]) return k.t === 'abre' ? ab[k.n] : fe[k.n];
      return k.t === 'abre' ? `<span class="cap cap-${k.n}">` : '</span>';
    }).join('');
  }

  // ---------- estado ----------
  const N = { itens: [], texto: '', etag: '', avisos: [], erro: '', lidas: load(K.lidas, {}), modal: null, fila: [], autoVistos: new Set(), ctx: null, pronto: false };
  if (!N.lidas || typeof N.lidas !== 'object') N.lidas = {};
  const lida = it => N.lidas[it.id] === it.versao;
  function ativas(now) {
    const t = now || Date.now();
    return N.itens.filter(it => it.ativo && (!it.ini || it.ini <= t) && (!it.fim || t < it.fim))
      .sort((a, b) => ORDEM[a.tipo] - ORDEM[b.tipo] || (b.upd || b.ini || 0) - (a.upd || a.ini || 0) || a.id.localeCompare(b.id, 'pt-BR', { numeric: true }));
  }
  function marcarLida(it) {
    // não apaga lidas de IDs fora do arquivo: se o arquivo vier incompleto uma vez, o "Ciente" não se perde
    N.lidas[it.id] = it.versao;
    save(K.lidas, N.lidas);
  }

  // texto recebido do repositório (null = arquivo não existe)
  function aplicar(texto, meta) {
    if (texto == null) { N.itens = []; N.texto = ''; N.avisos = []; N.erro = ''; atualizar(); return { ok: true }; }
    if (texto === N.texto) return { ok: true, igual: true };
    const r = ler(texto);
    if (!r.ok) { N.erro = r.err; atualizar(); return r; }                   // mantém as últimas válidas
    N.itens = r.itens; N.avisos = r.avisos; N.erro = ''; N.texto = texto;
    if (meta && meta.etag) N.etag = meta.etag;
    atualizar();
    return r;
  }
  // As notificações NÃO ficam guardadas em texto aberto: vêm dentro do dados.json cifrado (o app abre o pacote guardado ao iniciar).
  // No aparelho fica só o que já foi lido (id + versão), que não tem conteúdo.

  // ---------- topo: ícone + contador ----------
  function renderBotao(at) {
    const b = document.getElementById('btNotif'); if (!b) return;
    const nl = at.filter(x => !lida(x));
    b.hidden = !at.length;
    const bd = b.querySelector('.nbd');
    bd.hidden = !nl.length; bd.textContent = nl.length;
    if (nl.length) { const t = nl[0].tipo; bd.style.background = COR[t]; bd.style.color = t === 'AVISO' ? '#2b1a00' : '#fff'; }
    b.setAttribute('aria-label', at.length ? `Notificações: ${at.length}${nl.length ? `, ${nl.length} não lida${nl.length > 1 ? 's' : ''}` : ''}` : 'Notificações');
  }

  // ---------- janela ----------
  function montar() {
    let bg = document.getElementById('ntBg');
    if (bg) return bg;
    bg = document.createElement('div'); bg.id = 'ntBg'; bg.className = 'nt-bg'; bg.hidden = true;
    bg.innerHTML = '<div class="nt" id="nt" role="dialog" aria-modal="true" aria-labelledby="ntTit" tabindex="-1"></div>';
    bg.addEventListener('click', e => { if (e.target === bg) fechar(); });
    document.body.appendChild(bg);
    return bg;
  }
  const X = '<button class="nt-x" id="ntX" aria-label="Fechar">✕</button>';
  function desenhar() {
    const bg = montar(), box = bg.querySelector('#nt'), m = N.modal; if (!m) return;
    const at = ativas();
    if (m.modo === 'uma') {
      const it = at.find(x => x.id === m.id) || N.itens.find(x => x.id === m.id);
      if (!it) { fechar(); return; }
      const pend = it.obrig && !lida(it);
      box.className = `nt t-${it.tipo}`;
      box.innerHTML = `<div class="nt-top">${m.daLista ? '<button class="nt-x nt-volta" id="ntVolta" aria-label="Voltar para a lista" title="Voltar para a lista"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg></button>' : ''}<span class="sp"></span>${X}</div>
        <div class="nt-h"><span class="nt-ic">${ICONE[it.tipo]}</span><h3 id="ntTit">${esc(it.titulo || NOME[it.tipo])}</h3></div>
        <div class="nt-corpo">${html(it.texto)}</div>
        ${pend ? '<button class="nt-ciente" id="ntCiente">Ciente</button>' : ''}`;
      if (!it.obrig && !lida(it)) { marcarLida(it); renderBotao(at); }
      if (pend) box.querySelector('#ntCiente').onclick = () => { marcarLida(it); renderBotao(ativas()); if (m.daLista) { N.modal = { modo: 'lista' }; desenhar(); } else fechar(); };
      if (m.daLista) box.querySelector('#ntVolta').onclick = () => { N.modal = { modo: 'lista' }; desenhar(); };
    } else {
      if (!at.length) { fechar(); return; }
      box.className = 'nt nt-lista';
      box.innerHTML = `<div class="nt-top"><h3 id="ntTit">Notificações</h3><span class="sp"></span>${X}</div>
        <div class="nt-itens">${[...at.filter(x => !lida(x)), ...at.filter(x => lida(x))].map(it => { const l = lida(it); return `<button class="nt-it${l ? ' lida' : ''}" data-nid="${esc(it.id)}"><span class="nt-ic">${ICONE[it.tipo]}</span><span class="nt-tt">${esc(it.titulo || NOME[it.tipo])}</span><span class="nt-pt" aria-label="${l ? 'lida' : 'não lida'}"></span></button>`; }).join('')}</div>`;
      box.querySelectorAll('.nt-it').forEach(b => b.onclick = () => { N.modal = { modo: 'uma', id: b.dataset.nid, daLista: true }; desenhar(); });
    }
    box.querySelector('#ntX').onclick = () => fechar();
    box.scrollTop = 0;
  }
  function abrir(m) {
    const novo = !N.modal;
    N.modal = m; const bg = montar(); bg.hidden = false; document.body.classList.add('nt-on'); document.documentElement.classList.add('trava');
    desenhar();
    if (novo) { try { history.pushState({ notif: 1 }, ''); N.hist = true; } catch (e) { N.hist = false; } }
    const d = document.getElementById('nt'); if (d) d.focus({ preventScroll: true });   // foco na janela (leitor de tela), sem destacar o ✕
  }
  // porHistorico = já veio do botão voltar do aparelho
  function fechar(porHistorico) {
    if (!N.modal) return;
    N.modal = null; const bg = document.getElementById('ntBg'); if (bg) bg.hidden = true; document.body.classList.remove('nt-on'); if (!document.body.classList.contains('sheet-on')) document.documentElement.classList.remove('trava');
    if (!porHistorico && N.hist) { N.hist = false; N.ignorarPop = true; history.back(); } else N.hist = false;
    setTimeout(proximaObrigatoria, 50);
  }
  function tocarBotao() {
    const at = ativas(); if (!at.length) return;
    abrir(at.length === 1 ? { modo: 'uma', id: at[0].id, daLista: false } : { modo: 'lista' });
  }
  // obrigatórias sem "Ciente": abrem sozinhas, uma de cada vez, na ordem do ID.
  // Fechou uma (✕ ou Ciente) → abre a próxima. Com "Ciente" não abre sozinha de novo;
  // fechada só no ✕, volta a abrir na próxima vez que o app for aberto.
  function proximaObrigatoria() {
    if (N.modal || !N.pronto || document.querySelector('.sheet.show')) return;
    const it = ativas().filter(x => x.obrig && !lida(x) && !N.autoVistos.has(x.id + '|' + x.versao))
      .sort((a, b) => a.id.localeCompare(b.id, 'pt-BR', { numeric: true }))[0];
    if (!it) return;
    N.autoVistos.add(it.id + '|' + it.versao);
    abrir({ modo: 'uma', id: it.id, daLista: false });
  }
  // redesenha a janela aberta só quando muda o que ela mostra (não a cada conferência)
  function atualizar() {
    const at = ativas();
    renderBotao(at);
    const sig = at.map(x => x.id + ':' + x.versao + ':' + (lida(x) ? 1 : 0)).join('|');
    if (N.modal && sig !== N.sig) desenhar();
    N.sig = sig;
    proximaObrigatoria();
  }

  window.PSNotif = {
    versao: VERSAO, ler, html, ativas, aplicar, atualizar, tocarBotao, fechar,
    iniciar() { N.pronto = true; atualizar(); },
    aberto: () => !!N.modal,
    consumirPop: () => { if (N.ignorarPop) { N.ignorarPop = false; return true; } return false; },
    etag: () => N.etag,
    avisos: () => (N.erro ? [`notificacao.txt com erro: ${N.erro}. Mantidas as últimas notificações válidas.`] : []).concat(N.avisos),
    estado: () => ({ itens: N.itens.length, ativas: ativas().map(x => x.id), naoLidas: ativas().filter(x => !lida(x)).map(x => x.id), modal: N.modal, lidas: { ...N.lidas } }),
  };
})();

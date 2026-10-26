/* Problemas Sistêmicos — Painel (dia / semana / mês)
   Mesma estrutura do painel do app de NS: Dia/Semana/Mês (botão ou arrastar), filtro do dia da semana,
   seleção de coluna, cards, gráficos, matriz sistemas × períodos e tabela.
   Os períodos são montados aqui a partir das datas de cada chamado (o sistemas.txt tem uma linha por ID). */
(function () {
  'use strict';
  const VERSAO = '1.39.0';
  const HORA_INI = 8, HORA_FIM = 21, EXP = (HORA_FIM - HORA_INI) * 3600e3;   // expediente 08:00–21:00 (13h)
  const POS14 = ((14 - HORA_INI) / (HORA_FIM - HORA_INI) * 100).toFixed(2);   // marca das 14h na coluna do dia
  const LIMITE = 7;                                                         // 7 dias, 7 semanas, 7 meses
  const WD = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
  const WD_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
  const MES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MES_EXT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  const NOME = { DIA: 'Dia', SEMANA: 'Semana', MES: 'Mês' };
  const ORDEM_MODOS = ['DIA', 'SEMANA', 'MES'];
  const TIPOS = [['total', 'Indisp. total', 'var(--fTotal)'], ['parcial', 'Indisp. parcial', 'var(--fParcial)'], ['interm', 'Intermitência', 'var(--fInterm)'], ['lent', 'Lentidão', 'var(--fLent)'], ['outro', 'Outro', 'var(--fOutro)']];

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');
  const dia0 = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addD = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const ddmm = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const ymd = d => d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
  const fmtH = ms => { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${pad(m % 60)}`; };
  const fmtHc = ms => { const m = Math.round(ms / 60000); return m === 0 ? '' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? pad(m % 60) : ''}`; };
  const pctTxt = v => v > 0 && v < 0.05 ? '<0,1%' : v.toFixed(1).replace('.', ',') + '%';
  const tipoK = t => /TOTAL/.test(t) ? 'total' : /PARCIAL/.test(t) ? 'parcial' : /INTERMIT/.test(t) ? 'interm' : /LENTID/.test(t) ? 'lent' : 'outro';
  const COR = t => TIPOS.find(x => x[0] === tipoK(t))[2];

  // ---------------- estado (só enquanto o app está aberto) ----------------
  // a matriz de sistemas sempre começa fechada (e volta a fechar ao entrar na página do Painel)
  let modo = 'DIA', filtroDia = null, sel = null, mxAberto = false, celSel = null;
  let ctx = null;   // { itens, inicio, now, abrirLista(titulo, sub, ids), root, rerender }

  // ---------------- períodos montados a partir das datas ----------------
  function periodos(m, now) {
    const t0 = dia0(new Date(now)), out = [];
    if (m === 'DIA') {
      if (filtroDia == null) for (let i = LIMITE - 1; i >= 0; i--) out.push({ ini: addD(t0, -i), dias: 1 });
      else { let d = t0; while (d.getDay() !== filtroDia) d = addD(d, -1); for (let i = 0; i < LIMITE; i++) { out.unshift({ ini: d, dias: 1 }); d = addD(d, -7); } }
    } else if (m === 'SEMANA') {
      const seg = addD(t0, -((t0.getDay() + 6) % 7));    // semana de segunda a domingo
      for (let i = LIMITE - 1; i >= 0; i--) out.push({ ini: addD(seg, -7 * i), dias: 7 });
    } else {
      for (let i = LIMITE - 1; i >= 0; i--) { const ini = new Date(t0.getFullYear(), t0.getMonth() - i, 1); out.push({ ini, dias: new Date(ini.getFullYear(), ini.getMonth() + 1, 0).getDate() }); }
    }
    const cod = { DIA: '3', SEMANA: '2', MES: '1' }[m];
    const ini0 = ctx.inicio ? dia0(ctx.inicio) : null;
    return out.map(p => {
      p.tipo = m; p.fim = addD(p.ini, p.dias); p.ordem = cod + ymd(p.ini);
      p.andamento = p.fim > now;                                       // período ainda não terminou
      p.semDados = !ini0 || p.fim <= ini0;                             // antes do 1º chamado do arquivo
      return p;
    });
  }
  // trechos de um chamado dentro do expediente (08–20) de um período: [{x0, x1} em fração da coluna, ms]
  function trechos(c, p) {
    const out = [];
    for (let i = 0; i < p.dias; i++) {
      const d = addD(p.ini, i);
      const a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), HORA_INI), b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), HORA_FIM);
      const s = Math.max(c.ini, a), e = Math.min(c.fimCalc, b);
      if (e > s) out.push({ x0: (i + (s - a) / EXP) / p.dias, x1: (i + (e - a) / EXP) / p.dias, ms: e - s });
    }
    return out;
  }
  const noPeriodo = (c, p) => c.ini < p.fim && c.fimCalc >= p.ini;
  const uniao = tr => { const v = [...tr].sort((a, b) => a.x0 - b.x0), out = []; for (const t of v) { const u = out[out.length - 1]; if (u && t.x0 <= u.x1) u.x1 = Math.max(u.x1, t.x1); else out.push({ x0: t.x0, x1: t.x1 }); } return out; };
  const uniaoMs = (itens, p) => uniao(itens.filter(c => !c.indevido).flatMap(c => trechos(c, p))).reduce((a, t) => a + (t.x1 - t.x0), 0) * p.dias * EXP;

  // expediente decorrido do período até agora: período fechado = expediente inteiro (dias × 13h);
  // período em andamento = só as horas de 08h–21h que já passaram
  function expDec(p) {
    if (p.semDados) return 0;
    let t = 0;
    for (let i = 0; i < p.dias; i++) {
      const d = addD(p.ini, i), a = new Date(d.getFullYear(), d.getMonth(), d.getDate(), HORA_INI).getTime(), b = new Date(d.getFullYear(), d.getMonth(), d.getDate(), HORA_FIM).getTime();
      t += Math.max(0, Math.min(ctx.now, b) - a);
    }
    return t;
  }
  const pctDe = (ms, exp) => exp > 0 ? ms / exp * 100 : 0;
  function estat(p) {
    const its = ctx.itens.filter(c => noPeriodo(c, p));
    const val = its.filter(c => !c.indevido);
    const ms = p.semDados ? 0 : uniaoMs(its, p);
    const porTipo = {}; TIPOS.forEach(([k]) => { porTipo[k] = 0; });
    val.forEach(c => { porTipo[tipoK(c.tipo)]++; });
    const sis = new Map();
    val.forEach(c => { const t = trechos(c, p).reduce((a, x) => a + x.ms, 0); sis.set(c.sistema, (sis.get(c.sistema) || 0) + t); });
    const top = [...sis.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0];
    // tempo total do período (dia inteiro, não só o expediente), sobreposição conta uma vez, indevido fora
    const fimP = Math.min(p.fim.getTime(), ctx.now);
    const iv = val.map(c => [Math.max(c.ini.getTime(), p.ini.getTime()), Math.min(c.fimCalc.getTime(), fimP)]).filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
    let msTot = 0, cs = -1, ce = -1;
    for (const [a, b] of iv) { if (a > ce) { if (ce > cs) msTot += ce - cs; cs = a; ce = b; } else if (b > ce) ce = b; }
    if (ce > cs) msTot += ce - cs;
    const exp = expDec(p);
    return { n: val.length, ids: val.map(c => c.id), sisMs: sis, ind: its.length - val.length, ms, msTot: p.semDados ? 0 : msTot, exp, pct: pctDe(ms, exp), porTipo, nSis: sis.size, top: top ? top[0] : '' };
  }

  // ---------------- rótulos ----------------
  const rot = p => p.tipo === 'DIA' ? ddmm(p.ini) : p.tipo === 'SEMANA' ? `${ddmm(p.ini)} a ${ddmm(addD(p.fim, -1))}` : `${MES_EXT[p.ini.getMonth()]}/${String(p.ini.getFullYear()).slice(2)}`;
  const rotLongo = p => `${p.tipo === 'DIA' ? WD[p.ini.getDay()].toLowerCase() + ', ' : p.tipo === 'SEMANA' ? 'semana ' : ''}${rot(p)}${p.andamento ? ' (em andamento)' : ''}`;
  const rotTab = p => p.tipo === 'DIA' ? `${WD[p.ini.getDay()].charAt(0) + WD[p.ini.getDay()].slice(1).toLowerCase()} ${ddmm(p.ini)}` : p.tipo === 'SEMANA' ? `${ddmm(p.ini)}–${ddmm(addD(p.fim, -1))}` : `${MES[p.ini.getMonth()]}/${String(p.ini.getFullYear()).slice(2)}`;
  const tituloPer = (t, s) => t === 'DIA' ? (s ? 'Dia selecionado' : 'Hoje') : t === 'SEMANA' ? (s ? 'Semana selecionada' : 'Semana atual') : (s ? 'Mês selecionado' : 'Mês atual');
  // acumulado dos períodos visíveis (cards sem seleção): chamados e sistemas distintos, tempos somados
  function acumulado(ps, st) {
    const ok = ps.map((p, i) => [p, st[i]]).filter(([p]) => !p.semDados);
    const ids = new Set(), sis = new Map();
    let ms = 0, exp = 0;
    for (const [, s] of ok) { s.ids.forEach(id => ids.add(id)); s.sisMs.forEach((v, k) => sis.set(k, (sis.get(k) || 0) + v)); ms += s.ms; exp += s.exp; }
    const top = [...sis.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'pt-BR'))[0];
    return { vazio: !ok.length, n: ids.size, ms, exp, pct: pctDe(ms, exp), nSis: sis.size, top: top ? top[0] : '' };
  }
  const yy = d => String(d.getFullYear()).slice(2);
  const rotFaixa = (a, b) => a.tipo === 'MES' ? `${MES[a.ini.getMonth()]}/${yy(a.ini)} a ${MES[b.ini.getMonth()]}/${yy(b.ini)}` : `${ddmm(a.ini)} a ${ddmm(b.tipo === 'SEMANA' ? addD(b.fim, -1) : b.ini)}`;

  // ---------------- desenho ----------------
  function render(c) {
    ctx = c;
    const now = c.now;
    const ps = periodos(modo, now);
    if (sel && !ps.some(p => p.ordem === sel)) sel = null;
    const st = ps.map(estat);
    const iSel = sel ? ps.findIndex(p => p.ordem === sel) : -1;
    const i = iSel >= 0 ? iSel : ps.length - 1, p = ps[i], s = st[i];
    const kc = iSel >= 0 ? 'kpi ksel' : 'kpi';
    // sem seleção: acumulado dos períodos da tela; com seleção: só o período escolhido. Sem comparação com o período anterior.
    const unid = modo === 'DIA' ? (filtroDia != null ? WD_PLURAL[filtroDia] : 'dias') : modo === 'SEMANA' ? 'semanas' : 'meses';
    const a = iSel >= 0 ? (p.semDados ? { vazio: true } : { vazio: false, n: s.n, ms: s.ms, exp: s.exp, pct: s.pct, nSis: s.nSis, top: s.top }) : acumulado(ps, st);
    const ondeN = iSel >= 0 ? (modo === 'DIA' ? 'no dia' : modo === 'SEMANA' ? 'na semana' : 'no mês') + (p.andamento ? ' · <b class="dias">em andamento</b>' : '') : `em ${ps.length} ${unid}`;
    const zero = '<span class="okv">0</span>';
    const perV = iSel >= 0 ? rot(p) : rotFaixa(ps[0], ps[ps.length - 1]);
    const perL = iSel >= 0 ? tituloPer(modo, true) : 'Período';
    const k = `
      <div class="${kc}"><div class="l">Chamados</div><div class="v">${a.vazio ? '—' : a.n || zero}</div><div class="s">${a.vazio ? 'sem dados de sistemas' : ondeN}</div></div>
      <div class="${kc}"><div class="l">Tempo com falha</div><div class="v">${a.vazio ? '—' : a.ms ? fmtH(a.ms) : zero}</div><div class="s">${a.vazio ? '' : `${pctTxt(a.pct)} do expediente`}</div></div>
      <div class="${kc}"><div class="l">Sistemas afetados</div><div class="v">${a.vazio ? '—' : a.nSis || zero}</div><div class="s">${a.top ? 'mais tempo: ' + esc(a.top) : a.vazio ? '' : '<span class="okt">sem ocorrência</span>'}</div></div>
      <div class="${kc} kper"><div class="l">${perL}</div><div class="v">${esc(perV)}</div><div class="s">${a.vazio ? '' : `${fmtH(a.exp)} de expediente`}</div></div>`;
    const filtro = modo !== 'DIA' ? '<div style="height:12px"></div>' : `
      <div class="wdf" role="group" aria-label="Comparar o mesmo dia da semana">
        ${[0, 1, 2, 3, 4, 5, 6].map(w => `<button data-wd="${w}" class="${w === 0 ? 'dom' : ''}${filtroDia === w ? ' on' : ''}" aria-pressed="${filtroDia === w}">${WD[w]}</button>`).join('')}
        ${filtroDia != null ? '<button class="wdx" id="bWdx" aria-label="Remover filtro e voltar aos dias corridos">✕</button>' : ''}
      </div>`;
    const fd = modo === 'DIA' ? filtroDia : null;
    const porX = modo === 'DIA' ? (fd != null ? ' · ' + WD_PLURAL[fd] : ' por dia') : modo === 'SEMANA' ? ' por semana' : ' por mês';
    const capSel = iSel >= 0 ? `${esc(rotLongo(p))} — ${p.semDados ? 'sem dados de sistemas' : s.n ? `${s.n} chamado${s.n > 1 ? 's' : ''} · ${fmtH(s.ms)} (${pctTxt(s.pct)}) de ${fmtH(s.exp)} de expediente` : 'nenhum chamado'}` : '';
    const dica = 'Toque numa coluna para selecionar · toque de novo para limpar.';
    c.root.innerHTML = `
      <div class="card topbar">
        <div class="seg" role="tablist" aria-label="Período">${ORDEM_MODOS.map(t => `<button role="tab" data-m="${t}" class="${modo === t ? 'on' : ''}">${NOME[t]}</button>`).join('')}</div>
        <div class="meta-line"><span>Expediente 08h–21h</span><span>${c.inicio ? 'dados desde ' + ddmm(c.inicio) + '/' + String(c.inicio.getFullYear()).slice(2) : 'sem dados'}</span></div>
        ${iSel >= 0 ? `<button class="selchip" id="bLimpar" aria-label="Limpar seleção"><span class="t">Selecionado: <b>${esc(rot(p))}</b> · toque para limpar</span><span aria-hidden="true">✕</span></button>` : ''}
      </div>
      <div id="pag">
        <div class="kpis kpis2">${k}</div>
        ${filtro}
        <div class="card chart"><h2>Tempo com falha no expediente${porX}</h2>${chartT(ps, st)}
          <div class="legend"><span><i style="background:var(--expbg)"></i>expediente 08h–21h (no período em andamento, até agora)</span><span><i style="background:var(--tot)"></i>tempo com algum sistema com problema (sobreposição conta uma vez)</span>${ps.some(x => x.semDados) ? '<span><i class="sd"></i>sem dados</span>' : ''}</div>
          <div class="cap${iSel >= 0 ? ' capsel' : ''}">${iSel >= 0 ? capSel : '% = tempo com falha ÷ expediente (dia 13h; semana 7 × 13h; mês dias × 13h). No período em andamento, só as horas de expediente que já passaram.'}</div></div>
        ${matriz(ps, iSel >= 0 ? sel : null)}
        ${tabela(ps, st)}
      </div>`;
    ligar(ps);
  }

  // eixo x: dia (número + dia da semana, domingo em vermelho), semana (dd/mm + mês), mês (Mmm + ano)
  function xRot(p, cx, y, on) {
    const d = p.ini, dom = p.tipo === 'DIA' && d.getDay() === 0;
    const a = p.tipo === 'DIA' ? (filtroDia != null ? ddmm(d) : pad(d.getDate())) : p.tipo === 'SEMANA' ? ddmm(d) : MES[d.getMonth()];
    const b = p.tipo === 'DIA' ? (filtroDia != null ? String(d.getFullYear()) : WD[d.getDay()]) : p.tipo === 'SEMANA' ? MES[d.getMonth()].toLowerCase() : String(d.getFullYear());
    const cor = on ? 'var(--selink)' : dom ? 'var(--domc)' : 'var(--ink2)';
    return `<text x="${cx}" y="${y}" text-anchor="middle" style="fill:${cor};font-size:11px;font-weight:${on ? 800 : 650}">${a}${p.andamento ? '*' : ''}</text><text x="${cx}" y="${y + 13}" text-anchor="middle" style="fill:${dom ? 'var(--domc)' : 'var(--ink3)'};font-size:9.5px">${b}</text>`;
  }
  const W = 360, H = 210, T = 32, B = 34, L = 6, R = 6;
  function quadro(ps, barras) {
    const n = ps.length, bw = (W - L - R) / n;
    const band = ps.map((p, i) => sel === p.ordem ? `<rect x="${L + i * bw + 1}" y="2" width="${bw - 2}" height="${H - 4}" rx="8" style="fill:var(--selbg);stroke:var(--selln)"/>` : '').join('');
    const base = `<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" style="stroke:var(--line);stroke-width:1"/>`;
    const xs = ps.map((p, i) => xRot(p, L + i * bw + bw / 2, H - B + 15, sel === p.ordem)).join('');
    const hit = ps.map((p, i) => `<rect class="hit" data-ordem="${p.ordem}" x="${L + i * bw}" y="0" width="${bw}" height="${H}" style="fill:transparent"><title>${esc(rotLongo(p))}</title></rect>`).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img">${band}${base}${barras(bw)}${xs}${hit}</svg>`;
  }
  const halo = 'paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round';
  const sdRect = (x, bw) => `<rect x="${x + bw * 0.2}" y="${T}" width="${bw * 0.6}" height="${H - B - T}" rx="5" style="fill:url(#sdpat)"/>`;
  const defs = `<defs><pattern id="sdpat" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(135)"><rect width="8" height="8" style="fill:var(--sdA)"/><rect width="4" height="8" style="fill:var(--sdB)"/></pattern></defs>`;
  // Tempo com falha: o fundo lilás é o expediente (100% = expediente inteiro do período, todas as colunas alinhadas);
  // no período em andamento o fundo sobe conforme as horas passam. O preenchimento é o tempo afetado, na mesma escala.
  // bolinha verde com check branco (dia/período sem ocorrência)
  const okBola = (cx, cy) => `<g class="okb" aria-hidden="true"><circle cx="${cx}" cy="${cy}" r="8.5" style="fill:var(--okc)"/><path d="M${cx - 4} ${cy + 0.2}l2.7 2.7 5.3-5.6" style="fill:none;stroke:#fff;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round"/></g>`;
  function chartT(ps, st) {
    const hh = H - B - T;
    return quadro(ps, bw => defs + ps.map((p, i) => {
      const x = L + i * bw, cx = x + bw / 2, s = st[i], w = Math.min(34, bw * 0.56);
      if (p.semDados) return sdRect(x, bw);
      const full = p.dias * EXP, hb = s.exp / full * hh, yb = H - B - hb;
      const fundo = hb > 0 ? `<rect class="expbg" x="${cx - w / 2}" y="${yb}" width="${w}" height="${hb}" rx="4" style="fill:var(--expbg)"/>` : '';
      const yl = hb > 0 ? yb : H - B;
      if (!s.ms) return fundo + okBola(cx, yl - 12);   // dia sem falha: bolinha verde com check branco
      const hf = Math.max(2, s.ms / full * hh), yf = H - B - hf;
      return fundo + `<rect class="falha" x="${cx - w / 2}" y="${yf}" width="${w}" height="${hf}" rx="4" style="fill:var(--tot)"/>` +
        `<text x="${cx}" y="${yl - 17}" text-anchor="middle" style="fill:var(--ink);font-size:11px;font-weight:800;${halo}">${fmtHc(s.ms)}</text>` +
        `<text x="${cx}" y="${yl - 5}" text-anchor="middle" style="fill:var(--ink2);font-size:9.5px;font-weight:600;${halo}">${pctTxt(s.pct)}</text>`;
    }).join(''));
  }

  // ---------------- matriz sistemas × períodos (mesma do app de NS) ----------------
  function matriz(ps, selOrdem) {
    const validos = ctx.itens;
    if (celSel && !ps.some(p => p.ordem === celSel.ordem)) celSel = null;
    const mapa = new Map();
    for (const c of validos) {
      ps.forEach((p, ci) => {
        if (p.semDados) return;
        const tr = trechos(c, p), fora = !tr.length && noPeriodo(c, p);
        if (!tr.length && !fora) return;
        if (!mapa.has(c.sistema)) mapa.set(c.sistema, { nome: c.sistema, cols: ps.map(() => []), ms: 0, n: new Set() });
        const s = mapa.get(c.sistema);
        s.cols[ci].push({ c, tr, fora });
        if (!c.indevido) { s.ms += tr.reduce((a, t) => a + t.ms, 0); s.n.add(c.id); }
      });
    }
    const sis = [...mapa.values()].sort((a, b) => b.ms - a.ms || a.nome.localeCompare(b.nome, 'pt-BR'));
    const titulo = modo === 'DIA' ? (filtroDia != null ? `Sistemas · ${WD_PLURAL[filtroDia]}` : 'Sistemas por dia') : modo === 'SEMANA' ? 'Sistemas por semana' : 'Sistemas por mês';
    const totCols = ps.map(p => p.semDados ? [] : uniao(validos.filter(c => !c.indevido).flatMap(c => trechos(c, p))));
    const totMs = totCols.reduce((a, u, ci) => a + u.reduce((x, t) => x + (t.x1 - t.x0) * ps[ci].dias * EXP, 0), 0);
    const temNaCol = ci => !ps[ci].semDados && validos.some(c => noPeriodo(c, ps[ci]));
    const cab = ps.map(p => {
      const d = p.ini, dom = modo === 'DIA' && d.getDay() === 0, mesMin = MES[d.getMonth()].toLowerCase();
      const t = modo === 'MES' ? MES[d.getMonth()] : pad(d.getDate());
      const s = modo === 'DIA' ? (filtroDia != null ? mesMin : WD[d.getDay()]) : modo === 'SEMANA' ? mesMin : String(d.getFullYear());
      return `<button class="hd${dom ? ' dom' : ''}${selOrdem === p.ordem ? ' sel' : ''}${p.andamento ? ' and' : ''}${p.semDados ? ' sd' : ''}" data-ordem="${p.ordem}" aria-label="Selecionar ${esc(rot(p))}" aria-pressed="${selOrdem === p.ordem}">${t}${p.andamento ? '*' : ''}<small>${s}</small></button>`;
    }).join('');
    const divisoes = () => modo === 'DIA' ? `<span class="dv" style="left:${POS14}%"></span>` : modo === 'SEMANA' ? [1, 2, 3, 4, 5, 6].map(i => `<span class="dv" style="left:${(i / 7 * 100).toFixed(2)}%"></span>`).join('') : '';
    const clsCel = (p, tem, marcada) => `cel${p.semDados ? ' sd' : tem ? ' tem' : ''}${marcada ? ' sel' : selOrdem === p.ordem ? ' colsel' : ''}`;
    const linhas = sis.map(s => `<div class="sys${celSel && celSel.sis === s.nome ? ' sel' : ''}" title="${esc(s.nome)}">${esc(s.nome)}</div>` + s.cols.map((cs, ci) => {
      const p = ps[ci], marcada = celSel && celSel.ordem === p.ordem && celSel.sis === s.nome;
      const bars = cs.flatMap(({ c, tr, fora }) => fora
        ? [`<span class="fora" style="left:${c.ini.getHours() < HORA_INI ? 0 : 'calc(100% - 6px)'}"></span>`]
        : tr.map(t => `<span class="bar${c.indevido ? ' indev' : ''}${c.aberto ? ' viva' : ''}" style="left:${(t.x0 * 100).toFixed(2)}%;width:${((t.x1 - t.x0) * 100).toFixed(2)}%;background:${COR(c.tipo)}"></span>`)).join('');
      return `<button class="${clsCel(p, cs.length, marcada)}" data-ordem="${p.ordem}" data-sis="${esc(s.nome)}" aria-label="${esc(s.nome)} · ${esc(rot(p))}${p.semDados ? ' · sem dados' : ''}">${p.semDados ? '' : divisoes()}${bars}</button>`;
    }).join('') + `<div class="tot">${fmtHc(s.ms) || (s.n.size ? '0' : '')}</div>`).join('');
    const linhaTot = `<div class="sys totl">Total</div>` + totCols.map((u, ci) => {
      const p = ps[ci], marcada = celSel && celSel.ordem === p.ordem && celSel.sis == null;
      return `<button class="${clsCel(p, temNaCol(ci), marcada)} tcel" data-ordem="${p.ordem}" data-tot="1" aria-label="Todos os sistemas · ${esc(rot(p))}${p.semDados ? ' · sem dados' : ''}">${p.semDados ? '' : divisoes()}${u.map(t => `<span class="bar tot" style="left:${(t.x0 * 100).toFixed(2)}%;width:${((t.x1 - t.x0) * 100).toFixed(2)}%"></span>`).join('')}</button>`;
    }).join('') + `<div class="tot tt">${fmtHc(totMs) || ''}</div>`;
    // chamados consolidados (todos os sistemas, sem indevidos) por coluna; à direita, chamados distintos da tela inteira
    const idsTela = new Set();
    const linhaCham = `<div class="sys ncl">Chamados</div>` + ps.map(p => {
      if (p.semDados) return `<div class="ncel sd" aria-label="${esc(rot(p))} · sem dados">–</div>`;
      const its = validos.filter(c => !c.indevido && noPeriodo(c, p)); its.forEach(c => idsTela.add(c.id));
      const marcada = celSel && celSel.ordem === p.ordem && celSel.sis == null;
      return its.length ? `<button class="ncel tem${marcada ? ' sel' : selOrdem === p.ordem ? ' colsel' : ''}" data-ordem="${p.ordem}" data-tot="1" aria-label="${its.length} chamado${its.length > 1 ? 's' : ''} · ${esc(rot(p))}">${its.length}</button>`
        : `<div class="ncel zero${selOrdem === p.ordem ? ' colsel' : ''}" aria-label="nenhum chamado · ${esc(rot(p))}"><span class="okc" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m7 12.3 3.4 3.4L17 9"/></svg></span></div>`;
    }).join('') + `<div class="tot ntot" title="Total de chamados">${idsTela.size}</div>`;
    const temSd = ps.some(p => p.semDados);
    const sub = modo === 'DIA' ? 'Cada coluna = expediente das 08h às 21h (linha = 14h).' : modo === 'SEMANA' ? 'Cada coluna = 7 dias (seg a dom), cada dia das 08h às 21h.' : 'Cada coluna = os dias do mês, cada dia das 08h às 21h.';
    const lab = mxAberto ? (window.innerWidth < 380 ? 92 : 112) + 'px' : 'max-content';
    return `<div class="card mxcard ${mxAberto ? 'mx-on' : 'mx-off'}" id="cardSis">
      <button class="mxhead" id="bMx" aria-expanded="${mxAberto}" aria-label="${mxAberto ? 'Fechar' : 'Abrir'} a matriz de sistemas"><h2>${titulo}</h2><span class="seta" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="${mxAberto ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'}"/></svg></span></button>
      ${mxAberto ? `<div class="mxsub">${sub} Horas = no expediente; no Total, tempo com algum sistema com problema.</div>` : ''}
      <div class="mx" style="--n:${ps.length};--lab:${lab}"><div class="corner">${mxAberto ? 'Sistema' : ''}</div>${cab}<div class="tot hd2">Horas</div>${mxAberto ? linhas + (sis.length ? '<div class="sep"></div>' : '') : ''}${linhaTot}${linhaCham}</div>
      ${mxAberto && !sis.length ? `<div class="vazio">Nenhum sistema com chamado nesse período.</div>` : ''}
      <div class="legend">
        ${mxAberto ? TIPOS.slice(0, 4).map(([, n, cor]) => `<span><i style="background:${cor}"></i>${n}</span>`).join('') + '<span><i class="fora"></i>fora do expediente</span><span><i class="indev"></i>indevido</span>' : ''}
        <span><i style="background:var(--tot)"></i>Total: todos os sistemas juntos</span><span><b class="lgn">nº</b>Chamados: todos os sistemas, sem indevidos</span>
        ${temSd ? '<span><i class="sd"></i>sem dados de sistemas</span>' : ''}
      </div>
      <div class="cap">${mxAberto ? 'Toque numa célula com chamado para ver a lista · toque no cabeçalho da coluna para selecionar o período.' : ''}</div>
    </div>`;
  }

  // tabela: dia (data em destaque e dia da semana embaixo), chamados, tempo total, no expediente e % do expediente
  function tabela(ps, st) {
    const fd = modo === 'DIA' ? filtroDia : null;
    const nome = modo === 'DIA' ? (fd != null ? WD_PLURAL[fd].charAt(0).toUpperCase() + WD_PLURAL[fd].slice(1) : 'Dias') : modo === 'SEMANA' ? 'Semanas' : 'Meses';
    const cel1 = p => {
      const a = p.tipo === 'DIA' ? ddmm(p.ini) : p.tipo === 'SEMANA' ? ddmm(p.ini) : MES[p.ini.getMonth()];
      const b = p.tipo === 'DIA' ? WD[p.ini.getDay()].toLowerCase() : p.tipo === 'SEMANA' ? 'a ' + ddmm(addD(p.fim, -1)) : String(p.ini.getFullYear());
      return `<b class="pa">${a}${p.andamento ? '*' : ''}</b><small class="pb">${b}${p.andamento ? '<br>em andamento' : ''}</small>`;
    };
    const linhas = ps.map((p, i) => ({ p, s: st[i] })).reverse().map(({ p, s }) => {
      const dom = p.tipo === 'DIA' && p.ini.getDay() === 0;
      const cls = [p.ordem === sel ? 'sel' : '', dom ? 'dom' : '', p.andamento ? 'and' : '', p.semDados ? 'sd' : ''].filter(Boolean).join(' ');
      if (p.semDados) return `<tr data-ordem="${p.ordem}" class="${cls}" aria-selected="${p.ordem === sel}"><td class="c1">${cel1(p)}</td><td colspan="4" class="nd">sem dados de sistemas</td></tr>`;
      const ch = s.n ? `<span class="nchip">${s.n}</span>` : '<span class="nchip ok">0</span>';
      const tm = v => v ? fmtH(v) : '<span class="z">0</span>';
      const pc = Math.min(100, s.pct);
      return `<tr data-ordem="${p.ordem}" class="${cls}" aria-selected="${p.ordem === sel}"><td class="c1">${cel1(p)}</td><td>${ch}</td><td>${tm(s.msTot)}</td><td class="ex">${tm(s.ms)}</td>` +
        `<td class="pc"><span class="pt${s.ms ? '' : ' z'}">${pctTxt(s.pct)}</span><span class="pbar" aria-hidden="true"><i style="width:${pc.toFixed(1)}%"></i></span></td></tr>`;
    }).join('');
    return `<div class="card"><h2>${nome}</h2><div class="tdw"><table class="tdias tsel">
      <thead><tr><th class="c1">${modo === 'DIA' ? 'DIA' : modo === 'SEMANA' ? 'SEMANA' : 'MÊS'}</th><th>CHAM.</th><th>TEMPO<br>TOTAL</th><th>NO<br>EXPED.</th><th>%<br>EXPED.</th></tr></thead><tbody>${linhas}</tbody></table></div>
      <div class="small muted tnota">CHAM. = chamados no período (sem indevidos) · TEMPO TOTAL = tempo com algum sistema com falha, em qualquer horário · NO EXPED. = a parte dentro do expediente (08h–21h) · % EXPED. = NO EXPED. ÷ expediente (no período em andamento, só as horas que já passaram). Sobreposição conta uma vez. * = em andamento.</div></div>`;
  }

  // ---------------- toques ----------------
  function redesenhar() { const y = window.scrollY; ctx.rerender(); window.scrollTo(0, y); }
  function toggleSel(o) { sel = sel === o ? null : o; redesenhar(); }
  function setFiltroDia(w) { filtroDia = w; sel = null; redesenhar(); }
  const semAnim = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setModo(m, dir) {
    if (dir == null) dir = Math.sign(ORDEM_MODOS.indexOf(m) - ORDEM_MODOS.indexOf(modo)) || 1;
    modo = m; sel = null; celSel = null;
    redesenhar();
    const pag = ctx.root.querySelector('#pag');
    if (!pag || semAnim()) return;
    pag.style.transition = 'none'; pag.style.transform = `translateX(${dir * 38}%)`; pag.style.opacity = '0';
    requestAnimationFrame(() => requestAnimationFrame(() => { pag.style.transition = 'transform .24s cubic-bezier(.2,.8,.2,1), opacity .24s'; pag.style.transform = ''; pag.style.opacity = ''; }));
  }
  const vizinho = step => { const k = ORDEM_MODOS.indexOf(modo) + step; return k >= 0 && k < ORDEM_MODOS.length ? ORDEM_MODOS[k] : null; };

  function ligar(ps) {
    const root = ctx.root;
    root.querySelectorAll('.seg button').forEach(b => b.onclick = () => { if (b.dataset.m !== modo) setModo(b.dataset.m); });
    const bl = root.querySelector('#bLimpar'); if (bl) bl.onclick = () => toggleSel(sel);
    root.querySelectorAll('.wdf button[data-wd]').forEach(b => b.onclick = () => { const w = +b.dataset.wd; setFiltroDia(filtroDia === w ? null : w); });
    const bx = root.querySelector('#bWdx'); if (bx) bx.onclick = () => setFiltroDia(null);
    root.querySelectorAll('svg .hit, table.tsel tr[data-ordem], .mx .hd').forEach(el => el.onclick = () => toggleSel(el.dataset.ordem));
    root.querySelector('#bMx').onclick = () => { mxAberto = !mxAberto; if (!mxAberto) celSel = null; redesenhar(); };
    root.querySelectorAll('.mx .cel, .mx button.ncel').forEach(b => b.onclick = () => {
      const p = ps.find(q => q.ordem === b.dataset.ordem); if (!p || p.semDados) return;
      const tot = !!b.dataset.tot, s = tot ? null : b.dataset.sis;
      const itens = ctx.itens.filter(x => (tot || x.sistema === s) && noPeriodo(x, p)).sort((a, b2) => a.ini - b2.ini);
      if (!itens.length) return;
      celSel = { ordem: p.ordem, sis: s }; redesenhar();
      const ms = uniaoMs(itens, p);
      ctx.abrirLista(tot ? 'Todos os sistemas' : s, `${rotLongo(p)} · ${itens.length} chamado${itens.length > 1 ? 's' : ''} · ${fmtH(ms)} (${pctTxt(pctDe(ms, expDec(p)))}) no expediente`,
        itens.map(x => x.id), () => { celSel = null; redesenhar(); });
    });
  }
  // arrastar para o lado em qualquer ponto do painel troca Dia ⇄ Semana ⇄ Mês
  function gesto(root, ativo) {
    let st = null, acabou = false;
    root.addEventListener('pointerdown', e => {
      if (!ativo() || e.pointerType === 'mouse' || !e.isPrimary || document.body.classList.contains('sheet-on')) return;
      const pag = root.querySelector('#pag'); if (!pag) return;
      st = { x: e.clientX, y: e.clientY, id: e.pointerId, dir: null, dx: 0, pag };
    });
    root.addEventListener('pointermove', e => {
      if (!st || e.pointerId !== st.id) return;
      const dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (!st.dir) { if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return; st.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v'; if (st.dir === 'h') st.pag.style.transition = 'none'; }
      if (st.dir !== 'h') return;
      st.dx = dx;
      const mov = vizinho(dx < 0 ? 1 : -1) ? dx : dx * 0.22;
      st.pag.style.transform = `translateX(${mov}px)`; st.pag.style.opacity = String(1 - Math.min(0.45, Math.abs(mov) / 700));
    });
    const fim = e => {
      if (!st || e.pointerId !== st.id) return;
      const s = st; st = null;
      if (s.dir !== 'h') return;
      acabou = true; setTimeout(() => { acabou = false; }, 350);
      const Wd = root.clientWidth, step = s.dx < 0 ? 1 : -1, alvo = vizinho(step);
      if (alvo && Math.abs(s.dx) > Math.min(70, Wd * 0.18)) {
        if (semAnim()) { setModo(alvo, step); return; }
        s.pag.style.transition = 'transform .14s ease-in, opacity .14s'; s.pag.style.transform = `translateX(${-step * Wd * 0.6}px)`; s.pag.style.opacity = '0';
        setTimeout(() => setModo(alvo, step), 140);
      } else { s.pag.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s'; s.pag.style.transform = ''; s.pag.style.opacity = ''; }
    };
    root.addEventListener('pointerup', fim);
    root.addEventListener('pointercancel', fim);
    root.addEventListener('click', e => { if (acabou) { e.stopPropagation(); e.preventDefault(); } }, true);
  }

  window.PSPainel = {
    versao: VERSAO, render, gesto, trechos,
    recolher: () => { mxAberto = false; celSel = null; },
    estado: () => ({ modo, filtroDia, sel, mxAberto, celSel }),
    msExpediente: c => { let ms = 0; for (let d = dia0(c.ini); d < c.fimCalc; d = addD(d, 1)) ms += trechos(c, { ini: d, dias: 1 }).reduce((a, t) => a + t.ms, 0); return ms; },
  };
})();

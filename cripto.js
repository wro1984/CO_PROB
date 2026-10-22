/* Problemas Sistêmicos — acesso e criptografia dos dados publicados.

   O site é público (GitHub Pages), então o dados.json publicado vem CRIPTOGRAFADO. Quem não tem um acesso aprovado
   no MAPI só vê bytes sem sentido.

   FORMATO do dados.json (gerado pelo MAPI, módulo sis_app.py):
     app      "problemas-sistemicos"      v  1
     kdf      PBKDF2-SHA256 com `iter` iterações (hoje 600 mil)
     acessos  { <id>: {salt, iv, ct} }    id = SHA-256("ps:" + MATRÍCULA)
              ct = a chave dos dados, cifrada (AES-GCM) com a chave da pessoa
     dados    {iv, ct}                    o sistemas.txt, cifrado (AES-GCM) com a chave dos dados
     notificacoes {iv, ct} (OPCIONAL)     o notificacao.txt, cifrado com a MESMA chave dos dados e um iv próprio
     push     {chave} (OPCIONAL)          chave pública VAPID (não é segredo): o app precisa dela para se inscrever em push
     acessos[id].tk {iv, ct} (OPCIONAL)   o "segredo de push" da pessoa, cifrado com a chave dela: só quem abre o pacote o
                                          conhece, e é com ele que o app prova ao MAPI que a inscrição de push é legítima

   A chave da pessoa sai da chave de acesso dela (PBKDF2 com o salt dela). Depois do primeiro login fica guardada no
   aparelho como CryptoKey NÃO extraível: a chave digitada não é guardada, e o script não consegue ler a chave da
   pessoa, só usá-la.

   A chave dos dados muda a cada publicação. Quem teve o acesso removido no MAPI some de `acessos` e deixa de abrir
   os dados novos (o app então apaga tudo o que guardou no aparelho).

   Cofre local: o que o app precisa lembrar entre uma abertura e outra (mudanças já vistas) é guardado cifrado com uma
   chave do aparelho (AES-GCM, não extraível), nunca em texto aberto. */
(function (root) {
  'use strict';

  const VERSAO = '1.18.0';
  const C = (root.crypto && root.crypto.subtle) ? root.crypto : null;
  const enc = new TextEncoder();
  const APP = 'problemas-sistemicos', PREFIXO = 'ps:';
  const ITER_MIN = 100000, ITER_MAX = 2000000;

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const toB64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

  const normMatricula = m => String(m || '').trim().toUpperCase().replace(/\s+/g, '');
  // A chave pode ser o código sorteado (XXXX-XXXX-XXXX-XXXX) ou uma palavra definida pelo admin.
  // Sem acento, maiúscula e só letras/números: "Girassól 26" e "girassol26" são a mesma chave.
  // Precisa ser IGUAL a nsp.norm_codigo do MAPI (ns_painel.py): filtra ANTES de passar para maiúscula
  // ("ß".toUpperCase() vira "SS" no JS e não no Python).
  const normCodigo = c => String(c || '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const CHAVE_MINIMA = 8;
  const codigoValido = c => normCodigo(c).length >= CHAVE_MINIMA && normCodigo(c).length <= 64;

  const erro = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

  async function idDe(matricula) {
    return hex(await C.subtle.digest('SHA-256', enc.encode(PREFIXO + normMatricula(matricula))));
  }

  async function chaveDoCodigo(codigo, salt, iter) {
    const base = await C.subtle.importKey('raw', enc.encode(normCodigo(codigo)), 'PBKDF2', false, ['deriveKey']);
    return C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  }

  function conferePacote(p) {
    if (!p || p.app !== APP || p.v !== 1 || !p.acessos || !p.dados || !p.kdf) throw erro('formato', 'dados.json em formato desconhecido.');
    const it = p.kdf.iter;
    if (!Number.isInteger(it) || it < ITER_MIN || it > ITER_MAX) throw erro('formato', 'dados.json com parâmetros de segurança inválidos.');
  }

  async function decifrar(k, campo, msg) {
    if (!campo || typeof campo.iv !== 'string' || typeof campo.ct !== 'string') throw erro('corrompido', msg);
    try { return new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(campo.iv) }, k, b64(campo.ct))); }
    catch (e) { throw erro('corrompido', msg); }
  }

  // chave dos dados (aberta com a chave da pessoa)
  async function chaveDosDados(pacote, chaveUsuario, id) {
    const a = pacote.acessos[id];
    if (!a) throw erro('sem_acesso', 'Seu acesso a este app foi removido. Se precisar, peça de novo ao administrador.');
    let rawK;
    try { rawK = await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(a.iv) }, chaveUsuario, b64(a.ct)); }
    catch (e) { throw erro('codigo', 'Chave de acesso incorreta.'); }
    return C.subtle.importKey('raw', rawK, 'AES-GCM', false, ['decrypt']);
  }

  async function abrirCampos(pacote, chaveUsuario, id) {
    const k = await chaveDosDados(pacote, chaveUsuario, id);
    const dados = await decifrar(k, pacote.dados, 'Os dados publicados estão corrompidos.');
    let notificacoes = null;
    if (pacote.notificacoes != null) notificacoes = await decifrar(k, pacote.notificacoes, 'As notificações publicadas estão corrompidas.');
    // push é opcional: qualquer problema aqui só desliga o aviso no celular, nunca impede de ver os chamados
    let pushSecret = null;
    const tk = pacote.acessos[id] && pacote.acessos[id].tk;
    if (tk && typeof tk.iv === 'string' && typeof tk.ct === 'string') {
      try { pushSecret = new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(tk.iv) }, chaveUsuario, b64(tk.ct))); } catch (e) { pushSecret = null; }
    }
    const pushChave = pacote.push && typeof pacote.push.chave === 'string' ? pacote.push.chave : null;
    return { dados, notificacoes, pushSecret, pushChave };
  }

  // prova da inscrição de push: HMAC-SHA256(segredo, endpoint \n p256dh \n auth), em hexadecimal.
  // Precisa ser IGUAL a sis_app.mac_inscricao do MAPI.
  async function macInscricao(segredo, endpoint, p256dh, auth) {
    const k = await C.subtle.importKey('raw', segredo, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return hex(await C.subtle.sign('HMAC', k, enc.encode(endpoint + '\n' + p256dh + '\n' + auth)));
  }

  // primeiro acesso: matrícula + chave -> credencial para guardar no aparelho
  async function entrar(pacote, matricula, codigo) {
    if (!C) throw erro('sem_cripto', 'Este navegador não tem criptografia (abra pelo endereço https do app).');
    conferePacote(pacote);
    const id = await idDe(matricula);
    const a = pacote.acessos[id];
    // mesma resposta para "matrícula sem acesso" e "chave errada": não revela quem tem acesso
    if (!a) throw erro('codigo', 'Matrícula ou chave incorreta, ou acesso ainda não liberado.');
    const chave = await chaveDoCodigo(codigo, b64(a.salt), pacote.kdf.iter);
    let campos;
    try { campos = await abrirCampos(pacote, chave, id); }
    catch (e) { if (e.code === 'codigo') throw erro('codigo', 'Matrícula ou chave incorreta, ou acesso ainda não liberado.'); throw e; }
    return { cred: { id, matricula: normMatricula(matricula), chave, salt: a.salt, desde: Date.now() }, ...campos };
  }

  // próximos acessos: usa a credencial guardada
  async function abrir(pacote, cred) {
    conferePacote(pacote);
    const a = pacote.acessos[cred.id];
    // o salt da pessoa só muda se o acesso foi refeito no MAPI: aí a chave antiga não vale mais
    if (a && a.salt !== cred.salt) throw erro('sem_acesso', 'Sua chave foi trocada. Entre de novo com a chave nova.');
    return abrirCampos(pacote, cred.chave, cred.id);
  }

  // ---------- aparelho: credencial e cofre (IndexedDB guarda CryptoKey sem expor a chave) ----------
  const DB = 'problemas-sistemicos-acesso', ST_CRED = 'cred', ST_COFRE = 'cofre';
  function db() {
    return new Promise((res, rej) => {
      if (!root.indexedDB) { rej(new Error('sem IndexedDB')); return; }
      const rq = root.indexedDB.open(DB, 1);
      rq.onupgradeneeded = () => { rq.result.createObjectStore(ST_CRED); rq.result.createObjectStore(ST_COFRE); };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }
  async function op(store, mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode); let out;
      const r = fn(t.objectStore(store)); if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => { d.close(); res(out); }; t.onerror = () => { d.close(); rej(t.error); };
    });
  }
  const lerCred = () => op(ST_CRED, 'readonly', s => s.get('atual')).catch(() => null);
  const salvarCred = c => op(ST_CRED, 'readwrite', s => s.put(c, 'atual'));
  // apaga TUDO que o app guardou no aparelho para este acesso (sair, ou acesso removido)
  const apagarTudo = () => new Promise(res => {
    if (!root.indexedDB) { res(); return; }
    const rq = root.indexedDB.deleteDatabase(DB);
    rq.onsuccess = rq.onerror = rq.onblocked = () => res();
  });

  async function chaveLocal() {
    let k = await op(ST_COFRE, 'readonly', s => s.get('local')).catch(() => null);
    if (k) return k;
    k = await C.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await op(ST_COFRE, 'readwrite', s => s.put(k, 'local'));
    return k;
  }
  // objeto -> texto cifrado (iv + ct em base64); sem IndexedDB devolve null (nada é guardado em aberto)
  async function selar(obj) {
    try {
      const k = await chaveLocal(), iv = root.crypto.getRandomValues(new Uint8Array(12));
      const ct = await C.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(obj)));
      return 'c1.' + toB64(iv) + '.' + toB64(ct);
    } catch (e) { return null; }
  }
  async function abrirSelo(txt) {
    try {
      const p = String(txt || '').split('.');
      if (p.length !== 3 || p[0] !== 'c1') return null;
      const k = await chaveLocal();
      return JSON.parse(new TextDecoder().decode(await C.subtle.decrypt({ name: 'AES-GCM', iv: b64(p[1]) }, k, b64(p[2]))));
    } catch (e) { return null; }
  }

  const api = { versao: VERSAO, entrar, abrir, macInscricao, lerCred, salvarCred, apagarTudo, selar, abrirSelo, idDe,
    normMatricula, normCodigo, codigoValido, temCripto: !!C };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PSCripto = api;
})(typeof self !== 'undefined' ? self : this);

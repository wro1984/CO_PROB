/* Problemas Sistêmicos — notificações push (aviso no celular com o app fechado).

   O MAPI envia direto ao serviço de push do navegador; aqui o app só se inscreve e entrega a inscrição ao MAPI pela caixa
   de entrada, junto com uma prova (HMAC com o segredo que só quem abre o pacote conhece). O texto do aviso vem cifrado de
   ponta a ponta para este aparelho. Quem recebe o evento `push` é o sw.js. */
(function (root) {
  'use strict';
  const VERSAO = '1.18.0';

  const urlB64ParaBytes = s => {
    const b = atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4));
    return Uint8Array.from(b, c => c.charCodeAt(0));
  };

  // Dá para ligar o push? Precisa de caixa configurada, da chave pública e do segredo vindos do pacote, e do navegador.
  function disponivel(ctx) {
    const w = ctx.janela || root;
    return !!(ctx.caixa && ctx.caixa.configurada() && ctx.segredo && ctx.chave && w.navigator && 'serviceWorker' in w.navigator
      && 'PushManager' in w && 'Notification' in w);
  }

  // Inscreve (se preciso) e entrega ao MAPI. `guardado` é a última inscrição já entregue ("endereço|chave|salt"): se não
  // mudou, não repete. Devolve {ok, registrou, assinatura}.
  async function registrar(ctx) {
    const reg = ctx.reg;
    let sub = await reg.pushManager.getSubscription();
    // inscrição feita com outra chave pública (o MAPI trocou a dele) não recebe mais nada: refaz
    if (sub && !mesmaChave(sub, ctx.chave)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await criar(reg, ctx.chave);
    let j = sub.toJSON();
    const k = j.keys || {};
    const marca = `${j.endpoint}|${ctx.chave}|${ctx.cred.salt}`;
    if (!ctx.forcar && ctx.guardado === marca) return { ok: true, registrou: false, marca };
    const mac = await ctx.cripto.macInscricao(ctx.segredo, j.endpoint, k.p256dh, k.auth);
    await ctx.caixa.inscreverPush({ id: ctx.cred.id, endpoint: j.endpoint, p256dh: k.p256dh, auth: k.auth, mac });
    return { ok: true, registrou: true, marca };
  }

  function mesmaChave(sub, chave) {
    const k = sub.options && sub.options.applicationServerKey;
    if (!k) return true;                                  // o navegador não informa: assume que é a mesma
    const a = new Uint8Array(k), b = urlB64ParaBytes(chave);
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  // Se mesmo assim o navegador recusar a inscrição nova (chave diferente), desfaz a velha e cria de novo, uma vez.
  async function criar(reg, chave) {
    const opcoes = { userVisibleOnly: true, applicationServerKey: urlB64ParaBytes(chave) };
    try { return await reg.pushManager.subscribe(opcoes); }
    catch (e) {
      const velha = await reg.pushManager.getSubscription();
      if (!velha) throw e;
      await velha.unsubscribe();
      return reg.pushManager.subscribe(opcoes);
    }
  }

  async function desinscrever(reg) {
    try { const s = reg && await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); return true; } catch (e) { return false; }
  }

  const api = { versao: VERSAO, disponivel, registrar, desinscrever, urlB64ParaBytes };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PSPush = api;
})(typeof self !== 'undefined' ? self : this);

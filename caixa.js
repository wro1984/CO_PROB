/* Problemas Sistêmicos — conversa com a caixa de entrada (Cloudflare Worker): pedido de acesso, andamento do pedido e
   inscrição de notificação (push). A caixa só entrega ao MAPI, que busca por conexão de saída; o app nunca fala com
   nada interno. Sem `PS_CONFIG.caixa` nada disto aparece. */
(function (root) {
  'use strict';
  const VERSAO = '1.18.0';
  const base = () => String((root.PS_CONFIG && root.PS_CONFIG.caixa) || '').replace(/\/+$/, '');
  const configurada = () => !!base();

  async function chamar(rota, corpo) {
    if (!configurada()) throw Object.assign(new Error('Este app ainda não está ligado à caixa de pedidos.'), { code: 'sem_caixa' });
    let r;
    try {
      r = await (api._fetch || root.fetch.bind(root))(base() + rota, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo), cache: 'no-store' });
    } catch (e) {
      throw Object.assign(new Error('Sem conexão com o serviço de pedidos. Verifique sua internet e tente de novo.'), { code: 'rede' });
    }
    let dados = {};
    try { dados = await r.json(); } catch (e) { /* corpo vazio */ }
    if (!r.ok) throw Object.assign(new Error(dados.erro || ('Falha (' + r.status + ').')), { status: r.status, code: 'http' });
    return dados;
  }

  const api = {
    versao: VERSAO, configurada, _fetch: null,
    solicitar: d => chamar('/solicitar', { matricula: d.matricula, nome: d.nome, email: d.email, justificativa: d.justificativa }),
    consultar: p => chamar('/status', { protocolo: p.protocolo, token: p.token }),
    inscreverPush: s => chamar('/push/inscrever', { id: s.id, endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, mac: s.mac }),
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.PSCaixa = api;
})(typeof self !== 'undefined' ? self : this);

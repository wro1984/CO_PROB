/**
 * Caixa de entrada do app Problemas Sistêmicos — Cloudflare Worker + D1.
 *
 * Papel: o app no celular entrega aqui pedidos de acesso e inscrições de notificação (push); o MAPI (que está na rede
 * interna e não recebe conexões de fora) vem BUSCAR por conexão de saída, decide e devolve o resultado.
 * Nada é aberto no MAPI. A caixa não guarda dado de chamado nenhum.
 *
 * Rotas públicas (o app):
 *   POST /solicitar      {matricula, nome, email, justificativa?}          -> {protocolo, token}
 *   POST /status         {protocolo, token}                                -> {status, motivo, atualizado_em}
 *   POST /push/inscrever {id, endpoint, p256dh, auth, mac}                 -> 202
 * Rotas do MAPI (Authorization: Bearer <MAPI_CHAVE>):
 *   GET  /admin/ping
 *   GET  /admin/novos                       pedidos ainda não buscados
 *   POST /admin/ack      {protocolos:[...]} confirma o recebimento e APAGA matrícula, nome, e-mail e justificativa daqui
 *   POST /admin/decisao  {protocolo, status, motivo?}   aprovado | recusado | revogado
 *   GET  /admin/push/novos                  inscrições de push ainda não buscadas
 *   POST /admin/push/ack {ids:[...]}        confirma e APAGA as inscrições daqui
 *
 * Privacidade: dados pessoais ficam aqui só até o MAPI confirmar o recebimento (ack). O cron diário apaga o que sobrou
 * (pedidos com mais de RETENCAO_DIAS, inscrições com mais de 7 dias). O IP nunca é gravado, só um hash com sal.
 *
 * A inscrição de push NÃO é validada aqui (a caixa não conhece as chaves): o MAPI confere a prova (mac) e o endereço
 * antes de usar; inscrição sem prova válida é descartada lá. Aqui só se limita volume e se exige endereço de serviço
 * de push conhecido.
 */

const VERSAO = "2.0.0";
const STATUS_DECISAO = ["aprovado", "recusado", "revogado"];
const MAX_CORPO = 4096;
// serviços de push dos navegadores (sufixo do host); o MAPI confere de novo
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com", "android.googleapis.com"];

// ---------- utilidades ----------
const enc = new TextEncoder();

async function sha256(texto) {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(texto));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function iguais(a, b) {                    // comparação em tempo constante (entradas de mesmo tamanho: hashes)
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function agora() { return new Date().toISOString(); }

function numero(valor, padrao) {
  const n = parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

function origensPermitidas(env) {
  return String(env.ORIGENS_PERMITIDAS || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function origemOk(request, env) {
  const lista = origensPermitidas(env);
  if (lista.length === 0 || lista.includes("*")) return true;
  return lista.includes(request.headers.get("Origin") || "");
}

function cors(request, env) {
  const origem = request.headers.get("Origin") || "";
  const lista = origensPermitidas(env);
  const permitido = lista.includes("*") ? "*" : (lista.includes(origem) ? origem : "");
  const h = { "Vary": "Origin" };
  if (permitido) {
    h["Access-Control-Allow-Origin"] = permitido;
    h["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    h["Access-Control-Allow-Headers"] = "Content-Type";
    h["Access-Control-Max-Age"] = "86400";
  }
  return h;
}

function json(corpo, status = 200, extra = {}) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

class Erro extends Error {
  constructor(status, mensagem) { super(mensagem); this.status = status; }
}

async function lerJson(request) {
  const texto = await request.text();
  if (texto.length > MAX_CORPO) throw new Erro(413, "Pedido grande demais.");
  try {
    const v = JSON.parse(texto || "{}");
    if (v === null || typeof v !== "object" || Array.isArray(v)) throw new Error("x");
    return v;
  } catch (e) {
    throw new Erro(400, "Corpo inválido (esperado JSON).");
  }
}

function limpar(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

async function origemHash(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "sem-ip";
  return sha256(`${ip}|${env.MAPI_CHAVE || "sal"}`);
}

function b64urlBytes(s) {
  try {
    const b = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (String(s).length % 4)) % 4));
    return b.length;
  } catch (e) { return -1; }
}

// ---------- validação ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validarPedido(c) {
  const matricula = limpar(c.matricula, 30).toUpperCase();
  const nome = limpar(c.nome, 120);
  const email = limpar(c.email, 200).toLowerCase();
  const justificativa = limpar(c.justificativa, 300);
  if (!/^[A-Z0-9]{3,20}$/.test(matricula)) throw new Erro(400, "Matrícula inválida (3 a 20 letras ou números).");
  if (nome.length < 3) throw new Erro(400, "Informe o nome.");
  if (!EMAIL_RE.test(email) || email.length > 200) throw new Erro(400, "Informe um e-mail válido: é para ele que a chave de acesso será enviada.");
  return { matricula, nome, email, justificativa };
}

function endpointPushOk(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  return PUSH_HOSTS.some((d) => host === d || host.endsWith("." + d));
}

function gerarProtocolo() {
  const alfabeto = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";     // sem O, 0, I, 1
  const b = crypto.getRandomValues(new Uint8Array(8));
  return "PS-" + [...b].map((x) => alfabeto[x % alfabeto.length]).join("");
}

function gerarToken() {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

// ---------- rotas públicas ----------
async function solicitar(request, env) {
  const ped = validarPedido(await lerJson(request));
  const origem = await origemHash(request, env);
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();

  const porOrigem = await env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE origem_hash = ? AND criado_em >= ?")
    .bind(origem, desde).first();
  const global = await env.DB.prepare("SELECT COUNT(*) AS n FROM pedidos WHERE criado_em >= ?").bind(desde).first();
  if ((porOrigem?.n || 0) >= numero(env.LIMITE_POR_HORA, 30) || (global?.n || 0) >= numero(env.LIMITE_GLOBAL_HORA, 300)) {
    throw new Erro(429, "Muitos pedidos agora. Tente novamente mais tarde.");
  }

  const protocolo = gerarProtocolo();
  const token = gerarToken();
  const t = agora();
  await env.DB.prepare(
    `INSERT INTO pedidos (protocolo, token_hash, matricula, nome, email, justificativa, status, origem_hash, criado_em, atualizado_em)
     VALUES (?, ?, ?, ?, ?, ?, 'novo', ?, ?, ?)`)
    .bind(protocolo, await sha256(token), ped.matricula, ped.nome, ped.email, ped.justificativa, origem, t, t).run();
  return { protocolo, token };
}

async function status(request, env) {
  const c = await lerJson(request);
  const protocolo = limpar(c.protocolo, 20).toUpperCase();
  const token = limpar(c.token, 100);
  const naoAchou = new Erro(404, "Pedido não encontrado.");
  if (!protocolo || !token) throw naoAchou;
  const r = await env.DB.prepare("SELECT token_hash, status, motivo, atualizado_em FROM pedidos WHERE protocolo = ?")
    .bind(protocolo).first();
  if (!r || !iguais(r.token_hash, await sha256(token))) throw naoAchou;
  // "novo" e "pendente" são a mesma coisa para quem pediu: em análise.
  const s = r.status === "novo" ? "pendente" : r.status;
  return { status: s, motivo: r.motivo || null, atualizado_em: r.atualizado_em };
}

async function pushInscrever(request, env) {
  const c = await lerJson(request);
  const id = limpar(c.id, 80).toLowerCase();
  const endpoint = limpar(c.endpoint, 600);
  const p256dh = limpar(c.p256dh, 120);
  const auth = limpar(c.auth, 60);
  const mac = limpar(c.mac, 80).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id) || !/^[0-9a-f]{64}$/.test(mac)) throw new Erro(400, "Inscrição inválida.");
  if (!endpointPushOk(endpoint) || b64urlBytes(p256dh) !== 65 || b64urlBytes(auth) !== 16) throw new Erro(400, "Inscrição inválida.");
  const origem = await origemHash(request, env);
  const desde = new Date(Date.now() - 3600 * 1000).toISOString();
  const porOrigem = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_inscricoes WHERE origem_hash = ? AND criado_em >= ?")
    .bind(origem, desde).first();
  const pendentes = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").first();
  if ((porOrigem?.n || 0) >= numero(env.LIMITE_PUSH_HORA, 60) || (pendentes?.n || 0) >= numero(env.MAX_PUSH_PENDENTES, 2000)) {
    throw new Erro(429, "Muitas inscrições agora. Tente novamente mais tarde.");
  }
  await env.DB.prepare(
    "INSERT INTO push_inscricoes (id, endpoint, p256dh, auth, mac, origem_hash, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, endpoint, p256dh, auth, mac, origem, agora()).run();
  return { ok: true };
}

// ---------- rotas do MAPI ----------
async function autenticarMapi(request, env) {
  const segredo = String(env.MAPI_CHAVE || "");
  const enviado = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (segredo.length < 16) throw new Erro(503, "MAPI_CHAVE não configurada (mínimo 16 caracteres).");
  if (!iguais(await sha256(enviado), await sha256(segredo))) throw new Erro(401, "Chave inválida.");
}

async function adminPing(env) {
  const r = await env.DB.prepare(
    "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'novo' THEN 1 ELSE 0 END) AS novos FROM pedidos").first();
  const p = await env.DB.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").first();
  return { ok: true, versao: VERSAO, agora: agora(), total: r?.total || 0, novos: r?.novos || 0, push_novas: p?.n || 0 };
}

async function adminNovos(env) {
  const r = await env.DB.prepare(
    `SELECT protocolo, matricula, nome, email, justificativa, criado_em FROM pedidos
     WHERE status = 'novo' ORDER BY criado_em LIMIT 100`).all();
  return { pedidos: r.results || [] };
}

async function adminAck(request, env) {
  const c = await lerJson(request);
  const lista = (Array.isArray(c.protocolos) ? c.protocolos : []).map((p) => limpar(p, 20).toUpperCase()).filter(Boolean).slice(0, 100);
  let confirmados = 0;
  for (const p of lista) {
    // Marca como recebido e apaga os dados pessoais daqui: o MAPI já tem o pedido.
    const r = await env.DB.prepare(
      `UPDATE pedidos SET status = 'pendente', matricula = '-', nome = '-', email = NULL, justificativa = NULL, atualizado_em = ?
       WHERE protocolo = ? AND status = 'novo'`).bind(agora(), p).run();
    confirmados += r.meta?.changes || 0;
  }
  return { confirmados };
}

async function adminDecisao(request, env) {
  const c = await lerJson(request);
  const protocolo = limpar(c.protocolo, 20).toUpperCase();
  const st = limpar(c.status, 20).toLowerCase();
  if (!STATUS_DECISAO.includes(st)) throw new Erro(400, "Status inválido (aprovado, recusado ou revogado).");
  const r = await env.DB.prepare("UPDATE pedidos SET status = ?, motivo = ?, atualizado_em = ? WHERE protocolo = ?")
    .bind(st, limpar(c.motivo, 200) || null, agora(), protocolo).run();
  if (!(r.meta?.changes > 0)) throw new Erro(404, "Protocolo não encontrado.");
  return { ok: true };
}

async function adminPushNovos(env) {
  const r = await env.DB.prepare(
    "SELECT rid, id, endpoint, p256dh, auth, mac FROM push_inscricoes ORDER BY rid LIMIT 100").all();
  return { inscricoes: r.results || [] };
}

async function adminPushAck(request, env) {
  const c = await lerJson(request);
  const ids = (Array.isArray(c.ids) ? c.ids : []).map((x) => parseInt(x, 10)).filter((x) => Number.isFinite(x)).slice(0, 100);
  let confirmados = 0;
  for (const rid of ids) {
    const r = await env.DB.prepare("DELETE FROM push_inscricoes WHERE rid = ?").bind(rid).run();
    confirmados += r.meta?.changes || 0;
  }
  return { confirmados };
}

// ---------- entrada ----------
export async function handle(request, env) {
  const url = new URL(request.url);
  const { pathname } = url;
  const c = cors(request, env);
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: c });

    if (pathname === "/solicitar" || pathname === "/status" || pathname === "/push/inscrever") {
      if (request.method !== "POST") throw new Erro(405, "Use POST.");
      if (!origemOk(request, env)) throw new Erro(403, "Origem não permitida.");
      if (pathname === "/solicitar") return json(await solicitar(request, env), 201, c);
      if (pathname === "/status") return json(await status(request, env), 200, c);
      return json(await pushInscrever(request, env), 202, c);
    }

    if (pathname.startsWith("/admin/")) {
      await autenticarMapi(request, env);
      if (pathname === "/admin/ping" && request.method === "GET") return json(await adminPing(env));
      if (pathname === "/admin/novos" && request.method === "GET") return json(await adminNovos(env));
      if (pathname === "/admin/ack" && request.method === "POST") return json(await adminAck(request, env));
      if (pathname === "/admin/decisao" && request.method === "POST") return json(await adminDecisao(request, env));
      if (pathname === "/admin/push/novos" && request.method === "GET") return json(await adminPushNovos(env));
      if (pathname === "/admin/push/ack" && request.method === "POST") return json(await adminPushAck(request, env));
      throw new Erro(404, "Rota não encontrada.");
    }

    if (pathname === "/" && request.method === "GET") return json({ servico: "problemas-sistemicos-caixa", versao: VERSAO });
    throw new Erro(404, "Rota não encontrada.");
  } catch (e) {
    if (e instanceof Erro) return json({ erro: e.message }, e.status, c);
    console.error("erro inesperado:", e && e.message);
    return json({ erro: "Erro interno." }, 500, c);
  }
}

export async function limpezaDiaria(env) {
  const dias = numero(env.RETENCAO_DIAS, 30);
  const limite = new Date(Date.now() - dias * 86400 * 1000).toISOString();
  const r = await env.DB.prepare("DELETE FROM pedidos WHERE criado_em < ?").bind(limite).run();
  const limitePush = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
  const p = await env.DB.prepare("DELETE FROM push_inscricoes WHERE criado_em < ?").bind(limitePush).run();
  return (r.meta?.changes || 0) + (p.meta?.changes || 0);
}

export default {
  fetch: (request, env) => handle(request, env),
  scheduled: (event, env, ctx) => { ctx.waitUntil(limpezaDiaria(env)); },
};

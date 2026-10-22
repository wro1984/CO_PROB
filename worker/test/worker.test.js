import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { handle, limpezaDiaria } from "../src/index.js";

// D1 de mentira em cima do SQLite do Node: só o que o Worker usa (prepare/bind/first/all/run).
function d1() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../schema.sql", import.meta.url), "utf8"));
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const st = db.prepare(sql);
      const o = {
        bind(...a) { args = a; return o; },
        async first() { return st.get(...args) ?? null; },
        async all() { return { results: st.all(...args) }; },
        async run() { const r = st.run(...args); return { meta: { changes: Number(r.changes) } }; },
      };
      return o;
    },
  };
}

const CHAVE = "chave-de-teste-com-mais-de-16";
const ORIGEM = "https://wro1984.github.io";
const novoEnv = (extra = {}) => ({ DB: d1(), MAPI_CHAVE: CHAVE, ORIGENS_PERMITIDAS: `${ORIGEM},http://localhost:8080`,
  LIMITE_POR_HORA: "30", LIMITE_GLOBAL_HORA: "300", LIMITE_PUSH_HORA: "60", MAX_PUSH_PENDENTES: "2000", RETENCAO_DIAS: "30", ...extra });

const post = (env, caminho, corpo, headers = {}) => handle(new Request("https://x.workers.dev" + caminho, {
  method: "POST", body: JSON.stringify(corpo), headers: { "Content-Type": "application/json", Origin: ORIGEM, "CF-Connecting-IP": "1.2.3.4", ...headers } }), env);
const admin = (env, metodo, caminho, corpo, chave = CHAVE) => handle(new Request("https://x.workers.dev" + caminho, {
  method: metodo, body: corpo ? JSON.stringify(corpo) : undefined, headers: { Authorization: `Bearer ${chave}` } }), env);

const PEDIDO = { matricula: "a1234567", nome: "Fulano de Tal", email: "Fulano@Telefonica.com", justificativa: "Preciso acompanhar os chamados" };
const b64u = (n) => Buffer.alloc(n, 7).toString("base64url");
const INSCRICAO = { id: "a".repeat(64), endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: b64u(65), auth: b64u(16), mac: "b".repeat(64) };

test("fluxo completo: pedir -> MAPI busca -> ack apaga os dados pessoais -> decide -> app vê", async () => {
  const env = novoEnv();
  const r = await post(env, "/solicitar", PEDIDO);
  assert.equal(r.status, 201);
  const { protocolo, token } = await r.json();
  assert.match(protocolo, /^PS-[A-Z2-9]{8}$/);
  assert.equal(token.length, 48);

  let s = await (await post(env, "/status", { protocolo, token })).json();
  assert.equal(s.status, "pendente");                      // "novo" aparece como em análise

  const novos = await (await admin(env, "GET", "/admin/novos")).json();
  assert.equal(novos.pedidos.length, 1);
  assert.deepEqual([novos.pedidos[0].matricula, novos.pedidos[0].nome, novos.pedidos[0].email, novos.pedidos[0].justificativa],
    ["A1234567", "Fulano de Tal", "fulano@telefonica.com", "Preciso acompanhar os chamados"]);

  const ack = await (await admin(env, "POST", "/admin/ack", { protocolos: [protocolo, "PS-NAOEXISTE"] })).json();
  assert.equal(ack.confirmados, 1);
  assert.equal((await (await admin(env, "GET", "/admin/novos")).json()).pedidos.length, 0);
  const guardado = env.DB.raw.prepare("SELECT matricula, nome, email, justificativa FROM pedidos").get();
  assert.deepEqual({ ...guardado }, { matricula: "-", nome: "-", email: null, justificativa: null });   // dados pessoais apagados
  assert.equal((await admin(env, "POST", "/admin/ack", { protocolos: [protocolo] }).then((x) => x.json())).confirmados, 0);

  assert.equal((await admin(env, "POST", "/admin/decisao", { protocolo, status: "aprovado", motivo: "Chave enviada por e-mail" })).status, 200);
  s = await (await post(env, "/status", { protocolo, token })).json();
  assert.deepEqual([s.status, s.motivo], ["aprovado", "Chave enviada por e-mail"]);
  await admin(env, "POST", "/admin/decisao", { protocolo, status: "revogado" });
  assert.equal((await (await post(env, "/status", { protocolo, token })).json()).status, "revogado");
});

test("validação do pedido (e-mail é obrigatório)", async () => {
  const env = novoEnv();
  for (const ruim of [{}, { ...PEDIDO, matricula: "a" }, { ...PEDIDO, matricula: "A123 456" }, { ...PEDIDO, nome: "ab" },
    { ...PEDIDO, email: "" }, { ...PEDIDO, email: "sem-arroba" }, { ...PEDIDO, email: "a@b" }, { ...PEDIDO, matricula: "A1;DROP" }]) {
    assert.equal((await post(env, "/solicitar", ruim)).status, 400, JSON.stringify(ruim));
  }
  assert.equal((await handle(new Request("https://x/solicitar", { method: "POST", body: "{nao json", headers: { Origin: ORIGEM } }), env)).status, 400);
  assert.equal((await handle(new Request("https://x/solicitar", { method: "GET" }), env)).status, 405);
  assert.equal((await post(env, "/solicitar", { ...PEDIDO, justificativa: "x".repeat(10000) })).status, 413);
  assert.equal((await post(env, "/solicitar", { ...PEDIDO, justificativa: "y".repeat(400) })).status, 201);   // cortada em 300
  assert.equal(env.DB.raw.prepare("SELECT length(justificativa) AS n FROM pedidos").get().n, 300);
});

test("token errado e protocolo inexistente dão a mesma resposta", async () => {
  const env = novoEnv();
  const { protocolo } = await (await post(env, "/solicitar", PEDIDO)).json();
  const a = await post(env, "/status", { protocolo, token: "errado" });
  const b = await post(env, "/status", { protocolo: "PS-ZZZZZZZZ", token: "errado" });
  assert.equal(a.status, 404); assert.equal(b.status, 404);
  assert.deepEqual(await a.json(), await b.json());
});

test("push: inscrição guardada, buscada pelo MAPI e apagada no ack", async () => {
  const env = novoEnv();
  const r = await post(env, "/push/inscrever", INSCRICAO);
  assert.equal(r.status, 202);
  assert.equal((await (await admin(env, "GET", "/admin/ping")).json()).push_novas, 1);
  const { inscricoes } = await (await admin(env, "GET", "/admin/push/novos")).json();
  assert.equal(inscricoes.length, 1);
  assert.deepEqual([inscricoes[0].id, inscricoes[0].endpoint, inscricoes[0].mac], [INSCRICAO.id, INSCRICAO.endpoint, INSCRICAO.mac]);
  const ack = await (await admin(env, "POST", "/admin/push/ack", { ids: [inscricoes[0].rid, 999] })).json();
  assert.equal(ack.confirmados, 1);
  assert.equal((await (await admin(env, "GET", "/admin/push/novos")).json()).inscricoes.length, 0);
});

test("push: endereço que não é de serviço de push, chaves ruins e id/mac mal formados são recusados", async () => {
  const env = novoEnv();
  for (const ruim of [
    { endpoint: "https://169.254.169.254/latest" }, { endpoint: "http://fcm.googleapis.com/x" },
    { endpoint: "https://evil.com/fcm.googleapis.com" }, { endpoint: "https://fcm.googleapis.com.evil.com/x" },
    { endpoint: "https://u:p@fcm.googleapis.com/x" }, { endpoint: "https://fcm.googleapis.com:8443/x" }, { endpoint: "lixo" },
    { p256dh: b64u(10) }, { auth: b64u(8) }, { p256dh: "***" }, { id: "curto" }, { mac: "zz" }, { mac: "B".repeat(63) },
  ]) {
    assert.equal((await post(env, "/push/inscrever", { ...INSCRICAO, ...ruim })).status, 400, JSON.stringify(ruim).slice(0, 60));
  }
  assert.equal(env.DB.raw.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").get().n, 0);
  for (const ok of ["https://updates.push.services.mozilla.com/wpush/v2/x", "https://web.push.apple.com/x", "https://wns2.notify.windows.com/?t=1"]) {
    assert.equal((await post(env, "/push/inscrever", { ...INSCRICAO, endpoint: ok })).status, 202, ok);
  }
});

test("push: limite por origem e teto de pendentes", async () => {
  const env = novoEnv({ LIMITE_PUSH_HORA: "3", MAX_PUSH_PENDENTES: "5" });
  for (let i = 0; i < 3; i++) assert.equal((await post(env, "/push/inscrever", INSCRICAO)).status, 202);
  assert.equal((await post(env, "/push/inscrever", INSCRICAO)).status, 429);
  assert.equal((await post(env, "/push/inscrever", INSCRICAO, { "CF-Connecting-IP": "9.9.9.9" })).status, 202);
  assert.equal((await post(env, "/push/inscrever", INSCRICAO, { "CF-Connecting-IP": "8.8.8.8" })).status, 202);
  assert.equal((await post(env, "/push/inscrever", INSCRICAO, { "CF-Connecting-IP": "7.7.7.7" })).status, 429);   // teto de 5
});

test("rotas do MAPI exigem a chave (inclusive as de push)", async () => {
  const env = novoEnv();
  for (const [m, c] of [["GET", "/admin/ping"], ["GET", "/admin/novos"], ["GET", "/admin/push/novos"], ["POST", "/admin/push/ack"], ["POST", "/admin/ack"], ["POST", "/admin/decisao"]]) {
    assert.equal((await admin(env, m, c, m === "POST" ? {} : null, "outra-chave-qualquer-xx")).status, 401, c);
    assert.equal((await handle(new Request("https://x" + c, { method: m }), env)).status, 401, c);
  }
  const semChave = novoEnv({ MAPI_CHAVE: "curta" });
  assert.equal((await admin(semChave, "GET", "/admin/ping", null, "curta")).status, 503);
  assert.equal((await admin(env, "POST", "/admin/decisao", { protocolo: "PS-NADA", status: "aprovado" })).status, 404);
  assert.equal((await admin(env, "POST", "/admin/decisao", { protocolo: "PS-NADA", status: "qualquer" })).status, 400);
  const ping = await (await admin(env, "GET", "/admin/ping")).json();
  assert.deepEqual([ping.ok, ping.total, ping.novos, ping.push_novas, ping.versao], [true, 0, 0, 0, "2.0.0"]);
});

test("CORS: só a origem do app; as rotas do MAPI não têm CORS", async () => {
  const env = novoEnv();
  const pre = await handle(new Request("https://x/push/inscrever", { method: "OPTIONS", headers: { Origin: ORIGEM } }), env);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  for (const rota of ["/solicitar", "/status", "/push/inscrever"]) {
    const ruim = await post(env, rota, rota === "/push/inscrever" ? INSCRICAO : PEDIDO, { Origin: "https://outro-site.com" });
    assert.equal(ruim.status, 403, rota);
    assert.equal(ruim.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal((await post(env, rota, PEDIDO, { Origin: "" })).status, 403, rota);   // sem Origin (não é navegador)
  }
  const ok = await post(env, "/solicitar", PEDIDO);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), ORIGEM);
  assert.equal((await admin(env, "GET", "/admin/ping")).headers.get("Access-Control-Allow-Origin"), null);
});

test("limite de pedidos por origem e global; o IP não fica guardado; a limpeza diária apaga o antigo", async () => {
  const env = novoEnv({ LIMITE_POR_HORA: "3", LIMITE_GLOBAL_HORA: "5" });
  for (let i = 0; i < 3; i++) assert.equal((await post(env, "/solicitar", PEDIDO)).status, 201);
  assert.equal((await post(env, "/solicitar", PEDIDO)).status, 429);
  assert.equal((await post(env, "/solicitar", PEDIDO, { "CF-Connecting-IP": "9.9.9.9" })).status, 201);
  assert.equal((await post(env, "/solicitar", PEDIDO, { "CF-Connecting-IP": "8.8.8.8" })).status, 201);
  assert.equal((await post(env, "/solicitar", PEDIDO, { "CF-Connecting-IP": "7.7.7.7" })).status, 429);
  const linha = env.DB.raw.prepare("SELECT origem_hash FROM pedidos").get();
  assert.match(linha.origem_hash, /^[0-9a-f]{64}$/);
  assert.ok(!linha.origem_hash.includes("1.2.3.4"));

  const env2 = novoEnv();
  await post(env2, "/solicitar", PEDIDO);
  await post(env2, "/push/inscrever", INSCRICAO);
  env2.DB.raw.prepare("UPDATE pedidos SET criado_em = ?").run(new Date(Date.now() - 40 * 86400e3).toISOString());
  env2.DB.raw.prepare("UPDATE push_inscricoes SET criado_em = ?").run(new Date(Date.now() - 8 * 86400e3).toISOString());
  await post(env2, "/solicitar", PEDIDO, { "CF-Connecting-IP": "5.5.5.5" });
  await post(env2, "/push/inscrever", INSCRICAO, { "CF-Connecting-IP": "5.5.5.5" });
  assert.equal(await limpezaDiaria(env2), 2);
  assert.equal(env2.DB.raw.prepare("SELECT COUNT(*) AS n FROM pedidos").get().n, 1);
  assert.equal(env2.DB.raw.prepare("SELECT COUNT(*) AS n FROM push_inscricoes").get().n, 1);
});

test("raiz e rota desconhecida", async () => {
  const env = novoEnv();
  assert.equal((await handle(new Request("https://x/"), env)).status, 200);
  assert.equal((await handle(new Request("https://x/nada"), env)).status, 404);
});

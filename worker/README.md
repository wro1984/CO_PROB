# Caixa de entrada (Cloudflare Worker + D1)

Recebe os **pedidos de acesso** e as **inscrições de aviso (push)** do app, para o MAPI buscar por conexão de saída (o MAPI não recebe
conexões de fora). Não guarda dado de chamado nenhum. Visão geral e segurança: ver o `SIS_APP.md` do repositório do MAPI e o `LEIAME.md` daqui.

Rotas: `POST /solicitar`, `POST /status`, `POST /push/inscrever` (app) e `/admin/*` (só o MAPI, com `MAPI_CHAVE`).
Privacidade: matrícula, nome, e-mail e motivo ficam só até o MAPI confirmar o recebimento; o cron diário apaga pedidos com mais de 30 dias e
inscrições com mais de 7. O IP nunca é gravado.

## Publicar pelo painel da Cloudflare (conta gratuita, sem instalar nada)
1. **Banco:** *Storage & Databases → D1 → Create database*, nome `problemas-sistemicos`. Na aba **Console**, rode o conteúdo de `schema-painel.sql`
   **um comando por vez** (o console junta as linhas; por isso este arquivo não tem comentários).
2. **Worker:** *Compute → Workers & Pages → Create → Hello World*, nome à sua escolha (o endereço vira `https://<nome>.<subdominio>.workers.dev`).
   **Edit code**, apague tudo, cole o `src/index.js` e **Deploy**. Abrir o endereço deve mostrar `{"servico":"problemas-sistemicos-caixa","versao":"2.0.0"}`.
3. **Banco no Worker:** *Settings → Bindings → Add → D1 database*, variável **`DB`** (maiúsculas), banco `problemas-sistemicos`.
4. **Variáveis** (*Settings → Variables and Secrets*):

   | Nome | Tipo | Valor |
   |---|---|---|
   | `MAPI_CHAVE` | **Secret** | chave longa (PowerShell: `[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")`); guarde para o `.env` do MAPI |
   | `ORIGENS_PERMITIDAS` | Texto | `https://wro1984.github.io` (o endereço do app, sem barra no final) |
   | `LIMITE_POR_HORA` | Texto | `30` |
   | `LIMITE_GLOBAL_HORA` | Texto | `300` |
   | `LIMITE_PUSH_HORA` | Texto | `60` |
   | `MAX_PUSH_PENDENTES` | Texto | `2000` |
   | `RETENCAO_DIAS` | Texto | `30` |
5. **Limpeza:** *Settings → Trigger Events → Cron Triggers → Add*, expressão `0 3 * * *`.
6. **Testar a chave** (PowerShell): `Invoke-RestMethod https://<endereco>/admin/ping -Headers @{Authorization="Bearer SUA-CHAVE"}` deve voltar `ok: True`.
7. **Ligar:** no `.env` do MAPI: `SIS_APP_CAIXA_URL=https://<endereco>` e `SIS_APP_CAIXA_CHAVE=<a chave>`; em `config.js` do app: `caixa: 'https://<endereco>'`.

## Publicar pelo terminal (alternativa)
`npm install`, `npx wrangler login`, `npx wrangler d1 create problemas-sistemicos` (cole o `database_id` em `wrangler.toml`),
`npx wrangler d1 execute problemas-sistemicos --remote --file=schema.sql`, `npx wrangler secret put MAPI_CHAVE`, `npx wrangler deploy`.

## Atualizar a partir da versão 1 (só pedidos, sem e-mail)
Rode `ALTER TABLE pedidos ADD COLUMN email TEXT;` e o `CREATE TABLE ... push_inscricoes` de `schema-painel.sql`; depois cole o novo `src/index.js` e faça o deploy.

## Testes
`npm install && npm test` (Node 22+; usa um SQLite em memória no lugar do D1). Rodar local de ponta a ponta:
`npx wrangler d1 execute problemas-sistemicos --local --file=schema.sql`, depois `npx wrangler dev --local --var ORIGENS_PERMITIDAS:http://localhost:8090`
(a chave local fica em `worker/.dev.vars`: `MAPI_CHAVE=...`; não commitar).

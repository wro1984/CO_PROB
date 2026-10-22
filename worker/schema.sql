-- Caixa de entrada do app Problemas Sistêmicos (pedidos de acesso e inscrições de push).
-- Banco novo:   npx wrangler d1 execute problemas-sistemicos --remote --file=schema.sql
-- Banco que já tinha a versão 1 (só pedidos, sem e-mail): rodar também o bloco "MIGRAÇÃO" abaixo, uma vez.
CREATE TABLE IF NOT EXISTS pedidos (
  protocolo     TEXT PRIMARY KEY,                 -- PS-XXXXXXXX
  token_hash    TEXT NOT NULL,                    -- sha256 do token que só o celular conhece
  matricula     TEXT NOT NULL,
  nome          TEXT NOT NULL,
  email         TEXT,
  justificativa TEXT,
  status        TEXT NOT NULL DEFAULT 'novo',     -- novo | pendente | aprovado | recusado | revogado
  motivo        TEXT,
  origem_hash   TEXT NOT NULL,                    -- sha256(ip + sal): só para limitar abuso
  criado_em     TEXT NOT NULL,
  atualizado_em TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_pedidos_status ON pedidos (status);
CREATE INDEX IF NOT EXISTS ix_pedidos_origem ON pedidos (origem_hash, criado_em);

CREATE TABLE IF NOT EXISTS push_inscricoes (
  rid           INTEGER PRIMARY KEY AUTOINCREMENT,
  id            TEXT NOT NULL,                    -- sha256("ps:" + matrícula), o mesmo id do dados.json
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  mac           TEXT NOT NULL,                    -- prova de que quem abriu o pacote fez a inscrição (o MAPI confere)
  origem_hash   TEXT NOT NULL,
  criado_em     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_push_origem ON push_inscricoes (origem_hash, criado_em);

-- MIGRAÇÃO (só se a tabela pedidos já existia sem a coluna email; dá erro "duplicate column" se já tiver, pode ignorar):
-- ALTER TABLE pedidos ADD COLUMN email TEXT;

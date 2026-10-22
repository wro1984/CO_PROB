CREATE TABLE IF NOT EXISTS pedidos (protocolo TEXT PRIMARY KEY, token_hash TEXT NOT NULL, matricula TEXT NOT NULL, nome TEXT NOT NULL, email TEXT, justificativa TEXT, status TEXT NOT NULL DEFAULT 'novo', motivo TEXT, origem_hash TEXT NOT NULL, criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_pedidos_status ON pedidos (status);
CREATE INDEX IF NOT EXISTS ix_pedidos_origem ON pedidos (origem_hash, criado_em);
CREATE TABLE IF NOT EXISTS push_inscricoes (rid INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, mac TEXT NOT NULL, origem_hash TEXT NOT NULL, criado_em TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS ix_push_origem ON push_inscricoes (origem_hash, criado_em);

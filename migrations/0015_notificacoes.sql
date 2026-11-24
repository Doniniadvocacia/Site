-- Notificações ao usuário (sino da barra superior): prazos atribuídos, novas intimações, leads e follow-ups atribuídos.
CREATE TABLE notificacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id  INTEGER NOT NULL REFERENCES usuarios(id),
  tipo        TEXT NOT NULL,
  texto       TEXT NOT NULL,
  link        TEXT,
  autor_id    INTEGER,
  lida        INTEGER NOT NULL DEFAULT 0,
  criado_em   INTEGER NOT NULL
);
CREATE INDEX idx_notificacoes_usuario ON notificacoes(usuario_id, lida, criado_em);

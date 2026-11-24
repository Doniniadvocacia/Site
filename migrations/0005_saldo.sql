-- Configurações gerais do sistema (chave/valor). Usada para o saldo de referência da conta.
CREATE TABLE configuracoes (
  chave         TEXT PRIMARY KEY,
  valor         TEXT,
  atualizado_por INTEGER REFERENCES usuarios(id),
  atualizado_em INTEGER NOT NULL
);

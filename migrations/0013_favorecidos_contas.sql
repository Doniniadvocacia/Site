-- Favorecidos (cadastro em Configurações) e conta do escritório em cada lançamento.
CREATE TABLE favorecidos (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  nome                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  documento_enc       TEXT,           -- CPF/CNPJ (cifrado)
  dados_bancarios_enc TEXT,           -- banco, agência, conta, Pix (cifrado)
  ativo               INTEGER NOT NULL DEFAULT 1,
  criado_em           INTEGER NOT NULL,
  atualizado_em       INTEGER
);
ALTER TABLE financeiro ADD COLUMN conta TEXT;   -- conta do escritório: crédito (receita) ou débito (despesa)
INSERT OR IGNORE INTO listas (lista, valor, ordem) VALUES
  ('conta_bancaria', 'Itaú', 1), ('conta_bancaria', 'Banrisul', 2), ('conta_bancaria', 'Nubank', 3),
  ('conta_bancaria', 'Asaas', 4), ('conta_bancaria', 'InfinityPay', 5);

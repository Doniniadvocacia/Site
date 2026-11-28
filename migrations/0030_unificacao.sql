-- Unificação de cadastros duplicados de pessoas.
-- Registros do Wix absorvidos por outro cadastro: a importação não os recria e liga os dados deles ao cadastro que ficou.
CREATE TABLE cadastros_unificados (
  wix_id       TEXT PRIMARY KEY,
  cliente_id   INTEGER NOT NULL REFERENCES clientes(id),
  unificado_em INTEGER NOT NULL
);
-- Pares marcados como "não são a mesma pessoa" (não voltam a ser sugeridos).
CREATE TABLE cadastros_distintos (
  a INTEGER NOT NULL,
  b INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);

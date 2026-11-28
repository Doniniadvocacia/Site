-- Intimações excluídas na triagem: a captura do DJEN não volta a trazê-las.
CREATE TABLE publicacoes_excluidas (
  hash         TEXT PRIMARY KEY,
  djen_id      TEXT,
  excluida_por INTEGER REFERENCES usuarios(id),
  excluida_em  INTEGER NOT NULL
);
CREATE INDEX idx_publicacoes_excluidas_djen ON publicacoes_excluidas(djen_id);

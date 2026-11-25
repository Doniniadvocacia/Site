-- Cálculos judiciais: índices do Banco Central (SGS) e cálculos salvos.
CREATE TABLE indices (
  serie         TEXT NOT NULL,       -- ipca, ipcae, inpc, igpm, selic, taxa_legal, tr
  mes           TEXT NOT NULL,       -- AAAA-MM
  valor         REAL NOT NULL,       -- variação ou taxa do mês, em %
  atualizado_em INTEGER NOT NULL,
  PRIMARY KEY (serie, mes)
);
CREATE TABLE indices_atualizacoes (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  criado_em INTEGER NOT NULL,
  resumo    TEXT,
  erro      TEXT
);
CREATE TABLE calculos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id   INTEGER REFERENCES processos(id),
  titulo        TEXT NOT NULL,
  parametros    TEXT NOT NULL,       -- JSON com critérios, parcelas e acréscimos
  data_final    TEXT,
  total         REAL,
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE INDEX idx_calculos_processo ON calculos(processo_id);

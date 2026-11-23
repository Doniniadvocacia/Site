-- Diligo — etapa 2: prazos, agenda, publicações do DJEN, OABs monitoradas e feriados

CREATE TABLE oabs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT NOT NULL,
  uf          TEXT NOT NULL,
  advogado    TEXT,
  ativo       INTEGER NOT NULL DEFAULT 1,
  criado_em   INTEGER NOT NULL,
  UNIQUE (numero, uf)
);

-- Feriados além dos nacionais (que o sistema calcula sozinho): estaduais, municipais, do tribunal.
CREATE TABLE feriados (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  data        TEXT NOT NULL,          -- AAAA-MM-DD
  descricao   TEXT NOT NULL,
  abrangencia TEXT,                   -- ex.: RS, TJRS, Caxias do Sul
  criado_em   INTEGER NOT NULL,
  UNIQUE (data, abrangencia)
);

CREATE TABLE publicacoes (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id                 TEXT UNIQUE,
  djen_id                TEXT UNIQUE,
  hash                   TEXT UNIQUE,
  data_disponibilizacao  TEXT,        -- AAAA-MM-DD
  data_publicacao        TEXT,        -- 1º dia útil seguinte à disponibilização
  tribunal               TEXT,
  orgao                  TEXT,
  tipo                   TEXT,
  numero_processo        TEXT,
  processo_id            INTEGER REFERENCES processos(id),
  texto                  TEXT,
  link                   TEXT,
  oab                    TEXT,
  situacao               TEXT NOT NULL DEFAULT 'pendente'
                         CHECK (situacao IN ('pendente', 'com_prazo', 'sem_prazo', 'importada')),
  triada_por             INTEGER REFERENCES usuarios(id),
  triada_em              INTEGER,
  criado_em              INTEGER NOT NULL
);
CREATE INDEX idx_publicacoes_situacao ON publicacoes(situacao, data_disponibilizacao);
CREATE INDEX idx_publicacoes_processo ON publicacoes(processo_id);

CREATE TABLE prazos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id           TEXT UNIQUE,
  processo_id      INTEGER REFERENCES processos(id),
  publicacao_id    INTEGER REFERENCES publicacoes(id),
  titulo           TEXT NOT NULL,
  tipo             TEXT,
  categoria        TEXT,
  descricao        TEXT,
  data_inicio      TEXT,             -- data da publicação/intimação usada no cálculo
  dias             INTEGER,
  contagem         TEXT CHECK (contagem IN ('uteis', 'corridos')),
  prazo_fatal      TEXT,             -- AAAA-MM-DD
  prazo_interno    TEXT,
  hora             TEXT,
  responsavel      TEXT,
  situacao         TEXT NOT NULL DEFAULT 'aberto' CHECK (situacao IN ('aberto', 'cumprido', 'cancelado')),
  data_cumprimento TEXT,
  data_audiencia   TEXT,
  hora_audiencia   TEXT,
  uf               TEXT,
  criado_por       INTEGER REFERENCES usuarios(id),
  criado_em        INTEGER NOT NULL,
  atualizado_em    INTEGER NOT NULL
);
CREATE INDEX idx_prazos_fatal ON prazos(situacao, prazo_fatal);
CREATE INDEX idx_prazos_processo ON prazos(processo_id);

CREATE TABLE agenda (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id        TEXT UNIQUE,
  processo_id   INTEGER REFERENCES processos(id),
  cliente_id    INTEGER REFERENCES clientes(id),
  titulo        TEXT NOT NULL,
  tipo          TEXT,
  data          TEXT NOT NULL,       -- AAAA-MM-DD
  hora          TEXT,
  local         TEXT,
  situacao      TEXT NOT NULL DEFAULT 'agendado' CHECK (situacao IN ('agendado', 'realizado', 'cancelado')),
  observacoes   TEXT,
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     INTEGER NOT NULL,
  atualizado_em INTEGER NOT NULL
);
CREATE INDEX idx_agenda_data ON agenda(data);

CREATE TABLE capturas (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  origem       TEXT NOT NULL,        -- 'agendada' ou 'manual'
  oab          TEXT,
  encontradas  INTEGER NOT NULL DEFAULT 0,
  novas        INTEGER NOT NULL DEFAULT 0,
  erro         TEXT,
  criado_em    INTEGER NOT NULL
);

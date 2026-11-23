-- Diligo — etapa 3: financeiro, histórico processual, anexos e cadastro próprio

-- Acesso ao financeiro por credencial (administradores sempre têm).
ALTER TABLE usuarios ADD COLUMN acesso_financeiro INTEGER NOT NULL DEFAULT 0;

-- Registros alterados aqui não são mais sobrescritos pela importação do Wix.
ALTER TABLE clientes ADD COLUMN editado_local INTEGER NOT NULL DEFAULT 0;
ALTER TABLE processos ADD COLUMN editado_local INTEGER NOT NULL DEFAULT 0;

-- Arquivos ficam cifrados (AES-256-GCM) no Cloudflare R2; aqui só os metadados.
CREATE TABLE anexos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  chave         TEXT UNIQUE,              -- nome do objeto no R2 (nulo enquanto não copiado do Wix)
  nome          TEXT NOT NULL,
  tipo_mime     TEXT,
  tamanho       INTEGER,
  contexto      TEXT NOT NULL CHECK (contexto IN ('historico', 'financeiro')),
  origem_wix    TEXT UNIQUE,              -- wix:document://... (importados)
  erro          TEXT,
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     INTEGER NOT NULL
);

CREATE TABLE historico (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id        TEXT UNIQUE,
  processo_id   INTEGER REFERENCES processos(id),
  cliente_id    INTEGER REFERENCES clientes(id),
  data          TEXT NOT NULL,            -- AAAA-MM-DD
  descricao     TEXT NOT NULL,
  anexo_id      INTEGER REFERENCES anexos(id),
  criado_por    INTEGER REFERENCES usuarios(id),
  criado_em     INTEGER NOT NULL
);
CREATE INDEX idx_historico_processo ON historico(processo_id, data);

CREATE TABLE financeiro (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id          TEXT UNIQUE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('receita', 'despesa')),
  categoria       TEXT,
  descricao       TEXT NOT NULL,
  processo_id     INTEGER REFERENCES processos(id),
  cliente_id      INTEGER REFERENCES clientes(id),
  valor           REAL NOT NULL,
  vencimento      TEXT NOT NULL,          -- AAAA-MM-DD
  pago            INTEGER NOT NULL DEFAULT 0,
  data_pagamento  TEXT,
  forma_pagamento TEXT,
  condicao        TEXT,                   -- À vista, Parcelado, Entrada+Parcelado, Recorrente
  grupo           TEXT,                   -- parcelas e recorrências do mesmo lançamento
  parcela         INTEGER,
  parcelas        INTEGER,
  responsavel     TEXT,
  pagante         TEXT,
  favorecido      TEXT,
  dados_bancarios_enc TEXT,               -- banco, agência, conta, Pix
  observacoes_enc TEXT,
  anexo_id        INTEGER REFERENCES anexos(id),
  criado_por      INTEGER REFERENCES usuarios(id),
  criado_em       INTEGER NOT NULL,
  atualizado_em   INTEGER NOT NULL
);
CREATE INDEX idx_financeiro_vencimento ON financeiro(vencimento);
CREATE INDEX idx_financeiro_processo ON financeiro(processo_id);
CREATE INDEX idx_financeiro_grupo ON financeiro(grupo);

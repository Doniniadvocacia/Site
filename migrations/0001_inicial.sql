-- Diligo — esquema inicial (etapa 1: acesso, clientes e processos)
-- Campos terminados em _enc guardam texto cifrado (AES-256-GCM) pela aplicação.

CREATE TABLE usuarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash      TEXT NOT NULL,                 -- pbkdf2-sha256$iteracoes$sal$hash
  perfil          TEXT NOT NULL DEFAULT 'colaborador'
                  CHECK (perfil IN ('admin', 'advogado', 'colaborador', 'cliente')),
  cliente_id      INTEGER REFERENCES clientes(id), -- futuro portal do cliente
  totp_enc        TEXT,                          -- segredo do 2FA, cifrado
  totp_ativo      INTEGER NOT NULL DEFAULT 0,
  totp_ultimo     INTEGER NOT NULL DEFAULT 0,    -- último passo usado (evita reuso do código)
  trocar_senha    INTEGER NOT NULL DEFAULT 1,
  ativo           INTEGER NOT NULL DEFAULT 1,
  falhas          INTEGER NOT NULL DEFAULT 0,
  bloqueado_ate   INTEGER NOT NULL DEFAULT 0,    -- epoch em segundos
  criado_em       INTEGER NOT NULL,
  ultimo_acesso   INTEGER
);

CREATE TABLE sessoes (
  token_hash      TEXT PRIMARY KEY,              -- SHA-256 do token; o token só existe no cookie
  usuario_id      INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  etapa           TEXT NOT NULL CHECK (etapa IN ('senha', 'completa')),
  csrf            TEXT NOT NULL,
  criada_em       INTEGER NOT NULL,
  expira_em       INTEGER NOT NULL,
  ip              TEXT,
  agente          TEXT
);
CREATE INDEX idx_sessoes_usuario ON sessoes(usuario_id);

CREATE TABLE auditoria (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id      INTEGER,
  acao            TEXT NOT NULL,
  detalhe         TEXT,
  ip              TEXT,
  criado_em       INTEGER NOT NULL
);
CREATE INDEX idx_auditoria_data ON auditoria(criado_em);

CREATE TABLE clientes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id              TEXT UNIQUE,
  nome                TEXT NOT NULL,
  tipo                TEXT,            -- pessoa física / jurídica
  posicao             TEXT,
  genero              TEXT,
  estado_civil        TEXT,
  profissao           TEXT,
  cidade              TEXT,
  estado              TEXT,
  documento_enc       TEXT,
  data_nascimento_enc TEXT,
  email_enc           TEXT,
  telefone_enc        TEXT,
  endereco_enc        TEXT,            -- endereço, bairro e CEP juntos
  observacoes_enc     TEXT,
  data_cadastro       TEXT,
  criado_em           INTEGER NOT NULL,
  atualizado_em       INTEGER NOT NULL
);
CREATE INDEX idx_clientes_nome ON clientes(nome COLLATE NOCASE);

CREATE TABLE processos (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  wix_id                  TEXT UNIQUE,
  cliente_id              INTEGER REFERENCES clientes(id),
  pasta                   TEXT,
  numero                  TEXT,
  titulo                  TEXT,
  tipo_acao               TEXT,
  rito                    TEXT,
  fase                    TEXT,
  instancia               TEXT,
  situacao                TEXT,
  competencia             TEXT,
  comarca                 TEXT,
  vara                    TEXT,
  uf                      TEXT,
  posicao_cliente         TEXT,
  parte_contraria         TEXT,
  advogado_parte_contraria TEXT,
  advogado_responsavel    TEXT,
  ajg_deferida            TEXT,
  valor_causa             REAL,
  data_distribuicao       TEXT,
  data_cadastro           TEXT,
  resultado               TEXT,
  resultado_atual         TEXT,
  resultado_primeira      TEXT,
  data_decisao_primeira   TEXT,
  resultado_segunda       TEXT,
  data_decisao_segunda    TEXT,
  resultado_superior      TEXT,
  data_decisao_superior   TEXT,
  data_decisao_final      TEXT,
  proximo_prazo           TEXT,
  contato_parte_contraria_enc TEXT,    -- e-mail e telefone da parte contrária
  observacoes_enc         TEXT,
  criado_em               INTEGER NOT NULL,
  atualizado_em           INTEGER NOT NULL
);
CREATE INDEX idx_processos_cliente ON processos(cliente_id);
CREATE INDEX idx_processos_numero ON processos(numero);

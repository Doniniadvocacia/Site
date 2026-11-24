-- CRM: funil de potenciais clientes (leads), interações, follow-ups, origem e etiquetas dos clientes.
CREATE TABLE leads (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nome            TEXT NOT NULL,
  tipo            TEXT,                 -- pessoa física / jurídica
  telefone_enc    TEXT,
  email_enc       TEXT,
  origem          TEXT,
  indicado_por    TEXT,
  area            TEXT,                 -- área de interesse
  etiquetas       TEXT,                 -- separadas por vírgula
  valor_estimado  REAL,                 -- honorários estimados
  responsavel     TEXT,
  etapa           TEXT NOT NULL DEFAULT 'Novo contato',
  resumo_enc      TEXT,                 -- resumo do caso (cifrado)
  motivo_perda    TEXT,
  cliente_id      INTEGER REFERENCES clientes(id),
  etapa_desde     INTEGER,
  encerrado_em    INTEGER,
  criado_em       INTEGER NOT NULL,
  atualizado_em   INTEGER
);
CREATE INDEX idx_leads_etapa ON leads(etapa);

CREATE TABLE crm_interacoes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER REFERENCES leads(id),
  cliente_id  INTEGER REFERENCES clientes(id),
  tipo        TEXT NOT NULL,
  data        TEXT NOT NULL,            -- AAAA-MM-DD
  resumo_enc  TEXT,                     -- anotação (cifrada)
  usuario_id  INTEGER,
  criado_em   INTEGER NOT NULL
);
CREATE INDEX idx_crm_interacoes_lead ON crm_interacoes(lead_id);
CREATE INDEX idx_crm_interacoes_cliente ON crm_interacoes(cliente_id);

CREATE TABLE crm_tarefas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id       INTEGER REFERENCES leads(id),
  cliente_id    INTEGER REFERENCES clientes(id),
  titulo        TEXT NOT NULL,
  data          TEXT NOT NULL,          -- AAAA-MM-DD
  responsavel   TEXT,
  feito         INTEGER NOT NULL DEFAULT 0,
  concluido_em  INTEGER,
  criado_por    INTEGER,
  criado_em     INTEGER NOT NULL
);
CREATE INDEX idx_crm_tarefas_pendentes ON crm_tarefas(feito, data);

ALTER TABLE clientes ADD COLUMN origem TEXT;
ALTER TABLE clientes ADD COLUMN etiquetas TEXT;

INSERT OR IGNORE INTO listas (lista, valor, ordem) VALUES
  ('origem_cliente', 'Indicação de cliente', 1), ('origem_cliente', 'Indicação de parceiro', 2), ('origem_cliente', 'Site', 3),
  ('origem_cliente', 'Instagram', 4), ('origem_cliente', 'Google', 5), ('origem_cliente', 'WhatsApp', 6),
  ('origem_cliente', 'Seguradora', 7), ('origem_cliente', 'Cliente antigo', 8), ('origem_cliente', 'Outro', 9),
  ('area_interesse', 'Sub-rogação securitária', 1), ('area_interesse', 'Direito médico', 2), ('area_interesse', 'Empresarial', 3),
  ('area_interesse', 'Contratos', 4), ('area_interesse', 'Família', 5), ('area_interesse', 'Sucessões', 6),
  ('area_interesse', 'Consumidor', 7), ('area_interesse', 'Trabalhista', 8), ('area_interesse', 'Outro', 9),
  ('tipo_interacao', 'Ligação', 1), ('tipo_interacao', 'Reunião presencial', 2), ('tipo_interacao', 'Reunião online', 3),
  ('tipo_interacao', 'WhatsApp', 4), ('tipo_interacao', 'E-mail', 5), ('tipo_interacao', 'Proposta enviada', 6), ('tipo_interacao', 'Outro', 7),
  ('motivo_perda', 'Preço / honorários', 1), ('motivo_perda', 'Escolheu outro escritório', 2), ('motivo_perda', 'Desistiu da ação', 3),
  ('motivo_perda', 'Caso inviável', 4), ('motivo_perda', 'Sem retorno', 5), ('motivo_perda', 'Fora da área de atuação', 6), ('motivo_perda', 'Outro', 7);

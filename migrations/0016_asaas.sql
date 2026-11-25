-- Integração com o Asaas: cobranças emitidas pelo Diligo, baixa automática por aviso (webhook) e conciliação do extrato.
ALTER TABLE clientes ADD COLUMN asaas_id TEXT;            -- cliente no Asaas (cus_...)
ALTER TABLE financeiro ADD COLUMN asaas_id TEXT;          -- cobrança no Asaas (pay_...)
ALTER TABLE financeiro ADD COLUMN asaas_status TEXT;      -- PENDING, RECEIVED, CONFIRMED, OVERDUE, REFUNDED...
ALTER TABLE financeiro ADD COLUMN asaas_link TEXT;        -- link da fatura (invoiceUrl)
ALTER TABLE financeiro ADD COLUMN asaas_forma TEXT;       -- BOLETO, PIX, CREDIT_CARD, UNDEFINED
CREATE UNIQUE INDEX idx_financeiro_asaas ON financeiro(asaas_id) WHERE asaas_id IS NOT NULL;
CREATE INDEX idx_clientes_asaas ON clientes(asaas_id);

-- Avisos recebidos do Asaas (o mesmo aviso pode chegar mais de uma vez: o id evita processar de novo).
CREATE TABLE asaas_eventos (
  id           TEXT PRIMARY KEY,
  tipo         TEXT NOT NULL,
  cobranca_id  TEXT,
  financeiro_id INTEGER,
  resultado    TEXT,
  recebido_em  INTEGER NOT NULL
);

-- Extrato do Asaas trazido para conciliação.
CREATE TABLE asaas_extrato (
  id            TEXT PRIMARY KEY,         -- id da movimentação no Asaas
  data          TEXT NOT NULL,            -- AAAA-MM-DD
  tipo          TEXT,                     -- PAYMENT_RECEIVED, TRANSFER, BILL_PAYMENT, *_FEE...
  valor         REAL NOT NULL,            -- positivo = entrada, negativo = saída
  descricao     TEXT,
  cobranca_id   TEXT,
  financeiro_id INTEGER REFERENCES financeiro(id),
  situacao      TEXT NOT NULL DEFAULT 'pendente' CHECK (situacao IN ('pendente', 'conciliado', 'ignorado')),
  criado_em     INTEGER NOT NULL
);
CREATE INDEX idx_asaas_extrato_situacao ON asaas_extrato(situacao, data);

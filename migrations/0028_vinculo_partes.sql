-- Vínculo da pessoa com o escritório (lista editável em Configurações › Listas) e partes contrárias do processo.
ALTER TABLE clientes ADD COLUMN vinculo TEXT;
UPDATE clientes SET vinculo = CASE WHEN cliente = 1 THEN 'Cliente' ELSE 'Parte Adversa' END;
INSERT OR IGNORE INTO listas (lista, valor, ordem) VALUES ('vinculo_pessoa', 'Cliente', 1), ('vinculo_pessoa', 'Parte Adversa', 2);

-- Parte contrária principal ligada ao cadastro de pessoas (o nome continua em processos.parte_contraria).
ALTER TABLE processos ADD COLUMN parte_contraria_id INTEGER REFERENCES clientes(id);
-- Demais partes contrárias (não aparecem na capa do processo).
CREATE TABLE processo_partes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  processo_id INTEGER NOT NULL REFERENCES processos(id) ON DELETE CASCADE,
  pessoa_id   INTEGER REFERENCES clientes(id),
  nome        TEXT NOT NULL,
  ordem       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_processo_partes ON processo_partes(processo_id);

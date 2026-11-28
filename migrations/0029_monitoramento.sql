-- Monitoramento no DJEN além das OABs: por número do processo e pelo nome do cliente.
ALTER TABLE processos ADD COLUMN monitorar INTEGER NOT NULL DEFAULT 0;
ALTER TABLE processos ADD COLUMN monitorado_em INTEGER;
ALTER TABLE clientes ADD COLUMN monitorar INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clientes ADD COLUMN monitorado_em INTEGER;

-- Diligo — campos da ficha do processo que existiam no Wix
ALTER TABLE processos ADD COLUMN numero_vara TEXT;            -- "1ª"; a coluna vara guarda o órgão julgador
ALTER TABLE processos ADD COLUMN data_citacao TEXT;
ALTER TABLE processos ADD COLUMN data_transito TEXT;
ALTER TABLE processos ADD COLUMN data_encerramento TEXT;
ALTER TABLE processos ADD COLUMN motivo_encerramento TEXT;
ALTER TABLE processos ADD COLUMN oab_parte_contraria TEXT;
ALTER TABLE processos ADD COLUMN telefone_parte_contraria_enc TEXT;
ALTER TABLE processos ADD COLUMN email_parte_contraria_enc TEXT;
ALTER TABLE historico ADD COLUMN atualizado_em INTEGER;

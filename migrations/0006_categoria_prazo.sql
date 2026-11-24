-- Prazo ou Compromisso (mesma regra do Diligo no Wix); registros sem categoria são prazos.
UPDATE prazos SET categoria = 'Prazo' WHERE categoria IS NULL OR TRIM(categoria) = '' OR categoria NOT IN ('Prazo', 'Compromisso');

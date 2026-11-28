-- Andamento gerado pela triagem de uma intimação (evita lançar o mesmo andamento duas vezes).
ALTER TABLE historico ADD COLUMN publicacao_id INTEGER REFERENCES publicacoes(id);
CREATE INDEX idx_historico_publicacao ON historico(publicacao_id);

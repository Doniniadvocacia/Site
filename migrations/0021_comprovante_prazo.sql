-- Comprovante de protocolo anexado ao cumprir um prazo (opcional).
ALTER TABLE prazos ADD COLUMN comprovante_anexo_id INTEGER REFERENCES anexos(id);

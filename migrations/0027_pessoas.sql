-- Cadastro de pessoas: indica se a pessoa é cliente do escritório (os cadastros existentes são clientes).
ALTER TABLE clientes ADD COLUMN cliente INTEGER NOT NULL DEFAULT 1;

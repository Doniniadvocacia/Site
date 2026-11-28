-- Identifica a execução da captura que trouxe cada intimação (permite desfazer uma captura inteira).
ALTER TABLE publicacoes ADD COLUMN execucao TEXT;
ALTER TABLE capturas ADD COLUMN execucao TEXT;

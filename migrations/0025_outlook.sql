-- Espelhamento de prazos/compromissos na agenda do Outlook (Microsoft 365).
ALTER TABLE prazos ADD COLUMN outlook INTEGER NOT NULL DEFAULT 0;
ALTER TABLE prazos ADD COLUMN outlook_evento TEXT;
ALTER TABLE prazos ADD COLUMN outlook_erro TEXT;

-- Pasta do cliente no SharePoint (as pastas dos processos ficam dentro dela).
ALTER TABLE clientes ADD COLUMN sharepoint_item TEXT;

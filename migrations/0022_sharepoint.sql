-- Pasta do processo no SharePoint/OneDrive (Microsoft 365), vinculada manualmente na ficha do processo.
ALTER TABLE processos ADD COLUMN sharepoint_drive TEXT;
ALTER TABLE processos ADD COLUMN sharepoint_item TEXT;
ALTER TABLE processos ADD COLUMN sharepoint_nome TEXT;
ALTER TABLE processos ADD COLUMN sharepoint_url TEXT;

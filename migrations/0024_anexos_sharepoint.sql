-- Cópia dos anexos do histórico para a pasta do processo no SharePoint.
ALTER TABLE anexos ADD COLUMN sharepoint_item TEXT;
ALTER TABLE anexos ADD COLUMN sharepoint_erro TEXT;

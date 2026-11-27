-- Pastas automáticas no SharePoint: 1 = o usuário desvinculou de propósito; a criação automática não refaz o vínculo.
ALTER TABLE processos ADD COLUMN sharepoint_ignorar INTEGER NOT NULL DEFAULT 0;

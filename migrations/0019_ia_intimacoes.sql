-- Análise automática das intimações por IA (sugestão de prazo para aprovação do usuário).
ALTER TABLE publicacoes ADD COLUMN ia_status TEXT;      -- NULL (não analisada), 'pronta' ou 'erro'
ALTER TABLE publicacoes ADD COLUMN ia_sugestao TEXT;    -- JSON devolvido pela IA
ALTER TABLE publicacoes ADD COLUMN ia_erro TEXT;
ALTER TABLE publicacoes ADD COLUMN ia_em INTEGER;
ALTER TABLE publicacoes ADD COLUMN ia_tentativas INTEGER NOT NULL DEFAULT 0;
ALTER TABLE publicacoes ADD COLUMN ia_resultado TEXT;   -- 'aprovada', 'corrigida' ou 'rejeitada' (como a sugestão foi tratada)

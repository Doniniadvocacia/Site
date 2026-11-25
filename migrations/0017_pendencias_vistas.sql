-- Pendências (prazos, compromissos, follow-ups, leads, intimações) abertas pelo sino (ou "Ler todas"/"Limpar"): somem da lista do usuário naquele dia.
-- Se o item continuar pendente, volta a aparecer no dia seguinte.
CREATE TABLE pendencias_vistas (
  usuario_id INTEGER NOT NULL,
  chave      TEXT NOT NULL,      -- ex.: prazo:12, agenda:5, followup:3, lead:7, intimacoes:4
  dia        TEXT NOT NULL,      -- AAAA-MM-DD (horário de Brasília)
  PRIMARY KEY (usuario_id, chave, dia)
);

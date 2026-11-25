-- Cancelamento de prazos/compromissos com motivo (prazos cadastrados não são mais editados: só cumpridos, reagendados ou cancelados).
ALTER TABLE prazos ADD COLUMN motivo_cancelamento TEXT;
ALTER TABLE prazos ADD COLUMN cancelado_em INTEGER;
ALTER TABLE prazos ADD COLUMN cancelado_por INTEGER;
INSERT OR IGNORE INTO listas (lista, valor, ordem) VALUES
  ('motivo_cancelamento_prazo', 'Cadastrado em duplicidade', 1),
  ('motivo_cancelamento_prazo', 'Cadastrado por engano', 2),
  ('motivo_cancelamento_prazo', 'Intimação sem prazo ou sem providência', 3),
  ('motivo_cancelamento_prazo', 'Prazo suspenso ou devolvido', 4),
  ('motivo_cancelamento_prazo', 'Acordo, desistência ou encerramento do processo', 5),
  ('motivo_cancelamento_prazo', 'Compromisso desmarcado', 6),
  ('motivo_cancelamento_prazo', 'Outro', 7);

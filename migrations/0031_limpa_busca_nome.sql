-- A busca do DJEN por nome era aproximada e trouxe publicações de outras pessoas (homônimos parciais).
-- Remove as capturadas só pelo nome do cliente que ainda estão na triagem, sem processo cadastrado e sem prazo gerado.
-- As corretas voltam na próxima captura (que revisa os últimos 10 dias), agora só com o nome exato.
DELETE FROM publicacoes
 WHERE oab LIKE 'Cliente: %' AND situacao = 'pendente' AND processo_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM prazos p WHERE p.publicacao_id = publicacoes.id);

-- Prazo padrão por tipo de prazo (preenche "Prazo (dias)" no agendamento). Editável em Configurações › Listas.
ALTER TABLE listas ADD COLUMN dias INTEGER;
ALTER TABLE listas ADD COLUMN contagem TEXT;  -- uteis | corridos

-- CPC (dias úteis, art. 219)
UPDATE listas SET dias = 15, contagem = 'uteis' WHERE lista = 'tipo_prazo' AND valor IN (
  'Contestação', 'Contestação c/ Reconvenção', 'Réplica', 'Apelação', 'Contrarrazões ao Recurso de Apelação',
  'Agravo de Instrumento', 'Agravo Interno', 'Contrarrazões ao Agravo Interno', 'Recurso Extraordinário',
  'Contrarrazões ao Recurso Especial', 'Contrarrazões ao Recurso Extraordinário', 'Agravo em Recurso Especial',
  'Agravo em Recurso Extraordinário', 'Embargos à Execução', 'Impugnação ao Cumprimento de Sentença',
  'Apresentação de Quesitos', 'Memoriais', 'Rol de Testemunhas', 'Pagamento de Custas', 'Pagamento de Condenação',
  'Incidente de Desconsideração PJ');
UPDATE listas SET dias = 5, contagem = 'uteis' WHERE lista = 'tipo_prazo' AND valor IN (
  'Embargos de Declaração', 'Contrarrazões aos Embargos de Declaração', 'Manifestação');
-- Juizados (Lei 9.099/95, art. 42) e Justiça do Trabalho (CLT, arts. 895 e 897)
UPDATE listas SET dias = 10, contagem = 'uteis' WHERE lista = 'tipo_prazo' AND valor = 'Recurso Inominado';
UPDATE listas SET dias = 8, contagem = 'uteis' WHERE lista = 'tipo_prazo' AND valor IN ('Contrarrazões ao Recurso Ordinário', 'Agravo de Petição');

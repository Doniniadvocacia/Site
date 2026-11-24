-- Tipo de lançamento financeiro: receita, despesa ou ambos (filtra a lista no formulário do Financeiro).
ALTER TABLE listas ADD COLUMN aplicacao TEXT;  -- receita | despesa | ambos (usado em categoria_financeira)
UPDATE listas SET aplicacao = 'despesa' WHERE lista = 'categoria_financeira';
UPDATE listas SET aplicacao = 'receita' WHERE lista = 'categoria_financeira' AND valor IN (
  'Alvará Judicial', 'Honorário Contratuais', 'Honorários Mensais', 'Honorários Sucumbenciais', 'Reembolso Despesa');
UPDATE listas SET aplicacao = 'ambos' WHERE lista = 'categoria_financeira' AND valor IN (
  'Pagamento Acordo', 'Pagamento Condenação', 'Devolução de Valores');

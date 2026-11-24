// Listas de opções iguais às da coleção "Listas" do Diligo no Wix (campos tipoDePrazo e tipoDeCompromisso).
const ordenar = (l) => [...l].sort((a, b) => a.localeCompare(b, "pt-BR"));

export const TIPOS_PRAZO = ordenar([
  "Agravo de Instrumento", "Agravo de Petição", "Agravo em Recurso Especial", "Agravo em Recurso Extraordinário", "Agravo Interno",
  "Apelação", "Apresentação de Quesitos", "Audiência de Conciliação", "Audiência de Instrução", "Comprovar Intimação Testemunha",
  "Contestação", "Contestação c/ Reconvenção", "Contrarrazões ao Agravo Interno", "Contrarrazões ao Recurso de Apelação",
  "Contrarrazões ao Recurso Especial", "Contrarrazões ao Recurso Extraordinário", "Contrarrazões ao Recurso Ordinário",
  "Contrarrazões aos Embargos de Declaração", "Distribuir Precatória", "Embargos à Execução", "Embargos de Declaração",
  "Embargos de Terceiro", "Impugnação ao Cumprimento de Sentença", "Incidente de Desconsideração PJ", "Manifestação", "Memoriais",
  "Pagamento de Condenação", "Pagamento de Custas", "Petição Inicial", "Provas", "Recurso Extraordinário", "Recurso Inominado",
  "Réplica", "Rol de Testemunhas",
]);

export const TIPOS_COMPROMISSO = ordenar([
  "Acompanhamento Processual", "Acompanhar Oficio", "Ajustar Cadastro", "Análise Ajuizamento", "Análise Encerramento",
  "Assinar Acordo", "Cálculo Condenação", "Cumprir Diligência", "Distribuir Ação", "Encaminhar Oficio", "Formulário Encerramento",
  "Intimar Testemunha", "Monitorar Citação", "Monitorar Crédito Alvará", "Monitorar Expedição Alvará", "Monitorar Precatório/RPV",
  "Monitorar Publicação Sentença", "Monitorar Trânsito em Julgado", "Retirar Carta Prectória", "Retirar Oficio", "Sessão de Julgamento",
]);

export const tiposDa = (categoria) => (categoria === "Compromisso" ? TIPOS_COMPROMISSO : TIPOS_PRAZO);

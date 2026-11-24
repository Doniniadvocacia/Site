// Listas de opções do sistema, editáveis pelos administradores (Configurações › Listas).
// Os valores iniciais vêm da coleção "Listas" do Diligo no Wix; ficam gravados na tabela "listas".
export const DEFINICOES = [
  { chave: "tipo_prazo", nome: "Tipos de prazo", grupo: "Agenda", padrao: [
    "Agravo de Instrumento", "Agravo de Petição", "Agravo em Recurso Especial", "Agravo em Recurso Extraordinário", "Agravo Interno",
    "Apelação", "Apresentação de Quesitos", "Audiência de Conciliação", "Audiência de Instrução", "Comprovar Intimação Testemunha",
    "Contestação", "Contestação c/ Reconvenção", "Contrarrazões ao Agravo Interno", "Contrarrazões ao Recurso de Apelação",
    "Contrarrazões ao Recurso Especial", "Contrarrazões ao Recurso Extraordinário", "Contrarrazões ao Recurso Ordinário",
    "Contrarrazões aos Embargos de Declaração", "Distribuir Precatória", "Embargos à Execução", "Embargos de Declaração",
    "Embargos de Terceiro", "Impugnação ao Cumprimento de Sentença", "Incidente de Desconsideração PJ", "Manifestação", "Memoriais",
    "Pagamento de Condenação", "Pagamento de Custas", "Petição Inicial", "Provas", "Recurso Extraordinário", "Recurso Inominado",
    "Réplica", "Rol de Testemunhas"] },
  { chave: "tipo_compromisso", nome: "Tipos de compromisso", grupo: "Agenda", padrao: [
    "Acompanhamento Processual", "Acompanhar Oficio", "Ajustar Cadastro", "Análise Ajuizamento", "Análise Encerramento",
    "Assinar Acordo", "Cálculo Condenação", "Cumprir Diligência", "Distribuir Ação", "Encaminhar Oficio", "Formulário Encerramento",
    "Intimar Testemunha", "Monitorar Citação", "Monitorar Crédito Alvará", "Monitorar Expedição Alvará", "Monitorar Precatório/RPV",
    "Monitorar Publicação Sentença", "Monitorar Trânsito em Julgado", "Retirar Carta Prectória", "Retirar Oficio", "Sessão de Julgamento"] },
  { chave: "tipo_acao", nome: "Tipos de ação", grupo: "Processos", padrao: [
    "Precatório", "Requisição de Pequeno Valor", "Embargos à Execução", "Execução Fiscal", "Impug. ao Cump. de Sentença",
    "Execução de Título Extrajudicial", "Exceção de Pré-Executividade", "Carta Precatória", "Embargos de Terceiro", "Recurso de Revista",
    "Recurso Ordinário", "Agravo de Petição", "Recurso Extraordinário", "Recurso Especial", "Recurso de Apelação", "Embargos de Declaração",
    "Agravo de Instrumento", "Alimentos", "Guarda", "Reclamatória Trabalhista", "Incidente Desc. PJ", "Medida Protetiva",
    "Improbidade Administrativa", "Anulatória", "Cautelar", "Civil pública", "Cobrança", "Consignação em pagamento", "Cumprimento de sentença",
    "Demarcação", "Despejo", "Dissolução parcial de sociedade", "Divisão", "Execução", "Exibição de documentos", "Imissão na posse",
    "Indenização", "Interdição", "Inventário", "Manutenção de posse", "Monitória", "Negatória", "Nunciação de obra nova",
    "Obrigação de fazer", "Obrigação de não fazer", "Pauliana (revocatória)", "Petitória", "Possessória", "Prestação de contas",
    "Produção antecipada de provas", "Reparação de danos", "Reintegração de posse", "Remoção de inventariante", "Renovatória",
    "Rescisória", "Retificação de registro", "Reivindicatória", "Revisional", "Sonegados", "Sustação de protesto",
    "Tutela antecipada antecedente", "Tutela cautelar antecedente", "Usucapião"] },
  { chave: "fase", nome: "Fases processuais", grupo: "Processos", ordenada: true, padrao: [
    "Aguarda Citação", "Conhecimento", "Instrução", "Sentencial", "Recursal", "Cumprimento de Sentença", "Trânsito em Julgado",
    "Suspenso", "Aguarda Arquivamento", "Arquivado"] },
  { chave: "status_pasta", nome: "Status da pasta", grupo: "Processos", ordenada: true, padrao: ["Ativa", "Suspensa", "Encerrada"] },
  { chave: "instancia", nome: "Instâncias", grupo: "Processos", ordenada: true, padrao: ["1º Grau", "2º Grau", "Trib. Superiores"] },
  { chave: "competencia", nome: "Competências", grupo: "Processos", padrao: ["Estadual", "Federal", "Trabalhista", "Juizado Especial Civel", "Juizado Especial Federal"] },
  { chave: "rito", nome: "Ritos processuais", grupo: "Processos", padrao: ["Ordinário", "Sumaríssimo"] },
  { chave: "posicao_cliente", nome: "Posições do cliente", grupo: "Processos", padrao: [
    "Autor", "Réu", "Executado", "Exequente", "Reclamado", "Reclamante", "Agravante", "Agravado", "Apelante", "Apelado", "Embargante"] },
  { chave: "resultado", nome: "Resultados / decisões", grupo: "Processos", padrao: [
    "Procedente", "Parcialmente Procedente", "Improcedente", "Extinto sem Resolução do Mérito", "Acordo Homologado",
    "Recurso Provido", "Recurso Parcialmente Provido", "Recurso não Provido"] },
  { chave: "motivo_encerramento", nome: "Motivos de encerramento", grupo: "Processos", padrao: [
    "Acordo Favorável Quitado", "Acordo Desfavorável Quitado", "Procedência da Ação", "Parcial Procedência da Ação", "Improcedência da Ação",
    "Extinto S/ Resolução do Mérito", "Desistência da Ação", "Revogação Procuração", "Pagamento Condenação"] },
  { chave: "tipo_cadastro", nome: "Tipos de cliente", grupo: "Clientes", padrao: ["Pessoa Física", "Pessoa Jurídica"] },
  { chave: "genero", nome: "Gêneros", grupo: "Clientes", padrao: ["Masculino", "Feminino", "Outro"] },
  { chave: "estado_civil", nome: "Estados civis", grupo: "Clientes", padrao: ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"] },
  { chave: "categoria_financeira", nome: "Tipos de lançamento", grupo: "Financeiro", padrao: [
    "Alimentação", "Alvará Judicial", "Aluguel", "Anuidade OAB", "Cartão de Crédito", "Certidão", "Combustível",
    "Complementação Custas Iniciais", "Complementação Custas Preparo Apelação", "Complementação Preparo Agravo de Instrumento",
    "Compra Materiais Escritório", "Condomínio", "Condução Oficial de Justiça", "Custas Diligência Pesquisa (SISBAJUD/INFOJUD)",
    "Custas Finais", "Custas Iniciais", "Custas Iniciais Cumprimento de Sentença", "Despesas Correio", "Despesas Postais",
    "Devolução de Valores", "Energia Elétrica", "Estacionamento", "Expedição Carta Citação", "Gás", "Honorário Contratuais",
    "Honorários Conciliador", "Honorários Diligência", "Honorários Mensais", "Honorários Periciais", "Honorários Sucumbenciais", "Internet",
    "Mensalidades", "Móveis e Utensílios", "Outros Serviços", "Pagamento Acordo", "Pagamento Condenação", "Preparo Agravo de Instrumento",
    "Preparo Recurso de Apelação", "Pró-Labore", "Reembolso Despesa", "Sistemas e Softwares"] },
  { chave: "forma_pagamento", nome: "Formas de pagamento", grupo: "Financeiro", padrao: [
    "Boleto", "Cartão de Débito", "Cartão de Crédito", "Transferência", "Dinheiro", "Crédito em Conta", "Débito em Conta", "Pix"] },
  { chave: "cargo", nome: "Cargos / funções", grupo: "Usuários", padrao: [
    "Advogado(a) titular", "Advogado(a) associado(a)", "Advogado(a)", "Estagiário(a)", "Assistente jurídico(a)", "Secretário(a)", "Financeiro", "Administrativo"] },
];
export const DEF = Object.fromEntries(DEFINICOES.map((d) => [d.chave, d]));

const ordenarValores = (chave, itens) => (DEF[chave]?.ordenada
  ? itens.sort((a, b) => a.ordem - b.ordem || a.valor.localeCompare(b.valor, "pt-BR"))
  : itens.sort((a, b) => a.valor.localeCompare(b.valor, "pt-BR"))).map((i) => i.valor);

// Carrega listas do banco. Devolve { chave: [valores] }.
export async function obterListas(env, chaves = DEFINICOES.map((d) => d.chave)) {
  const { results } = await env.DB.prepare(`SELECT lista, valor, ordem FROM listas WHERE lista IN (${chaves.map(() => "?").join(",")})`).bind(...chaves).all();
  const out = Object.fromEntries(chaves.map((c) => [c, []]));
  for (const r of results) out[r.lista]?.push(r);
  for (const c of chaves) out[c] = ordenarValores(c, out[c]);
  return out;
}
export const obterLista = async (env, chave) => (await obterListas(env, [chave]))[chave];

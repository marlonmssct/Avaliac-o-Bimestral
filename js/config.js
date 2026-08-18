/* ============================================================
   Academia — Painel de recepção
   Configurações e constantes globais da aplicação.
   ============================================================ */

export const API = 'http://localhost:3000';
export const POR_PAGINA = 10;
export const IDADE_MINIMA = 14;
export const FORMAS = ['Dinheiro', 'Cartão', 'Pix', 'Boleto'];

export const CHIP_MATRICULA = {
  ativa: 'chip-blue',
  trancada: 'chip-yellow',
  cancelada: 'chip-red'
};

export const CHIP_PAGAMENTO = {
  pago: 'chip-green',
  pendente: 'chip-yellow',
  atrasado: 'chip-red'
};

/* Catálogo central de mensagens */
export const MSG = {
  vazioAlunos: 'Nenhum aluno cadastrado.',
  vazioPlanos: 'Nenhum plano cadastrado.',
  vazioMatriculas: 'Nenhuma matrícula cadastrada.',
  vazioPagamentos: 'Nenhum pagamento registrado.',
  buscaAlunos: 'Nenhum aluno encontrado para a busca informada.',
  buscaMatriculas: 'Nenhuma matrícula encontrada para a busca informada.',
  buscaPagamentos: 'Nenhum pagamento encontrado para a busca informada.',
  semDado: 'Nenhum dado disponível.',
  erroCarregar: 'Não foi possível carregar os dados. Tente novamente.',
  erroSalvar: 'Não foi possível salvar as alterações. Tente novamente.',
  okAluno: 'Aluno cadastrado com sucesso.',
  okAlunoEdit: 'Dados do aluno atualizados com sucesso.',
  okPlano: 'Plano cadastrado com sucesso.',
  okPlanoEdit: 'Plano atualizado com sucesso.',
  okMatricula: 'Matrícula realizada com sucesso.',
  okMatriculaEdit: 'Matrícula atualizada com sucesso.',
  campoObrigatorio: 'Este campo é obrigatório.',
  cpfFormato: 'CPF deve estar no formato 000.000.000-00.',
  cpfInvalido: 'CPF inválido. Deve conter 11 dígitos numéricos e não pode ter todos os dígitos iguais.',
  cpfDuplicado: 'Já existe um aluno cadastrado com este CPF.',
  telefoneFormato: 'Telefone deve estar no formato (00) 00000-0000.',
  nascimentoFuturo: 'A data de nascimento não pode ser uma data futura.',
  idadeMinima: 'O aluno deve ter pelo menos 14 anos completos.',
  dataInicioPassada: 'A data de início não pode ser anterior à data de hoje.',
  valorInvalido: 'O valor mensal deve ser um número positivo.',
  duracaoInvalida: 'A duração deve ser um número inteiro maior que zero.',
  planoEmUso: 'Este plano não pode ser excluído pois possui matrícula ativa ou trancada vinculada.',
  planoNomeDuplicado: 'Já existe um plano cadastrado com este nome.',
  semAlunoAtivo: 'Nenhum aluno ativo disponível. Cadastre um aluno antes de continuar.',
  semPlano: 'Nenhum plano cadastrado. Cadastre um plano antes de continuar.',
  matriculaEmAndamento: 'Este aluno já possui uma matrícula ativa ou trancada.'
};

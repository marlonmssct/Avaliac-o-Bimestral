/* ============================================================
   Academia — Painel de recepção
   Gerenciamento do estado centralizado da aplicação.
   ============================================================ */

/** Estado local do banco de dados (espelho do json-server) */
export let db = {
  alunos: [],
  planos: [],
  matriculas: [],
  pagamentos: []
};

export function atualizarDb(novosDados) {
  db = { ...db, ...novosDados };
}

/** Controle de timer do relógio no dashboard */
export let relogioTimer = null;

export function definirRelogioTimer(timer) {
  if (relogioTimer) clearInterval(relogioTimer);
  relogioTimer = timer;
}

export function limparRelogioTimer() {
  if (relogioTimer) {
    clearInterval(relogioTimer);
    relogioTimer = null;
  }
}

/** Estado de filtros e paginações da UI */
export const ui = {
  alunos: { campo: 'todos', busca: '', pagina: 1 },
  matriculas: { busca: '', pagina: 1 },
  pagamentos: { busca: '', pagina: 1 },
  dashboard: { plano: '' }
};

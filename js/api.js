/* ============================================================
   Academia — Painel de recepção
   Camada de consumo e integração com a API json-server.
   ============================================================ */

import { API } from './config.js';
import { atualizarDb } from './state.js';

/** Faz requisições HTTP para a API com tratamento de erros */
export async function req(caminho, opcoes = {}) {
  const resposta = await fetch(`${API}${caminho}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes
  });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.status === 204 ? null : resposta.json();
}

/** Carrega todas as coleções de dados da API em paralelo */
export async function carregarTudo() {
  const [alunos, planos, matriculas, pagamentos] = await Promise.all([
    req('/alunos'), req('/planos'), req('/matriculas'), req('/pagamentos')
  ]);
  atualizarDb({ alunos, planos, matriculas, pagamentos });
  marcarConexao(true);
}

/** Atualiza a indicação visual de conexão com a API no rodapé da barra lateral */
export function marcarConexao(ok) {
  const dot = document.querySelector('#api-dot');
  const status = document.querySelector('#api-status');
  if (dot) dot.className = `api-dot ${ok ? 'is-on' : 'is-off'}`;
  if (status) status.textContent = ok ? 'Conectado ao servidor' : 'Servidor indisponível';
}

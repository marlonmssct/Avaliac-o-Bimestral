/* ============================================================
   Academia — Painel de recepção
   Funções utilitárias de formatação, máscaras e validações.
   ============================================================ */

import { db } from './state.js';

export const same = (a, b) => String(a) === String(b);

/** Sanitiza HTML para evitar ataques XSS na concatenação de templates */
export function esc(txt) {
  return String(txt ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Converte objeto Date para string no formato YYYY-MM-DD */
export function paraISO(data) {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}

export const hojeISO = () => paraISO(new Date());

/** Converte data ISO (YYYY-MM-DD) para formato legível DD/MM/YYYY */
export function formatarData(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

/** Formata valor numérico para Moeda Brasileira (R$) */
export function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2
  });
}

/** Retorna data por extenso em Português */
export function formatarDataExtenso(d = new Date()) {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Formata a hora atual HH:MM:SS */
export function formatarHoraTempoReal(d = new Date()) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/**
 * Soma meses preservando o dia original, ajustando para o último dia do mês quando necessário.
 * Ex: 15/08 -> 15/09 | 31/01 -> 28/02.
 */
export function somarMeses(iso, meses) {
  if (!iso) return hojeISO();
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return paraISO(alvo);
}

/** Valida se o aluno possui a idade mínima exigida (14 anos completos) */
export function temIdadeMinima(iso, anos) {
  const [a, m, d] = iso.split('-').map(Number);
  return paraISO(new Date(a + anos, m - 1, d)) <= hojeISO();
}

/**
 * Validação de CPF ajustada conforme a especificação do projeto:
 * Valida a estrutura de 11 dígitos e bloqueia sequências repetidas (ex: 000.000.000-00).
 * O spec dispensa a verificação de dígito verificador por módulo 11.
 */
export function validarCPF(cpf) {
  if (!cpf) return false;
  const num = String(cpf).replace(/\D/g, '');
  if (num.length !== 11) return false;

  // Impede dígitos todos iguais (ex: 000.000.000-00, 111.111.111-11)
  if (/^(\d)\1{10}$/.test(num)) return false;

  return true;
}

/** Remove acentos e converte texto para minúsculas (para busca insensível) */
export function normalizar(txt) {
  return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Aplica máscara de CPF em tempo real (000.000.000-00) */
export function mascaraCPF(valor) {
  const n = String(valor).replace(/\D/g, '').slice(0, 11);
  return n
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

/** Aplica máscara de Telefone em tempo real ((00) 00000-0000) */
export function mascaraTelefone(valor) {
  const n = String(valor).replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) {
    return n.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return n.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

/** Adia a execução de uma função até que se passem ms milissegundos sem novas chamadas */
export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/**
 * Regra derivada: "atrasado" é sempre calculado pela data de vencimento, NUNCA lido/persistido.
 */
export function statusPagamento(p) {
  if (p.status === 'pago') return 'pago';
  return p.dataVencimento && p.dataVencimento < hojeISO() ? 'atrasado' : 'pendente';
}

export const alunoDe = (id) => db.alunos.find((a) => same(a.id, id));
export const planoDe = (id) => db.planos.find((p) => same(p.id, id));
export const matriculaDe = (id) => db.matriculas.find((m) => same(m.id, id));

export function alunoDaMatricula(m) {
  return m ? alunoDe(m.alunoId) : null;
}

export function temMatriculaEmAndamento(alunoId, ignorarId) {
  return db.matriculas.some((m) =>
    same(m.alunoId, alunoId) &&
    !same(m.id, ignorarId) &&
    (m.status === 'ativa' || m.status === 'trancada')
  );
}

export function planoEmUso(planoId) {
  return db.matriculas.some((m) =>
    same(m.planoId, planoId) && (m.status === 'ativa' || m.status === 'trancada')
  );
}

/** Todos os nomes de planos conhecidos na base (atuais e cadastros anteriores nas matrículas) */
export function nomesDePlano() {
  const nomes = new Set(db.planos.map((p) => p.nome));
  db.matriculas.forEach((m) => { if (m.nomePlanoSnapshot) nomes.add(m.nomePlanoSnapshot); });
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const QTDE_CORES_PLANO = 6;

export function obterClasseCorPlano(nomePlano) {
  const todos = nomesDePlano();
  const idx = todos.indexOf(nomePlano);
  return `p${(idx >= 0 ? idx : 0) % QTDE_CORES_PLANO}`;
}

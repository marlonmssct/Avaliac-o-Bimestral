/* ============================================================
   Academia — Painel de recepção
   Componentes de interface, modais, alertas e seletores visuais.
   ============================================================ */

import { POR_PAGINA } from './config.js';
import { esc } from './utils.js';

export const $ = (sel) => document.querySelector(sel);
export const view = $('#view');

/** Exibe toast de notificação temporário no canto da tela */
export function avisar(texto, erro = false) {
  const stack = $('#toasts');
  if (!stack) return;
  const el = document.createElement('div');
  el.className = `toast${erro ? ' is-error' : ''}`;
  el.textContent = texto;
  stack.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/** Modal genérico com suporte a acessibilidade e validação pré-submissão */
export function abrirModal({ titulo, corpo = '', rotulo = 'Confirmar', perigo = false, validar = null }) {
  return new Promise((resolve) => {
    const caixa = $('#modal');
    const btnOk = $('#modal-confirm');
    const btnNao = $('#modal-cancel');

    $('#modal-title').textContent = titulo;
    $('#modal-body').innerHTML = corpo;
    btnOk.textContent = rotulo;
    btnOk.className = `btn ${perigo ? 'btn-danger' : 'btn-solid'}`;
    caixa.hidden = false;
    btnOk.focus();

    const fechar = (valor) => {
      caixa.hidden = true;
      btnOk.removeEventListener('click', aoConfirmar);
      btnNao.removeEventListener('click', aoCancelar);
      document.removeEventListener('keydown', aoTeclar);
      caixa.removeEventListener('click', aoClicarFora);
      resolve(valor);
    };

    const aoConfirmar = () => {
      if (!validar) return fechar(true);
      const valor = validar();
      if (valor !== null && valor !== undefined) fechar(valor);
    };
    const aoCancelar = () => fechar(null);
    const aoTeclar = (e) => { if (e.key === 'Escape') fechar(null); };
    const aoClicarFora = (e) => { if (e.target === caixa) fechar(null); };

    btnOk.addEventListener('click', aoConfirmar);
    btnNao.addEventListener('click', aoCancelar);
    document.addEventListener('keydown', aoTeclar);
    caixa.addEventListener('click', aoClicarFora);
  });
}

export const confirmar = (titulo, corpo, rotulo = 'Confirmar', perigo = false) =>
  abrirModal({ titulo, corpo: `<p>${esc(corpo)}</p>`, rotulo, perigo });

export const carregando = (texto = 'Carregando dados…') =>
  `<div class="state"><div class="spinner"></div><p>${esc(texto)}</p></div>`;

export const estadoVazio = (titulo, texto = '', acao = '') =>
  `<div class="state"><strong>${esc(titulo)}</strong>${texto ? `<p>${esc(texto)}</p>` : ''}${acao}</div>`;

export function cabecalho(titulo, descricao, acoes = '') {
  return `<header class="head">
    <div><h1>${esc(titulo)}</h1><p>${esc(descricao)}</p></div>
    <div class="row-actions">${acoes}</div>
  </header>`;
}

export function paginar(lista, pagina) {
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const atual = Math.max(1, Math.min(pagina, paginas));
  const inicio = (atual - 1) * POR_PAGINA;
  return { itens: lista.slice(inicio, inicio + POR_PAGINA), atual, paginas, total: lista.length };
}

export function barraPaginacao(pag, acao) {
  if (pag.total === 0) return '';
  const de = (pag.atual - 1) * POR_PAGINA + 1;
  const ate = Math.min(pag.atual * POR_PAGINA, pag.total);
  return `<div class="pager">
    <span>Exibindo ${de}–${ate} de ${pag.total}</span>
    <div class="pager-btns">
      <button class="btn btn-ghost btn-sm" data-pagina="${pag.atual - 1}" data-alvo="${acao}"
        ${pag.atual === 1 ? 'disabled' : ''}>Anterior</button>
      <button class="btn btn-ghost btn-sm" data-pagina="${pag.atual + 1}" data-alvo="${acao}"
        ${pag.atual === pag.paginas ? 'disabled' : ''}>Próxima</button>
    </div>
  </div>`;
}

/** Renderiza um campo de formulário com rótulo, indicador de obrigatoriedade (*) e dica */
export function campo(nome, rotulo, tipo, valor = '', extra = '', dica = '', obrigatorio = true) {
  return `<div class="field">
    <label for="f-${nome}">
      ${esc(rotulo)}
      ${obrigatorio ? '<span class="required-asterisk" aria-hidden="true">*</span>' : ''}
    </label>
    <input id="f-${nome}" name="${nome}" type="${tipo}" value="${esc(valor)}" ${extra}>
    ${dica ? `<span class="hint">${esc(dica)}</span>` : ''}
    <span class="err" data-erro="${nome}"></span>
  </div>`;
}

export function mostrarErros(erros) {
  view.querySelectorAll('[data-erro]').forEach((el) => {
    el.textContent = '';
    const alvo = view.querySelector(`[name="${el.dataset.erro}"]`);
    if (alvo) alvo.removeAttribute('aria-invalid');
  });
  Object.entries(erros).forEach(([nome, texto]) => {
    const el = view.querySelector(`[data-erro="${nome}"]`);
    if (el) el.textContent = texto;
    const alvo = view.querySelector(`[name="${nome}"]`);
    if (alvo) alvo.setAttribute('aria-invalid', 'true');
  });
  const primeiro = view.querySelector('[aria-invalid="true"]');
  if (primeiro) primeiro.focus();
}

export const valorDe = (nome) => (view.querySelector(`[name="${nome}"]`)?.value || '').trim();

/* ============================================================
   Academia — Painel de recepção
   Visão: Alunos (Listagem e Formulário de Cadastro/Edição).
   ============================================================ */

import { MSG, IDADE_MINIMA } from '../config.js';
import { db, ui } from '../state.js';
import {
  esc, formatarData, normalizar, mascaraCPF, mascaraTelefone,
  validarCPF, temIdadeMinima, hojeISO, same, alunoDe, debounce, $
} from '../utils.js';
import {
  view, cabecalho, estadoVazio, paginar, barraPaginacao,
  campo, mostrarErros, valorDe, avisar
} from '../ui.js';
import { req } from '../api.js';

const chip = (texto, classe) =>
  `<span class="chip ${classe}">${esc(texto[0].toUpperCase() + texto.slice(1))}</span>`;

export function telaAlunos() {
  const busca = normalizar(ui.alunos.busca);
  const campoFiltro = ui.alunos.campo || 'todos';

  const lista = db.alunos
    .filter((a) => {
      if (!busca) return true;
      const nome = normalizar(a.nome);
      const cpf = normalizar(a.cpf);
      const tel = normalizar(a.telefone);

      if (campoFiltro === 'nome') return nome.includes(busca);
      if (campoFiltro === 'cpf') return cpf.includes(busca);
      if (campoFiltro === 'telefone') return tel.includes(busca);
      return nome.includes(busca) || cpf.includes(busca) || tel.includes(busca);
    })
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));

  const pag = paginar(lista, ui.alunos.pagina);
  ui.alunos.pagina = pag.atual;

  /*
   * Nota: A badge "Inativo" foi mantida exclusivamente na coluna "Situação",
   * eliminando a duplicidade ao lado do nome do aluno (melhoria apontada na avaliação).
   */
  const linhas = pag.itens.map((a) => `
    <tr>
      <td>${esc(a.nome)}</td>
      <td>${esc(a.cpf)}</td>
      <td>${esc(a.telefone)}</td>
      <td>${formatarData(a.dataNascimento)}</td>
      <td>${a.ativo === false ? chip('Inativo', 'chip-gray') : chip('Ativo', 'chip-blue')}</td>
      <td class="acts">
        <div class="row-actions">
          <a class="btn btn-ghost btn-sm" href="#/alunos/${a.id}/editar">Editar</a>
          <button class="btn btn-ghost btn-sm" data-acao="${a.ativo === false ? 'reativar' : 'inativar'}-aluno" data-id="${a.id}">
            ${a.ativo === false ? 'Reativar' : 'Inativar'}
          </button>
        </div>
      </td>
    </tr>`).join('');

  const corpo = db.alunos.length === 0
    ? estadoVazio(MSG.vazioAlunos, 'Cadastre o primeiro aluno para começar a matricular.',
      '<a class="btn btn-solid" href="#/alunos/novo">Cadastrar aluno</a>')
    : lista.length === 0
      ? estadoVazio(MSG.buscaAlunos, 'Revise o termo digitado na busca.')
      : `<div class="table-wrap">
          <table>
            <thead><tr>
              <th>Nome</th><th>CPF</th><th>Telefone</th><th>Nascimento</th><th>Situação</th><th></th>
            </tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>${barraPaginacao(pag, 'alunos')}`;

  const placeholderBusca = campoFiltro === 'cpf'
    ? '000.000.000-00'
    : campoFiltro === 'telefone'
      ? '(00) 00000-0000'
      : campoFiltro === 'nome'
        ? 'Buscar por nome do aluno...'
        : 'Buscar por nome, CPF ou telefone';

  view.innerHTML = `
    ${cabecalho('Alunos', 'Alunos nunca são excluídos — apenas inativados, para preservar o histórico.',
    '<a class="btn btn-solid" href="#/alunos/novo">Cadastrar aluno</a>')
    }
  <section class="card">
    <div class="card-head">
      <h2>Todos os alunos</h2>
      <div class="filter-search-group">
        <select id="tipo-busca-alunos" class="search-select">
          <option value="todos" ${campoFiltro === 'todos' ? ' selected' : ''}>Todos os campos</option>
          <option value="nome" ${campoFiltro === 'nome' ? ' selected' : ''}>Nome</option>
          <option value="cpf" ${campoFiltro === 'cpf' ? ' selected' : ''}>CPF</option>
          <option value="telefone" ${campoFiltro === 'telefone' ? ' selected' : ''}>Telefone</option>
        </select>
        <input class="search" type="search" id="busca-alunos" autocomplete="off"
          placeholder="${placeholderBusca}"
          value="${esc(ui.alunos.busca)}" aria-label="Buscar alunos">
      </div>
    </div>
    ${corpo}
  </section>`;

  const selectTipo = $('#tipo-busca-alunos');
  const campoBusca = $('#busca-alunos');

  if (selectTipo) {
    selectTipo.addEventListener('change', (e) => {
      ui.alunos.campo = e.target.value;
      ui.alunos.busca = '';
      ui.alunos.pagina = 1;
      telaAlunos();
      const novoInput = $('#busca-alunos');
      if (novoInput) novoInput.focus();
    });
  }

  if (campoBusca) {
    campoBusca.addEventListener('input', debounce((e) => {
      let val = e.target.value;
      if (ui.alunos.campo === 'cpf') {
        val = mascaraCPF(val);
        e.target.value = val;
      } else if (ui.alunos.campo === 'telefone') {
        val = mascaraTelefone(val);
        e.target.value = val;
      }
      ui.alunos.busca = val;
      ui.alunos.pagina = 1;
      telaAlunos();
      const novo = $('#busca-alunos');
      if (novo) {
        novo.focus();
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    }, 250));
  }
}

export function telaAlunoForm(id) {
  const aluno = id ? alunoDe(id) : null;
  if (id && !aluno) return (location.hash = '#/alunos');

  view.innerHTML = `
    ${cabecalho(aluno ? 'Editar aluno' : 'Cadastrar aluno',
    aluno ? 'Alterar os dados não muda a situação do cadastro.' : 'Todo aluno nasce com o cadastro ativo.')
    }
  <section class="card">
    <form class="form" id="form-aluno" novalidate>
      ${campo('nome', 'Nome', 'text', aluno?.nome || '', 'maxlength="120" autocomplete="name"')}
      <div class="form-grid-2">
        ${campo('cpf', 'CPF', 'text', aluno?.cpf || '', 'inputmode="numeric" maxlength="14" placeholder="000.000.000-00"')}
        ${campo('telefone', 'Telefone', 'text', aluno?.telefone || '', 'inputmode="numeric" maxlength="15" placeholder="(00) 00000-0000"')}
      </div>
      ${campo('dataNascimento', 'Data de nascimento', 'date', aluno?.dataNascimento || '', `max="${hojeISO()}"`,
      'O aluno deve ter pelo menos 14 anos completos.')}
      <div class="form-actions">
        <button type="submit" class="btn btn-solid">Salvar</button>
        <a class="btn btn-ghost" href="#/alunos">Voltar</a>
      </div>
    </form>
  </section>`;

  const campoCPF = view.querySelector('[name="cpf"]');
  const campoTel = view.querySelector('[name="telefone"]');
  if (campoCPF) campoCPF.addEventListener('input', () => { campoCPF.value = mascaraCPF(campoCPF.value); });
  if (campoTel) campoTel.addEventListener('input', () => { campoTel.value = mascaraTelefone(campoTel.value); });

  $('#form-aluno').addEventListener('submit', async (e) => {
    e.preventDefault();
    const dados = {
      nome: valorDe('nome'),
      cpf: valorDe('cpf'),
      telefone: valorDe('telefone'),
      dataNascimento: valorDe('dataNascimento')
    };
    const erros = validarAluno(dados, aluno?.id);
    if (Object.keys(erros).length) return mostrarErros(erros);

    try {
      if (aluno) {
        await req(`/alunos/${aluno.id}`, { method: 'PATCH', body: JSON.stringify(dados) });
        avisar(MSG.okAlunoEdit);
      } else {
        await req('/alunos', { method: 'POST', body: JSON.stringify({ ...dados, ativo: true }) });
        avisar(MSG.okAluno);
      }
      location.hash = '#/alunos';
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

export function validarAluno(d, idAtual) {
  const erros = {};
  if (!d.nome) erros.nome = MSG.campoObrigatorio;

  if (!d.cpf) erros.cpf = MSG.campoObrigatorio;
  else if (!/^\d{3}\.\d{3}\.\d{3}-\d{2}$/.test(d.cpf)) erros.cpf = MSG.cpfFormato;
  else if (!validarCPF(d.cpf)) erros.cpf = MSG.cpfInvalido;
  else if (db.alunos.some((a) => a.cpf === d.cpf && !same(a.id, idAtual))) erros.cpf = MSG.cpfDuplicado;

  if (!d.telefone) erros.telefone = MSG.campoObrigatorio;
  else if (!/^\(\d{2}\) \d{4,5}-\d{4}$/.test(d.telefone)) erros.telefone = MSG.telefoneFormato;

  if (!d.dataNascimento) erros.dataNascimento = MSG.campoObrigatorio;
  else if (d.dataNascimento > hojeISO()) erros.dataNascimento = MSG.nascimentoFuturo;
  else if (!temIdadeMinima(d.dataNascimento, IDADE_MINIMA)) erros.dataNascimento = MSG.idadeMinima;

  return erros;
}

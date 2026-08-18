/* ============================================================
   Academia — Painel de recepção
   Visão: Planos (Listagem e Formulário de Cadastro/Edição).
   ============================================================ */

import { MSG } from '../config.js';
import { db } from '../state.js';
import { esc, formatarMoeda, planoDe, same, $ } from '../utils.js';
import {
  view, cabecalho, estadoVazio, campo,
  mostrarErros, valorDe, avisar
} from '../ui.js';
import { req } from '../api.js';

export function telaPlanos() {
  const linhas = db.planos.map((p) => `
    <tr>
      <td>${esc(p.nome)}</td>
      <td class="num">${formatarMoeda(p.valorMensal)}</td>
      <td class="num">${p.duracaoMeses} ${p.duracaoMeses === 1 ? 'mês' : 'meses'}</td>
      <td class="acts">
        <div class="row-actions">
          <a class="btn btn-ghost btn-sm" href="#/planos/${p.id}/editar">Editar</a>
          <button class="btn btn-ghost btn-sm" data-acao="excluir-plano" data-id="${p.id}">Excluir</button>
        </div>
      </td>
    </tr>`).join('');

  view.innerHTML = `
    ${cabecalho('Planos', 'O valor vigente vale para novas matrículas; as existentes mantêm o valor contratado.',
    '<a class="btn btn-solid" href="#/planos/novo">Cadastrar plano</a>')
    }
  <section class="card">
    ${db.planos.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Nome</th><th class="num">Valor mensal</th><th class="num">Duração</th><th></th>
            </tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>`
      : estadoVazio(MSG.vazioPlanos, 'Cadastre um plano para poder matricular alunos.',
        '<a class="btn btn-solid" href="#/planos/novo">Cadastrar plano</a>')}
  </section>`;
}

export function telaPlanoForm(id) {
  const plano = id ? planoDe(id) : null;
  if (id && !plano) return (location.hash = '#/planos');

  view.innerHTML = `
    ${cabecalho(plano ? 'Editar plano' : 'Cadastrar plano',
    'A duração é informativa: ela não encerra a matrícula nem limita as cobranças.')
    }
  <section class="card">
    <form class="form" id="form-plano" novalidate>
      ${campo('nome', 'Nome', 'text', plano?.nome || '', 'maxlength="60" placeholder="Mensal, Trimestral, Anual…"')}
      <div class="form-grid-2">
        ${campo('valorMensal', 'Valor mensal (R$)', 'number', plano?.valorMensal ?? '', 'step="0.01" min="0.01" inputmode="decimal"')}
        ${campo('duracaoMeses', 'Duração em meses', 'number', plano?.duracaoMeses ?? '', 'step="1" min="1" inputmode="numeric"')}
      </div>
      <div class="form-actions">
        <button type="submit" class="btn btn-solid">Salvar</button>
        <a class="btn btn-ghost" href="#/planos">Voltar</a>
      </div>
    </form>
  </section>`;

  $('#form-plano').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nome = valorDe('nome');
    const valor = valorDe('valorMensal');
    const duracao = valorDe('duracaoMeses');

    const erros = {};
    if (!nome) erros.nome = MSG.campoObrigatorio;
    else if (db.planos.some((p) => p.nome.trim().toLowerCase() === nome.toLowerCase() && !same(p.id, plano?.id))) {
      erros.nome = MSG.planoNomeDuplicado;
    }
    if (!valor) erros.valorMensal = MSG.campoObrigatorio;
    else if (!(Number(valor) > 0)) erros.valorMensal = MSG.valorInvalido;
    if (!duracao) erros.duracaoMeses = MSG.campoObrigatorio;
    else if (!Number.isInteger(Number(duracao)) || Number(duracao) <= 0) erros.duracaoMeses = MSG.duracaoInvalida;
    if (Object.keys(erros).length) return mostrarErros(erros);

    const dados = { nome, valorMensal: Number(valor), duracaoMeses: Number(duracao) };
    try {
      if (plano) {
        await req(`/planos/${plano.id}`, { method: 'PATCH', body: JSON.stringify(dados) });
        avisar(MSG.okPlanoEdit);
      } else {
        await req('/planos', { method: 'POST', body: JSON.stringify(dados) });
        avisar(MSG.okPlano);
      }
      location.hash = '#/planos';
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

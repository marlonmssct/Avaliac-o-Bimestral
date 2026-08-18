/* ============================================================
   Academia — Painel de recepção
   Visão: Matrículas (Listagem e Formulário de Matrícula/Edição).
   ============================================================ */

import { MSG, CHIP_MATRICULA } from '../config.js';
import { db, ui } from '../state.js';
import {
  esc, formatarData, formatarMoeda, normalizar, hojeISO,
  same, alunoDaMatricula, matriculaDe, planoDe,
  temMatriculaEmAndamento, somarMeses, statusPagamento, debounce, $
} from '../utils.js';
import {
  view, cabecalho, estadoVazio, paginar, barraPaginacao,
  campo, mostrarErros, valorDe, avisar
} from '../ui.js';
import { req } from '../api.js';

const chip = (texto, classe) =>
  `<span class="chip ${classe}">${esc(texto[0].toUpperCase() + texto.slice(1))}</span>`;

export function telaMatriculas() {
  const busca = normalizar(ui.matriculas.busca);
  const lista = db.matriculas
    .filter((m) => !busca || normalizar(alunoDaMatricula(m)?.nome).includes(busca))
    .sort((a, b) => String(b.dataInicio).localeCompare(String(a.dataInicio)));

  const pag = paginar(lista, ui.matriculas.pagina);
  ui.matriculas.pagina = pag.atual;

  /*
   * Requisito 5.4: O botão "Editar" está disponível EXCLUSIVAMENTE para status "ativa".
   * Matrículas trancadas exibem apenas "Reativar" e "Cancelar".
   * Matrículas canceladas são somente leitura.
   */
  const acoes = (m) => {
    if (m.status === 'cancelada') return '<span class="muted">Somente leitura</span>';
    const botoes = [];
    if (m.status === 'ativa') {
      botoes.push(`<a class="btn btn-ghost btn-sm" href="#/matriculas/${m.id}/editar">Editar</a>`);
      botoes.push(`<button class="btn btn-ghost btn-sm" data-acao="trancar" data-id="${m.id}">Trancar</button>`);
    }
    if (m.status === 'trancada') {
      botoes.push(`<button class="btn btn-ghost btn-sm" data-acao="reativar-matricula" data-id="${m.id}">Reativar</button>`);
    }
    botoes.push(`<button class="btn btn-ghost btn-sm" data-acao="cancelar-matricula" data-id="${m.id}">Cancelar</button>`);
    return `<div class="row-actions">${botoes.join('')}</div>`;
  };

  const linhas = pag.itens.map((m) => `
    <tr>
      <td>${esc(alunoDaMatricula(m)?.nome || 'Aluno removido')}</td>
      <td>${esc(m.nomePlanoSnapshot)}</td>
      <td>${formatarData(m.dataInicio)}</td>
      <td>${chip(m.status, CHIP_MATRICULA[m.status] || 'chip-gray')}</td>
      <td class="acts">${acoes(m)}</td>
    </tr>`).join('');

  const corpo = db.matriculas.length === 0
    ? estadoVazio(MSG.vazioMatriculas, 'Matricule um aluno ativo em um plano para gerar a primeira cobrança.',
      '<a class="btn btn-solid" href="#/matriculas/nova">Nova matrícula</a>')
    : lista.length === 0
      ? estadoVazio(MSG.buscaMatriculas, 'Revise o nome digitado na busca.')
      : `<div class="table-wrap">
    <table>
      <thead><tr><th>Aluno</th><th>Plano</th><th>Início</th><th>Status</th><th></th></tr></thead>
      <tbody>${linhas}</tbody>
    </table>
        </div>${barraPaginacao(pag, 'matriculas')}`;

  view.innerHTML = `
    ${cabecalho('Matrículas', 'Um aluno pode ter apenas uma matrícula em andamento por vez.',
    '<a class="btn btn-solid" href="#/matriculas/nova">Nova matrícula</a>')
    }
  <section class="card">
    <div class="card-head">
      <h2>Todas as matrículas</h2>
      <input class="search" type="search" id="busca-matriculas" placeholder="Buscar por nome do aluno"
        value="${esc(ui.matriculas.busca)}" aria-label="Buscar matrículas por nome do aluno">
    </div>
    ${corpo}
  </section>`;

  const campoBusca = $('#busca-matriculas');
  if (campoBusca) {
    campoBusca.addEventListener('input', debounce((e) => {
      ui.matriculas.busca = e.target.value;
      ui.matriculas.pagina = 1;
      telaMatriculas();
      const novo = $('#busca-matriculas');
      if (novo) {
        novo.focus();
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    }, 300));
  }
}

export function telaMatriculaForm(id) {
  const matricula = id ? matriculaDe(id) : null;
  if (id && !matricula) return (location.hash = '#/matriculas');
  if (matricula && matricula.status !== 'ativa') return (location.hash = '#/matriculas');

  /* Edição */
  if (matricula) {
    const pagamentosMatricula = db.pagamentos.filter((p) => same(p.matriculaId, matricula.id));
    const temAtraso = pagamentosMatricula.some((p) => statusPagamento(p) === 'atrasado');
    const emDia = !temAtraso;

    const opcoesPlano = db.planos
      .map((p) => `<option value="${p.id}"${same(p.id, matricula.planoId) ? ' selected' : ''}>${esc(p.nome)} — ${formatarMoeda(p.valorMensal)}</option>`)
      .join('');

    view.innerHTML = `
      ${cabecalho('Editar matrícula',
      emDia
        ? 'Você pode alterar a data de início e o plano desta matrícula.'
        : 'Esta matrícula possui pagamentos em atraso. A alteração de plano está bloqueada.')
      }
  <section class="card">
    <form class="form" id="form-matricula" novalidate>
      <div class="banner ${emDia ? 'is-info' : 'is-warning'}">
        Aluno: <strong>${esc(alunoDaMatricula(matricula)?.nome || 'Aluno removido')}</strong> ·
        Plano atual: <strong>${esc(matricula.nomePlanoSnapshot)}</strong> (${formatarMoeda(matricula.valorMensalSnapshot)}/mês)
        ${!emDia ? '<br><span class="banner-warning-text">⚠️ Pagamento em atraso detectado: quite as pendências para alterar o plano.</span>' : ''}
      </div>

      <div class="field">
        <label for="f-planoId">
          Plano <span class="required-asterisk" aria-hidden="true">*</span>
        </label>
        <select id="f-planoId" name="planoId" ${!emDia ? 'disabled' : ''}>
          <option value="">Selecione o plano</option>${opcoesPlano}
        </select>
        <span class="hint">${emDia ? 'Ao alterar o plano, o novo valor será aplicado aos próximos pagamentos.' : 'Alteração bloqueada devido a débitos pendentes.'}</span>
        <span class="err" data-erro="planoId"></span>
      </div>

      ${campo('dataInicio', 'Data de início', 'date', matricula.dataInicio, '',
        'Alterar a data não recalcula os pagamentos já gerados.')}

      <div class="form-actions">
        <button type="submit" class="btn btn-solid">Salvar</button>
        <a class="btn btn-ghost" href="#/matriculas">Voltar</a>
      </div>
    </form>
  </section>`;

    $('#form-matricula').addEventListener('submit', async (e) => {
      e.preventDefault();
      const dataInicio = valorDe('dataInicio');
      const planoId = valorDe('planoId');

      const erros = {};
      if (!dataInicio) erros.dataInicio = MSG.campoObrigatorio;
      else if (dataInicio !== matricula.dataInicio && dataInicio < hojeISO()) erros.dataInicio = MSG.dataInicioPassada;

      if (emDia && !planoId) {
        erros.planoId = MSG.campoObrigatorio;
      }

      if (Object.keys(erros).length) return mostrarErros(erros);

      const dadosAtualizacao = { dataInicio };
      if (emDia && planoId) {
        if (!same(planoId, matricula.planoId)) {
          const novoPlano = planoDe(planoId);
          if (novoPlano) {
            dadosAtualizacao.planoId = novoPlano.id;
            dadosAtualizacao.nomePlanoSnapshot = novoPlano.nome;
            dadosAtualizacao.valorMensalSnapshot = Number(novoPlano.valorMensal);
          }
        }
      }

      try {
        await req(`/matriculas/${matricula.id}`, { method: 'PATCH', body: JSON.stringify(dadosAtualizacao) });
        avisar(MSG.okMatriculaEdit);
        location.hash = '#/matriculas';
      } catch {
        avisar(MSG.erroSalvar, true);
      }
    });
    return;
  }

  /* Criação de Matrícula */
  const ativos = db.alunos.filter((a) => a.ativo !== false);
  const bloqueio = !ativos.length ? MSG.semAlunoAtivo : !db.planos.length ? MSG.semPlano : '';

  if (bloqueio) {
    view.innerHTML = `
      ${cabecalho('Nova matrícula', 'É preciso ter um aluno ativo e um plano cadastrado.')}
  <section class="card">
    ${estadoVazio(bloqueio, '', !ativos.length
      ? '<a class="btn btn-solid" href="#/alunos/novo">Cadastrar aluno</a>'
      : '<a class="btn btn-solid" href="#/planos/novo">Cadastrar plano</a>')}
  </section>`;
    return;
  }

  const opcoesAluno = ativos
    .map((a) => `<option value="${a.id}">${esc(a.nome)} — ${esc(a.cpf)}</option>`).join('');
  const opcoesPlano = db.planos
    .map((p) => `<option value="${p.id}">${esc(p.nome)} — ${formatarMoeda(p.valorMensal)}</option>`).join('');

  view.innerHTML = `
    ${cabecalho('Nova matrícula', 'A matrícula nasce ativa e já gera o primeiro pagamento.')}
  <section class="card">
    <form class="form" id="form-matricula" novalidate>
      <div class="field">
        <label for="f-alunoId">
          Aluno <span class="required-asterisk" aria-hidden="true">*</span>
        </label>
        <select id="f-alunoId" name="alunoId">
          <option value="">Selecione o aluno</option>${opcoesAluno}
        </select>
        <span class="hint">Apenas alunos ativos aparecem nesta lista.</span>
        <span class="err" data-erro="alunoId"></span>
      </div>
      <div class="field">
        <label for="f-planoId">
          Plano <span class="required-asterisk" aria-hidden="true">*</span>
        </label>
        <select id="f-planoId" name="planoId">
          <option value="">Selecione o plano</option>${opcoesPlano}
        </select>
        <span class="hint">O valor é congelado na matrícula: alterar o plano depois não muda esta cobrança.</span>
        <span class="err" data-erro="planoId"></span>
      </div>
      ${campo('dataInicio', 'Data de início', 'date', hojeISO(), `min="${hojeISO()}"`,
    'O primeiro pagamento vence 1 mês após a data de início.')}
      <div class="form-actions">
        <button type="submit" class="btn btn-solid">Matricular</button>
        <a class="btn btn-ghost" href="#/matriculas">Voltar</a>
      </div>
    </form>
  </section>`;

  $('#form-matricula').addEventListener('submit', async (e) => {
    e.preventDefault();
    const alunoId = valorDe('alunoId');
    const planoId = valorDe('planoId');
    const dataInicio = valorDe('dataInicio');

    const erros = {};
    if (!alunoId) erros.alunoId = MSG.campoObrigatorio;
    if (!planoId) erros.planoId = MSG.campoObrigatorio;
    if (!dataInicio) erros.dataInicio = MSG.campoObrigatorio;
    else if (dataInicio < hojeISO()) erros.dataInicio = MSG.dataInicioPassada;
    if (alunoId && temMatriculaEmAndamento(alunoId)) erros.alunoId = MSG.matriculaEmAndamento;
    if (Object.keys(erros).length) return mostrarErros(erros);

    const plano = planoDe(planoId);
    try {
      const nova = await req('/matriculas', {
        method: 'POST',
        body: JSON.stringify({
          alunoId,
          planoId,
          nomePlanoSnapshot: plano.nome,
          valorMensalSnapshot: Number(plano.valorMensal),
          dataInicio,
          status: 'ativa'
        })
      });

      /*
       * Requisito 5.15: O primeiro pagamento vence exatamente 1 mês após a data de início,
       * preservando o dia do mês (via somarMeses(dataInicio, 1)).
       */
      await req('/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          matriculaId: nova.id,
          valor: Number(plano.valorMensal),
          dataVencimento: somarMeses(dataInicio, 1),
          dataPagamento: null,
          status: 'pendente',
          forma: null
        })
      });
      avisar(MSG.okMatricula);
      location.hash = '#/matriculas';
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

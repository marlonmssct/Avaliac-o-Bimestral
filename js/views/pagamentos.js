/* ============================================================
   Academia — Painel de recepção
   Visão: Pagamentos (Listagem e Registro de Quitação).
   ============================================================ */

import { MSG, FORMAS, CHIP_PAGAMENTO } from '../config.js';
import { db, ui } from '../state.js';
import {
  esc, formatarData, formatarMoeda, normalizar, hojeISO,
  same, alunoDaMatricula, matriculaDe, statusPagamento, somarMeses, debounce, $
} from '../utils.js';
import {
  view, cabecalho, estadoVazio, paginar, barraPaginacao,
  abrirModal, avisar
} from '../ui.js';
import { req } from '../api.js';

const chip = (texto, classe) =>
  `<span class="chip ${classe}">${esc(texto[0].toUpperCase() + texto.slice(1))}</span>`;

export function telaPagamentos() {
  const busca = normalizar(ui.pagamentos.busca);

  const enriquecidos = db.pagamentos.map((p) => {
    const m = matriculaDe(p.matriculaId);
    return { p, m, aluno: alunoDaMatricula(m), situacao: statusPagamento(p) };
  });

  const lista = enriquecidos
    .filter((it) => !busca || normalizar(it.aluno?.nome).includes(busca))
    .sort((a, b) => String(b.p.dataVencimento).localeCompare(String(a.p.dataVencimento)));

  const pag = paginar(lista, ui.pagamentos.pagina);
  ui.pagamentos.pagina = pag.atual;

  const linhas = pag.itens.map(({ p, m, aluno, situacao }) => `
    <tr>
      <td>${esc(aluno?.nome || 'Aluno removido')}</td>
      <td>${esc(m?.nomePlanoSnapshot || '—')}</td>
      <td class="num">${formatarMoeda(p.valor)}</td>
      <td>${formatarData(p.dataVencimento)}</td>
      <td>${formatarData(p.dataPagamento)}</td>
      <td>${p.forma ? esc(p.forma) : '<span class="muted">—</span>'}</td>
      <td>${chip(situacao, CHIP_PAGAMENTO[situacao])}</td>
      <td class="acts">
        ${situacao === 'pago'
      ? '<span class="muted">Quitado</span>'
      : `<button class="btn btn-ghost btn-sm" data-acao="registrar-pagamento" data-id="${p.id}">Registrar pagamento</button>`}
      </td>
    </tr>`).join('');

  const corpo = db.pagamentos.length === 0
    ? estadoVazio(MSG.vazioPagamentos, 'Os pagamentos são criados automaticamente ao matricular um aluno.',
      '<a class="btn btn-solid" href="#/matriculas/nova">Nova matrícula</a>')
    : lista.length === 0
      ? estadoVazio(MSG.buscaPagamentos, 'Revise o nome digitado na busca.')
      : `<div class="table-wrap">
    <table>
      <thead><tr>
        <th>Aluno</th><th>Plano</th><th class="num">Valor</th><th>Vencimento</th>
        <th>Pagamento</th><th>Forma</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${linhas}</tbody>
    </table>
        </div>${barraPaginacao(pag, 'pagamentos')}`;

  view.innerHTML = `
    ${cabecalho('Pagamentos', 'Gerados automaticamente. Não é possível criar, editar ou excluir manualmente.')}
  <section class="card">
    <div class="card-head">
      <h2>Todos os pagamentos</h2>
      <input class="search" type="search" id="busca-pagamentos" placeholder="Buscar por nome do aluno"
        value="${esc(ui.pagamentos.busca)}" aria-label="Buscar pagamentos por nome do aluno">
    </div>
    ${corpo}
  </section>`;

  const campoBusca = $('#busca-pagamentos');
  if (campoBusca) {
    campoBusca.addEventListener('input', debounce((e) => {
      ui.pagamentos.busca = e.target.value;
      ui.pagamentos.pagina = 1;
      telaPagamentos();
      const novo = $('#busca-pagamentos');
      if (novo) {
        novo.focus();
        novo.setSelectionRange(novo.value.length, novo.value.length);
      }
    }, 300));
  }
}

export async function registrarPagamento(id, recarregarCallback) {
  const pagamento = db.pagamentos.find((p) => same(p.id, id));
  if (!pagamento || pagamento.status === 'pago') return;

  const matricula = matriculaDe(pagamento.matriculaId);
  const aluno = alunoDaMatricula(matricula);
  const planoNome = matricula?.nomePlanoSnapshot || 'Plano';

  // Cálculo exato de dias de atraso e juros (0,5% por dia)
  const hoje = hojeISO();
  let diasAtraso = 0;
  if (pagamento.dataVencimento && pagamento.dataVencimento < hoje) {
    const [vA, vM, vD] = pagamento.dataVencimento.split('-').map(Number);
    const [hA, hM, hD] = hoje.split('-').map(Number);
    const dtVenc = Date.UTC(vA, vM - 1, vD);
    const dtHoje = Date.UTC(hA, hM - 1, hD);
    const msPorDia = 1000 * 60 * 60 * 24;
    diasAtraso = Math.max(0, Math.round((dtHoje - dtVenc) / msPorDia));
  }

  const valorOriginal = Number(pagamento.valor || 0);
  const percentualJuros = 0.005; // 0,5% por dia de atraso
  const valorJuros = diasAtraso > 0 ? Number((valorOriginal * percentualJuros * diasAtraso).toFixed(2)) : 0;
  const valorTotal = Number((valorOriginal + valorJuros).toFixed(2));

  const opcoes = FORMAS.map((f) => `<option value="${f}">${f}</option>`).join('');
  const corpo = `
    <div class="payment-modal-info">
      <p><strong>Aluno:</strong> ${esc(aluno?.nome || 'Aluno removido')}</p>
      <p><strong>Plano:</strong> ${esc(planoNome)}</p>
      <p><strong>Vencimento:</strong> ${formatarData(pagamento.dataVencimento)}</p>
      <p><strong>Valor original:</strong> ${formatarMoeda(valorOriginal)}</p>
      ${diasAtraso > 0 ? `
        <p class="payment-late-warning">
          ⚠️ Mensalidade em atraso: ${diasAtraso} dia${diasAtraso === 1 ? '' : 's'} (0,5% de acréscimo por dia)
        </p>
        <p class="payment-late-interest"><strong>Juros/Multa (${diasAtraso} x 0,5%):</strong> +${formatarMoeda(valorJuros)}</p>
        <p class="payment-total-amount">
          Valor Total a Pagar: ${formatarMoeda(valorTotal)}
        </p>
      ` : `
        <p class="payment-total-amount">
          Valor Total a Pagar: ${formatarMoeda(valorTotal)}
        </p>
      `}
    </div>
    <div class="field">
      <label for="modal-forma">Forma de pagamento <span class="required-asterisk" aria-hidden="true">*</span></label>
      <select id="modal-forma">
        <option value="">Selecione a forma</option>${opcoes}
      </select>
      <span class="err" id="modal-forma-erro"></span>
    </div>`;

  const forma = await abrirModal({
    titulo: 'Registrar pagamento',
    corpo,
    rotulo: 'Confirmar pagamento',
    validar: () => {
      const select = $('#modal-forma');
      if (!select.value) {
        const erroEl = $('#modal-forma-erro');
        if (erroEl) erroEl.textContent = 'Selecione a forma de pagamento.';
        select.setAttribute('aria-invalid', 'true');
        select.focus();
        return null;
      }
      return select.value;
    }
  });
  if (!forma) return;

  try {
    await req(`/pagamentos/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pago', dataPagamento: hoje, valor: valorTotal, forma })
    });

    let proximoVencimento = null;
    /* Próxima cobrança: só para matrícula ativa ou trancada. Valor vem do snapshot. */
    if (matricula && (matricula.status === 'ativa' || matricula.status === 'trancada')) {
      proximoVencimento = somarMeses(pagamento.dataVencimento, 1);
      await req('/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          matriculaId: matricula.id,
          valor: Number(matricula.valorMensalSnapshot),
          dataVencimento: proximoVencimento,
          dataPagamento: null,
          status: 'pendente',
          forma: null
        })
      });
    }

    if (recarregarCallback) await recarregarCallback();

    // RESUMO COMPLETO DE CONFIRMAÇÃO DE PAGAMENTO
    const corpoResumo = `
      <div class="payment-receipt-box">
        <h3 class="payment-receipt-title">✅ Comprovante de Pagamento Quitado</h3>
        <p><strong>Aluno:</strong> ${esc(aluno?.nome || 'Aluno')}</p>
        <p><strong>CPF:</strong> ${esc(aluno?.cpf || '—')}</p>
        <p><strong>Plano:</strong> ${esc(planoNome)}</p>
        <hr class="payment-receipt-hr">
        <p><strong>Data de Vencimento:</strong> ${formatarData(pagamento.dataVencimento)}</p>
        <p><strong>Data de Pagamento:</strong> ${formatarData(hoje)}</p>
        <p><strong>Forma de Pagamento:</strong> ${esc(forma)}</p>
        <hr class="payment-receipt-hr">
        <p><strong>Valor Parcela:</strong> ${formatarMoeda(valorOriginal)}</p>
        ${diasAtraso > 0 ? `
          <p class="payment-receipt-late"><strong>Atraso (${diasAtraso} dia${diasAtraso === 1 ? '' : 's'} x 0,5%):</strong> +${formatarMoeda(valorJuros)}</p>
        ` : '<p class="payment-receipt-ontime"><strong>Situação:</strong> Pagamento em dia (0% de acréscimo)</p>'}
        <p class="payment-receipt-total">
          TOTAL PAGO: ${formatarMoeda(valorTotal)}
        </p>
        ${proximoVencimento ? `
          <div class="payment-receipt-next">
            <strong>Próxima cobrança:</strong> Vencimento gerado para <strong>${formatarData(proximoVencimento)}</strong>.
          </div>
        ` : ''}
      </div>`;

    await abrirModal({
      titulo: 'Resumo da Confirmação de Pagamento',
      corpo: corpoResumo,
      rotulo: 'Concluir'
    });

  } catch {
    avisar(MSG.erroSalvar, true);
  }
}

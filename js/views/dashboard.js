/* ============================================================
   Academia — Painel de recepção
   Visão: Dashboard / Visão Geral (Indicadores e Métricas).
   ============================================================ */

import { MSG } from '../config.js';
import { db, ui, relogioTimer, definirRelogioTimer, limparRelogioTimer } from '../state.js';
import {
  esc, formatarMoeda, formatarDataExtenso, formatarHoraTempoReal,
  statusPagamento, matriculaDe, nomesDePlano, obterClasseCorPlano, $
} from '../utils.js';
import { view, estadoVazio } from '../ui.js';

export function telaDashboard() {
  limparRelogioTimer();
  definirRelogioTimer(setInterval(() => {
    const el = $('#relogio-admin');
    if (el) {
      el.textContent = formatarHoraTempoReal(new Date());
    } else {
      limparRelogioTimer();
    }
  }, 1000));

  const filtro = ui.dashboard.plano;
  const matriculas = filtro
    ? db.matriculas.filter((m) => m.nomePlanoSnapshot === filtro)
    : db.matriculas;
  const idsMatricula = new Set(matriculas.map((m) => String(m.id)));
  const pagamentos = filtro
    ? db.pagamentos.filter((p) => idsMatricula.has(String(p.matriculaId)))
    : db.pagamentos;

  const porStatus = (s) => matriculas.filter((m) => m.status === s).length;
  const pagos = pagamentos.filter((p) => statusPagamento(p) === 'pago');
  const atrasados = pagamentos.filter((p) => statusPagamento(p) === 'atrasado');

  const semMatriculas = matriculas.length === 0;
  const semReceita = pagos.length === 0;

  const receitaTotal = pagos.reduce((s, p) => s + Number(p.valor || 0), 0);
  const emAberto = atrasados.reduce((s, p) => s + Number(p.valor || 0), 0);
  const taxa = semMatriculas ? 0 : (porStatus('cancelada') / matriculas.length) * 100;

  const metrica = (rotulo, valor, cor, nota = '', vazio = false) => `
    <div class="metric ${cor}">
      <div class="metric-label">${esc(rotulo)}</div>
      <div class="metric-value${vazio ? ' is-empty' : ''}">${vazio ? MSG.semDado : valor}</div>
      ${nota && !vazio ? `<div class="metric-note">${esc(nota)}</div>` : ''}
    </div>`;

  /* Receita por plano — agrupada pelo nome congelado na matrícula */
  const porPlano = {};
  pagos.forEach((p) => {
    const m = matriculaDe(p.matriculaId);
    const nome = m?.nomePlanoSnapshot || 'Plano removido';
    porPlano[nome] = (porPlano[nome] || 0) + Number(p.valor || 0);
  });
  const listaReceita = Object.entries(porPlano).sort((a, b) => b[1] - a[1]);
  const maiorReceita = listaReceita.length ? listaReceita[0][1] : 0;

  /*
   * Ranking 100% dinâmico (requisito 2.5):
   * Exibe nominalmente TODOS os planos cadastrados ou com histórico de matrículas,
   * sem agrupamento genérico em "Outros".
   */
  const todosOsNomes = nomesDePlano();
  const ranking = todosOsNomes
    .map((nome) => {
      const total = db.matriculas.filter(
        (m) => String(m.nomePlanoSnapshot || '').toLowerCase() === nome.toLowerCase()
      ).length;
      return { nome, total };
    })
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));

  const maiorRanking = ranking.length ? ranking[0].total : 0;

  const opcoes = todosOsNomes
    .map((n) => `<option value="${esc(n)}"${n === filtro ? ' selected' : ''}>${esc(n)}</option>`)
    .join('');

  const barras = (lista, formatador, maior) => `<div class="bars">${lista
    .map((item) => `
      <div class="bar-row">
        <div class="bar-top"><strong>${esc(item.nome)}</strong><span>${formatador(item.valor)}</span></div>
        <div class="bar-track">
          <div class="bar-fill ${obterClasseCorPlano(item.nome)}" style="width:${maior > 0 ? Math.max(2, (item.valor / maior) * 100) : 2}%"></div>
        </div>
      </div>`).join('')}</div>`;

  view.innerHTML = `
    <div class="admin-header">
      <div>
        <h1 class="admin-header-title">Painel de Gestão Administrativa</h1>
        <p class="admin-header-desc">Matrículas, receita e inadimplência da academia.</p>
        <div class="admin-header-date">
          <span>📅</span> <span>${formatarDataExtenso(new Date())}</span>
        </div>
      </div>
      <div class="admin-header-controls">
        <div class="admin-filter-group">
          <label for="filtro-plano" class="admin-filter-label">Filtrar Plano</label>
          <select id="filtro-plano" class="admin-filter-select">
            <option value="">Todos os planos</option>${opcoes}
          </select>
        </div>
        <div class="admin-clock-box">
          <div class="admin-clock-label">Hora Atual</div>
          <div id="relogio-admin" class="admin-clock-time">${formatarHoraTempoReal(new Date())}</div>
        </div>
      </div>
    </div>

    ${filtro ? `<div class="banner is-info">Indicadores filtrados pelo plano ${esc(filtro)}. O ranking segue comparando todos os planos.</div>` : ''}

    <div class="metrics">
      ${metrica('Matrículas ativas', porStatus('ativa'), 'plate-blue', '', semMatriculas)}
      ${metrica('Trancadas', porStatus('trancada'), 'plate-yellow', '', semMatriculas)}
      ${metrica('Canceladas', porStatus('cancelada'), 'plate-red', '', semMatriculas)}
      ${metrica('Taxa de cancelamento', `${taxa.toFixed(1).replace('.', ',')}%`, 'plate-red', 'sobre o total de matrículas', semMatriculas)}
    </div>

    <div class="metrics">
      ${metrica('Receita recebida', formatarMoeda(receitaTotal), 'plate-green',
    `${pagos.length} pagamento${pagos.length === 1 ? '' : 's'} quitado${pagos.length === 1 ? '' : 's'}`, semReceita)}
      ${metrica('Pagamentos atrasados', atrasados.length, 'plate-red', 'calculado pelo vencimento')}
      ${metrica('Valor em aberto', formatarMoeda(emAberto), 'plate-red', 'soma dos pagamentos atrasados')}
    </div>

    <div class="dash-grid">
      <section class="card">
        <div class="card-head"><h2>Receita por plano</h2></div>
        ${listaReceita.length
      ? barras(listaReceita.map(([nome, valor]) => ({ nome, valor })), formatarMoeda, maiorReceita)
      : estadoVazio(MSG.semDado, 'Nenhum pagamento quitado até agora.')}
      </section>

      <section class="card">
        <div class="card-head"><h2>Planos mais contratados</h2></div>
        ${ranking.length
      ? barras(ranking.map((r) => ({ nome: r.nome, valor: r.total })),
        (v) => `${v} matrícula${v === 1 ? '' : 's'}`, maiorRanking)
      : estadoVazio(MSG.semDado, '', '<a class="btn btn-solid" href="#/planos/novo">Cadastre um plano para começar</a>')}
      </section>
    </div>`;

  const selectFiltro = $('#filtro-plano');
  if (selectFiltro) {
    selectFiltro.addEventListener('change', (e) => {
      ui.dashboard.plano = e.target.value;
      telaDashboard();
      const novoSelect = $('#filtro-plano');
      if (novoSelect) novoSelect.focus();
    });
  }
}

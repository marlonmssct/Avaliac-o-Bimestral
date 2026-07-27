/* ============================================================
   Academia — Painel de recepção
   SPA sem framework. Dados via json-server (http://localhost:3000).

   Decisões implementadas (ver decisoes_academia.md):
   - "atrasado" NUNCA é persistido: sempre derivado de dataVencimento.
   - Matrícula guarda snapshot do nome e do valor mensal do plano.
   - Pagamento seguinte usa o snapshot e vence 1 mês após o anterior
     (com ajuste para o último dia do mês quando o dia não existe).
   - Cancelar matrícula não altera pagamentos em aberto.
   - Matrícula trancada continua gerando cobrança (texto literal do PDF).
   ============================================================ */

'use strict';

const API = 'http://localhost:3000';
const POR_PAGINA = 10;
const IDADE_MINIMA = 14;
const FORMAS = ['Dinheiro', 'Cartão', 'Pix', 'Boleto'];

/* ---------- Catálogo de mensagens ---------- */

const MSG = {
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
  cpfInvalido: 'CPF inválido. Não são permitidos números repetidos ou sequenciais (ex: 000.000.000-00 ou 123.456.789-00).',
  cpfDuplicado: 'Já existe um aluno cadastrado com este CPF.',
  telefoneFormato: 'Telefone deve estar no formato (00) 00000-0000.',
  nascimentoFuturo: 'A data de nascimento não pode ser uma data futura.',
  idadeMinima: 'O aluno deve ter pelo menos 14 anos completos.',
  dataInicioPassada: 'A data de início não pode ser anterior à data de hoje.',
  valorInvalido: 'O valor mensal deve ser um número positivo.',
  duracaoInvalida: 'A duração deve ser um número inteiro maior que zero.',
  planoEmUso: 'Este plano não pode ser excluído pois possui matrícula ativa ou trancada vinculada.',
  semAlunoAtivo: 'Nenhum aluno ativo disponível. Cadastre um aluno antes de continuar.',
  semPlano: 'Nenhum plano cadastrado. Cadastre um plano antes de continuar.',
  matriculaEmAndamento: 'Este aluno já possui uma matrícula ativa ou trancada.'
};

/* ---------- Estado ---------- */

let db = { alunos: [], planos: [], matriculas: [], pagamentos: [] };
let relogioTimer = null;

const ui = {
  alunos: { campo: 'todos', busca: '', pagina: 1 },
  matriculas: { busca: '', pagina: 1 },
  pagamentos: { busca: '', pagina: 1 },
  dashboard: { plano: '' }
};

const $ = (sel) => document.querySelector(sel);
const view = $('#view');

/* ============================================================
   Utilidades
   ============================================================ */

const same = (a, b) => String(a) === String(b);

function esc(txt) {
  return String(txt ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function paraISO(data) {
  const m = String(data.getMonth() + 1).padStart(2, '0');
  const d = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${m}-${d}`;
}

const hojeISO = () => paraISO(new Date());

function formatarData(iso) {
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return `${d}/${m}/${a}`;
}

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL', minimumFractionDigits: 2
  });
}

function formatarDataExtenso(d = new Date()) {
  const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
  return `${dias[d.getDay()]}, ${d.getDate()} de ${meses[d.getMonth()]} de ${d.getFullYear()}`;
}

function formatarHoraTempoReal(d = new Date()) {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  const s = String(d.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Soma meses ajustando para o último dia quando o dia não existe (31/01 -> 28/02). */
function somarMeses(iso, meses) {
  if (!iso) return hojeISO();
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return paraISO(alvo);
}

/** Retorna a data correspondente ao dia 01 do mês seguinte (ex: 11/08 -> 01/09). */
function primeiroDiaMesSeguinte(iso) {
  if (!iso) return hojeISO();
  const [a, m] = iso.split('-').map(Number);
  const proximoMes = m === 12 ? 1 : m + 1;
  const proximoAno = m === 12 ? a + 1 : a;
  const mm = String(proximoMes).padStart(2, '0');
  return `${proximoAno}-${mm}-01`;
}

function temIdadeMinima(iso, anos) {
  const [a, m, d] = iso.split('-').map(Number);
  return paraISO(new Date(a + anos, m - 1, d)) <= hojeISO();
}

function validarCPF(cpf) {
  if (!cpf) return false;
  const num = String(cpf).replace(/\D/g, '');
  if (num.length !== 11) return false;

  // Impede dígitos repetidos (ex: 000.000.000-00, 111.111.111-11)
  if (/^(\d)\1{10}$/.test(num)) return false;

  // Impede sequências numéricas diretas ou inversas (ex: 12345678901 ou 98765432109)
  let eCrescente = true;
  let eDecrescente = true;
  for (let i = 0; i < 10; i++) {
    if (Number(num[i + 1]) !== (Number(num[i]) + 1) % 10) eCrescente = false;
    if (Number(num[i + 1]) !== (Number(num[i]) + 9) % 10) eDecrescente = false;
  }
  if (eCrescente || eDecrescente) return false;

  // Cálculo do 1º Dígito Verificador (Módulo 11)
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(num[i]) * (10 - i);
  let resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== Number(num[9])) return false;

  // Cálculo do 2º Dígito Verificador (Módulo 11)
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(num[i]) * (11 - i);
  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== Number(num[10])) return false;

  return true;
}

function normalizar(txt) {
  return String(txt || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function mascaraCPF(valor) {
  const n = String(valor).replace(/\D/g, '').slice(0, 11);
  return n
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
}

function mascaraTelefone(valor) {
  const n = String(valor).replace(/\D/g, '').slice(0, 11);
  if (n.length <= 10) {
    return n.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return n.replace(/^(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ============================================================
   Regras derivadas
   ============================================================ */

/** "atrasado" é sempre calculado, nunca lido do registro. */
function statusPagamento(p) {
  if (p.status === 'pago') return 'pago';
  return p.dataVencimento && p.dataVencimento < hojeISO() ? 'atrasado' : 'pendente';
}

const alunoDe = (id) => db.alunos.find((a) => same(a.id, id));
const planoDe = (id) => db.planos.find((p) => same(p.id, id));
const matriculaDe = (id) => db.matriculas.find((m) => same(m.id, id));

function alunoDaMatricula(m) {
  return m ? alunoDe(m.alunoId) : null;
}

function temMatriculaEmAndamento(alunoId, ignorarId) {
  return db.matriculas.some((m) =>
    same(m.alunoId, alunoId) &&
    !same(m.id, ignorarId) &&
    (m.status === 'ativa' || m.status === 'trancada')
  );
}

function planoEmUso(planoId) {
  return db.matriculas.some((m) =>
    same(m.planoId, planoId) && (m.status === 'ativa' || m.status === 'trancada')
  );
}

/** Todos os nomes de plano relevantes: cadastrados + histórico congelado. */
function nomesDePlano() {
  const nomes = new Set(db.planos.map((p) => p.nome));
  db.matriculas.forEach((m) => { if (m.nomePlanoSnapshot) nomes.add(m.nomePlanoSnapshot); });
  return [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

const CORES_PLANO_FIXAS = {
  'Mensal': 'p0',
  'Trimestral': 'p1',
  'Semestral': 'p2',
  'Anual': 'p3'
};

function obterClasseCorPlano(nomePlano) {
  if (CORES_PLANO_FIXAS[nomePlano]) return CORES_PLANO_FIXAS[nomePlano];
  const todos = nomesDePlano();
  const idx = todos.indexOf(nomePlano);
  return `p${(idx >= 0 ? idx : 0) % 4}`;
}

const CHIP_MATRICULA = { ativa: 'chip-blue', trancada: 'chip-yellow', cancelada: 'chip-red' };
const CHIP_PAGAMENTO = { pago: 'chip-green', pendente: 'chip-yellow', atrasado: 'chip-red' };

const chip = (texto, classe) =>
  `<span class="chip ${classe}">${esc(texto[0].toUpperCase() + texto.slice(1))}</span>`;

/* ============================================================
   API
   ============================================================ */

async function req(caminho, opcoes = {}) {
  const resposta = await fetch(`${API}${caminho}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opcoes
  });
  if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
  return resposta.status === 204 ? null : resposta.json();
}

async function carregarTudo() {
  const [alunos, planos, matriculas, pagamentos] = await Promise.all([
    req('/alunos'), req('/planos'), req('/matriculas'), req('/pagamentos')
  ]);
  db = { alunos, planos, matriculas, pagamentos };
  marcarConexao(true);
}

function marcarConexao(ok) {
  $('#api-dot').className = `api-dot ${ok ? 'is-on' : 'is-off'}`;
  $('#api-status').textContent = ok ? 'Conectado ao servidor' : 'Servidor indisponível';
}

/* ============================================================
   Avisos e modal
   ============================================================ */

function avisar(texto, erro = false) {
  const el = document.createElement('div');
  el.className = `toast${erro ? ' is-error' : ''}`;
  el.textContent = texto;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

/**
 * Modal genérico. Resolve com o valor de validar() ou com true;
 * resolve null quando o usuário volta atrás.
 */
function abrirModal({ titulo, corpo = '', rotulo = 'Confirmar', perigo = false, validar = null }) {
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

const confirmar = (titulo, corpo, rotulo = 'Confirmar', perigo = false) =>
  abrirModal({ titulo, corpo: `<p>${esc(corpo)}</p>`, rotulo, perigo });

/* ============================================================
   Blocos de tela reaproveitados
   ============================================================ */

const carregando = (texto = 'Carregando dados…') =>
  `<div class="state"><div class="spinner"></div><p>${esc(texto)}</p></div>`;

const estadoVazio = (titulo, texto = '', acao = '') =>
  `<div class="state"><strong>${esc(titulo)}</strong>${texto ? `<p>${esc(texto)}</p>` : ''}${acao}</div>`;

function cabecalho(titulo, descricao, acoes = '') {
  return `<header class="head">
    <div><h1>${esc(titulo)}</h1><p>${esc(descricao)}</p></div>
    <div class="row-actions">${acoes}</div>
  </header>`;
}

function paginar(lista, pagina) {
  const paginas = Math.max(1, Math.ceil(lista.length / POR_PAGINA));
  const atual = Math.max(1, Math.min(pagina, paginas));
  const inicio = (atual - 1) * POR_PAGINA;
  return { itens: lista.slice(inicio, inicio + POR_PAGINA), atual, paginas, total: lista.length };
}

function barraPaginacao(pag, acao) {
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

function campo(nome, rotulo, tipo, valor = '', extra = '', dica = '') {
  return `<div class="field">
    <label for="f-${nome}">${esc(rotulo)}</label>
    <input id="f-${nome}" name="${nome}" type="${tipo}" value="${esc(valor)}" ${extra}>
    ${dica ? `<span class="hint">${esc(dica)}</span>` : ''}
    <span class="err" data-erro="${nome}"></span>
  </div>`;
}

function mostrarErros(erros) {
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

const valorDe = (nome) => (view.querySelector(`[name="${nome}"]`)?.value || '').trim();

/* ============================================================
   Tela: Visão geral
   ============================================================ */

function telaDashboard() {
  if (relogioTimer) clearInterval(relogioTimer);
  relogioTimer = setInterval(() => {
    const el = $('#relogio-admin');
    if (el) {
      el.textContent = formatarHoraTempoReal(new Date());
    } else {
      clearInterval(relogioTimer);
      relogioTimer = null;
    }
  }, 1000);

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
  const alunosAtivosCount = db.alunos.filter((a) => a.ativo !== false).length;

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

  /* Ranking — nunca é afetado pelo filtro: existe para comparar planos entre si */
  const ranking = nomesDePlano()
    .map((nome) => ({
      nome,
      total: db.matriculas.filter((m) => m.nomePlanoSnapshot === nome).length
    }))
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
  const maiorRanking = ranking.length ? ranking[0].total : 0;

  const opcoes = nomesDePlano()
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
    <div class="admin-header" style="background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%); color: #fff; padding: 22px 26px; border-radius: 12px; margin-bottom: 24px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 16px; box-shadow: 0 4px 14px rgba(0,0,0,0.12);">
      <div>
        <h1 style="margin: 0 0 4px 0; font-size: 1.55rem; color: #f8fafc; font-weight: 700;">Painel de Gestão Administrativa</h1>
        <p style="margin: 0 0 8px 0; color: #cbd5e1; font-size: 0.95rem;">Matrículas, receita e inadimplência da academia.</p>
        <div style="font-size: 0.88rem; color: #38bdf8; font-weight: 500; display: flex; align-items: center; gap: 6px;">
          <span>📅</span> <span>${formatarDataExtenso(new Date())}</span>
        </div>
      </div>
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div style="background: rgba(255,255,255,0.07); padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12);">
          <label for="filtro-plano" style="color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 4px;">Filtrar Plano</label>
          <select id="filtro-plano" style="background: #0f172a; color: #fff; border: 1px solid #334155; padding: 6px 12px; border-radius: 6px; font-size: 0.9rem; outline: none; cursor: pointer;">
            <option value="">Todos os planos</option>${opcoes}
          </select>
        </div>
        <div style="background: rgba(255,255,255,0.07); padding: 8px 18px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); text-align: center;">
          <div style="font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; font-weight: 700;">Hora Atual</div>
          <div id="relogio-admin" style="font-size: 1.35rem; font-weight: 700; color: #38bdf8; font-family: monospace; letter-spacing: 1px;">${formatarHoraTempoReal(new Date())}</div>
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

  $('#filtro-plano').addEventListener('change', (e) => {
    ui.dashboard.plano = e.target.value;
    telaDashboard();
  });
}

/* ============================================================
   Tela: Alunos
   ============================================================ */

function telaAlunos() {
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

  const linhas = pag.itens.map((a) => `
    <tr>
      <td>${esc(a.nome)} ${a.ativo === false ? chip('Inativo', 'chip-gray') : ''}</td>
      <td>${esc(a.cpf)}</td>
      <td>${esc(a.telefone)}</td>
      <td>${formatarData(a.dataNascimento)}</td>
      <td>${a.ativo === false ? chip('inativo', 'chip-gray') : chip('ativo', 'chip-blue')}</td>
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
    <div class="card-head" style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">
      <h2>Todos os alunos</h2>
      <div style="display: flex; gap: 8px; align-items: center; margin-left: auto;">
        <select id="tipo-busca-alunos" style="padding: 8px 12px; border: 1px solid #ccc; border-radius: 6px; font-size: 0.9rem; background: #fff;">
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

function telaAlunoForm(id) {
  const aluno = id ? alunoDe(id) : null;
  if (id && !aluno) return irPara('#/alunos');

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
  campoCPF.addEventListener('input', () => { campoCPF.value = mascaraCPF(campoCPF.value); });
  campoTel.addEventListener('input', () => { campoTel.value = mascaraTelefone(campoTel.value); });

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
      irPara('#/alunos');
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

function validarAluno(d, idAtual) {
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

/* ============================================================
   Tela: Planos
   ============================================================ */

function telaPlanos() {
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

function telaPlanoForm(id) {
  const plano = id ? planoDe(id) : null;
  if (id && !plano) return irPara('#/planos');

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
      irPara('#/planos');
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

/* ============================================================
   Tela: Matrículas
   ============================================================ */

function telaMatriculas() {
  const busca = normalizar(ui.matriculas.busca);
  const lista = db.matriculas
    .filter((m) => !busca || normalizar(alunoDaMatricula(m)?.nome).includes(busca))
    .sort((a, b) => String(b.dataInicio).localeCompare(String(a.dataInicio)));

  const pag = paginar(lista, ui.matriculas.pagina);
  ui.matriculas.pagina = pag.atual;

  const acoes = (m) => {
    if (m.status === 'cancelada') return '<span class="muted">Somente leitura</span>';
    const botoes = [`<a class="btn btn-ghost btn-sm" href="#/matriculas/${m.id}/editar">Editar</a>`];
    if (m.status === 'ativa') botoes.push(`<button class="btn btn-ghost btn-sm" data-acao="trancar" data-id="${m.id}">Trancar</button>`);
    if (m.status === 'trancada') botoes.push(`<button class="btn btn-ghost btn-sm" data-acao="reativar-matricula" data-id="${m.id}">Reativar</button>`);
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
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    }, 300));
  }
}

function telaMatriculaForm(id) {
  const matricula = id ? matriculaDe(id) : null;
  if (id && !matricula) return irPara('#/matriculas');
  if (matricula && matricula.status === 'cancelada') return irPara('#/matriculas');

  /* Edição: permite alterar data de início e o plano (apenas se pagamentos estiverem em dia) */
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
        ${!emDia ? '<br><span style="color:#c0392b; font-weight:bold;">⚠️ Pagamento em atraso detectado: quite as pendências para alterar o plano.</span>' : ''}
      </div>

      <div class="field">
        <label for="f-planoId">Plano</label>
        <select id="f-planoId" name="planoId" ${!emDia ? 'disabled' : ''}>
          <option value="">Selecione o plano</option>${opcoesPlano}
        </select>
        <span class="hint">${emDia ? 'Ao alterar o plano, o novo valor será aplicado aos próximos pagamentos.' : 'Alteração bloqueada devido a débitos pendentes.'}</span>
        <span class="err" data-erro="planoId"></span>
      </div>

      ${campo('dataInicio', 'Data de início', 'date', matricula.dataInicio, `min="${hojeISO()}"`,
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
      else if (dataInicio < hojeISO()) erros.dataInicio = MSG.dataInicioPassada;

      if (emDia && !planoId) {
        erros.planoId = MSG.campoObrigatorio;
      }

      if (Object.keys(erros).length) return mostrarErros(erros);

      const dadosAtualizacao = { dataInicio };
      if (emDia && planoId) {
        const novoPlano = planoDe(planoId);
        if (novoPlano) {
          dadosAtualizacao.planoId = novoPlano.id;
          dadosAtualizacao.nomePlanoSnapshot = novoPlano.nome;
          dadosAtualizacao.valorMensalSnapshot = Number(novoPlano.valorMensal);
        }
      }

      try {
        await req(`/matriculas/${matricula.id}`, { method: 'PATCH', body: JSON.stringify(dadosAtualizacao) });
        avisar(MSG.okMatriculaEdit);
        irPara('#/matriculas');
      } catch {
        avisar(MSG.erroSalvar, true);
      }
    });
    return;
  }

  /* Criação */
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
        <label for="f-alunoId">Aluno</label>
        <select id="f-alunoId" name="alunoId">
          <option value="">Selecione o aluno</option>${opcoesAluno}
        </select>
        <span class="hint">Apenas alunos ativos aparecem nesta lista.</span>
        <span class="err" data-erro="alunoId"></span>
      </div>
      <div class="field">
        <label for="f-planoId">Plano</label>
        <select id="f-planoId" name="planoId">
          <option value="">Selecione o plano</option>${opcoesPlano}
        </select>
        <span class="hint">O valor é congelado na matrícula: alterar o plano depois não muda esta cobrança.</span>
        <span class="err" data-erro="planoId"></span>
      </div>
      ${campo('dataInicio', 'Data de início', 'date', hojeISO(), `min="${hojeISO()}"`,
    'O primeiro pagamento vence no dia 01 do mês seguinte.')}
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
      await req('/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          matriculaId: nova.id,
          valor: Number(plano.valorMensal),
          dataVencimento: primeiroDiaMesSeguinte(dataInicio),
          dataPagamento: null,
          status: 'pendente',
          forma: null
        })
      });
      avisar(MSG.okMatricula);
      irPara('#/matriculas');
    } catch {
      avisar(MSG.erroSalvar, true);
    }
  });
}

/* ============================================================
   Tela: Pagamentos
   ============================================================ */

function telaPagamentos() {
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
        </div > ${barraPaginacao(pag, 'pagamentos')} `;

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
      novo.focus();
      novo.setSelectionRange(novo.value.length, novo.value.length);
    }, 300));
  }
}

/* ============================================================
   Ações
   ============================================================ */

async function alternarAluno(id, reativar) {
  const aluno = alunoDe(id);
  if (!aluno) return;

  const ok = await confirmar(
    reativar ? 'Reativar aluno' : 'Inativar aluno',
    reativar
      ? `${aluno.nome} volta a ficar disponível para novas matrículas.`
      : `${aluno.nome} deixa de aparecer em novas matrículas. As matrículas e cobranças em andamento continuam normalmente.`,
    reativar ? 'Reativar' : 'Inativar',
    !reativar
  );
  if (!ok) return;

  try {
    await req(`/alunos/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo: reativar }) });
    avisar(reativar ? 'Aluno reativado.' : 'Aluno inativado.');
    await recarregar();
  } catch {
    avisar(MSG.erroSalvar, true);
  }
}

async function excluirPlano(id) {
  const plano = planoDe(id);
  if (!plano) return;

  if (planoEmUso(id)) {
    await abrirModal({ titulo: 'Exclusão bloqueada', corpo: `<p>${MSG.planoEmUso}</p>`, rotulo: 'Entendi' });
    return;
  }

  const ok = await confirmar('Excluir plano',
    `O plano ${plano.nome} será removido. O histórico de receita já registrado é preservado. Esta ação não poderá ser desfeita.`,
    'Excluir', true);
  if (!ok) return;

  try {
    await req(`/planos/${id}`, { method: 'DELETE' });
    avisar('Plano excluído.');
    await recarregar();
  } catch {
    avisar(MSG.erroSalvar, true);
  }
}

async function mudarStatusMatricula(id, novoStatus) {
  const m = matriculaDe(id);
  if (!m) return;
  const nome = alunoDaMatricula(m)?.nome || 'o aluno';

  const textos = {
    trancada: ['Trancar matrícula', `A matrícula de ${nome} fica suspensa e pode ser reativada depois. As cobranças mensais continuam sendo geradas.`, 'Trancar', false],
    ativa: ['Reativar matrícula', `A matrícula de ${nome} volta a ficar ativa.`, 'Reativar', false],
    cancelada: ['Cancelar matrícula', `A matrícula de ${nome} será encerrada e ficará somente leitura. Os pagamentos em aberto continuam existindo e seguem contando na inadimplência. Esta ação não poderá ser desfeita.`, 'Cancelar matrícula', true]
  };

  const [titulo, corpo, rotulo, perigo] = textos[novoStatus];
  if (!(await confirmar(titulo, corpo, rotulo, perigo))) return;

  try {
    await req(`/matriculas/${id}`, { method: 'PATCH', body: JSON.stringify({ status: novoStatus }) });
    avisar(`Matrícula ${novoStatus}.`);
    await recarregar();
  } catch {
    avisar(MSG.erroSalvar, true);
  }
}

async function registrarPagamento(id) {
  const pagamento = db.pagamentos.find((p) => same(p.id, id));
  if (!pagamento || pagamento.status === 'pago') return;

  const matricula = matriculaDe(pagamento.matriculaId);
  const aluno = alunoDaMatricula(matricula);
  const planoNome = matricula?.nomePlanoSnapshot || 'Plano';

  // Cálculo exato de dias de atraso e juros (5% por dia de atraso) sem interferência de fuso horário
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
  const percentualJuros = 0.05; // 5% por dia de atraso
  const valorJuros = diasAtraso > 0 ? Number((valorOriginal * percentualJuros * diasAtraso).toFixed(2)) : 0;
  const valorTotal = Number((valorOriginal + valorJuros).toFixed(2));

  const opcoes = FORMAS.map((f) => `<option value="${f}">${f}</option>`).join('');
  const corpo = `
    <div style="margin-bottom: 15px; font-size: 0.95rem; line-height: 1.5;">
      <p><strong>Aluno:</strong> ${esc(aluno?.nome || 'Aluno removido')}</p>
      <p><strong>Plano:</strong> ${esc(planoNome)}</p>
      <p><strong>Vencimento:</strong> ${formatarData(pagamento.dataVencimento)}</p>
      <p><strong>Valor original:</strong> ${formatarMoeda(valorOriginal)}</p>
      ${diasAtraso > 0 ? `
        <p style="color: #c0392b; font-weight: bold; margin-top: 8px;">
          ⚠️ Mensalidade em atraso: ${diasAtraso} dia${diasAtraso === 1 ? '' : 's'} (5% de acréscimo por dia)
        </p>
        <p style="color: #c0392b;"><strong>Juros/Multa (${diasAtraso} x 5%):</strong> +${formatarMoeda(valorJuros)}</p>
        <p style="font-size: 1.1rem; color: #27ae60; font-weight: bold; margin-top: 4px;">
          Valor Total a Pagar: ${formatarMoeda(valorTotal)}
        </p>
      ` : `
        <p style="font-size: 1.05rem; color: #27ae60; font-weight: bold; margin-top: 8px;">
          Valor Total a Pagar: ${formatarMoeda(valorTotal)}
        </p>
      `}
    </div>
    <div class="field">
      <label for="modal-forma">Forma de pagamento</label>
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
        $('#modal-forma-erro').textContent = 'Selecione a forma de pagamento.';
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

    await recarregar();

    // RESUMO COMPLETO DE CONFIRMAÇÃO DE PAGAMENTO
    const corpoResumo = `
      <div style="background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; padding: 16px; line-height: 1.6;">
        <h3 style="color: #27ae60; margin-top: 0; margin-bottom: 12px; font-size: 1.1rem;">✅ Comprovante de Pagamento Quitados</h3>
        <p><strong>Aluno:</strong> ${esc(aluno?.nome || 'Aluno')}</p>
        <p><strong>CPF:</strong> ${esc(aluno?.cpf || '—')}</p>
        <p><strong>Plano:</strong> ${esc(planoNome)}</p>
        <hr style="border: 0; border-top: 1px solid #dee2e6; margin: 10px 0;">
        <p><strong>Data de Vencimento:</strong> ${formatarData(pagamento.dataVencimento)}</p>
        <p><strong>Data de Pagamento:</strong> ${formatarData(hoje)}</p>
        <p><strong>Forma de Pagamento:</strong> ${esc(forma)}</p>
        <hr style="border: 0; border-top: 1px solid #dee2e6; margin: 10px 0;">
        <p><strong>Valor Parcela:</strong> ${formatarMoeda(valorOriginal)}</p>
        ${diasAtraso > 0 ? `
          <p style="color: #c0392b;"><strong>Atraso (${diasAtraso} dia${diasAtraso === 1 ? '' : 's'} x 5%):</strong> +${formatarMoeda(valorJuros)}</p>
        ` : '<p style="color: #27ae60;"><strong>Situação:</strong> Pagamento em dia (0% de acréscimo)</p>'}
        <p style="font-size: 1.15rem; font-weight: bold; color: #27ae60; margin-top: 8px;">
          TOTAL PAGO: ${formatarMoeda(valorTotal)}
        </p>
        ${proximoVencimento ? `
          <div style="margin-top: 12px; padding: 8px 12px; background: #e8f8f5; border-left: 4px solid #27ae60; border-radius: 4px; font-size: 0.9rem;">
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

/* ============================================================
   Rotas
   ============================================================ */

function irPara(hash) {
  if (location.hash === hash) rotear();
  else location.hash = hash;
}

function lerRota() {
  const partes = (location.hash.replace(/^#\/?/, '') || 'dashboard').split('/');
  return { base: partes[0] || 'dashboard', id: partes[1] || null, sub: partes[2] || null };
}

function marcarNav(base) {
  document.querySelectorAll('.nav-link').forEach((a) => {
    if (a.dataset.nav === base) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

function desenhar(rota) {
  switch (rota.base) {
    case 'alunos':
      if (rota.id === 'novo') return telaAlunoForm(null);
      if (rota.sub === 'editar') return telaAlunoForm(rota.id);
      return telaAlunos();
    case 'planos':
      if (rota.id === 'novo') return telaPlanoForm(null);
      if (rota.sub === 'editar') return telaPlanoForm(rota.id);
      return telaPlanos();
    case 'matriculas':
      if (rota.id === 'nova') return telaMatriculaForm(null);
      if (rota.sub === 'editar') return telaMatriculaForm(rota.id);
      return telaMatriculas();
    case 'pagamentos':
      return telaPagamentos();
    default:
      return telaDashboard();
  }
}

async function rotear() {
  const rota = lerRota();
  marcarNav(rota.base);
  view.innerHTML = carregando();

  try {
    await carregarTudo();
  } catch {
    marcarConexao(false);
    view.innerHTML = `
      ${cabecalho('Sem conexão com o servidor', 'Os dados não puderam ser carregados.')}
      <section class="card">
        ${estadoVazio(MSG.erroCarregar,
      'Confira se o json-server está rodando em http://localhost:3000 e tente de novo.',
      '<button class="btn btn-solid" data-acao="recarregar">Tentar novamente</button>')}
      </section>`;
    return;
  }

  desenhar(rota);
}

/** Recarrega os dados mantendo a tela atual (usado após cada alteração). */
async function recarregar() {
  try {
    await carregarTudo();
    desenhar(lerRota());
  } catch {
    marcarConexao(false);
    avisar(MSG.erroCarregar, true);
  }
}

/* ============================================================
   Eventos globais
   ============================================================ */

document.addEventListener('click', (e) => {
  const alvo = e.target.closest('[data-acao], [data-pagina]');
  if (!alvo) return;

  if (alvo.dataset.pagina) {
    const destino = ui[alvo.dataset.alvo];
    if (destino) destino.pagina = Number(alvo.dataset.pagina);
    if (alvo.dataset.alvo === 'alunos') return telaAlunos();
    if (alvo.dataset.alvo === 'matriculas') return telaMatriculas();
    if (alvo.dataset.alvo === 'pagamentos') return telaPagamentos();
  }

  const { acao, id } = alvo.dataset;
  const rotas = {
    'inativar-aluno': () => alternarAluno(id, false),
    'reativar-aluno': () => alternarAluno(id, true),
    'excluir-plano': () => excluirPlano(id),
    'trancar': () => mudarStatusMatricula(id, 'trancada'),
    'reativar-matricula': () => mudarStatusMatricula(id, 'ativa'),
    'cancelar-matricula': () => mudarStatusMatricula(id, 'cancelada'),
    'registrar-pagamento': () => registrarPagamento(id),
    'recarregar': () => rotear()
  };
  if (rotas[acao]) rotas[acao]();
});

window.addEventListener('hashchange', rotear);
window.addEventListener('DOMContentLoaded', rotear);

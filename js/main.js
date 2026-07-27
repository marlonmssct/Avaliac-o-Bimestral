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
  cpfDuplicado: 'Já existe um aluno cadastrado com este CPF.',
  telefoneFormato: 'Telefone deve estar no formato (00) 00000-0000.',
  nascimentoFuturo: 'A data de nascimento não pode ser uma data futura.',
  idadeMinima: 'O aluno deve ter pelo menos 14 anos completos.',
  valorInvalido: 'O valor mensal deve ser um número positivo.',
  duracaoInvalida: 'A duração deve ser um número inteiro maior que zero.',
  planoEmUso: 'Este plano não pode ser excluído pois possui matrícula ativa ou trancada vinculada.',
  semAlunoAtivo: 'Nenhum aluno ativo disponível. Cadastre um aluno antes de continuar.',
  semPlano: 'Nenhum plano cadastrado. Cadastre um plano antes de continuar.',
  matriculaEmAndamento: 'Este aluno já possui uma matrícula ativa ou trancada.'
};

/* ---------- Estado ---------- */

let db = { alunos: [], planos: [], matriculas: [], pagamentos: [] };

const ui = {
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

/** Soma meses ajustando para o último dia quando o dia não existe (31/01 -> 28/02). */
function somarMeses(iso, meses) {
  const [a, m, d] = iso.split('-').map(Number);
  const alvo = new Date(a, m - 1 + meses, 1);
  const ultimoDia = new Date(alvo.getFullYear(), alvo.getMonth() + 1, 0).getDate();
  alvo.setDate(Math.min(d, ultimoDia));
  return paraISO(alvo);
}

function temIdadeMinima(iso, anos) {
  const [a, m, d] = iso.split('-').map(Number);
  return paraISO(new Date(a + anos, m - 1, d)) <= hojeISO();
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
  const atual = Math.min(pagina, paginas);
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
    .map((item, i) => `
      <div class="bar-row">
        <div class="bar-top"><strong>${esc(item.nome)}</strong><span>${formatador(item.valor)}</span></div>
        <div class="bar-track">
          <div class="bar-fill p${i % 4}" style="width:${maior > 0 ? Math.max(2, (item.valor / maior) * 100) : 2}%"></div>
        </div>
      </div>`).join('')}</div>`;

  view.innerHTML = `
    ${cabecalho('Visão geral', 'Matrículas, receita e inadimplência da academia.', `
      <div class="filter-inline">
        <label for="filtro-plano">Plano</label>
        <select id="filtro-plano">
          <option value="">Todos os planos</option>${opcoes}
        </select>
      </div>`)}

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
          : estadoVazio(MSG.semDado, 'Cadastre um plano para começar.')}
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
  const linhas = db.alunos.map((a) => `
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

  view.innerHTML = `
    ${cabecalho('Alunos', 'Alunos nunca são excluídos — apenas inativados, para preservar o histórico.',
      '<a class="btn btn-solid" href="#/alunos/novo">Cadastrar aluno</a>')}
    <section class="card">
      ${db.alunos.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th>Nome</th><th>CPF</th><th>Telefone</th><th>Nascimento</th><th>Situação</th><th></th>
            </tr></thead>
            <tbody>${linhas}</tbody>
          </table>
        </div>`
        : estadoVazio(MSG.vazioAlunos, 'Cadastre o primeiro aluno para começar a matricular.',
            '<a class="btn btn-solid" href="#/alunos/novo">Cadastrar aluno</a>')}
    </section>`;
}

function telaAlunoForm(id) {
  const aluno = id ? alunoDe(id) : null;
  if (id && !aluno) return irPara('#/alunos');

  view.innerHTML = `
    ${cabecalho(aluno ? 'Editar aluno' : 'Cadastrar aluno',
      aluno ? 'Alterar os dados não muda a situação do cadastro.' : 'Todo aluno nasce com o cadastro ativo.')}
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
      '<a class="btn btn-solid" href="#/planos/novo">Cadastrar plano</a>')}
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
      'A duração é informativa: ela não encerra a matrícula nem limita as cobranças.')}
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
      '<a class="btn btn-solid" href="#/matriculas/nova">Nova matrícula</a>')}
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

  /* Edição: apenas a data de início. Aluno e plano são a chave dos pagamentos já emitidos. */
  if (matricula) {
    view.innerHTML = `
      ${cabecalho('Editar matrícula', 'Aluno e plano não podem ser alterados — cancele e crie uma nova matrícula para trocá-los.')}
      <section class="card">
        <form class="form" id="form-matricula" novalidate>
          <div class="banner is-info">
            ${esc(alunoDaMatricula(matricula)?.nome || 'Aluno removido')} · ${esc(matricula.nomePlanoSnapshot)}
            · ${formatarMoeda(matricula.valorMensalSnapshot)} por mês
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
      if (!dataInicio) return mostrarErros({ dataInicio: MSG.campoObrigatorio });
      try {
        await req(`/matriculas/${matricula.id}`, { method: 'PATCH', body: JSON.stringify({ dataInicio }) });
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
        ${campo('dataInicio', 'Data de início', 'date', hojeISO(), '',
          'O primeiro pagamento vence 1 mês após esta data.')}
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
          dataVencimento: somarMeses(dataInicio, 1),
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

  const opcoes = FORMAS.map((f) => `<option value="${f}">${f}</option>`).join('');
  const corpo = `
    <p>${esc(aluno?.nome || 'Aluno removido')} · ${formatarMoeda(pagamento.valor)}
       · vencimento ${formatarData(pagamento.dataVencimento)}</p>
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
    rotulo: 'Registrar pagamento',
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
      body: JSON.stringify({ status: 'pago', dataPagamento: hojeISO(), forma })
    });

    /* Próxima cobrança: só para matrícula ativa ou trancada. Valor vem do snapshot. */
    if (matricula && (matricula.status === 'ativa' || matricula.status === 'trancada')) {
      await req('/pagamentos', {
        method: 'POST',
        body: JSON.stringify({
          matriculaId: matricula.id,
          valor: Number(matricula.valorMensalSnapshot),
          dataVencimento: somarMeses(pagamento.dataVencimento, 1),
          dataPagamento: null,
          status: 'pendente',
          forma: null
        })
      });
      avisar('Pagamento registrado. Próxima cobrança gerada.');
    } else {
      avisar('Pagamento registrado.');
    }
    await recarregar();
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
    destino.pagina = Number(alvo.dataset.pagina);
    return alvo.dataset.alvo === 'matriculas' ? telaMatriculas() : telaPagamentos();
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

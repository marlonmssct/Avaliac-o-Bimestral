# Sistema de Academia — Painel de recepção

Front-end em HTML, CSS e JavaScript puro (sem framework, sem build), consumindo **json-server** como back-end.

Implementa a especificação de `especificacao_academia_formatada__1_.pdf`, refinada em `refinamento_academia.md` e fechada em `decisoes_academia.md`.

---

## Estrutura

```
academia/
│
├── css/
│   └── styles.css
│
├── js/
│   └── main.js
│
├── assets/
│   ├── images/
│   └── icons/
│       └── logo.svg
│
├── index.html
├── db.json
└── README.md
```

Aplicação de página única: `index.html` é o único HTML, e as cinco telas (visão geral, alunos, planos, matrículas, pagamentos) são trocadas por rota em hash.

---

## Como rodar

Pré-requisito: Node.js instalado.

**1. Suba o back-end**

```bash
npx json-server db.json --port 3000
```

Deixe rodando. Endpoints: `/alunos`, `/planos`, `/matriculas`, `/pagamentos`.

**2. Sirva o front**

Não abra o `index.html` com duplo clique — `file://` bloqueia as requisições. Use um servidor local:

```bash
npx serve .
```

ou, com Python:

```bash
python3 -m http.server 5500
```

Acesse o endereço indicado no terminal. O indicador no rodapé da barra lateral mostra se o servidor está respondendo.

---

## Rotas da aplicação

| Rota | Tela |
|---|---|
| `#/dashboard` | Visão geral |
| `#/alunos` | Listagem de alunos |
| `#/alunos/novo` | Cadastro de aluno |
| `#/alunos/:id/editar` | Edição de aluno |
| `#/planos` | Listagem de planos |
| `#/planos/novo` | Cadastro de plano |
| `#/planos/:id/editar` | Edição de plano |
| `#/matriculas` | Listagem de matrículas |
| `#/matriculas/nova` | Nova matrícula |
| `#/matriculas/:id/editar` | Edição de matrícula |
| `#/pagamentos` | Listagem de pagamentos |

---

## Modelo de dados

```jsonc
// aluno
{ "nome", "cpf", "telefone", "dataNascimento", "ativo" }

// plano
{ "nome", "valorMensal", "duracaoMeses" }

// matricula
{ "alunoId", "planoId", "nomePlanoSnapshot", "valorMensalSnapshot", "dataInicio", "status" }

// pagamento
{ "matriculaId", "valor", "dataVencimento", "dataPagamento", "status", "forma" }
```

`status` de matrícula: `ativa` | `trancada` | `cancelada`.
`status` de pagamento **gravado**: `pendente` | `pago`. O valor `atrasado` nunca é gravado — ver abaixo.

---

## Decisões que afetam o código

| Decisão | Onde está |
|---|---|
| **`atrasado` é sempre derivado**, nunca persistido: comparação de `dataVencimento` com a data de hoje, na leitura | `statusPagamento()` |
| **Snapshot do plano na matrícula** (`nomePlanoSnapshot`, `valorMensalSnapshot`): editar ou excluir um plano não altera matrículas nem a receita histórica | criação de matrícula, receita por plano |
| **Vencimento seguinte** = vencimento anterior + 1 mês, com ajuste para o último dia do mês quando o dia não existe (31/01 → 28/02) | `somarMeses()` |
| **Cancelar matrícula não mexe nos pagamentos em aberto**: eles continuam existindo e contando na inadimplência | `mudarStatusMatricula()` |
| **Matrícula trancada continua gerando cobrança** (texto literal do PDF) | `registrarPagamento()` |
| **Inativar aluno não afeta matrícula em andamento**; só bloqueia novas matrículas | `alternarAluno()`, seleção de aluno |
| **Forma de pagamento** é escolhida no momento da baixa, nunca antes | modal de `registrarPagamento()` |
| **Filtro do dashboard** recalcula tudo, exceto o ranking de planos | `telaDashboard()` |
| **CPF único** considerando alunos ativos e inativos | `validarAluno()` |
| **Ranking** exibe todos os planos, inclusive com zero matrículas; empate resolvido por ordem alfabética | `telaDashboard()` |
| **Duração do plano é informativa**: não encerra matrícula nem limita cobranças | — |
| Ordenação: matrículas por início decrescente, pagamentos por vencimento decrescente. Busca parcial, sem acento/caixa, com atraso de 300 ms | `telaMatriculas()`, `telaPagamentos()` |

---

## Regras exercitáveis nos dados de exemplo

O `db.json` já vem com situações que cobrem os casos de borda:

- **Pagamento atrasado derivado** — o registro está gravado como `pendente`, mas aparece como atrasado na tela e na inadimplência.
- **Dívida de matrícula cancelada** — a matrícula 6 está cancelada e ainda tem pagamento em aberto contando na inadimplência.
- **Matrícula trancada** — a matrícula 3 segue gerando cobrança ao dar baixa.
- **Aluno inativo** — Gustavo Teixeira não aparece na seleção de nova matrícula, mas segue visível na listagem com o badge.
- **Aluno menor de idade no limite** — Fernanda Prado tem mais de 14 anos; tente cadastrar alguém com menos para ver a validação.

---

## Acessibilidade e responsividade

- Navegação por teclado com foco visível em todos os controles.
- `prefers-reduced-motion` respeitado.
- Barra lateral vira barra superior abaixo de 900 px; tabelas rolam na horizontal.
- Link "Ir para o conteúdo" no início da página.

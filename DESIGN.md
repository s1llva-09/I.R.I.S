# DESIGN — Izze

Escrito a partir do que foi **construído**, não do que foi planejado. Verdade
do produto vive em [PRODUCT.md](PRODUCT.md); aqui é só o visual.

Mundo: **referência técnica viva**. A Izze não é um chat — é a página de manual
da sua própria máquina. Gramática do `man(1)` e do Process Explorer: tinta sobre
chapa fosca, fio de cabelo no lugar de sombra, cor só onde ela significa estado.

Recusa explícita de duas coisas: a coluna centralizada de balõezinhos que todo
app de IA entrega, e o HUD do Homem de Ferro em néon com brilho.

## Tokens

Todos em `src/renderer/src/assets/main.css`, no bloco `@theme` do Tailwind v4.
Nenhuma cor é escrita à mão em componente — a exceção é `Painel.tsx`, que
precisa de string literal porque o recharts pinta SVG por prop, não por classe.

### Chapa (três profundidades)

| Token | Valor | Onde |
|---|---|---|
| `fundo` | `#0E1116` | fundo da janela, corpo da conversa |
| `chapa` | `#161A21` | barra de status, rodapé, painéis, modal |
| `sulco` | `#0A0C10` | escavado: bloco de comando no modal |

### Tinta

| Token | Valor | Contraste sobre `fundo` |
|---|---|---|
| `tinta` | `#E4E1D8` | 15.9:1 — prosa. Branco QUENTE, de papel |
| `tinta-2` | `#9AA1AC` | 6.9:1 — secundário. Cinza FRIO, de metal |
| `tinta-3` | `#7C838E` | 4.95:1 — rótulos e placeholder |

`tinta-3` é o piso: qualquer coisa mais fraca cai abaixo de 4.5:1. Placeholder
usa `tinta-3`, nunca menos.

### Sinal e estado

| Token | Valor | Significado |
|---|---|---|
| `sinal` | `#E8A33D` | âmbar da marca. Foco, cursor, ferramenta, cota |
| `ok` | `#7FB069` | sucesso (declarado, ainda sem uso) |
| `perigo` | `#D1655B` | aprovação, falha, cota no fim |
| `info` | `#7BA6D1` | informativo (declarado, ainda sem uso) |

Todos passam de 5:1 sobre `fundo`. Estado nunca decora — só aparece quando o
estado existe.

### Fio

| Token | Valor | Uso |
|---|---|---|
| `fio` | `#232830` | divisória padrão. UMA espessura no app inteiro: 1px |
| `fio-forte` | `#333A45` | separador vertical, borda de botão, segmento vazio |

Não existe sombra na interface, com **uma** exceção: o modal de aprovação
(`0 18px 50px -12px rgba(0,0,0,.75)`), que precisa flutuar acima do conteúdo.
Instrumento não brilha — halo colorido, glow e gradiente estão fora.

## Tipografia

Duas faces, ambas já instaladas no Windows 11 — a CSP do `index.html` é
`default-src 'self'` e **nenhuma fonte externa carrega**.

- `--font-mono`: **Cascadia Mono** → Consolas. Estrutura e medida: rótulos de
  calha, nomes de ferramenta, números, comando, cabeçalho de tabela. É a face
  que este usuário lê o dia inteiro no terminal — escolha, não fallback.
- `--font-sans`: **Segoe UI Variable Text** → Segoe UI. Só prosa.

Monoespaçado **nunca** é fantasia de "técnico": ele carrega dado, medida ou
código, ou não é usado. A resposta da Izze é prosa e sai em sans.

Escala em uso:

| Papel | Tamanho | Tracking |
|---|---|---|
| rótulo de calha, versalete | 10px mono | `0.18em` |
| wordmark IZZE | 12px mono 600 | `0.30em` |
| ferramenta, número de cota, comando | 11–12px mono | — |
| prosa | 16px sans, `line-height 1.65` | — |

Medida da prosa travada em `max-w-[72ch]`. A janela tem 1100px e uma linha de
1000px não se lê, se varre.

## Composição — a calha

A gramática única do app: **rótulo versalete monoespaçado à esquerda numa calha
de 104px alinhada à direita, conteúdo pendurado à direita, `gap-5`.** É a cabeça
de seção da página de manual, e substitui a coluna de balões.

Usada em quatro lugares, com o MESMO alinhamento: mensagens (`VOCÊ`/`IZZE`),
abertura do estado vazio (`NOME`/`SINOPSE`/`DESCRIÇÃO`/`ATALHOS`), seções do
modal (`O QUE FAZ`/`COMANDO`) e o rodapé do prompt. O que você digita nasce na
mesma coluna em que ela responde.

Componente: `Calha` em `App.tsx`.

Nada tem raio de canto. O mundo é ortogonal — barra de gráfico incluída.

## Peças

- **Barra de status** (`h-10`, casa com `titleBarOverlay` do main): wordmark ·
  anunciador de foco · escada de cota · estado · voz. Toda ela arrasta a janela;
  os controles são `no-drag`. `pr-[140px]` reserva os botões nativos do Windows.
- **Anunciador**: a peça central. Mostra o programa em foco (âmbar, mono) e o
  título da janela (sans, `tinta-2`, truncado). É o mecanismo do produto
  visível — antes ele só existia dentro do prompt do modelo.
- **Escada de cota**: 14 segmentos de 3×12px. Régua de LED, não anel de
  progresso nem número gigante. Vira `perigo` no último quinto.
- **Painel de visual** (`Painel.tsx`): moldura de fio, legenda em versalete
  mono. O `kpi` é uma **tabela de campos** — rótulo à esquerda, valor tabular à
  direita, fio entre linhas — e não o número gigante com rótulo pequeno.
- **Modal de aprovação**: entrada de manual completa do comando. `RECUSAR` é o
  foco inicial e o padrão do Esc; `EXECUTAR` é contornado em `perigo` e só
  preenche no hover — a ação perigosa exige intenção, não reflexo.

## Ícones

`icones.tsx`, autorais. Grade de 16, traço 1.5, ponta reta, sem preenchimento,
`currentColor`. **Nenhum emoji**: emoji muda de desenho por sistema, vem
colorido de fábrica e ignora `currentColor` — três motivos pra nunca pertencer
a um sistema visual.

## Movimento

**Um** momento autorado, não efeitos espalhados: o **anunciador**. Quando o
programa em foco muda, o texto é revelado por varredura
(`clip-path`, 420ms, `cubic-bezier(.16,1,.3,1)`), como um mostrador
eletromecânico virando. Ele roda no `key={foco.programa}` — troca de aba não
dispara, senão viraria estrobo.

Derivados do mesmo vocabulário, ambos funcionais: `.rastro` (a varredura em
modo contínuo enquanto ela processa) e `.cursor` (onda quadrada, `step-end`,
como o cursor do console). Tudo desligado sob `prefers-reduced-motion`.

## Estados cobertos

Vazio (abertura de manual, centrada na vertical) · processando (rastro + cursor)
· ferramenta em execução · visual · aprovação pendente + fila · falha (nomeia o
problema E a saída, em `Falha`) · cota no fim · foco de teclado.

O anel de foco é âmbar, `outline-offset: -1px`, em tudo **menos** `textarea`:
lá ele desenharia uma caixa de formulário de 1000px no rodapé. O campo indica
foco pelo `caret-sinal` e pelo sinal de prompt que acende junto.

## Pendências

- `ok` e `info` estão declarados e sem uso. Primeiro consumidor natural: marcar
  ferramenta que falhou vs. que deu certo no log de invocação.
- Sem responsivo real. É desktop Windows, janela 1100×720. A calha de 104px e
  o `pr-[140px]` assumem largura de desktop.

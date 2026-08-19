# Sistema visual da Izze

Escrito a partir do que foi construído, não do que foi planejado. Fonte da
verdade dos tokens: [src/renderer/src/assets/main.css](src/renderer/src/assets/main.css).

## A ideia: o HUD do Mark III

A referência é o Jarvis dos filmes — mas o Jarvis **certo**.

O HUD cyan, carregado e cheio de anéis girando é o **Mark II**. Os próprios
designers o abandonaram: no Mark III, Wesley Sewell trocou por
*"predominantly white with accent colors"* porque *"cyan is passé"* e ele
queria algo *"more unique and different"*. A equipe chegou a anotar que
*"amber is kind of the 80s and cyan is the 90s"*.

Então nem cyan nem âmbar governam a tela. **Quem governa é o traço branco**,
e a cor entra só onde há informação crítica.

A regra de corte que veio do set vale mais que qualquer paleta:

> *"If it doesn't do something that would be real for somebody flying around
> in this suit then we are taking it out."*

Eles cortaram *"all this extra crap to make it futuristic and fancy"*. Anel
que não mede, varredura que não indica processo e brilho que não é estado
ficam de fora. No filme, a UI que exibe esse clichê é a do **vilão** — o Iron
Monger é vermelho monocromático com a tipografia OCRA, escolhida de propósito
por ser *"unimaginative"*.

## Cor

| Papel | Token | Valor |
|---|---|---|
| Fundo (vidro escuro, viés azul) | `fundo` | `#05090E` |
| Superfície elevada | `chapa` | `#0B1219` |
| Sulco escavado | `sulco` | `#03070A` |
| **O traço** | `tinta` | `#EAF2F6` |
| Secundária | `tinta-2` | `#93A6B3` |
| Rótulo | `tinta-3` | `#6D7F8B` |
| **Acento crítico / marca** | `sinal` | `#E8A33D` |
| Dado secundário (herança Mark II) | `hud` / `info` | `#5BC8E8` |
| Sucesso | `ok` | `#6FD39A` |
| Perigo / falha | `perigo` | `#FF5646` |
| Fio de cabelo | `fio` / `fio-forte` | branco a 10% / 22% |

O fio é **branco transparente**, não cinza sólido: wireframe que ganha peso ao
empilhar, como o do capacete.

Âmbar some da tela quando nada é crítico. Cyan é dado, nunca fundo nem brilho.
Contraste: `tinta-3` está em 4.95:1 sobre `fundo` — se mexer, recalcule.

Dark não é padrão de categoria: é a cena de uso — sala fechada, à noite,
chamada por cima de outra janela.

## Tipografia

- **Rótulos em versalete:** `Bahnschrift` → `Segoe UI Variable Display`.
  Condensada e técnica: a voz do instrumento.
- **Dado, número e código:** `Cascadia Mono` → `Consolas`.
- **Prosa:** `Segoe UI Variable Text` → `Segoe UI`.

As três já vêm no Windows 11, e a CSP do `index.html` é `default-src 'self'`
— **nenhuma fonte externa carrega**. Adicionar uma face exige empacotá-la.

Medida do texto corrido travada em `max-w-[72ch]`.

## Composição

**Calha suspensa** — sobreviveu da direção anterior porque funciona, e é o que
substitui a coluna de balõezinhos:

```
      NOME  izze — assistente que enxerga a máquina...
   SINOPSE  abrir_app  listar_pasta  rodar_powershell ⚠
```

Rótulo à direita numa calha de `104px`, conteúdo pendurado à esquerda.
Componentes `Calha` e `Secao` em [App.tsx](src/renderer/src/App.tsx).

**Colchetes de canto** (`.colchetes`) — quatro cantos em L, não caixa fechada.
É a diferença entre uma mira e um card: o retângulo completo é vocabulário de
página web. Feito com oito gradientes num `background` só, porque `::before` +
`::after` dariam só dois cantos. `.colchetes-vivo` acende em âmbar, e só o
modal de aprovação usa.

**Barra de status** (`h-10`) é a barra de título: `titleBarStyle: 'hidden'` +
`titleBarOverlay` pintam os botões nativos do Windows na chapa. A altura do
overlay em [index.ts](src/main/index.ts) e o `h-10` + `pr-[140px]` do header
andam juntos.

## Peças

- **Anunciador** — a janela em foco, ao vivo. O mecanismo do produto visível.
- **Escada** — a cota do dia como régua de LED segmentada. Vira `perigo` no
  último quinto. Não é anel de progresso.
- **Masthead** — o estado vazio como abertura de manual. A SINOPSE sai do
  `catalogo()` do main, nunca de lista escrita à mão.
- **Transmissão** — o aviso que ela dá sem ninguém pedir: a única coisa que
  aparece na tela sem você ter feito nada. Corpo próprio, não a resposta com um
  enfeite. Vem em **colchetes** porque é leitura de instrumento e não fala, e
  em **cyan** porque âmbar é acento crítico e some quando nada é crítico —
  gastá-lo num disco enchendo o esvazia pro modal de aprovação, que é onde ele
  precisa gritar. Traz a **hora** absoluta: o aviso pode ter esperado horas na
  bandeja, e sem marca de tempo a interface mente sobre quando aquilo foi lido.
  No pé, `ÚTIL` / `RUÍDO` — a única peça do app que existe pela medição e não
  pelo uso; some depois de respondida, e não responder é resposta válida.
- **`Pulso`** — o ícone da transmissão: fonte no centro, ondas pros dois lados.
  O `Som` irradia só pra direita porque tem um alto-falante apontando; o
  gatilho não aponta pra lugar nenhum, parte do meio. É o que separa os dois
  nos 11px em que ambos vivem.
- **Gráficos** — barra é wireframe translúcido (contorno 1px, miolo 18%), não
  laje sólida. A série categórica começa no **branco**: se começasse no âmbar,
  a cor de "crítico" pintaria a primeira barra de todo gráfico e deixaria de
  significar algo.

## Movimento

- **`.destravar`** — a mecânica *"exploded keyhole"* do filme: gira, destrava,
  abre em leque. Só em coisa que **nasce** na tela (painel de dado, modal).
- **`.anunciador`** — varredura quando o programa em foco muda. Roda porque um
  dado mudou.
- **`.arco`** — gira só enquanto ela processa. Some em espera.
- **`.cursor`** — onda quadrada, como a do console.

Tudo respeita `prefers-reduced-motion`. Fora isso a interface é imóvel.

## Ao estender

1. Peça nova entra na calha. Não invente segunda gramática de layout.
2. Cor de estado só quando há estado. Se está decorando, use `tinta-*`.
3. **O teste do set:** se o elemento não faz algo real, ele sai.
4. Ícone novo se desenha em [icones.tsx](src/renderer/src/icones.tsx), na
   mesma mão (grade 16, traço 1.5, `currentColor`). Nunca emoji nem glifo.
5. Nada de raio de canto, gradiente, glass ou glow.
6. As cores dos gráficos são a única duplicação de token do projeto (o recharts
   pinta por prop, não por classe). Mexeu no `main.css`, mexa no `Painel.tsx`.

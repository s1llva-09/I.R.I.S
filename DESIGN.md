# Sistema visual da Íris

Uma central futurista para conversar com a assistente e acompanhar a
segurança do ambiente. A imagem da câmera, as análises e o histórico têm
espaço próprio: o painel de segurança é uma área de trabalho completa.

Os tokens de implementação vivem em
[main.css](src/renderer/src/assets/main.css). Este documento registra a
direção visual e as regras para estender a interface.

## Marca

**I.R.I.S** — "Sua casa, sempre sob os seus olhos." O símbolo é um olho de
traço claro com a íris em ciano. Os originais (símbolo claro e escuro, ícone
do app, logotipos horizontais e a arte de apresentação) ficam em
[docs/marca](docs/marca). No app, o símbolo e o nome vêm de
[Marca.tsx](src/renderer/src/Marca.tsx): o traço segue `--marca-traco` e a
íris segue o acento, então mudar o tema muda a marca junto. O nome é escrito
com os pontos no acento (`I.R.I.S`); na prosa, a assistente continua "a Íris".

## Direção visual

Fundo marinho quase preto, superfícies em camadas, acento ciano da marca. Bordas delicadas, cantos arredondados e gradientes discretos dão
profundidade sem competir com texto, vídeo e estados do sistema.

O caráter futurista vem da composição, tipografia e organização das
informações. Leituras, contadores e alertas precisam ter uma fonte real.
Não adicionar porcentagens de proteção, pessoas fictícias, FPS inventado
ou animações que simulem uma análise inexistente.

## Cor

| Papel | Referência | Uso |
|---|---|---|
| Fundo principal | `#061019` | Base da aplicação (o fundo do ícone) |
| Superfícies | `#0c1a26` (cards), `#081521` (campos), `#0a1823` (barras) | Cards, navegação e campos |
| Bordas | `#1a3042` e `#2d4c64` (forte) | Separação entre camadas |
| Acento principal | `#35e0f2` | Seleção, ação principal, foco e a íris da marca |
| Texto sobre o acento | `#04121a` | Botão principal (branco no ciano não tem contraste) |
| Texto principal | `#eaf2f7` | Títulos e conteúdo (o claro do logotipo) |
| Texto secundário | `#b6c7d4` e `#8ea4b5` | Legendas, contexto e horários |
| Sucesso | `#5ad19c` | Estado confirmado pelos dados |
| Atenção | `#f2c46d` | Condição que precisa de revisão |
| Falha ou risco | `#ff8b98` | Erros, captura indisponível e alertas |

Estados usam texto e, quando útil, ícone além da cor. Cyan não significa
automaticamente que um ambiente está seguro. Gradientes ficam nas
superfícies e nos detalhes de marca; textos e controles mantêm contraste
legível. Validar contraste sempre que os tokens mudarem.

## Tipografia e geometria

- Interface e prosa: `Segoe UI Variable Text`, `Segoe UI`, sans-serif.
- Nome da marca, títulos de destaque e números do resumo: `Bahnschrift`
  (`--font-display`), `Segoe UI Variable Display`, sans-serif.
- Horários, números e dados técnicos: `Cascadia Mono`, `Consolas`, monospace.
- Cards com raio de 12–16px; campos e botões acompanham essa família visual.
- Espaçamento consistente, títulos claros e texto auxiliar legível, sem
  transformar toda a interface em rótulos minúsculos em caixa alta.

Usar fontes locais ou empacotadas. Não depender de carregamento externo
para a interface funcionar. Ícones seguem o traço de
[icones.tsx](src/renderer/src/icones.tsx), com `currentColor` e nomes
acessíveis nos controles que não têm texto.

## Estrutura da aplicação

Navegação persistente à esquerda para acessar Assistente, Segurança e
Ajustes. A seleção atual permanece clara. O cabeçalho reúne a identidade,
o título da área e os estados essenciais, respeitando o espaço dos
controles nativos da janela e a área de arraste do Electron.

O conteúdo ocupa o espaço restante e rola sem esconder a navegação. Em
janelas estreitas, a navegação fica compacta e as colunas de conteúdo se
empilham. A interface precisa continuar utilizável com zoom e teclado.

O Assistente mantém conversa, ferramentas e entrada de comando próximos.
Mensagens, resultados de ferramentas, gráficos e pedidos de aprovação
compartilham cores, bordas e espaçamento com o restante da aplicação.

## Área de segurança

A primeira leitura deve responder: **qual imagem está chegando, o que foi
detectado e se o sensor está disponível**. A hierarquia é:

1. **Imagem principal:** visor amplo, fonte identificada, estado de conexão
   e sobreposição dos rostos que o detector encontrou.
2. **Análise atual:** quantidade de rostos, nomes reconhecidos quando
   disponíveis e pessoas sem correspondência no cadastro.
3. **Estado do sistema:** captura ligada ou desligada, sinal disponível,
   erros de conexão e contexto necessário para interpretar a leitura.
4. **Eventos e decisões:** histórico real com horários e motivos de risco,
   inclusive estados vazios explícitos quando não há registros.

Controles de ligar, desligar e escolher fonte ficam fáceis de encontrar.
Cadastro de pessoas, câmera de rede, conexão pelo celular, calibração e
medição ficam em áreas de gerenciamento expansíveis ou secundárias, sem
dominar a visualização do ambiente.

### Estados honestos

- Câmera desligada, carregando, indisponível e sem rostos detectados são
  estados diferentes. Falta de sinal não significa ambiente vazio.
- Uma foto de teste deve aparecer identificada como teste. Não usar o
  rótulo “ao vivo” para uma imagem estática.
- Exibir horário e origem quando estiverem disponíveis. Não criar uma
  precisão que o sensor ou o histórico não fornece.
- Uma pessoa sem correspondência no cadastro é uma detecção para revisão,
  não uma conclusão sobre sua intenção.
- Erros precisam informar o problema e a próxima ação possível. A imagem
  antiga não deve continuar apresentada como uma transmissão atual.

## Interação, acessibilidade e movimento

O foco de teclado deve ser visível em botões, links, seletores e campos.
Cada campo tem rótulo; controles com ícone têm nome acessível. Não usar
somente `title` como instrução principal. Áreas expansíveis comunicam seu
estado, e ações indisponíveis ficam claramente desabilitadas.

Transições curtas podem acompanhar mudanças de área, entrada de cards e
processamento real. Evitar movimento contínuo em repouso e efeitos sobre
o vídeo que prejudiquem a leitura. Respeitar `prefers-reduced-motion` em
animações e transições. Não acrescentar flashes ou cintilação decorativa.

Captura ativa precisa de indicação persistente. Avisos e mudanças de
estado devem ser compreensíveis sem animação, áudio ou cor.

## Ao estender

1. Reutilizar os tokens e os componentes existentes antes de criar outra
   linguagem visual.
2. Colocar a informação principal antes dos controles de gerenciamento.
3. Usar bordas, raio, brilho discreto e gradientes para organizar camadas;
   preservar contraste e evitar excesso de efeitos simultâneos.
4. Ligar cada indicador à fonte de dados correspondente; mostrar ausência
   de dados em vez de preencher o espaço com telemetria decorativa.
5. Verificar estados vazio, ocupado, erro e recuperação, além do estado
   conectado com sucesso.
6. Conferir gráficos em [Painel.tsx](src/renderer/src/Painel.tsx) quando as
   cores compartilhadas mudarem, porque suas séries também recebem cores
   por propriedades.

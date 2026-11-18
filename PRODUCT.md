2# Íris

> Escrito a partir do código (o usuário delegou: "vc decide"). Corrija o que
> estiver errado — este arquivo é a verdade do produto, não do visual.

## O que é

Assistente pessoal de desktop no estilo Jarvis, rodando como app Electron no
Windows do Pablo. Não é um chat com IA: é um agente que **age na máquina** —
abre programas, lista e analisa pastas, roda PowerShell, mede o próprio uso.

## Mecanismo único

Ela **já sabe o que você está fazendo**. Um vigia lê a janela em foco a cada
500ms e injeta isso no prompt a cada turno, então "resume isso" e "o que eu tô
fazendo?" têm referente sem gastar uma chamada de ferramenta. É a diferença
entre um chat e um assistente que está na sala com você.

## Quem usa, onde

Pablo, desenvolvedor frontend, sozinho, na própria máquina. Sala fechada,
monitor grande, quase sempre à noite. Chama pelo Ctrl+Space por cima do que
estiver fazendo, pergunta uma coisa, volta pro trabalho. Sessões curtas e
frequentes, não uma janela que fica aberta o dia inteiro.

## Tarefas reais (modo Operate)

1. **Perguntar e ouvir.** Texto streamando + voz pelo SAPI. A voz é o padrão.
2. **Aprovar ou recusar um comando.** Modal bloqueante com o PowerShell cru.
   É o único momento em que a UI exige atenção total — e o único onde um erro
   de leitura custa caro.
3. **Ler um dado.** Gráficos (barra, pizza, linha), tabela e KPI, gerados pelas
   ferramentas no meio da resposta.
4. **Saber o próprio estado.** Em espera / processando, cota diária, voz on/off.

## Estados que importam

- **Vazio** (primeira abertura da sessão — acontece toda hora, pelo Ctrl+Space)
- **Processando** (streaming de texto, ferramentas rodando em paralelo)
- **Aprovação pendente** (fila, pode ter mais de uma)
- **Limite diário estourado** (cota do OpenRouter)
- **Falha de rede/chave**

## Restrições técnicas

- Electron + React 19 + Tailwind v4 + recharts. Sem dependência nova.
- **CSP `default-src 'self'`** no index.html: nenhuma fonte, imagem ou script
  externo carrega. Tudo tem que ser local ou embutido.
- Janela 1100x720, redimensionável. Só desktop, só Windows. Sem mobile.
- Português do Brasil em toda a interface.

## Compromissos de marca

- O nome na tela é **I.R.I.S**, com o slogan "Sua casa, sempre sob os seus olhos." (ver DESIGN.md, seção Marca).
- Referência declarada pelo usuário: **Jarvis** (Homem de Ferro).
- Pedido literal: "profissional e legal para me divertir e ficar bonito".

## O que NÃO é

- Não é multiusuário, não tem login, não tem onboarding, não tem configurações
  em tela (tudo vive no `.env`).
- Não é um chat de suporte: nada de avatar, bolha de balãozinho, "digitando…".

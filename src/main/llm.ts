import OpenAI from 'openai'
import { app } from 'electron'
import type {
  ChatCompletionChunk,
  ChatCompletionMessageParam
} from 'openai/resources/chat/completions'
import { DECLARACOES, NIVEIS, janelaEmFoco, rodarFerramenta } from './ferramentas'
import { registrar, registrarChamada, usoHoje } from './banco'

/**
 * Roda no processo MAIN, nunca no renderer:
 * a chave apareceria no DevTools e a API bloquearia por CORS.
 *
 * O OpenRouter fala o dialeto da OpenAI, então o SDK oficial da OpenAI
 * funciona só trocando a baseURL. Trocar de provedor depois
 * (Groq, Cerebras, Ollama) é mudança de uma linha.
 */
const cliente = new OpenAI({
  apiKey: import.meta.env.MAIN_VITE_LLM_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  /**
   * 429 e 5xx já voltam sozinhos daqui. O SDK repete com espera crescente e,
   * melhor que qualquer backoff escrito na mão, OBEDECE o cabeçalho
   * 'retry-after' que o OpenRouter manda dizendo quanto falta pra cota virar.
   * Um 2s/4s/8s fixo ignora esse número e tenta cedo demais.
   *
   * O padrão é 2; 3 porque modelo :free cai por rate limit com frequência.
   * 401 e 400 não são repetidos — não adianta insistir em chave inválida.
   */
  maxRetries: 3,
  defaultHeaders: {
    // Opcionais — só colocam teu app no ranking do OpenRouter.
    'HTTP-Referer': 'http://localhost',
    'X-Title': 'Izze'
  }
})

/**
 * Já foi o ultra-550b. Voltou pro super-120b por medida, não por gosto:
 * o ultra estourou "Provider timed out after ~11s" em 3 de 5 tentativas
 * seguidas, e o SDK ainda retenta 3x antes de desistir — cada falha dessas
 * queima ~45s e chamadas da cota. Modelo que não responde não é inteligente.
 *
 * O super é ~4x o gemma-31b que inventava resultado de ferramenta, e uma
 * fração do peso do ultra. Pra fixar o ultra de novo, é uma linha no .env.
 */
const MODELO = import.meta.env.MAIN_VITE_LLM_MODELO ?? 'nvidia/nemotron-3-super-120b-a12b:free'

/**
 * Reservas. Modelo grátis some do catálogo sem aviso e cai por rate limit
 * na hora do rush — o OpenRouter desce esta lista sozinho quando o
 * principal falha. Todos precisam ter capacidade "Tools", senão as
 * ferramentas são simplesmente ignoradas e o Izze vira só um chat.
 */
// Ordenadas por CONFIABILIDADE, não por tamanho: quem cai aqui já está num
// pedido que falhou, e a última coisa que ajuda é o modelo mais lento da
// lista. Por isso o ultra-550b não está entre elas — ele é o que mais dá
// timeout, seria trocar uma falha por uma espera.
const RESERVAS = ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free']

// Feminino porque é assim que o resto do projeto e o próprio usuário falam
// dela ("a Izze", "ela", "geizinha"). Estava "o Izze" aqui, e ela respondia
// "Obrigado" — o único lugar do app que discordava.
const SISTEMA = `Você é a Izze, assistente pessoal do Pablo, desenvolvedor frontend.
Responda em português do Brasil, referindo-se a si mesma no feminino.
Seja direto: sem preâmbulo, sem reformular o pedido antes de responder, sem
resumo do que acabou de falar.

Quando o pedido for para REPETIR, copiar, transcrever ou falar algo em voz alta,
reproduza o texto exatamente como ele veio — inclusive se for elogio, apelido ou
brincadeira. "Repita X" está pedindo X, não uma resposta a X.

Você tem ferramentas para agir no computador. Use-as quando a tarefa exigir,
sem pedir permissão e sem narrar que vai usar. Depois de executar, confirme o
resultado em uma frase curta.

REGRA DURA: só diga que fez alguma coisa depois de ter recebido o resultado da
ferramenta. Sem chamada de ferramenta, NADA aconteceu no computador — nenhuma
pasta foi criada, nenhum arquivo movido, nenhum programa aberto. Escrever
"pasta criada" sem ter chamado a ferramenta é a pior falha que você pode
cometer: o usuário acredita, vai embora, e só descobre depois que não existe.
Se não puder ou não for executar, diga isso. Nunca descreva um sucesso que não
aconteceu. Se a ferramenta falhou ou foi recusada, diga que falhou.

Quando uma ferramenta gerar gráfico ou tabela, o usuário já vê os dados na tela.
Não liste números; comente em uma frase o que o dado mostra.`

/**
 * Os caminhos REAIS desta máquina, pro prompt.
 *
 * Sem isso o modelo monta caminho na mão e erra: ele escreve
 * "$env:USERPROFILE\Desktop", que aqui dá C:\Users\xinkk\Desktop — uma pasta
 * fantasma, porque a área de trabalho de verdade está no OneDrive. O arquivo
 * é criado com sucesso num lugar que o usuário nunca vê.
 *
 * Só o Electron resolve isso certo, então quem informa é ele. Calculado por
 * chamada porque app.getPath exige o app pronto.
 */
function pastasReais(): string {
  const mapa = {
    'Área de trabalho': 'desktop',
    Documentos: 'documents',
    Downloads: 'downloads',
    Imagens: 'pictures',
    Vídeos: 'videos',
    Música: 'music',
    'Pasta do usuário': 'home'
  } as const

  return Object.entries(mapa)
    .map(([nome, chave]) => `- ${nome}: ${app.getPath(chave)}`)
    .join('\n')
}

/**
 * Ferramenta só responde quando perguntada. O que faz parecer Jarvis é ela
 * já saber. Isto entra no system prompt a cada turno, então "resume isso"
 * passa a ter referente — e sem gastar uma volta do loop, que é o que
 * custava caro: cada chamada de ferramenta é uma ida e volta inteira no
 * modelo. Por isso não existe ferramenta 'app_em_foco': ela só descobriria
 * o que já está escrito aqui.
 */
function contextoAtual(): string {
  const foco = janelaEmFoco()
  if (!foco) return ''

  return `

Agora o usuário está em "${foco.programa}" — ${foco.titulo}
Quando ele disser "isso", "aqui" ou perguntar o que está fazendo, é a isto que se refere.
Não comente a janela se ele não perguntou.`
}

// Teto de voltas. Sem isso, um modelo confuso chama a mesma ferramenta
// pra sempre e você só descobre pelo rate limit.
const MAX_VOLTAS = 8

type Eventos = {
  aoReceberTexto: (texto: string) => void
  aoUsarFerramenta: (nome: string, argumentos: string) => void
  aoGerarVisual: (visual: Visual) => void
  /** Devolve true se o usuário liberou. É o único evento que o loop espera. */
  aoPedirAprovacao: (nome: string, argumentos: string) => Promise<boolean>
}

/**
 * O LOOP DO AGENTE.
 *
 * A ideia inteira em quatro passos:
 *   1. manda a conversa + o catálogo de ferramentas
 *   2. se a resposta terminar em 'tool_calls', o modelo quer agir
 *   3. você executa e devolve o resultado como mensagem role:'tool'
 *   4. repete — agora ele já sabe o que aconteceu
 *
 * Ele sai do laço quando responde texto normal (finish_reason 'stop').
 * Daqui pra frente, "ensinar coisa nova pro Izze" = adicionar ferramenta
 * em ferramentas.ts. Este arquivo não muda mais.
 */
export async function conversar(
  historico: ChatCompletionMessageParam[],
  eventos: Eventos
): Promise<string> {
  const mensagens: ChatCompletionMessageParam[] = [
    {
      role: 'system',
      content: `${SISTEMA}

Caminhos reais deste computador. Use estes literalmente em comandos PowerShell.
NUNCA monte caminho de pasta do usuário com $env:USERPROFILE nem chute o nome —
neste PC a área de trabalho não fica onde você esperaria.
${pastasReais()}${contextoAtual()}`
    },
    ...historico
  ]

  let ultimoTexto = ''

  for (let volta = 0; volta < MAX_VOLTAS; volta++) {
    /**
     * DENTRO do laço, não antes dele.
     *
     * Uma pergunta só já gasta até MAX_VOLTAS chamadas. Conferir uma vez na
     * entrada libera as 8 de uma vez — que é exatamente como a cota estoura
     * no meio de uma demo, o caso que esta guarda existe pra evitar.
     */
    const uso = usoHoje()
    if (uso.restantes <= 0) {
      // Se já saiu texto nesta volta, devolve o texto: cortar uma resposta
      // pela metade pra avisar do limite é pior que a resposta incompleta.
      return (
        ultimoTexto ||
        `Cheguei ao limite diário: ${uso.usadas} de ${uso.teto} chamadas. A cota vira à meia-noite UTC (21h aqui) — ou aumente MAIN_VITE_TETO_DIARIO no .env se a sua conta tem crédito.`
      )
    }

    // Antes da chamada, não depois: uma chamada que falha gastou cota no
    // provedor do mesmo jeito. Contar só o sucesso deixaria o contador
    // otimista justamente no dia em que está tudo falhando.
    registrarChamada()

    const stream = await cliente.chat.completions.create({
      model: MODELO,
      models: RESERVAS, // extensão do OpenRouter: fallback automático
      // VOLTOU ATRÁS, exatamente pelo motivo que o comentário antigo previa.
      //
      // Estava 'enabled: false' (não gera raciocínio nenhum) porque num
      // nemotron-ultra o raciocínio custa segundos por volta. O preço
      // apareceu: a Izze respondeu "Pasta teste criada na sua área de
      // trabalho" SEM ter chamado o rodar_powershell — o log de execuções
      // não tem uma linha sequer daquele turno. Escolher ferramenta é
      // justamente a decisão que morre primeiro sem raciocínio.
      //
      // 'exclude: true' gera e ESCONDE: você paga a latência e não vê os
      // tokens. É o preço de ela não mentir sobre o que fez.
      reasoning: { exclude: true },
      stream: true,
      max_tokens: 2048,
      tools: DECLARACOES,
      messages: mensagens
      // 'models' não existe na tipagem oficial da OpenAI, por isso o cast.
    } as unknown as Parameters<typeof cliente.chat.completions.create>[0])

    let texto = ''
    let motivo: string | null = null

    /**
     * A parte chata do streaming com ferramentas:
     * a tool call NÃO chega inteira. Vem fatiada em vários chunks —
     * o nome num, pedaços do JSON dos argumentos nos seguintes.
     * O 'index' diz qual chamada é qual (podem vir várias em paralelo).
     * Por isso concatenamos tudo antes de tentar usar.
     */
    const emMontagem: Record<number, { id: string; nome: string; args: string }> = {}

    // O cast é por causa do 'as unknown as' lá em cima: o create() perdeu a
    // sobrecarga de stream junto com a tipagem das extensões do OpenRouter.
    // Os chunks em si são ChatCompletionChunk normais.
    for await (const chunk of stream as AsyncIterable<ChatCompletionChunk>) {
      const escolha = chunk.choices?.[0]
      if (!escolha) continue

      if (escolha.finish_reason) motivo = escolha.finish_reason

      const pedaco = escolha.delta?.content
      if (pedaco) {
        texto += pedaco
        eventos.aoReceberTexto(pedaco)
      }

      for (const tc of escolha.delta?.tool_calls ?? []) {
        const i = tc.index
        emMontagem[i] ??= { id: '', nome: '', args: '' }
        if (tc.id) emMontagem[i].id += tc.id
        if (tc.function?.name) emMontagem[i].nome += tc.function.name
        if (tc.function?.arguments) emMontagem[i].args += tc.function.arguments
      }
    }

    const chamadas = Object.values(emMontagem)
    if (texto) ultimoTexto = texto

    // Sem ferramenta pedida: acabou, ele só respondeu.
    if (chamadas.length === 0 || motivo !== 'tool_calls') {
      return ultimoTexto
    }

    // A mensagem do assistente COM as tool_calls precisa entrar no histórico
    // ANTES dos resultados. Se pular isso, a API rejeita o próximo turno.
    mensagens.push({
      role: 'assistant',
      content: texto || null,
      tool_calls: chamadas.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.nome, arguments: c.args }
      }))
    })

    // Em paralelo — se ele pediu 3 coisas, não faz sentido enfileirar.
    const resultados = await Promise.all(
      chamadas.map(async (c) => {
        // Ausente = 3. Ferramenta nova sem nível declarado pede aprovação
        // em vez de rodar solta — esquecer uma linha do NIVEIS não pode
        // virar permissão total.
        if ((NIVEIS[c.nome] ?? 3) === 3) {
          const aprovado = await eventos.aoPedirAprovacao(c.nome, c.args)
          if (!aprovado) {
            // A recusa também vai pro log: um registro de auditoria que só
            // guarda o que foi permitido não serve como auditoria.
            registrar({
              ferramenta: c.nome,
              argumentos: c.args,
              resultado: 'recusado pelo usuário',
              erro: false,
              duracao: 0
            })
            // Volta como resultado normal — o modelo lê, entende e sugere
            // outro caminho em vez de travar.
            return { id: c.id, saida: 'O usuário recusou a execução deste comando.' }
          }
        }

        eventos.aoUsarFerramenta(c.nome, c.args)
        const inicio = Date.now()
        const r = await rodarFerramenta(c.nome, c.args)

        // Aqui é o único ponto por onde TODA execução passa — é o lugar
        // certo pra medir. Escrita síncrona, custa microssegundos.
        registrar({
          ferramenta: c.nome,
          argumentos: c.args,
          resultado: r.texto,
          // rodarFerramenta prefixa 'Erro' em toda falha, inclusive nas que
          // ele engole pro modelo ler. É o que dá pra saber daqui.
          erro: r.texto.startsWith('Erro'),
          duracao: Date.now() - inicio
        })

        // O visual vai direto pra UI e NUNCA entra no histórico: role:'tool'
        // só aceita content string, e mandar os dados de novo pro modelo
        // seria queimar contexto com o que ele já leu resumido.
        if (r.visual) eventos.aoGerarVisual(r.visual)
        return { id: c.id, saida: r.texto }
      })
    )

    // Cada resultado volta amarrado ao tool_call_id que o originou.
    // A ordem não importa; o id é o que liga as pontas.
    for (const r of resultados) {
      mensagens.push({ role: 'tool', tool_call_id: r.id, content: r.saida })
    }
  }

  return ultimoTexto || 'Parei: excedi o limite de voltas sem chegar a uma resposta.'
}

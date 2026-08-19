import { app } from 'electron'
import { join } from 'path'
import { conversar } from './llm'
import { registrar, ultimoAvisoDe, usoHoje } from './banco'
import { rodarPS } from './ferramentas'
import { DEFESA_LIGADA, envelopar, pontuarRisco } from './confianca'
import { ler } from './config'

/**
 * GATILHOS POR EVENTO.
 *
 * Até aqui a Izze só REAGE: existe um turno porque alguém digitou. Um gatilho
 * é o primeiro caminho em que ela fala primeiro — uma condição verificada de
 * tempos em tempos e, quando ela vira verdadeira, uma mensagem que entra no
 * MESMO laço de agente do chat.
 *
 * Passar pelo laço em vez de montar a frase na mão tem um motivo: ela pode
 * olhar antes de falar. "Restam 8 GB" vira "restam 8 GB, e o Downloads sozinho
 * tem 40" porque o modelo chamou `analisar_pasta` no meio.
 *
 * As três restrições que fazem isso ser seguro e barato, nesta ordem:
 *
 *   1. NÃO APROVA NADA. `aoPedirAprovacao` devolve false, sempre. Não há
 *      usuário lendo às 3h da manhã; a alternativa a recusar seria aprovar
 *      sozinho. Autonomia de percepção, não de ação.
 *   2. CATÁLOGO FECHADO. Ele nem enxerga as ferramentas que escrevem (ver
 *      FERRAMENTAS_DO_GATILHO).
 *   3. RESERVA DE COTA. Ele para de rodar antes de a cota acabar, pra nunca
 *      ser o motivo de a Izze não responder quando você pergunta.
 */

/**
 * O que um gatilho pode usar.
 *
 * Lista fechada, e não `NIVEIS[x] === 1`, por causa de UM item: `abrir_app` é
 * nível 1 — abrir o Spotify é reversível — mas nível 1 significa "não muda
 * nada" pra quem está na frente do teclado e apertou enter. Um programa que
 * sobe sozinho enquanto você almoça não é a mesma coisa. O nível está certo
 * pro uso interativo; é a origem que muda o sentido dele.
 *
 * Ferramenta nova NÃO entra aqui automaticamente, e isso é o desejado: um
 * catálogo que cresce sozinho é como um gatilho ganha permissão que ninguém
 * decidiu dar.
 */
export const FERRAMENTAS_DO_GATILHO = new Set([
  'hora_atual',
  'listar_pasta',
  'analisar_pasta',
  'minhas_estatisticas',
  'meu_consumo',
  'lembrancas'
])

/**
 * Quantas chamadas do dia ficam reservadas pra VOCÊ.
 *
 * Sem isto o recurso se autodestrói: o teto é 45/dia (banco.ts), e um gatilho
 * que investiga com ferramentas gasta 2-3 chamadas por disparo. Uma manhã de
 * avisos automáticos deixaria a Izze respondendo "cheguei ao limite diário" na
 * primeira pergunta de verdade — trocando a assistente que funciona por uma
 * notificação de bateria.
 */
export const RESERVA = Number(import.meta.env.MAIN_VITE_RESERVA_GATILHO ?? 15)

/** Sem `silencioMs` próprio, um gatilho não repete o mesmo aviso por 1h. */
const SILENCIO_PADRAO = 3600000

/**
 * BRAÇO DE CONTROLE do experimento. `IZZE_GATILHO_CRU=1 npm run dev` entrega
 * o texto do `verificar` direto, sem passar pelo modelo.
 *
 * Mesma chave do DEFESA_LIGADA, e pelo mesmo motivo: a pergunta desta seção
 * não é "avisar é melhor que não avisar" — isso é óbvio e não se mede. É
 * "passar o aviso pelo laço de agente rende um aviso MELHOR que o alerta de
 * limiar burro que qualquer script faria?".
 *
 * Sem o braço cru, a precisão medida não tem contra o que ser comparada, e o
 * capítulo vira "a Izze avisou 12 vezes" — número sem leitura.
 *
 * As linhas do braço cru vão pro banco com sufixo ':cru', então o GROUP BY do
 * relatório separa os dois sozinho, sem coluna nova.
 */
const CRU = process.env.IZZE_GATILHO_CRU === '1'

/**
 * O teto de voltas do gatilho. Bem abaixo do MAX_VOLTAS=8 do chat: aqui cada
 * volta é cota gasta sem ninguém ter pedido nada, e um aviso que precisa de
 * três investigações pra ser escrito não é um aviso, é uma conversa.
 */
const VOLTAS = 3

/**
 * O que um `verificar` devolve quando há algo a dizer. DOIS textos, e não um.
 *
 * Parece duplicação e não é: os dois braços do experimento entregam a públicos
 * diferentes, e tratar isso como um texto só produziu um bug de verdade. O
 * braço cru cortava a primeira frase da mensagem DO MODELO — que carrega o
 * envelope de conteúdo não confiável — e o usuário via
 * `<<<CONTEUDO_EXTERNO_NAO_CONFIAVEL>>>` na notificação do Windows.
 *
 * A separação também deixa a assimetria explícita, que é o ponto do
 * experimento: o `cru` é tudo que um script de limiar consegue dizer.
 */
type Leitura = {
  /**
   * Vai pro laço de agente. Pode mandar investigar com ferramenta, e todo
   * nome vindo da máquina AQUI tem que passar pelo `externo` — é texto que
   * um modelo vai ler como instrução em potencial.
   */
  modelo: string
  /**
   * Vai direto pro usuário e NUNCA pro modelo. Por isso nome de terceiro
   * entra sem envelope: pra um humano, uma pasta com nome esquisito é só uma
   * pasta com nome esquisito.
   */
  cru: string
}

export type Gatilho = {
  nome: string
  /** De quanto em quanto tempo a condição é VERIFICADA. */
  intervaloMs: number
  /** Depois de avisar, fica quieto por tanto tempo. Padrão: 1h. */
  silencioMs?: number
  /** A condição. null quando não há nada a dizer. */
  verificar: () => Promise<Leitura | null>
}

// `Aviso` é global (src/tipos.d.ts) porque o renderer também o enxerga.

type Estado = { ultimaChecagem: number; ultimoAviso: number }

/**
 * A decisão de disparar, isolada de relógio, banco e rede — é a única parte
 * com lógica de verdade aqui, e a única que dá pra testar sem esperar meia
 * hora por um tique. O motivo volta como string em vez de boolean porque
 * "não rodou" tem quatro causas diferentes e depurar sem saber qual é chato.
 *
 * O silêncio é checado ANTES da verificação, não depois: durante as 12h de
 * silêncio do disco não faz sentido nem pagar o spawn do PowerShell pra
 * descobrir de novo o que já foi dito.
 */
export function decidir(
  g: Pick<Gatilho, 'intervaloMs' | 'silencioMs'>,
  estado: Estado,
  agora: number,
  restantes: number
): 'checar' | 'cota' | 'silencio' | 'cedo' {
  if (restantes <= RESERVA) return 'cota'
  if (agora - estado.ultimoAviso < (g.silencioMs ?? SILENCIO_PADRAO)) return 'silencio'
  if (agora - estado.ultimaChecagem < g.intervaloMs) return 'cedo'
  return 'checar'
}

// ---------------------------------------------------------------
// A regra de corte
// ---------------------------------------------------------------

/**
 * Abaixo disto o gatilho não tem nota — tem anedota. Cinco rótulos não é
 * significância estatística e não finge ser; é o mínimo pra "errou uma vez"
 * não virar 0% de precisão e matar um gatilho bom.
 */
export const N_MINIMO = 5

/**
 * O que fazer com o gatilho, dada a precisão medida.
 *
 * Métrica que não decide nada é decoração, então os dois cortes:
 *
 *   0.5  — um aviso certo em menos da metade das vezes CUSTA mais atenção do
 *          que economiza: você passa a conferir todos, inclusive os certos.
 *          É o ponto em que ignorar o gatilho é a atitude racional, e um
 *          gatilho que se aprende a ignorar é pior que nenhum, porque ainda
 *          interrompe.
 *   0.8   — abaixo disso ele ainda serve, mas incomoda demais pra frequência
 *          que tem; o conserto é afrouxar (limiar mais apertado, silêncio
 *          maior), não desligar.
 *
 * Os dois são CHUTE CALIBRÁVEL, como o LIMIAR do risco.ts. O que não é chute
 * é a forma: um número que só descreve não muda nada, e o objetivo aqui é
 * poder escrever "o gatilho X foi desligado pelo critério" no capítulo.
 */
export function veredito(l: {
  rotulados: number
  precisao: number | null
}): 'manter' | 'afrouxar' | 'desligar' | 'sem-dados' {
  if (l.rotulados < N_MINIMO || l.precisao === null) return 'sem-dados'
  if (l.precisao >= 0.8) return 'manter'
  if (l.precisao >= 0.5) return 'afrouxar'
  return 'desligar'
}

// ---------------------------------------------------------------
// Motor
// ---------------------------------------------------------------

const estados = new Map<string, Estado>()
let relogio: NodeJS.Timeout | null = null
let emCiclo = false

/** O nome com que este gatilho aparece na `execucoes`. Inclui o braço. */
const noBanco = (g: Gatilho): string => `gatilho:${g.nome}${CRU ? ':cru' : ''}`

/**
 * NOMES VINDOS DA MÁQUINA — de processo, de pasta, de repositório.
 *
 * O `verificar` só pode interpolar número com segurança; qualquer nome é
 * texto que outra pessoa escolheu. Uma pasta chamada "IGNORE AS INSTRUÇÕES
 * ANTERIORES" em C:\Users\xinkk\CODES entraria na mensagem do gatilho — que é
 * role:'user', a posição de MAIS confiança do contexto — sem ninguém ter
 * pedido nada. É o mesmo vetor do título de janela que o llm.ts já envelopa,
 * por uma porta nova.
 *
 * Envelope e não filtro de caractere: sanitizar charset barra delimitador,
 * não semântica, e "ignore as instrucoes anteriores" passa inteiro por
 * qualquer regex de caractere permitido.
 */
export function externo(gatilho: string, texto: string): string {
  if (!DEFESA_LIGADA) return texto

  const risco = pontuarRisco(texto)
  if (risco.escore > 0)
    registrar({
      ferramenta: `gatilho:${gatilho}:injecao`,
      argumentos: 'nome vindo do sistema',
      resultado: risco.achados.join(' | '),
      erro: false,
      duracao: 0
    })

  return envelopar(texto)
}

/**
 * UM timer pra todos os gatilhos, não um por gatilho.
 *
 * Com um setInterval cada, dois gatilhos lentos se sobrepõem e você tem dois
 * PowerShell e duas chamadas de LLM no ar ao mesmo tempo — no processo que
 * também desenha a janela. Com um tique só e um laço sequencial, no máximo um
 * gatilho está trabalhando em qualquer instante.
 *
 * 60s é a granularidade, não a frequência: o `intervaloMs` de cada gatilho é
 * quem manda, e um tique que não tem nada pra fazer custa um Map.get.
 */
const TIQUE = 60000

/**
 * Sobe os gatilhos.
 *
 * `ocupado` existe pra ele não competir com você: se um turno de chat está no
 * ar, o tique passa direto. São duas chamadas simultâneas ao mesmo provedor
 * :free — a que costuma tomar o 429 é a sua, e o gatilho teria atrapalhado
 * exatamente a conversa que importa.
 */
export function iniciarGatilhos(
  gatilhos: Gatilho[],
  entregar: (aviso: Aviso) => void,
  ocupado: () => boolean
): void {
  if (relogio) return

  const tique = async (): Promise<void> => {
    // Reentrância: um ciclo que demorou mais que o TIQUE não pode ganhar um
    // segundo ciclo por cima.
    if (emCiclo || ocupado()) return
    emCiclo = true

    // O porquê de cada gatilho não ter feito nada neste ciclo.
    const diario: string[] = []

    /**
     * Lido A CADA CICLO e não uma vez na subida: desligar um gatilho na tela
     * de ajustes precisa calar ele agora, não no próximo boot — e o motivo é
     * a demo da banca, onde o pior momento possível pra um aviso de disco é
     * justamente aquele.
     */
    // O Array.isArray não é paranoia: o valor vem de uma tabela que dá pra
    // editar com um cliente de SQLite, e um `new Set` sobre coisa não
    // iterável LANÇA — dentro do try do ciclo, o que mataria o motor de
    // gatilhos inteiro por causa de uma linha torta de configuração.
    const bruto = ler('gatilhosDesligados')
    const desligados = new Set(Array.isArray(bruto) ? bruto : [])

    try {
      for (const g of gatilhos) {
        if (desligados.has(g.nome)) {
          diario.push(`${g.nome}=desligado`)
          continue
        }

        // Na primeira volta o silêncio vem do banco, não de zero: senão cada
        // reinício do app reabriria a janela de aviso. Ver ultimoAvisoDe().
        const estado = estados.get(g.nome) ?? {
          ultimaChecagem: 0,
          ultimoAviso: ultimoAvisoDe(noBanco(g))
        }
        estados.set(g.nome, estado)

        // Lido POR GATILHO e não uma vez por ciclo: o primeiro gatilho do
        // laço pode ter acabado de gastar as chamadas que sobravam.
        const motivo = decidir(g, estado, Date.now(), usoHoje().restantes)
        if (motivo !== 'checar') {
          diario.push(`${g.nome}=${motivo}`)
          continue
        }

        estado.ultimaChecagem = Date.now()

        const aviso = await disparar(g)
        if (!aviso) {
          diario.push(`${g.nome}=quieto`)
          continue
        }

        estado.ultimoAviso = Date.now()
        diario.push(`${g.nome}=AVISOU`)
        entregar(aviso)
      }
    } catch (erro) {
      /**
       * SEM ESTE CATCH o motor morre calado.
       *
       * `tique` é async e quem chama é um setInterval, que não espera a
       * promise: uma exceção aqui vira unhandled rejection, não aparece em
       * lugar nenhum, e o ciclo seguinte encontra o `emCiclo` restaurado pelo
       * finally e repete o mesmo erro invisível — uma vez por minuto, pra
       * sempre.
       *
       * O `disparar` já tem o try dele, então o que sobra pra cair aqui é o
       * que está FORA dele: o banco, o `entregar`, o próprio `decidir`.
       * Justamente as partes de que ninguém desconfia.
       */
      console.error('[gatilhos] ciclo falhou:', erro)
    } finally {
      emCiclo = false
    }

    /**
     * Uma linha por ciclo, no console do main.
     *
     * Mesma razão da seção de falhas do relatório: "não aconteceu nada" tem
     * causas opostas — nada a avisar, silêncio ainda valendo, cota no fim, ou
     * tudo quebrado — e sem isto as quatro têm exatamente a mesma cara, que é
     * nenhuma. Foi o que custou três rodadas de dois minutos pra diagnosticar.
     */
    if (diario.length) console.log(`[gatilhos] ${diario.join(' ')}`)
  }

  relogio = setInterval(tique, TIQUE)

  /**
   * Uma linha no boot dizendo em que configuração ela subiu.
   *
   * Custou duas rodadas de diagnóstico: eu achava que o braço de controle
   * estava ligado e ele não estava, porque a variável de ambiente não chegou
   * no processo. Configuração que só existe num `process.env` e nunca se
   * anuncia é indistinguível de configuração ausente — e o sintoma foi o
   * silêncio, que é o mesmo sintoma de tudo funcionando.
   */
  console.log(
    `[gatilhos] ${gatilhos.length} ativos · braço ${CRU ? 'CRU (sem modelo)' : 'agente'}` +
      ` · reserva de cota ${RESERVA} · tique ${TIQUE / 1000}s`
  )

  // Um tique imediato deixaria a Izze avisando de disco cheio antes de a
  // janela existir, e ainda disputaria CPU com o boot (spawn da voz, do vigia
  // de foco e o React montando). O primeiro ciclo vem no minuto seguinte.
}

export function pararGatilhos(): void {
  if (relogio) clearInterval(relogio)
  relogio = null
}

/**
 * Verifica e, se for o caso, formula o aviso. Devolve o aviso pronto ou null.
 *
 * Nada aqui lança: um gatilho quebrado (PowerShell fora do PATH, provedor
 * fora do ar) não pode derrubar o timer e levar os outros junto.
 */
export async function disparar(g: Gatilho): Promise<Aviso | null> {
  const inicio = Date.now()
  const nome = noBanco(g)

  const montar = (texto: string, id: number): Aviso => ({
    id,
    texto,
    gatilho: g.nome,
    momento: new Date().toISOString()
  })

  let leitura: Leitura | null = null
  try {
    leitura = await g.verificar()
  } catch (erro) {
    registrar({
      ferramenta: nome,
      argumentos: 'verificar',
      resultado: `Erro: ${(erro as Error).message}`,
      erro: true,
      duracao: Date.now() - inicio
    })
    return null
  }

  if (!leitura) return null

  // Braço de controle: o alerta de limiar, sem uma chamada de API.
  if (CRU) {
    const id = registrar({
      ferramenta: nome,
      argumentos: leitura.modelo,
      resultado: leitura.cru,
      erro: false,
      duracao: Date.now() - inicio
    })
    return montar(leitura.cru, id)
  }

  try {
    const resposta = await conversar([{ role: 'user', content: leitura.modelo }], {
      origem: 'gatilho',
      ferramentas: FERRAMENTAS_DO_GATILHO,
      maxVoltas: VOLTAS,

      // O texto final volta do conversar(); não há UI escutando o stream.
      aoReceberTexto: () => {},
      aoUsarFerramenta: () => {},

      // Um gráfico sem janela aberta pra desenhar não vai a lugar nenhum — e
      // as ferramentas que geram visual estão fora do catálogo do gatilho.
      aoGerarVisual: () => {},

      // Vale registrar mesmo sem tela: é a evidência de que uma injeção
      // plantada num nome de arquivo chegou até um caminho automático.
      aoDetectarInjecao: (ferramenta, achados) =>
        registrar({
          ferramenta: `${nome}:injecao`,
          argumentos: ferramenta,
          resultado: achados.join(' | '),
          erro: false,
          duracao: 0
        }),

      // A trava. Ver o cabeçalho do arquivo.
      aoPedirAprovacao: async () => false
    })

    const texto = resposta.trim()

    /**
     * O registro é o que torna o gatilho MEDÍVEL: `duracao` é o tempo entre a
     * condição virar verdadeira e o aviso ficar pronto, que é o número que
     * separa "ela avisou" de "ela avisou a tempo".
     *
     *   SELECT ferramenta, COUNT(*), AVG(duracao_ms)
     *   FROM execucoes WHERE ferramenta LIKE 'gatilho:%' GROUP BY ferramenta;
     */
    const id = registrar({
      ferramenta: nome,
      argumentos: leitura.modelo,
      resultado: texto || '(sem resposta do modelo)',
      erro: !texto,
      duracao: Date.now() - inicio
    })

    return texto ? montar(texto, id) : null
  } catch (erro) {
    registrar({
      ferramenta: nome,
      argumentos: leitura.modelo,
      resultado: `Erro: ${(erro as Error).message}`,
      erro: true,
      duracao: Date.now() - inicio
    })
    return null
  }
}

// ---------------------------------------------------------------
// Os gatilhos
// ---------------------------------------------------------------

/**
 * Os limiares, num lugar só — é o que se mexe quando um gatilho sai como
 * 'afrouxar' no relatório de precisão.
 */

/** Abaixo disto o disco C deixa de ser informação e vira problema. */
const DISCO_GB = 15

/**
 * Acima disto a máquina começa a paginar e tudo fica lento. 88 e não 95: o
 * aviso serve pra você fechar alguma coisa ANTES de travar, e a 95% você já
 * percebeu sozinho — aviso que chega junto com o sintoma não informa nada.
 */
const MEMORIA_PCT = 88

/** Horas seguidas de teclado antes de sugerir uma pausa. */
const SESSAO_H = 3

/** Parado mais que isto (segundos) conta como pausa e reinicia a sessão. */
const PAUSA_S = 600

/** Dias sem commit, com arquivo solto, antes de virar aviso. */
const GIT_DIAS = 7

/**
 * Onde ficam os repositórios. `IZZE_REPOS` sobrepõe.
 *
 * O padrão é um chute na organização da máquina, e é o tipo de coisa que
 * falha CALADO: apontando pra pasta errada, o Get-ChildItem devolve vazio, o
 * gatilho nunca dispara e parece que não há nada a avisar.
 *
 * Função e não const: `app.getPath` exige o app pronto, e este módulo é
 * importado pelo index.ts antes do whenReady. A mesma armadilha que o
 * `pastasReais()` do llm.ts já contorna.
 */
const raizRepos = (): string => process.env.IZZE_REPOS ?? join(app.getPath('home'), 'CODES')

/** Começo da rajada de atividade atual. Ver o gatilho 'sessao'. */
let inicioAtividade = Date.now()

/** null = ainda não se sabe. Ver o gatilho 'bateria'. */
let temBateria: boolean | null = null

export const GATILHOS: Gatilho[] = [
  {
    nome: 'disco',
    intervaloMs: 30 * 60000,
    // 12h: disco enchendo é problema de dias, não de minutos. Repetir de hora
    // em hora é como se aprende a ignorar o aviso.
    silencioMs: 12 * 3600000,
    async verificar() {
      /**
       * BYTES, e a divisão feita aqui. Não é preciosismo: o PowerShell
       * formata número na cultura do Windows, e neste PC (pt-BR)
       * `[math]::Round(.../1GB, 1)` imprime "306,3" — com vírgula. O
       * `Number()` disso dá NaN, o `isFinite` abaixo devolve null, e o
       * gatilho fica morto e CALADO para sempre. Um inteiro grande não tem
       * separador em cultura nenhuma.
       *
       * Vale pra qualquer gatilho novo: traga inteiro do PowerShell, faça a
       * conta em JS.
       */
      const { stdout } = await rodarPS('(Get-PSDrive C).Free', { timeout: 10000 })

      // Number() e não o texto cru: é o que garante que nada além de dígito
      // chegue na mensagem que vai pro prompt.
      const bytes = Number(stdout.trim())
      if (!Number.isFinite(bytes)) return null

      const livre = Math.round(bytes / 1073741824)
      if (livre > DISCO_GB) return null

      return {
        /**
         * Pede o que o braço cru NÃO consegue: onde está o peso. O número já
         * está na pergunta, então repeti-lo é a resposta inútil — e é
         * exatamente a resposta que empataria o experimento.
         */
        modelo: `O disco C está com ${livre} GB livres, abaixo do limite de ${DISCO_GB} GB. Investigue as pastas do usuário e diga em no máximo duas frases ONDE está o peso e o que dá pra liberar sem risco. Não repita o número que já está aqui e não liste arquivo por arquivo.`,
        cru: `Disco C com ${livre} GB livres (limite: ${DISCO_GB} GB).`
      }
    }
  },

  {
    nome: 'bateria',
    intervaloMs: 5 * 60000,
    silencioMs: 30 * 60000,
    async verificar() {
      // Desktop não ganha bateria no meio do expediente. Sem esta linha o
      // gatilho spawna um PowerShell a cada 5 minutos, pra sempre, pra
      // reconfirmar que a máquina não tem bateria — 288 processos por dia
      // pra chegar sempre na mesma resposta.
      if (temBateria === false) return null

      /**
       * Carga e status na mesma leitura. BatteryStatus 1 = descarregando,
       * 2 = na tomada. Avisar de 15% com o cabo plugado é o tipo de aviso
       * errado que ensina a ignorar os certos.
       *
       * Em desktop o Win32_Battery não devolve nada e o stdout vem vazio.
       */
      const { stdout } = await rodarPS(
        `$b = Get-CimInstance Win32_Battery -EA SilentlyContinue | Select-Object -First 1
         if ($b) { "$($b.EstimatedChargeRemaining) $($b.BatteryStatus)" }`,
        { timeout: 10000 }
      )

      const [carga, status] = stdout.trim().split(/\s+/).map(Number)
      temBateria = Number.isFinite(carga)

      if (!temBateria || status !== 1 || carga > 20) return null

      return {
        // Aqui os dois braços dizem quase a mesma coisa, e está certo: não há
        // o que investigar sobre uma bateria. É o caso de controle do próprio
        // experimento — se este empatar e o `disco` não, a diferença veio da
        // investigação e não da prosa.
        modelo: `A bateria está em ${carga}% e o notebook está fora da tomada. Avise o usuário em uma frase curta.`,
        cru: `Bateria em ${carga}%, fora da tomada.`
      }
    }
  },

  {
    nome: 'memoria',
    intervaloMs: 10 * 60000,
    /**
     * 4h e não 2h por conta de cota, que é o recurso escasso aqui: a 2h isto
     * podia disparar 12 vezes num dia, e 12 avisos × ~2,5 chamadas comem 30
     * das 45 do dia inteiro. A RESERVA impediria a Izze de emudecer, mas o
     * gatilho teria gastado dois terços da cota pra dizer que o Chrome está
     * pesado — coisa que ninguém precisa ouvir seis vezes.
     */
    silencioMs: 4 * 3600000,
    async verificar() {
      /**
       * TAB entre os campos porque o último é um nome de processo, e nome de
       * processo tem espaço ("Memory Compression"). Com split por espaço, o
       * nome viraria dois campos e o parse silenciosamente pegaria metade.
       *
       * Os pseudo-processos do Windows saem fora: 'Memory Compression' é
       * quase sempre o maior WS da máquina, e apontar pra ele como culpado é
       * um aviso tecnicamente correto e inútil — não há o que fechar.
       */
      const { stdout } = await rodarPS(
        `$os = Get-CimInstance Win32_OperatingSystem
         $p = Get-Process |
              Where-Object { $_.Name -notin 'Memory Compression','Idle','System','Registry' } |
              Sort-Object WS -Descending | Select-Object -First 1
         "$($os.TotalVisibleMemorySize)\t$($os.FreePhysicalMemory)\t$([math]::Floor($p.WS/1MB))\t$($p.Name)"`,
        { timeout: 15000 }
      )

      const [totalKb, livreKb, mb, processo] = stdout.trim().split('\t')
      const total = Number(totalKb)
      const livre = Number(livreKb)
      if (!Number.isFinite(total) || !Number.isFinite(livre) || total === 0) return null

      const uso = Math.round(((total - livre) / total) * 100)
      if (uso < MEMORIA_PCT) return null

      const nome = processo ?? '?'
      const livreGb = Math.round(livre / 1048576)

      return {
        /**
         * O MELHOR diferencial do conjunto: a Izze recebe a janela em foco no
         * system prompt a cada turno, então ela sabe o que você está fazendo
         * AGORA. "O Chrome está com 3 GB" é dado; "o Chrome está com 3 GB e
         * você está no Figma há duas horas" é a informação que muda a decisão.
         * Nenhum script de limiar tem como chegar nisso.
         *
         * O nome do processo vai envelopado — é a única parte desta frase que
         * não é número, e nome de processo é texto de terceiro.
         */
        modelo: `A memória RAM está em ${uso}% de uso, com ${livreGb} GB livres. O processo que mais consome usa ${mb} MB e se chama: ${externo('memoria', nome)}. Você sabe em que janela o usuário está agora — diga em uma frase se esse consumo faz sentido pro que ele está fazendo ou se é coisa esquecida aberta.`,
        cru: `RAM em ${uso}% — ${nome} usando ${mb} MB.`
      }
    }
  },

  {
    nome: 'sessao',
    intervaloMs: 10 * 60000,
    // 90min: depois de avisar, ela só volta ao assunto se você continuar
    // emendando. Um lembrete de pausa que repete de hora em hora é a coisa
    // mais fácil do mundo de aprender a ignorar.
    silencioMs: 90 * 60000,
    async verificar() {
      /**
       * Tempo desde o último toque em teclado ou mouse, via user32. É a única
       * medida de "você está aí" que não depende de adivinhar pelo processo
       * em foco — um vídeo rodando mantém a janela ativa e você saiu.
       *
       * O Add-Type recompila o C# a cada spawn (~400ms). A cada 10 minutos
       * isso é irrelevante, e evita mais um processo persistente vivo.
       */
      const { stdout } = await rodarPS(
        `Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public class Ocio{[DllImport("user32.dll")]static extern bool GetLastInputInfo(ref LII p);struct LII{public uint cb;public uint t;}public static uint Seg(){LII l=new LII();l.cb=(uint)Marshal.SizeOf(l);GetLastInputInfo(ref l);return ((uint)Environment.TickCount-l.t)/1000;}}' -EA SilentlyContinue
         [Ocio]::Seg()`,
        { timeout: 15000 }
      )

      const ocioso = Number(stdout.trim())
      if (!Number.isFinite(ocioso)) return null

      // Parou tempo o bastante: a sessão recomeça daqui.
      if (ocioso > PAUSA_S) {
        inicioAtividade = Date.now()
        return null
      }

      const horas = (Date.now() - inicioAtividade) / 3600000
      if (horas < SESSAO_H) return null

      // Zera na hora de avisar, e não só pelo silêncio: sem isto, 90 minutos
      // depois o contador ainda marcaria 4h30 e ela avisaria de novo na
      // primeira chance. A pausa que interessa é a que começa agora.
      inicioAtividade = Date.now()

      return {
        modelo: `O usuário está trabalhando há ${horas.toFixed(1)} horas seguidas sem uma pausa de mais de ${Math.round(PAUSA_S / 60)} minutos. Você sabe em que janela ele está. Sugira uma pausa em uma frase curta e direta, sem sermão e sem conselho de saúde.`,
        cru: `${horas.toFixed(1)}h seguidas sem pausa.`
      }
    }
  },

  {
    nome: 'git',
    intervaloMs: 60 * 60000,
    silencioMs: 24 * 3600000,
    async verificar() {
      /**
       * Trabalho não commitado num repositório PARADO. As duas condições
       * juntas é que fazem o aviso valer: 30 arquivos modificados num repo em
       * que você commitou hoje é só terça-feira. Os mesmos 30 num repo sem
       * commit há dois meses é trabalho que existe em um disco só.
       *
       * `-Directory` num nível só, sem -Recurse: varrer node_modules atrás de
       * .git levaria minutos e acharia dependência, não projeto seu.
       */
      const { stdout } = await rodarPS(
        `Get-ChildItem -LiteralPath '${raizRepos().replace(/'/g, "''")}' -Directory -EA SilentlyContinue |
           Where-Object { Test-Path (Join-Path $_.FullName '.git') } |
           ForEach-Object {
             $sujo = (git -C $_.FullName status --porcelain 2>$null | Measure-Object -Line).Lines
             $ts = git -C $_.FullName log -1 --format=%ct 2>$null
             "$($_.Name)\t$sujo\t$ts"
           }`,
        { timeout: 60000 }
      )

      const agora = Date.now() / 1000
      const parados = stdout
        .split('\n')
        .map((l) => l.trim().split('\t'))
        .filter(([nome, sujo, ts]) => {
          const dias = (agora - Number(ts)) / 86400
          return nome && Number(sujo) > 0 && Number.isFinite(dias) && dias > GIT_DIAS
        })
        .map(([nome, sujo, ts]) => ({
          nome,
          sujo: Number(sujo),
          dias: Math.round((agora - Number(ts)) / 86400)
        }))
        // Mais arquivos soltos primeiro: é o que tem mais a perder.
        .sort((a, b) => b.sujo - a.sujo)
        .slice(0, 3)

      if (!parados.length) return null

      const lista = parados.map((r) => `${r.nome} (${r.sujo} arquivos, ${r.dias} dias)`).join(', ')

      return {
        /**
         * "Cite os nomes e quantos arquivos" era literalmente o texto cru com
         * outra pontuação — o braço com modelo custava uma chamada de API pra
         * entregar a mesma informação mais bonita, e o experimento mediria
         * prosa. Pedir QUAL corre mais risco obriga a uma comparação que o
         * limiar não faz: 82 arquivos parados há 76 dias e 3 parados há 116
         * não correm o mesmo risco, e escolher entre os dois é julgamento.
         */
        modelo: `Estes repositórios têm trabalho não commitado e nenhum commit há mais de ${GIT_DIAS} dias: ${externo('git', lista)}. Em uma frase, diga qual deles corre MAIS risco e por quê. Não repita a lista inteira.`,
        cru: `${parados.length} repositório(s) parados com trabalho solto: ${lista}.`
      }
    }
  }
]

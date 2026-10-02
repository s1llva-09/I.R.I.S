import { safeStorage } from 'electron'
import { gravarConfig, lerConfig, lerTudoConfig } from './banco'

/**
 * CONFIGURAÇÃO EM RUNTIME (I.1).
 *
 * O que isto destrava: rodar a Íris em outra máquina sem editar arquivo e
 * rebuildar. As `import.meta.env.MAIN_VITE_*` são resolvidas em tempo de
 * BUILD — a chave fica ASSADA no bundle. Instalar no PC da apresentação
 * significava clonar o repo, escrever um .env e compilar lá, o que não é
 * instalar, é montar.
 *
 * O .env não sumiu: virou o PADRÃO de quem clona e roda `npm run dev`. Quem
 * nunca abriu a tela de configurações continua com o comportamento de antes.
 *
 * O armazenamento é o `configuracoes` do banco.ts — ver o comentário de lá
 * sobre por que não é um electron-store.
 */
type Config = {
  llmChave: string
  llmModelo: string
  llmModeloVisao: string
  llmReservas: string[]
  tavilyChave: string
  atalho: string
  tetoDiario: number
  limiarRisco: number
  vozAtiva: boolean
  /** Sensor de presença por câmera (2.6). Opt-in. */
  cameraAtiva: boolean
  miniaturasSeguranca: boolean
  /** Qual câmera usar. Vazio = a padrão do sistema. */
  cameraId: string
  /** Distância máxima entre descritores pra ser a mesma pessoa (2.6). */
  limiarFacial: number
  /** Apresentar só o que é segurança, e abrir direto nela. */
  modoSeguranca: boolean
  vozRitmo: number
  gatilhosDesligados: string[]
}

/**
 * Os padrões de hoje, lidos do .env quando ele existe.
 *
 * Repetem os valores que estavam espalhados como constante em llm.ts,
 * risco.ts e banco.ts. Cada um daqueles pontos passou a ler daqui, então
 * mudar um número no .env continua funcionando e mudar na tela também.
 */
const PADRAO: Config = {
  llmChave: import.meta.env.MAIN_VITE_LLM_KEY ?? '',
  llmModelo: import.meta.env.MAIN_VITE_LLM_MODELO ?? 'nvidia/nemotron-3-super-120b-a12b:free',
  /**
   * O modelo usado SÓ no turno em que há um print no contexto.
   *
   * Existe porque o padrão não enxerga: o nemotron não tem Vision, e modelo
   * sem visão recebe a imagem e responde como se ela não estivesse lá —
   * descreve a tela de cabeça, com a mesma confiança de sempre. É a falha
   * mais cara que o ver_tela pode ter, porque parece resposta.
   */
  llmModeloVisao: 'google/gemma-4-31b-it:free',
  llmReservas: ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free'],
  // Lê do .env igual à chave do LLM: sem isto, colar a chave no .env não
  // fazia nada e a única entrada era o campo em Ajustes.
  tavilyChave: import.meta.env.MAIN_VITE_TAVILY_KEY ?? '',
  atalho: 'Control+Space',
  tetoDiario: Number(import.meta.env.MAIN_VITE_TETO_DIARIO ?? 45),
  limiarRisco: 3,
  vozAtiva: true,

  /**
   * DESLIGADA por padrão, e isto é a decisão de LGPD antes de ser
   * preferência: câmera que liga sozinha na instalação é o oposto de
   * consentimento. Quem quiser o sinal de presença liga em Ajustes, sabendo
   * o que ligou.
   */
  cameraAtiva: false,
  miniaturasSeguranca: false,

  /**
   * Máquina com uma webcam só nunca precisa disto. Duas — a do notebook e um
   * celular como câmera — e a escolha do sistema é aleatória do ponto de
   * vista de quem está usando.
   */
  cameraId: '',

  /**
   * 0,6 é o padrão do face-api, herdado do FaceNet — e é onde a bancada de
   * reconhecimento começa, não onde ela termina. Medir com as SUAS fotos,
   * na SUA luz, é o que transforma este número de chute em escolha; a tela
   * de segurança tem o botão que faz isso.
   */
  limiarFacial: 0.6,

  /**
   * MODO SEGURANÇA — o recorte que o TCC apresenta.
   *
   * Não é um modo "reduzido" por capricho: a tela de abertura listava as 25
   * ferramentas, e 18 delas são conveniência do dia a dia. Numa defesa isso
   * não é riqueza, é ruído — a banca lê "assistente pessoal com uma câmera
   * pregada do lado" em vez do argumento, que é a camada de decisão
   * auditável com presença física como sinal.
   *
   * Desligado por padrão porque o uso normal dele é o dia a dia. Liga por
   * fala ("modo segurança"), e é reversível na mesma frase.
   */
  modoSeguranca: false,

  /**
   * Rate do SAPI: inteiro de -10 a 10, onde 0 é a velocidade natural da voz.
   *
   * NÃO é multiplicador. O valor "1.05" que parece natural pra quem pensa em
   * playbackRate aqui significa "1", arredondado — e o campo pareceria não
   * fazer nada. 1 é o que já estava assado no script da voz.
   */
  vozRitmo: 1,

  /**
   * Os DESLIGADOS, e não os ligados.
   *
   * Guardar a lista de ativos faria todo gatilho NOVO nascer desligado — a
   * lista gravada não teria o nome dele, e ele ficaria calado pra sempre sem
   * ninguém entender por quê. Guardando quem foi desligado à mão, gatilho
   * novo nasce funcionando e a lista continua curta.
   */
  gatilhosDesligados: []
}

/**
 * As que nunca podem aparecer em texto puro.
 *
 * O `safeStorage` do Electron usa o DPAPI do Windows, que amarra a
 * criptografia à CONTA do usuário do SO. A consequência prática, e ela
 * importa na hora de instalar no PC da apresentação: copiar o banco pra
 * outra máquina NÃO leva a chave junto — ela não decifra, e o `decifrar`
 * devolve vazio, que faz a tela de primeira execução abrir sozinha. É o
 * comportamento certo, mas é surpresa se ninguém avisou.
 */
const SECRETAS = new Set<keyof Config>(['llmChave', 'tavilyChave'])

function cifrar(valor: string): string {
  if (!valor || !disponivel()) return valor
  return safeStorage.encryptString(valor).toString('base64')
}

function decifrar(valor: string): string {
  if (!valor || !disponivel()) return valor
  try {
    return safeStorage.decryptString(Buffer.from(valor, 'base64'))
  } catch {
    // Cifrado por outra conta do Windows, ou gravado antes do safeStorage
    // estar disponível. Vazio faz a tela de configurações abrir sozinha, que
    // é melhor que devolver lixo e falhar com "401 invalid api key".
    return ''
  }
}

/**
 * No Linux o safeStorage exige o app pronto e pode simplesmente não existir
 * (sem keyring instalado). O try/catch cobre isso sem espalhar `if
 * (process.platform)` pelo arquivo — quando não dá, o valor vai cru, que é o
 * que acontecia antes desta feature existir.
 */
function disponivel(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function ler<K extends keyof Config>(chave: K): Config[K] {
  const bruto = lerConfig(chave)
  if (bruto === undefined || bruto === null) return PADRAO[chave]

  if (SECRETAS.has(chave)) {
    const claro = decifrar(String(bruto))
    // Config gravada e vazia CAI PRO PADRÃO de propósito: é o que faz o .env
    // continuar servindo quem apagou a chave da tela sem querer.
    return (claro || PADRAO[chave]) as Config[K]
  }
  return bruto as Config[K]
}

export function gravar<K extends keyof Config>(chave: K, valor: Config[K]): void {
  gravarConfig(chave, SECRETAS.has(chave) ? cifrar(String(valor)) : valor)
}

/**
 * O que a tela desenha. As secretas vão MASCARADAS.
 *
 * Os 4 últimos dígitos ficam visíveis porque a pergunta que o usuário faz
 * olhando essa tela é "é a chave certa ou a antiga?", e um campo de bolinhas
 * sem nenhum resto não responde isso — obriga a colar de novo pra ter
 * certeza, toda vez.
 */
export function lerTudo(): Record<string, unknown> {
  const gravado = lerTudoConfig()
  const tudo: Record<string, unknown> = { ...PADRAO, ...gravado }
  delete tudo.chavesPush
  delete tudo.celularesPush
  delete tudo.acessoCelular

  for (const k of SECRETAS) {
    const real = ler(k) as string
    tudo[k] = real ? `••••••••${real.slice(-4)}` : ''
  }
  return tudo
}

/** Sem chave não há Íris: é o gancho que abre a tela sozinha no primeiro boot. */
export function primeiraExecucao(): boolean {
  return !ler('llmChave')
}

/**
 * O lado do main da presença (2.6). Só guarda a última leitura da câmera —
 * quem detecta é o renderer, que é onde existe `getUserMedia`.
 *
 * Estado deliberadamente burro: um número e um relógio. Toda a decisão mora
 * no `risco.ts`, que é onde está a contribuição.
 */

export type Presenca =
  | 'presente'
  | 'ausente'
  | 'acompanhado'
  /** Tem gente na frente e pelo menos uma não está no cadastro. */
  | 'nao_autorizado'
  | 'desconhecida'

export type Leitura = { rostos: number; desconhecidos: number; conhecidos: string[] }

/**
 * Depois disto a leitura não vale mais.
 *
 * O renderer reporta a cada 1,5s. Se parou de reportar, a janela morreu, a
 * câmera foi desligada ou a aba travou — e nenhum desses casos autoriza
 * afirmar que a sala está vazia. Vence 'desconhecida', não 'ausente'.
 */
const VALIDADE = 8000

let atual: Leitura = { rostos: -1, desconhecidos: 0, conhecidos: [] }
let quando = 0

/**
 * A leitura veio de uma câmera que olha pra quem está NO PC?
 *
 * O visor também lê câmera de rede — a ESP32-CAM da porta, um celular. Essa
 * leitura vale pro alarme e pra vigilância, mas não diz nada sobre a cadeira:
 * porta vazia virava 'ausente' (+2 em todo comando, com você sentado) e um
 * entregador virava 'nao_autorizado' (+3, travando o PC). A camada de risco
 * só aceita a webcam local e a foto de teste da bancada.
 */
let deFrente = true

export function reportarPresenca(l: Leitura, frente = true): void {
  atual = l
  deFrente = frente
  quando = Date.now()
}

/** Se a leitura atual pode falar por quem está no PC. Câmera de rede não pode. */
export function leituraDoPc(): boolean {
  return deFrente
}

/** A leitura crua, pra vigilância. A camada de risco usa `presencaAtual`. */
export function leituraAtual(): Leitura {
  return Date.now() - quando > VALIDADE ? { rostos: -1, desconhecidos: 0, conhecidos: [] } : atual
}

export function presencaAtual(): Presenca {
  const l = leituraAtual()
  // Câmera da porta: o mesmo 'desconhecida' de quem não tem câmera — não escala nada.
  if (l.rostos < 0 || !deFrente) return 'desconhecida'
  if (l.rostos === 0) return 'ausente'

  /**
   * Desconhecido VENCE os outros estados, mesmo com você na frente.
   *
   * O caso que isto pega não é o ladrão de filme — é o mundano: você
   * autenticado, a sessão aberta, e alguém que não devia estar ali lendo a
   * tela junto. 'acompanhado' já cobria "tem plateia"; isto distingue a
   * plateia que passou no cadastro da que não passou.
   */
  if (l.desconhecidos > 0) return 'nao_autorizado'
  return l.rostos === 1 ? 'presente' : 'acompanhado'
}

/** Desliga o sensor sem esperar o timeout — usado quando a config vira off. */
export function esquecerPresenca(): void {
  atual = { rostos: -1, desconhecidos: 0, conhecidos: [] }
  quando = 0
}

// ---------------------------------------------------------------
// Pedidos ao renderer (cadastro por voz)
// ---------------------------------------------------------------

/**
 * O descritor só existe no renderer — é lá que roda a câmera. Mas o pedido
 * nasce no main, porque quem pede é uma FERRAMENTA ("cadastra meu rosto como
 * Pablo"), e ferramenta roda no main.
 *
 * O canal fica AQUI e não no index.ts pra não fechar um ciclo de import: o
 * ferramentas.ts precisa chamar isto, e o index.ts já importa o
 * ferramentas.ts. O index registra o transporte no boot; este módulo só
 * sabe que existe um.
 */
type Transporte = {
  /** Pede um descritor à janela. Devolve o vetor ou o motivo de não dar. */
  capturarRosto: () => Promise<number[] | string>
  /** Manda a janela abrir o painel de segurança, e aparecer se estiver na bandeja. */
  abrirSeguranca: () => void
  /** Modo porta: o rosto em tela cheia com a câmera embaixo. */
  abrirPorta: () => void
  /** A config da câmera mudou: o laço no renderer precisa ligar ou parar. */
  cameraMudou: (ligada: boolean) => void
  /** O cadastro mudou: o comparador no renderer está com a lista velha. */
  galeriaMudou: () => void
}

let transporte: Transporte | null = null

export function registrarTransporte(t: Transporte): void {
  transporte = t
}

export async function pedirDescritor(): Promise<number[] | string> {
  // Sem janela não há câmera: a mensagem precisa dizer isso, senão o modelo
  // responde "cadastrei" pra um cadastro que não aconteceu.
  if (!transporte) return 'a janela da Íris não está aberta — não há câmera rodando'
  return transporte.capturarRosto()
}

export function avisarCameraMudou(ligada: boolean): void {
  if (!ligada) esquecerPresenca()
  transporte?.cameraMudou(ligada)
}

export function abrirModoPorta(): boolean {
  if (!transporte) return false
  transporte.abrirPorta()
  return true
}

export function avisarGaleriaMudou(): void {
  transporte?.galeriaMudou()
}

export function abrirPainelSeguranca(): boolean {
  if (!transporte) return false
  transporte.abrirSeguranca()
  return true
}

import * as faceapi from '@vladmandic/face-api'
import { classificar, esperadoDe } from '../../reconhecimento'

/**
 * PRESENÇA E RECONHECIMENTO (2.6).
 *
 * Duas leituras do mesmo frame:
 *
 *   1. QUANTAS pessoas estão ali  → sinal de contexto pra camada de risco
 *   2. Alguma delas NÃO está no cadastro → sinal de vigilância
 *
 * A regra que separa isto de uma câmera de vigilância comum, e que é a
 * resposta pronta pra banca:
 *
 *   **Cadastra-se quem autorizou. Nunca se guarda quem não autorizou.**
 *
 * Quem foi cadastrado tem um vetor biométrico de 128 floats no banco,
 * que continua sendo dado sensível e precisa de proteção. Quem
 * NÃO está no cadastro é contado como "desconhecido" e o descritor dele
 * morre em memória no mesmo tique: nenhum frame, nenhum vetor, nenhum nome.
 * A comparação é local e não cadastra automaticamente novos rostos.
 * Minimizar o armazenamento não substitui avaliar consentimento, finalidade
 * e as demais obrigações de privacidade de cada instalação.
 *
 * Tudo local: os pesos são servidos de dentro do app, o TensorFlow.js roda
 * na GPU da máquina, e nenhum byte de imagem sai daqui.
 */

/** Cadência. 1,5s é abaixo do tempo de uma pessoa entrar num enquadramento. */
const TIQUE = 1500
const VALIDADE_QUADRO = 6000
const LIMITE_FOTO = 25 * 1024 * 1024
const LIMITE_FOTO_CELULAR = 3 * 1024 * 1024
const TEMPO_CARGA_FOTO = 15_000

/**
 * Distância euclidiana máxima entre descritores pra considerar a mesma
 * pessoa. 0,6 é o valor de referência do FaceNet e o padrão do face-api.
 *
 * Deixou de ser fixo: vem da config e tem slider no painel de segurança.
 * Mexer nele é escolher entre alarme falso e alarme perdido — por isso o
 * slider fica ao lado da tabela da medição, e não solto em Ajustes. Um
 * número que se afrouxa até parar de incomodar não é uma configuração, é
 * uma proteção sendo desligada devagar.
 */
let LIMITE_MATCH = 0.6

/** Trocado pela config em runtime — ver a bancada de reconhecimento. */
export function definirLimiar(v: number): void {
  if (Number.isFinite(v) && v > 0 && v < 2) LIMITE_MATCH = v
}

export type Leitura = {
  /** Quantos rostos no frame. -1 = sem câmera. */
  rostos: number
  /** Quantos deles não casaram com ninguém do cadastro. */
  desconhecidos: number
  /** Nomes reconhecidos, pra vigilância saber quem entrou. */
  conhecidos: string[]
}

let stream: MediaStream | null = null
let video: HTMLVideoElement | null = null
let relogio: number | null = null
let carregado = false
let carregamento: Promise<void> | null = null
let modelos: EstadoSensor['modelos'] = 'nao-carregado'
let ativo = false
let geracao = 0
let versaoFonte = 0
let ultimoQuadroCamera: number | null = null
let ultimoQuadroRede: number | null = null
let ultimaAnaliseEm: number | null = null
let duracaoAnaliseMs: number | null = null
let emAnalise = false
let ultimoErro: string | null = null
let publicar: ((l: Leitura) => void) | null = null
let redeSelecionada = false
let quadro: HTMLImageElement | null = null
let versaoQuadro = 0
let versaoFoto = 0
let fotoNome: string | null = null
let fotoDoCelular = false
let cancelarCargaFoto: (() => void) | null = null

export type EstadoSensor = {
  ativo: boolean
  fonte: 'camera' | 'rede' | 'teste' | 'nenhuma'
  fotoNome: string | null
  sinal: boolean
  modelos: 'nao-carregado' | 'carregando' | 'pronto' | 'erro'
  ultimoQuadroEm: number | null
  ultimaAnaliseEm: number | null
  duracaoAnaliseMs: number | null
  emAnalise: boolean
  erro: string | null
  largura: number
  altura: number
}

function semLeitura(): Leitura {
  return { rostos: -1, desconhecidos: 0, conhecidos: [] }
}

function invalidarLeitura(): void {
  caixas = []
  ultimaAnaliseEm = null
  duracaoAnaliseMs = null
  publicar?.(semLeitura())
}

/**
 * FONTE DE TESTE — uma imagem no lugar da câmera.
 *
 * Existe por dois motivos e o segundo é o que importa pro TCC:
 *
 *   1. Máquina sem webcam. Um iPhone vira webcam no Windows por app de
 *      terceiro, mas até isso estar de pé nada da 2.6 é demonstrável.
 *   2. MEDIÇÃO. Acenar pra webcam não é experimento: cada rodada tem luz,
 *      ângulo e distância diferentes, e o número muda sem o código mudar.
 *      Um conjunto fixo de fotos dá a MESMA resposta toda vez — que é a
 *      diferença entre "funciona" e um resultado reproduzível por outra
 *      pessoa, do mesmo jeito que a bancada (II.1) fez pelas ferramentas.
 *
 * Quando está definida, ela SUBSTITUI a câmera: o laço, o reconhecimento, o
 * alarme e a escalada de risco correm pelo mesmo caminho de sempre. Nada
 * aqui é um atalho que só o teste percorre.
 */
let fonteTeste: HTMLImageElement | null = null

/** O que está sendo lido agora: a foto de teste, se houver, senão a câmera. */
function alvo(): HTMLImageElement | HTMLVideoElement | null {
  if (!ativo) return null
  if (fonteTeste) return fonteTeste
  if (redeSelecionada) {
    return quadro && ultimoQuadroRede !== null && Date.now() - ultimoQuadroRede < VALIDADE_QUADRO
      ? quadro
      : null
  }
  const track = stream?.getVideoTracks()[0]
  return video &&
    video.readyState >= 2 &&
    track?.readyState === 'live' &&
    !track.muted &&
    ultimoQuadroCamera !== null &&
    Date.now() - ultimoQuadroCamera < VALIDADE_QUADRO
    ? video
    : null
}

/** Telemetria local: ausência de quadros nunca é apresentada como vídeo ao vivo. */
export function estadoSensor(): EstadoSensor {
  const fonte = fonteTeste ? 'teste' : redeSelecionada ? 'rede' : video ? 'camera' : 'nenhuma'
  const atual = alvo()
  const dimensoes = tamanhoFonte()
  return {
    ativo,
    fonte,
    fotoNome,
    sinal: atual !== null,
    modelos,
    ultimoQuadroEm:
      fonte === 'rede' ? ultimoQuadroRede : fonte === 'camera' ? ultimoQuadroCamera : null,
    ultimaAnaliseEm,
    duracaoAnaliseMs,
    emAnalise,
    erro: ultimoErro,
    largura: dimensoes.w,
    altura: dimensoes.h
  }
}

/**
 * Onde cada rosto está no frame, e de quem é — o que o preview desenha.
 *
 * É a MESMA leitura que alimenta o alarme e a camada de risco, não uma
 * segunda passada só pra tela: duas detecções independentes divergiriam, e
 * um retângulo verde em cima de alguém que o sistema classificou como
 * desconhecido é pior que não ter retângulo nenhum.
 */
export type Caixa = { x: number; y: number; w: number; h: number; nome: string | null }

let caixas: Caixa[] = []

export function ultimasCaixas(): Caixa[] {
  return alvo() ? caixas : []
}

/**
 * A fonte viva, pro canvas desenhar. Devolve o elemento, não o frame — o
 * preview REDESENHA o que está chegando agora, então continua verdade que
 * nada é gravado: não existe buffer, só a última pintura na tela.
 */
export function fonteAtual(): HTMLImageElement | HTMLVideoElement | null {
  return alvo()
}

/** Tamanho intrínseco da fonte, pra escalar as caixas no canvas. */
export function tamanhoFonte(): { w: number; h: number } {
  const f = alvo()
  if (!f) return { w: 0, h: 0 }
  return f instanceof HTMLVideoElement
    ? { w: f.videoWidth, h: f.videoHeight }
    : { w: f.naturalWidth, h: f.naturalHeight }
}

/** O cadastro, em memória. Vem do main e é recarregado a cada ligação. */
let galeria: faceapi.LabeledFaceDescriptors[] = []

async function carregarModelos(): Promise<void> {
  if (carregado) return
  // Modelos empacotados no app. Selecionar o backend evita o WASM padrão,
  // que exige binários externos não distribuídos com esta aplicação.
  if (!carregamento) {
    modelos = 'carregando'
    carregamento = (async () => {
      try {
        // A versão empacotada expõe estas funções (também usadas no demo
        // oficial da biblioteca), mas omite ambas da declaração de tipos.
        const motor = faceapi.tf as typeof faceapi.tf & {
          setBackend: (nome: string) => Promise<boolean>
          ready: () => Promise<void>
        }
        let gpu = false
        try {
          gpu = await motor.setBackend('webgl')
        } catch {
          // Máquinas sem aceleração gráfica continuam com a análise local.
        }
        if (!gpu) await motor.setBackend('cpu')
        await motor.ready()
        await faceapi.nets.tinyFaceDetector.loadFromUri('facial')
        await faceapi.nets.faceLandmark68Net.loadFromUri('facial')
        await faceapi.nets.faceRecognitionNet.loadFromUri('facial')
        carregado = true
        modelos = 'pronto'
      } catch (e) {
        modelos = 'erro'
        throw e
      } finally {
        carregamento = null
      }
    })()
  }
  await carregamento
}

/**
 * As câmeras disponíveis. Os rótulos só aparecem DEPOIS de a permissão ter
 * sido concedida uma vez — antes disso o Chromium devolve strings vazias,
 * e uma lista de "câmera 1, câmera 2" não ajuda ninguém a escolher entre a
 * webcam do notebook e o iPhone.
 */
/**
 * Avisa quando a lista de câmeras muda.
 *
 * Existe por causa do caminho USB: apps como iVCam, Camo e DroidCam
 * instalam um driver que faz o celular aparecer como webcam comum — e isso
 * acontece quando você PLUGA o cabo, com a Íris já aberta. Sem este
 * ouvinte, o seletor continuaria mostrando a lista de quando o painel
 * abriu, e a câmera nova simplesmente não existiria até reiniciar o app.
 */
export function aoMudarCameras(cb: () => void): () => void {
  const alvo = navigator.mediaDevices
  if (!alvo) return () => {}
  alvo.addEventListener('devicechange', cb)
  return () => alvo.removeEventListener('devicechange', cb)
}

export async function listarCameras(): Promise<{ id: string; nome: string }[]> {
  if (!navigator.mediaDevices) return []
  const ds = await navigator.mediaDevices.enumerateDevices()
  return ds
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({ id: d.deviceId, nome: d.label || `câmera ${i + 1}` }))
}

async function ligarCamera(ciclo: number, deviceId?: string): Promise<void> {
  const novaStream = await navigator.mediaDevices.getUserMedia({
    /**
     * 640×480 e não 320×240 como na versão só-de-presença: contar rostos
     * funciona borrado, reconhecer não. É o mínimo em que o descritor ainda
     * é estável a uns 2 metros — a distância de uma portaria.
     */
    video: {
      width: 640,
      height: 480,
      frameRate: 5,
      /**
       * `ideal` e não `exact`: com iPhone-como-webcam o deviceId muda
       * quando o cabo sai e volta. `exact` daria OverconstrainedError e a
       * câmera não abriria mais — falha permanente por um id velho salvo na
       * config. Com `ideal` ele cai na câmera padrão e continua funcionando.
       */
      ...(deviceId ? { deviceId: { ideal: deviceId } } : {})
    }
  })

  if (ciclo !== geracao) {
    novaStream.getTracks().forEach((t) => t.stop())
    return
  }
  stream = novaStream
  const novoVideo = document.createElement('video')
  video = novoVideo
  novoVideo.srcObject = novaStream
  novoVideo.muted = true
  novoVideo.playsInline = true

  const perdeuSinal = (): void => {
    if (ciclo !== geracao || redeSelecionada || fonteTeste) return
    ultimoQuadroCamera = null
    ultimoErro = 'A câmera parou de transmitir.'
    invalidarLeitura()
  }
  novaStream.getVideoTracks().forEach((track) => {
    track.addEventListener('ended', perdeuSinal)
    track.addEventListener('mute', perdeuSinal)
  })
  novoVideo.addEventListener('error', perdeuSinal)

  const aoQuadro = (): void => {
    if (ciclo !== geracao || video !== novoVideo) return
    ultimoQuadroCamera = Date.now()
    novoVideo.requestVideoFrameCallback(aoQuadro)
  }
  novoVideo.requestVideoFrameCallback(aoQuadro)
  await novoVideo.play()
}

function desligar(): void {
  cancelarFotoPendente()
  geracao++
  ativo = false
  if (relogio) clearInterval(relogio)
  relogio = null
  // O track precisa parar de verdade: sem isto a luz da webcam fica acesa
  // com o recurso desligado, que é o que destrói a confiança na feature.
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  if (video) {
    video.pause()
    video.srcObject = null
  }
  video = null
  // Sem isto o preview congela na última leitura e fica mostrando um
  // retângulo com nome sobre uma câmera desligada.
  ultimoQuadroCamera = null
  emAnalise = false
  invalidarLeitura()
  publicar = null
}

/** Cancela também uma inicialização ainda aguardando modelos ou permissão. */
export function pararPresenca(): void {
  desligar()
}

let filaDeteccao: Promise<void> = Promise.resolve()

/** Cadastro, medição e vigilância compartilham o mesmo executor local. */
function serializarDeteccao<T>(tarefa: () => Promise<T>): Promise<T> {
  const resultado = filaDeteccao.then(tarefa)
  filaDeteccao = resultado.then(
    () => {},
    () => {}
  )
  return resultado
}

/**
 * O frame atual: onde está cada rosto e o vetor de cada um.
 *
 * A caixa vem da MESMA passada que o descritor porque as duas coisas têm
 * que concordar na tela — ver o retângulo e o rótulo saírem de detecções
 * diferentes é como se descobre, tarde, que o preview mente.
 */
async function detectar(
  fonte: HTMLImageElement | HTMLVideoElement
): Promise<{ d: Float32Array; box: faceapi.Box }[]> {
  return serializarDeteccao(async () => {
    const achados = await faceapi
      .detectAllFaces(fonte, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks()
      .withFaceDescriptors()
    return achados.map((a) => ({ d: a.descriptor, box: a.detection.box }))
  })
}

/** Só os vetores, pra quem não precisa de posição. */
async function descritores(fonte: HTMLImageElement | HTMLVideoElement): Promise<Float32Array[]> {
  return (await detectar(fonte)).map((a) => a.d)
}

/**
 * Um frame → uma leitura. O frame não é guardado em lugar nenhum: sai do
 * `video`, vira números, e o `descritores` local morre no fim da função.
 */
async function ler(ciclo: number): Promise<Leitura | null> {
  const fonte = alvo()
  if (!fonte) {
    invalidarLeitura()
    return semLeitura()
  }
  const versao = versaoFonte
  const inicio = performance.now()
  const achados = await detectar(fonte)
  if (ciclo !== geracao || versao !== versaoFonte) return null
  if (!alvo()) {
    invalidarLeitura()
    return semLeitura()
  }
  ultimaAnaliseEm = Date.now()
  duracaoAnaliseMs = Math.round(performance.now() - inicio)
  ultimoErro = null
  const ds = achados.map((a) => a.d)

  if (!ds.length) {
    caixas = []
    return { rostos: 0, desconhecidos: 0, conhecidos: [] }
  }

  const marcar = (nomes: (string | null)[]): void => {
    caixas = achados.map((a, i) => ({
      x: a.box.x,
      y: a.box.y,
      w: a.box.width,
      h: a.box.height,
      nome: nomes[i]
    }))
  }

  /**
   * SEM CADASTRO NÃO EXISTE DESCONHECIDO.
   *
   * Contar todo mundo como estranho com a galeria vazia parece rigoroso e é
   * o contrário: no primeiro boot a câmera liga, VOCÊ é o invasor, o alarme
   * dispara e toda ação de nível 2 passa a pedir confirmação — inclusive a
   * de se cadastrar. A feature se tranca no minuto zero, e o que a pessoa
   * faz com isso é desligar a câmera.
   *
   * Sem gabarito não há julgamento: conta as pessoas, não acusa ninguém. O
   * alarme começa a valer quando existe uma lista pra comparar.
   */
  if (!galeria.length) {
    // Sem cadastro ninguém é acusado: caixa sem nome, e sem vermelho.
    marcar(ds.map(() => null))
    return { rostos: ds.length, desconhecidos: 0, conhecidos: [] }
  }

  const matcher = new faceapi.FaceMatcher(galeria, LIMITE_MATCH)
  const conhecidos: string[] = []
  const nomes: (string | null)[] = []
  let desconhecidos = 0

  for (const d of ds) {
    const m = matcher.findBestMatch(d)
    nomes.push(m.label === 'unknown' ? null : m.label)
    if (m.label !== 'unknown') conhecidos.push(m.label)
    else desconhecidos++
  }

  marcar(nomes)
  return { rostos: ds.length, desconhecidos, conhecidos }
}

/**
 * O descritor de quem está na frente AGORA, pra cadastrar.
 *
 * Recusa com mais de um rosto no enquadramento de propósito: cadastrar o
 * rosto errado é o pior erro possível aqui — vira uma pessoa autorizada com
 * o nome de outra, e ninguém descobre até dar errado.
 */
export async function capturarDescritor(): Promise<Float32Array | string> {
  /**
   * Câmera desligada dava "não vi ninguém na câmera" — que é falso e manda
   * a pessoa se ajeitar na frente de um sensor que não está ligado. O
   * `video` nulo é a única forma de saber isso daqui.
   */
  const fonte = alvo()
  if (!fonte) return 'a câmera está desligada ou sem sinal — conecte uma fonte antes'

  const ciclo = geracao
  const versao = versaoFonte
  try {
    await carregarModelos()
    const ds = await descritores(fonte)
    if (ciclo !== geracao || versao !== versaoFonte || !alvo()) {
      return 'a fonte mudou ou perdeu o sinal — tente a captura novamente'
    }
    if (ds.length === 0) return 'não vi ninguém na câmera'
    if (ds.length > 1) return `vi ${ds.length} pessoas — só consigo cadastrar com uma na frente`
    return ds[0]
  } catch {
    return 'não consegui analisar o rosto — verifique o sinal e os modelos locais'
  }
}

/** Falhas de formato não desligam a fonte que já estava funcionando. */
export function validarFoto(arquivo: File): string {
  const extensao = arquivo.name.split('.').pop()?.toLowerCase() ?? ''
  const tipo = arquivo.type.toLowerCase()
  if (/^hei[cf]$/.test(extensao) || /^image\/hei[cf](?:-sequence)?$/.test(tipo))
    return 'Fotos HEIC/HEIF precisam ser exportadas como JPG ou PNG antes de carregar.'
  if (
    !/^(jpe?g|png|webp|bmp|gif|avif)$/.test(extensao) &&
    !/^image\/(jpeg|png|webp|bmp|x-ms-bmp|gif|avif)$/.test(tipo)
  )
    return 'Formato não aceito. Escolha uma foto JPG, PNG, WebP, BMP, GIF ou AVIF.'
  if (!arquivo.size) return 'O arquivo está vazio. Escolha outra foto.'
  if (arquivo.size > LIMITE_FOTO)
    return 'A foto excede 25 MB. Reduza o tamanho ou exporte uma cópia em JPG.'
  return ''
}

function cancelarFotoPendente(): void {
  versaoFoto++
  cancelarCargaFoto?.()
}

/** Só troca a fonte depois de decodificar. Cancelamento também libera o blob. */
function carregarFoto(
  url: string,
  nome: string,
  celular: boolean,
  liberar?: () => void
): Promise<string> {
  cancelarFotoPendente()
  const versao = versaoFoto
  return new Promise((resolve) => {
    const img = new Image()
    let terminou = false
    const concluir = (erro: string): void => {
      if (terminou) return
      terminou = true
      window.clearTimeout(timeout)
      img.onload = null
      img.onerror = null
      liberar?.()
      if (cancelarCargaFoto === cancelar) cancelarCargaFoto = null
      if (erro) img.src = ''
      resolve(erro)
    }
    const cancelar = (): void => concluir('Carregamento da foto cancelado: a fonte mudou.')
    const timeout = window.setTimeout(
      () => concluir('A foto demorou demais para abrir. Tente uma cópia menor em JPG ou PNG.'),
      TEMPO_CARGA_FOTO
    )
    cancelarCargaFoto = cancelar
    img.onload = () => {
      if (terminou) return
      if (versao !== versaoFoto) return cancelar()
      if (!img.naturalWidth || !img.naturalHeight)
        return concluir('Não foi possível ler essa imagem. Exporte uma cópia em JPG ou PNG.')
      fonteTeste = img
      fotoNome = nome
      fotoDoCelular = celular
      versaoFonte++
      versaoQuadro++
      quadro = null
      redeSelecionada = false
      ultimoQuadroRede = null
      if (modelos !== 'erro') ultimoErro = null
      invalidarLeitura()
      concluir('')
    }
    img.onerror = () =>
      concluir(
        'Não foi possível ler essa imagem. O arquivo pode estar danificado; tente JPG ou PNG.'
      )
    img.src = url
  })
}

/** Põe ou tira uma foto local sem apagar a anterior quando o arquivo falha. */
export function definirFonteTeste(arquivo: File | null): Promise<string> {
  if (!arquivo) {
    cancelarFotoPendente()
    fonteTeste = null
    fotoNome = null
    fotoDoCelular = false
    versaoFonte++
    invalidarLeitura()
    return Promise.resolve('')
  }
  const erro = validarFoto(arquivo)
  if (erro) return Promise.resolve(erro)
  try {
    const url = URL.createObjectURL(arquivo)
    return carregarFoto(url, arquivo.name, false, () => URL.revokeObjectURL(url))
  } catch {
    return Promise.resolve('Não foi possível abrir essa foto. Escolha o arquivo novamente.')
  }
}

/** Uma foto do celular permanece visível para permitir o cadastro sem pressa. */
export function receberFoto(jpegBase64: string): Promise<string> {
  if ((!ativo && !redeSelecionada) || (fonteTeste && !fotoDoCelular)) return Promise.resolve('')
  if (
    !jpegBase64 ||
    jpegBase64.length > Math.ceil(LIMITE_FOTO_CELULAR / 3) * 4 ||
    jpegBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(jpegBase64) ||
    !jpegBase64.startsWith('/9j/')
  )
    return Promise.resolve('A foto do celular não é um JPEG válido de até 3 MB.')
  return carregarFoto(`data:image/jpeg;base64,${jpegBase64}`, 'Foto do celular.jpg', true)
}

export function temFonteTeste(): boolean {
  return fonteTeste !== null
}

/**
 * CÂMERA DE REDE — alimentada pelo MAIN, quadro por quadro.
 *
 * A versão anterior punha a URL num `<img>` daqui. Não funciona: a CSP do
 * renderer é `img-src 'self' data:`, então host da rede local não passa; e
 * mesmo liberando, sem CORS o canvas fica *tainted* e o face-api não lê os
 * pixels — com `crossOrigin` a imagem nem carrega, porque ESP32-CAM não
 * manda `Access-Control-Allow-Origin`. Os dois caminhos morrem em silêncio,
 * que é o pior jeito de uma feature não funcionar.
 *
 * Agora o main abre o stream e manda JPEG em base64. Vira `data:` URL, que
 * a CSP aceita e que é mesma origem — nenhuma das duas paredes existe, e de
 * graça vem a reconexão automática, que o `<img>` não tinha.
 */
/** Seleciona a rede antes da conexão, sem confundir espera com sinal recebido. */
export function prepararFonteRede(): void {
  cancelarFotoPendente()
  versaoQuadro++
  versaoFonte++
  fonteTeste = null
  fotoNome = null
  fotoDoCelular = false
  quadro = null
  redeSelecionada = true
  ultimoQuadroRede = null
  ultimoErro = null
  invalidarLeitura()
}

/** Só publica quadros decodificados; uma decodificação antiga não vence a nova. */
export function receberQuadro(jpegBase64: string): void {
  // Quadros em trânsito após desligar não podem selecionar novamente a rede.
  if (!ativo && !redeSelecionada) return
  if (fonteTeste && !fotoDoCelular) return
  if (fonteTeste || !redeSelecionada) prepararFonteRede()
  const versao = ++versaoQuadro
  const recebidoEm = Date.now()
  const imagem = new Image()
  imagem.onload = () => {
    if (versao !== versaoQuadro || !redeSelecionada || !imagem.naturalWidth) return
    // A detecção que já começou mantém seu próprio elemento até terminar.
    quadro = imagem
    ultimoQuadroRede = recebidoEm
    if (modelos !== 'erro') ultimoErro = null
  }
  imagem.onerror = () => {
    if (versao !== versaoQuadro || !redeSelecionada) return
    ultimoErro = 'Não consegui decodificar o quadro recebido.'
    quadro = null
    invalidarLeitura()
  }
  imagem.src = `data:image/jpeg;base64,${jpegBase64}`
}

export function pararQuadros(): void {
  versaoQuadro++
  versaoFonte++
  redeSelecionada = false
  ultimoQuadroRede = null
  quadro = null
  invalidarLeitura()
}

/** Troca o cadastro em uso. Chamado no início e a cada cadastro novo. */
export function definirGaleria(
  pessoas: { nome: string; descritor: number[]; descritores?: number[][] }[]
): void {
  galeria = pessoas.map(
    (p) =>
      new faceapi.LabeledFaceDescriptors(
        p.nome,
        (p.descritores ?? [p.descritor]).map((d) => new Float32Array(d))
      )
  )
}

/**
 * Liga o sensor e reporta a cada tique. Devolve a função de parar.
 *
 * `rostos: -1` significa "não tenho olho", que é diferente de 0 ("olhei e
 * não tem ninguém"). As duas levam a decisões opostas na camada de risco.
 */
export async function iniciarPresenca(
  aoLer: (l: Leitura) => void,
  deviceId?: string
): Promise<() => void> {
  desligar()
  const ciclo = geracao
  ativo = true
  ultimoErro = null
  publicar = aoLer
  aoLer(semLeitura())
  const parar = (): void => {
    // A conclusão de um início antigo nunca desliga o sensor que o substituiu.
    if (ciclo === geracao) desligar()
  }
  let podeReconectar = true
  try {
    await carregarModelos()
    if (ciclo !== geracao) return parar
    if (!fonteTeste && !redeSelecionada) await ligarCamera(ciclo, deviceId)
  } catch (e) {
    if (ciclo !== geracao) return parar
    ultimoErro = e instanceof Error ? e.message : 'Não consegui iniciar o sensor.'
    console.warn('[presença] câmera indisponível:', (e as Error).message)
    if (!carregado) {
      // Visualização e reconhecimento são independentes: uma foto válida
      // continua na tela, mas nenhuma inferência usa modelos incompletos.
      if (!fonteTeste && !redeSelecionada) desligar()
      else invalidarLeitura()
      return parar
    }
    if (!fonteTeste && !redeSelecionada) {
      podeReconectar = !['NotAllowedError', 'SecurityError'].includes((e as Error).name)
    }
  }
  if (ciclo !== geracao) return parar

  let ocupado = false
  let reconectando = false
  let ultimaTentativa = Date.now()
  const tique = (): void => {
    if (ciclo !== geracao) return
    // Verifica o sinal mesmo durante uma inferência lenta, limpando nomes antigos.
    if (!alvo()) {
      if (redeSelecionada && ultimoQuadroRede !== null) {
        ultimoErro = 'Sem quadros recentes da câmera de rede.'
      } else if (video && ultimoQuadroCamera !== null) {
        ultimoErro = 'Sem quadros recentes da câmera local.'
      }
      invalidarLeitura()
      if (
        podeReconectar &&
        !fonteTeste &&
        !redeSelecionada &&
        !reconectando &&
        Date.now() - ultimaTentativa >= 5000
      ) {
        reconectando = true
        ultimaTentativa = Date.now()
        ultimoErro = 'Reconectando à câmera…'
        versaoFonte++
        stream?.getTracks().forEach((t) => t.stop())
        stream = null
        if (video) {
          video.pause()
          video.srcObject = null
        }
        video = null
        ultimoQuadroCamera = null
        void ligarCamera(ciclo, deviceId)
          .then(() => {
            if (ciclo === geracao) ultimoErro = null
          })
          .catch((e: Error) => {
            if (ciclo === geracao) {
              ultimoErro = `Reconectando: ${e.message}`
              podeReconectar = !['NotAllowedError', 'SecurityError'].includes(e.name)
            }
          })
          .finally(() => {
            reconectando = false
          })
      }
      return
    }
    // O reconhecimento leva mais que um tique em máquina lenta. Sem esta
    // trava os tiques se empilham e a fila de inferência só cresce.
    if (ocupado) return
    ocupado = true
    emAnalise = true
    ler(ciclo)
      .then((leitura) => {
        if (leitura && ciclo === geracao) aoLer(leitura)
      })
      // Um tique que falhou não vira "ausente": inventar que a sala esvaziou
      // é pior que admitir que não enxerguei.
      .catch((e) => {
        if (ciclo !== geracao) return
        ultimoErro = e instanceof Error ? e.message : 'Falha na análise local.'
        invalidarLeitura()
      })
      .finally(() => {
        ocupado = false
        if (ciclo === geracao) emAnalise = false
      })
  }
  relogio = window.setInterval(tique, TIQUE)
  tique()

  return parar
}

// ---------------------------------------------------------------
// Bancada de reconhecimento (2.6)
// ---------------------------------------------------------------

/**
 * O NÚMERO que falta na contribuição 2.6.
 *
 * "O reconhecimento funciona" não é resultado — funciona com que luz, a que
 * distância, e errando quanto? Esta bancada responde do mesmo jeito que a
 * II.1 respondeu pelas ferramentas: conjunto fixo de entradas, mesma saída
 * toda vez, rodável por outra pessoa.
 *
 * CONVENÇÃO: o nome do arquivo antes do primeiro `_` é a resposta certa.
 * `pablo_01.jpg` deve casar com o cadastro "pablo"; `desconhecido_03.jpg`
 * (ou qualquer nome fora do cadastro) não deve casar com ninguém. Nome de
 * arquivo como gabarito porque a alternativa é uma planilha à parte, que
 * dessincroniza na primeira foto adicionada.
 *
 * Os DOIS erros não são iguais, e é isso que o limiar decide:
 *
 *   - FALSO ACEITE: um estranho reconhecido como autorizado. Numa portaria,
 *     é a porta abrindo pra quem não podia entrar. É o erro grave.
 *   - FALSO REJEITE: um autorizado tratado como estranho. Irrita, gera
 *     alarme à toa — e alarme à toa é como um sistema de segurança morre,
 *     porque alguém desliga.
 *
 * Varrer o limiar mostra onde as duas curvas se cruzam. Sem isso, 0,6 é o
 * padrão da biblioteca, não uma escolha — e "por que 0,6?" é a primeira
 * pergunta de qualquer banca sobre biometria.
 */
export type Medicao = {
  limiar: number
  acertos: number
  falsoAceite: number
  falsoRejeite: number
  total: number
}

async function descritorDe(arquivo: File): Promise<Float32Array | null> {
  const url = URL.createObjectURL(arquivo)
  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = () => resolve(null)
      i.src = url
    })
    if (!img) return null

    const achado = await serializarDeteccao(async () =>
      faceapi
        .detectSingleFace(img, new faceapi.TinyFaceDetectorOptions())
        .withFaceLandmarks()
        .withFaceDescriptor()
    )
    return achado?.descriptor ?? null
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Roda o conjunto e varre o limiar. Devolve uma linha por limiar testado,
 * mais quantas fotos não tiveram rosto detectado — que não é acerto nem
 * erro de reconhecimento, é o detector não tendo achado ninguém, e misturar
 * as duas coisas esconde qual dos dois estágios está ruim.
 */
export async function medirReconhecimento(
  arquivos: File[],
  aoProgredir?: (feitas: number, total: number) => void
): Promise<{ medicoes: Medicao[]; semRosto: string[]; cadastrados: string[] }> {
  await carregarModelos()

  const cadastrados = galeria.map((g) => g.label)
  const amostras: { esperado: string; d: Float32Array }[] = []
  const semRosto: string[] = []

  for (const [i, a] of arquivos.entries()) {
    const d = await descritorDe(a)
    if (!d) semRosto.push(a.name)
    else amostras.push({ esperado: esperadoDe(a.name), d })
    aoProgredir?.(i + 1, arquivos.length)
  }

  const medicoes: Medicao[] = []
  for (let limiar = 0.4; limiar <= 0.8001; limiar += 0.05) {
    const l = Math.round(limiar * 100) / 100
    const matcher = new faceapi.FaceMatcher(galeria, l)
    let acertos = 0
    let falsoAceite = 0
    let falsoRejeite = 0

    for (const { esperado, d } of amostras) {
      const achou = galeria.length ? matcher.findBestMatch(d).label : 'unknown'
      const classe = classificar(esperado, achou, cadastrados)
      if (classe === 'acerto') acertos++
      else if (classe === 'falsoAceite') falsoAceite++
      else falsoRejeite++
    }

    medicoes.push({ limiar: l, acertos, falsoAceite, falsoRejeite, total: amostras.length })
  }

  return { medicoes, semRosto, cadastrados }
}

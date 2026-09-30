import { get } from 'http'
import type { IncomingMessage } from 'http'
import { createConnection } from 'net'
import { execFile } from 'child_process'
import { networkInterfaces } from 'os'

/**
 * A CÂMERA DA PORTA, lida pelo NODE e não pelo navegador (2.6).
 *
 * A primeira versão punha a URL direto num `<img>` do renderer. Não
 * funciona, e falha em silêncio por dois motivos independentes:
 *
 *   1. A CSP do index.html é `img-src 'self' data:`. Um host da rede local
 *      não passa, e o Chromium recusa sem lançar erro no `onerror` de forma
 *      distinguível — parece câmera offline.
 *   2. Mesmo liberando a CSP: sem `crossOrigin` o canvas fica *tainted* e o
 *      face-api não consegue ler os pixels; COM `crossOrigin` a imagem exige
 *      `Access-Control-Allow-Origin`, que ESP32-CAM e câmera IP barata não
 *      mandam. Os dois caminhos morrem.
 *
 * Aqui o main abre o MJPEG, corta os quadros na fronteira do multipart e
 * manda cada JPEG pro renderer como `data:` — que a CSP já permite, que é
 * mesma origem e que portanto não suja o canvas. Nenhuma das duas paredes
 * existe mais, e ainda sobra o que o navegador não tinha: reconexão.
 *
 * O frame não é gravado em disco em nenhum ponto: ele vive no buffer até o
 * próximo `\\r\\n--boundary` e é substituído.
 */

/** Quadro maior que isto é fluxo corrompido, não foto — protege a memória. */
const TETO_FRAME = 4_000_000

/** Espera antes de tentar de novo. Câmera de porta cai por Wi-Fi, e volta. */
const RECONEXAO = 4000

type Ouvinte = (jpegBase64: string) => void

let req: ReturnType<typeof get> | null = null
let timer: NodeJS.Timeout | null = null
let urlAtual = ''
let ouvinte: Ouvinte | null = null
let geracao = 0

/** Último erro legível, pra UI dizer o que houve em vez de "não pegou". */
let ultimoErro = ''

export function erroCamera(): string {
  return ultimoErro
}

function fechar(): void {
  req?.destroy()
  req = null
  if (timer) clearTimeout(timer)
  timer = null
}

/**
 * Corta o multipart. O separador vem do header `Content-Type`, e quando não
 * vem a gente cai no delimitador do JPEG (FFD8…FFD9) — vários firmwares
 * anunciam `boundary` errado ou não anunciam, e recusar por causa do header
 * deixaria de fora justamente as câmeras baratas que este caminho existe
 * pra atender.
 */
function consumir(res: IncomingMessage, ciclo: number): void {
  let buf = Buffer.alloc(0)

  res.on('data', (pedaco: Buffer) => {
    if (ciclo !== geracao) return
    buf = Buffer.concat([buf, pedaco])

    if (buf.length > TETO_FRAME) {
      ultimoErro = 'fluxo grande demais — não parece MJPEG'
      buf = Buffer.alloc(0)
      return
    }

    for (;;) {
      const inicio = buf.indexOf('\xff\xd8', 0, 'binary')
      if (inicio < 0) return
      const fim = buf.indexOf('\xff\xd9', inicio + 2, 'binary')
      if (fim < 0) {
        // Quadro incompleto: guarda só a partir do início dele e espera o
        // resto. Sem cortar aqui, o buffer cresceria com o cabeçalho de
        // todos os quadros já entregues.
        if (inicio > 0) buf = buf.subarray(inicio)
        return
      }

      const jpeg = buf.subarray(inicio, fim + 2)
      buf = buf.subarray(fim + 2)
      ultimoErro = ''
      ouvinte?.(jpeg.toString('base64'))
    }
  })

  res.on('end', () => {
    if (ciclo === geracao) agendarReconexao('a câmera encerrou a transmissão')
  })
  res.on('error', (e) => {
    if (ciclo === geracao) agendarReconexao(e.message)
  })
}

function agendarReconexao(motivo: string): void {
  ultimoErro = `Reconectando… ${motivo}`
  fechar()
  if (!urlAtual) return
  timer = setTimeout(() => urlAtual && conectar(urlAtual, ouvinte!), RECONEXAO)
}

/** Abre (ou reabre) o stream. URL vazia desliga. */
export function conectar(url: string, aoFrame: Ouvinte): void {
  const ciclo = ++geracao
  fechar()
  urlAtual = url.trim()
  ouvinte = aoFrame
  if (!urlAtual) {
    ultimoErro = ''
    return
  }

  try {
    req = get(urlAtual, { timeout: 8000 }, (res) => {
      if (ciclo !== geracao) {
        res.destroy()
        return
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume()
        return agendarReconexao(`a câmera respondeu ${res.statusCode}`)
      }
      consumir(res, ciclo)
    })

    req.on('timeout', () => {
      if (ciclo === geracao) agendarReconexao('a câmera não respondeu em 8s')
    })
    req.on('error', (e) => {
      if (ciclo === geracao) agendarReconexao(e.message)
    })
  } catch (e) {
    agendarReconexao((e as Error).message)
  }
}

export function desconectarCamera(): void {
  geracao++
  urlAtual = ''
  ouvinte = null
  ultimoErro = ''
  fechar()
}

// ---------------------------------------------------------------
// Procurar câmeras na rede (2.6)
// ---------------------------------------------------------------

/**
 * ACHAR A CÂMERA em vez de adivinhar a URL.
 *
 * O caminho anterior era: abra o app do celular, procure onde ele mostra o
 * endereço, digite certo. Três lugares pra errar, e o erro volta como
 * "não pegou" — indistinguível de câmera offline, porta errada ou caminho
 * errado.
 *
 * Aqui a máquina faz o que máquina faz: varre a própria sub-rede, acha quem
 * está servindo imagem e devolve a URL pronta. É exatamente o que qualquer
 * app de câmera IP faz pra emparelhar, e é a única forma de isto ser
 * demonstrável na frente de alguém — ninguém quer ver você caçando IP.
 *
 * DUAS FASES, e a ordem é o que torna isto viável em segundos:
 *
 *   1. TCP em cada host da /24, nas portas que câmera usa. Um connect que
 *      falha em 300ms elimina 250 hosts sem gastar um HTTP.
 *   2. Só em quem abriu, um GET nos caminhos conhecidos, olhando o
 *      Content-Type. `multipart/x-mixed-replace` é MJPEG; `image/jpeg` é
 *      foto única, que também serve (o laço repinta).
 *
 * Varre só a PRÓPRIA sub-rede, a partir do IP desta máquina. Não é timidez:
 * a câmera da porta está na mesma rede por definição, e sair disso seria
 * varrer rede de terceiro.
 */

/** Portas que firmware de câmera barata usa. A 81 é o padrão do ESP32-CAM. */
const PORTAS = [
  81, // ESP32-CAM
  8080, // IP Webcam (Android), câmera IP em geral
  8081, // IP Camera Lite
  4747, // DroidCam
  8000,
  80,
  8888,
  8090,
  5000,
  9000,
  8443
]

/** Caminhos que esses firmwares servem. A ordem é a da probabilidade. */
const CAMINHOS = [
  '/stream', // ESP32-CAM
  '/video', // IP Camera Lite, DroidCam
  '/live',
  '/mjpeg',
  '/mjpegfeed',
  '/videofeed',
  '/video.cgi',
  '/videostream.cgi',
  '/cam.mjpg',
  '/axis-cgi/mjpg/video.cgi', // Axis, e o padrão que muitos clones copiaram
  '/jpg',
  '/snapshot.cgi',
  '/'
]

/** Por host+porta. Curto de propósito: a rede é local, latência é ~1ms. */
const ESPERA_TCP = 350
const ESPERA_HTTP = 1500

/** Quantos hosts em paralelo. 64 mantém a varredura em ~2s sem afogar o Wi-Fi. */
const LOTE = 64

/**
 * `desconhecido` existe porque "não achei nada" tem três causas e elas
 * pedem ações opostas: o app do celular fechado, a porta certa com caminho
 * errado, ou rede errada. Sem distinguir, a resposta manda a pessoa mexer
 * no celular quando o problema era o caminho — e ela conclui que a feature
 * não funciona.
 *
 * Um host que ATENDEU HTTP na porta de câmera e devolveu outra coisa
 * (text/html do painel de configuração, por exemplo) é pista, não lixo: é o
 * endereço certo com o caminho errado, e é o único caso em que tentar na mão
 * resolve.
 */
export type Achado = {
  url: string
  tipo: 'mjpeg' | 'jpeg' | 'desconhecido'
  servidor: string
  /** O que veio no Content-Type, quando não era imagem. */
  conteudo?: string
}

/**
 * TODAS as /24 desta máquina, a rede doméstica primeiro.
 *
 * A primeira versão pegava a primeira interface que aparecesse, e isso
 * quebrou na máquina de teste por um motivo que vale escrever: ela tinha
 * duas placas ativas —
 *
 *   26.34.208.197   Radmin VPN
 *   192.168.1.5     a rede de casa
 *
 * A VPN vinha primeiro. A varredura ia inteira pra uma rede virtual onde
 * câmera nenhuma existe, levava os mesmos segundos e voltava "não achei" —
 * a falha mais cara possível, porque ela é indistinguível de "não tem
 * câmera" e manda a pessoa mexer no celular pelo motivo errado.
 *
 * Então: varre todas, e ORDENA. 192.168 é rede doméstica por convenção;
 * 10.x e 172.16-31 são corporativas e de container; 26.x é o bloco que
 * Radmin VPN usa. A ordem é a probabilidade de a câmera da porta estar lá.
 */
function subRedes(): string[] {
  const bases: string[] = []

  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      // `family` virou número em algumas versões do Node; aceitar os dois
      // evita um scan que não acha nada e parece "não tem câmera".
      const v4 = i.family === 'IPv4' || (i.family as unknown as number) === 4
      if (!v4 || i.internal) continue

      const p = i.address.split('.')
      if (p.length !== 4) continue
      const base = `${p[0]}.${p[1]}.${p[2]}`
      if (!bases.includes(base)) bases.push(base)
    }
  }

  const peso = (b: string): number => {
    if (b.startsWith('192.168.')) return 0
    if (b.startsWith('10.')) return 1
    const segundo = Number(b.split('.')[1])
    if (b.startsWith('172.') && segundo >= 16 && segundo <= 31) return 1
    return 2
  }

  return bases.sort((a, b) => peso(a) - peso(b))
}

/**
 * Três respostas, não duas, e a do meio é a que estava faltando.
 *
 *   'aberta'   — atendeu. Tem serviço nesta porta.
 *   'recusada' — ECONNREFUSED. Ninguém escuta NESTA porta, mas o host
 *                EXISTE: alguém processou o pacote pra poder recusá-lo.
 *   'muda'     — estourou o prazo. Não tem ninguém nesse endereço.
 *
 * A distinção entre 'recusada' e 'muda' é o que permite dizer "seu celular
 * está na rede, só não está servindo imagem" em vez de "não achei câmera" —
 * e as duas conclusões mandam você fazer coisas opostas: uma é ligar a
 * transmissão no app, a outra é conferir em qual Wi-Fi o celular está.
 */
type Sondagem = 'aberta' | 'recusada' | 'muda'

function sondarPorta(host: string, porta: number, espera = ESPERA_TCP): Promise<Sondagem> {
  return new Promise((resolve) => {
    const s = createConnection({ host, port: porta })
    const fim = (r: Sondagem): void => {
      s.destroy()
      resolve(r)
    }
    s.setTimeout(espera)
    s.once('connect', () => fim('aberta'))
    s.once('timeout', () => fim('muda'))
    s.once('error', (e: NodeJS.ErrnoException) =>
      fim(e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET' ? 'recusada' : 'muda')
    )
  })
}

/**
 * Um ping, pelo utilitário do sistema.
 *
 * ICMP por socket cru exigiria privilégio de administrador — que um app de
 * bandeja não deve pedir por causa de um diagnóstico. O `ping.exe` já roda
 * como usuário comum e o código de saída responde a pergunta.
 *
 * `-n 1` é um pacote só: com 254 hosts, dois pacotes dobram o tempo pra
 * confirmar o que o primeiro já disse. O primeiro pacote pra um iPhone
 * costuma se perder (economia de energia do Wi-Fi), então `-w 700` dá
 * folga pro rádio acordar em vez de declarar o aparelho morto.
 */
function pingou(host: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('ping', ['-n', '1', '-w', '700', host], { timeout: 2000 }, (erro, saida) => {
      // Código 0 não basta no Windows: o ping.exe sai 0 mesmo em "Host de
      // destino inacessível", que é resposta do ROTEADOR e não do host.
      resolve(!erro && /TTL=|ttl=/.test(saida))
    })
  })
}

/**
 * Quem está nesta sub-rede — pelos DOIS sinais, porque nenhum deles sozinho
 * enxerga a rede inteira. Isto foi medido, não deduzido:
 *
 *   RST (ECONNREFUSED) pega Windows, Linux, roteador. NÃO pega iPhone: o
 *   iOS DESCARTA pacote em porta fechada em vez de recusar, então o celular
 *   parecia ausente da rede mesmo ligado, respondendo ping a 41ms.
 *
 *   PING pega o iPhone. NÃO pega PC com Windows, que bloqueia ICMP por
 *   padrão no firewall.
 *
 * A união cobre os dois. E o custo é baixo porque as duas sondas rodam em
 * paralelo no mesmo lote: quem responde primeiro decide.
 */
async function hostsVivos(base: string): Promise<string[]> {
  const vivos: string[] = []

  for (let inicio = 1; inicio < 255; inicio += LOTE) {
    const hosts = Array.from(
      { length: Math.min(LOTE, 255 - inicio) },
      (_, k) => `${base}.${inicio + k}`
    )

    await Promise.all(
      hosts.map(async (host) => {
        const [tcp80, tcp443, icmp] = await Promise.all([
          sondarPorta(host, 80, 250),
          sondarPorta(host, 443, 250),
          pingou(host)
        ])
        if (icmp || tcp80 !== 'muda' || tcp443 !== 'muda') vivos.push(host)
      })
    )
  }

  return vivos.sort((a, b) => Number(a.split('.')[3]) - Number(b.split('.')[3]))
}

/** O que este endereço serve. null = não atendeu. */
function sondar(
  url: string
): Promise<{ tipo: Achado['tipo']; servidor: string; conteudo: string } | null> {
  return new Promise((resolve) => {
    const req = get(url, { timeout: ESPERA_HTTP }, (res) => {
      const ct = String(res.headers['content-type'] ?? '')
      const servidor = String(res.headers.server ?? '')

      // Não consome o corpo: um MJPEG aberto ficaria baixando pra sempre.
      // O header já respondeu a pergunta.
      res.destroy()

      const tipo: Achado['tipo'] = ct.includes('multipart/x-mixed-replace')
        ? 'mjpeg'
        : ct.includes('image/')
          ? 'jpeg'
          : 'desconhecido'

      resolve({ tipo, servidor, conteudo: ct })
    })
    req.on('timeout', () => {
      req.destroy()
      resolve(null)
    })
    req.on('error', () => resolve(null))
  })
}

export async function procurarCameras(): Promise<Achado[]> {
  return (await diagnosticarRede()).achados
}

/**
 * A varredura COM o contexto: o que serve imagem, e quem está na rede.
 *
 * A lista de vivos responde a pergunta que "não achei câmera" não
 * respondia. Se o celular aparece nela, ele está na Wi-Fi certa e o que
 * falta é a transmissão ligada no app; se não aparece, o problema é rede —
 * e sem separar as duas a pessoa mexe na coisa errada por meia hora.
 */
export async function diagnosticarRede(): Promise<{
  achados: Achado[]
  vivos: string[]
  redes: string[]
}> {
  const achados: Achado[] = []
  const vivos: string[] = []
  const redes = subRedes()

  for (const base of redes) {
    const nesta = await hostsVivos(base)
    vivos.push(...nesta)
    await varrer(achados, nesta)

    /**
     * Para na primeira rede que deu resultado DE VERDADE.
     *
     * Achou na 192.168 (a de casa)? Varrer a VPN depois só gasta segundos
     * pra oferecer uma lista maior e mais confusa. Se não achou nada,
     * continua — aí a rede seguinte é a única chance.
     */
    if (achados.some((a) => a.tipo !== 'desconhecido')) break
  }

  // MJPEG primeiro: é o que dá vídeo contínuo. JPEG único funciona, mas o
  // laço fica repintando a mesma foto se o firmware não atualizar.
  const ordem = { mjpeg: 0, jpeg: 1, desconhecido: 2 }
  achados.sort((a, b) => ordem[a.tipo] - ordem[b.tipo])
  return { achados, vivos, redes }
}

/**
 * Varre 11 portas só em quem está vivo, em vez de 6 em todos os 254.
 *
 * Numa rede doméstica são uns 8 dispositivos, então isto é MENOS trabalho
 * cobrindo MAIS portas — ~88 tentativas em vez de 1.524. É o que permite
 * incluir as portas incomuns que antes tinham ficado de fora por custo.
 */
async function varrer(achados: Achado[], vivos: string[]): Promise<void> {
  await Promise.all(
    vivos.map(async (host) => {
      for (const porta of PORTAS) {
        if ((await sondarPorta(host, porta)) !== 'aberta') continue

        /**
         * Guarda a primeira resposta NÃO-imagem da porta e segue tentando os
         * outros caminhos: ela só vira resultado se nenhum caminho desta
         * porta der imagem. É a pista de "endereço certo, caminho errado", e
         * não pode competir com um acerto de verdade.
         */
        let pista: Achado | null = null

        for (const caminho of CAMINHOS) {
          const url = `http://${host}:${porta}${caminho}`
          const r = await sondar(url)
          if (!r) continue

          if (r.tipo !== 'desconhecido') {
            achados.push({ url, tipo: r.tipo, servidor: r.servidor })
            // Um caminho por porta basta: o resto são apelidos do mesmo
            // fluxo, e cinco URLs da mesma câmera não ajudam ninguém.
            return
          }

          pista ??= { url, tipo: 'desconhecido', servidor: r.servidor, conteudo: r.conteudo }
        }

        if (pista) achados.push(pista)
      }
    })
  )
}

/**
 * Testa UM endereço e explica o que houve.
 *
 * A varredura responde "tem câmera na rede?". Esta responde "por que ESTE
 * endereço não funciona?", que é a pergunta de quem já sabe o IP do celular
 * e quer saber de quem é a culpa. Sem ela, a única ferramenta era varrer os
 * 254 hosts de novo pra descobrir algo sobre um só.
 *
 * Aceita host, host:porta ou URL inteira — quem está olhando o app do
 * celular copia o que está na tela, não o que o parser preferia.
 */
export async function testarEndereco(bruto: string): Promise<string> {
  const limpo = bruto.trim().replace(/^https?:\/\//, '')
  if (!limpo) return 'digite um endereço'

  const [hostPorta, ...resto] = limpo.split('/')
  const [host, portaTxt] = hostPorta.split(':')
  const caminhoDado = resto.join('/')

  const vivo = await sondarPorta(host, 80, 600)
  const outra = vivo === 'muda' ? await sondarPorta(host, 443, 600) : vivo

  if (outra === 'muda') {
    return `${host} não responde nada. Ou não é esse o endereço, ou o roteador isola os aparelhos entre si (nesse caso nenhum app de câmera vai funcionar — é configuração do roteador).`
  }

  // Vivo: agora é sobre a porta e o caminho, que é onde o app manda.
  const portas = portaTxt ? [Number(portaTxt)] : PORTAS
  const abertas: number[] = []

  for (const porta of portas) {
    if ((await sondarPorta(host, porta)) === 'aberta') abertas.push(porta)
  }

  if (!abertas.length) {
    return `${host} está na rede e responde, mas não tem nada escutando ${
      portaTxt ? `na porta ${portaTxt}` : 'nas portas de câmera'
    }. No celular, a transmissão está LIGADA dentro do app?`
  }

  for (const porta of abertas) {
    const caminhos = caminhoDado ? [`/${caminhoDado}`, ...CAMINHOS] : CAMINHOS
    for (const caminho of caminhos) {
      const url = `http://${host}:${porta}${caminho}`
      const r = await sondar(url)
      if (r && r.tipo !== 'desconhecido') return `ACHEI: ${url} (${r.tipo})`
    }
  }

  return `${host}:${abertas.join(', ')} responde, mas não é imagem em nenhum caminho conhecido. Abra no navegador do PC e veja o que aparece.`
}

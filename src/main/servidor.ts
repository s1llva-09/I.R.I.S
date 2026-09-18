import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes } from 'crypto'
import { networkInterfaces } from 'os'
import QRCode from 'qrcode'

/**
 * A CÂMERA DO CELULAR, sem app de terceiro (2.6).
 *
 * O caminho anterior dependia de um app que SERVE MJPEG no celular, e ele
 * tem três lugares pra falhar antes de chegar aqui: o servidor não iniciado
 * dentro do app, o iOS suspendendo em segundo plano, e o caminho da URL que
 * cada firmware inventa diferente.
 *
 * Aqui a direção inverte. A Íris sobe um servidor na rede local, mostra um
 * QR, e o celular ABRE uma página.
 *
 * O QUE ESTA PÁGINA CONSEGUE, e o limite é do navegador e não do código:
 *
 *   FOTO (funciona sempre) — `<input capture>` abre a câmera nativa do
 *   celular, devolve a imagem e ela sobe. Basta pra cadastrar um rosto e pra
 *   demonstrar reconhecimento, que é o caso de uso mais comum aqui.
 *
 *   VÍDEO AO VIVO (só em contexto seguro) — `navigator.mediaDevices` só
 *   EXISTE em https:// ou localhost. Em http:// na rede local ele é
 *   `undefined`, e o erro que o Safari dá é "undefined is not an object" —
 *   que parece falta de permissão e não é: é o objeto não ter sido criado.
 *   Não há contorno em JavaScript; a exigência é do navegador.
 *
 * Tentei HTTPS com certificado autoassinado e abandonei por dois motivos
 * somados: o iOS recusa `getUserMedia` em certificado não confiável mesmo
 * depois de você aceitar o aviso (exige instalar perfil e habilitar
 * confiança total, seis passos nos Ajustes), e uma dependência a mais pra
 * gerar cert num caminho que pode falhar por versão do iOS é dívida pior
 * que o recurso.
 *
 * Pra vídeo ao vivo de verdade, o caminho que NÃO tem essa parede é o
 * inverso: o celular SERVE e a Íris consome (`camera.ts`). Servir não exige
 * contexto seguro — só capturar exige.
 *
 * É também a resposta pro display da porta: a mesma página, aberta num
 * tablet velho ou num Raspberry, é o LCD com a cara da Íris.
 *
 * O TOKEN não é enfeite. Um servidor que aceita imagem na rede local aceita
 * imagem de QUALQUER coisa na rede local — o vizinho no mesmo Wi-Fi, um
 * dispositivo comprometido, um colega no laboratório da facul. Sem o
 * segredo na URL, qualquer um empurraria quadros pro sistema de vigilância e
 * a `presenca` viraria o que ele quisesse: bastaria mandar a foto de uma sala
 * vazia pra desligar a escalada de risco. O token nasce por sessão e só
 * existe dentro do QR.
 */

/** Acima disto não é foto de câmera, é alguém testando o servidor. */
const TETO_POST = 3_000_000

const PORTA = 8790

type Estado = () => { rostos: number; desconhecidos: number; conhecidos: string[] }

let servidor: ReturnType<typeof createServer> | null = null
let segredo = ''
let aoQuadro: ((jpegBase64: string) => void) | null = null
let lerEstado: Estado = () => ({ rostos: -1, desconhecidos: 0, conhecidos: [] })

/** O IP desta máquina na rede doméstica — o que o celular consegue alcançar. */
function ipLocal(): string | null {
  const candidatos: string[] = []

  for (const lista of Object.values(networkInterfaces())) {
    for (const i of lista ?? []) {
      const v4 = i.family === 'IPv4' || (i.family as unknown as number) === 4
      if (v4 && !i.internal) candidatos.push(i.address)
    }
  }

  // 192.168 primeiro, pelo mesmo motivo da varredura: VPN (26.x, 25.x) vem
  // antes na lista do Node e o celular não alcança aquele endereço.
  return (
    candidatos.sort(
      (a, b) => Number(b.startsWith('192.168.')) - Number(a.startsWith('192.168.'))
    )[0] ?? null
  )
}

function corpo(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const partes: Buffer[] = []
    let total = 0

    req.on('data', (p: Buffer) => {
      total += p.length
      if (total > TETO_POST) {
        req.destroy()
        return resolve(null)
      }
      partes.push(p)
    })
    req.on('end', () => resolve(Buffer.concat(partes)))
    req.on('error', () => resolve(null))
  })
}

/**
 * A página que o celular abre. Autocontida de propósito: sem build, sem
 * bundle, sem CSP pra negociar — o navegador do celular recebe um arquivo e
 * funciona. Ela é feia por escolha; quem olha é a pessoa segurando o
 * telefone, e o que importa é o botão funcionar de primeira.
 */
function pagina(token: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Íris — câmera</title>
<style>
  :root { color-scheme: dark }
  body { margin:0; background:#05090e; color:#eaf2f6;
         font:14px/1.5 -apple-system, system-ui, sans-serif;
         display:flex; flex-direction:column; align-items:center; gap:16px; padding:20px }
  video { width:100%; max-width:420px; border:1px solid rgba(234,242,246,.22); background:#000 }
  button { background:none; border:1px solid rgba(234,242,246,.22); color:#eaf2f6;
           padding:12px 20px; font:inherit; letter-spacing:.15em; text-transform:uppercase }
  #s { color:#6d7f8b; font-size:12px; letter-spacing:.1em; text-transform:uppercase }
  .on { color:#6fd39a !important }
</style></head><body>
<h1 style="font-size:13px;letter-spacing:.3em;text-transform:uppercase;color:#6d7f8b;margin:0">
  Íris · câmera da porta</h1>
<video id="v" playsinline muted></video>
<button id="b">Ligar câmera</button>

<label id="f" style="display:none">
  <span style="display:inline-block;border:1px solid rgba(234,242,246,.22);padding:12px 20px;
               letter-spacing:.15em;text-transform:uppercase">Tirar foto</span>
  <input type="file" accept="image/*" capture="environment" hidden>
</label>

<p id="s">toque para começar</p>
<script>
  const v = document.getElementById('v'), s = document.getElementById('s')
  const b = document.getElementById('b'), f = document.getElementById('f')
  let timer = null

  /**
   * A checagem que precisa vir ANTES de qualquer tentativa.
   *
   * Em http:// o navegador não cria 'navigator.mediaDevices'. Chamar
   * '.getUserMedia' nele dá "undefined is not an object" — mensagem que
   * manda a pessoa procurar permissão de câmera nos ajustes do celular por
   * meia hora. O problema é o protocolo, e dizer isso é o conserto.
   */
  const aoVivoPossivel = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)

  if (!aoVivoPossivel) {
    b.style.display = 'none'
    v.style.display = 'none'
    f.style.display = 'block'
    s.innerHTML = 'vídeo ao vivo indisponível: o navegador só libera a câmera em ' +
      '<b>https</b>, e esta conexão é http na rede local.<br><br>' +
      'A foto abaixo funciona e serve pra cadastrar um rosto.'
  }

  // O getUserMedia exige GESTO do usuário no iOS — por isso o botão, e por
  // isso ele não pode ser um autoplay disfarçado.
  b.onclick = async () => {
    try {
      // facingMode 'environment' = câmera de trás, que é a que aponta pra
      // porta quando o celular está apoiado. Cai na frontal se não houver.
      v.srcObject = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: 640, height: 480 }
      })
      await v.play()
      s.textContent = 'transmitindo'
      s.className = 'on'
      if (!timer) timer = setInterval(enviar, 200)
    } catch (e) { s.textContent = 'sem permissão de câmera: ' + e.message }
  }

  const c = document.createElement('canvas')

  async function enviar() {
    if (!v.videoWidth) return
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    // 0.6 de qualidade: a 640x480 dá ~25KB por quadro, que atravessa Wi-Fi
    // doméstico a 5fps sem engasgar. Acima disso o ganho não muda a
    // detecção e a latência sobe.
    const b64 = c.toDataURL('image/jpeg', 0.6).split(',')[1]
    try {
      await fetch('/quadro?t=${token}', { method:'POST', body: b64 })
    } catch { s.textContent = 'perdi a conexão com o PC'; s.className = '' }
  }

  /**
   * A FOTO ÚNICA — o caminho que não depende de https.
   *
   * 'capture="environment"' faz o iOS abrir a câmera de trás direto em vez
   * da galeria. Sobe pelo mesmo endpoint dos quadros: pro PC é um quadro
   * como qualquer outro, então cadastro e reconhecimento funcionam iguais.
   */
  f.querySelector('input').onchange = async (ev) => {
    const arq = ev.target.files && ev.target.files[0]
    if (!arq) return
    s.textContent = 'enviando…'

    const b64 = await new Promise((ok) => {
      const fr = new FileReader()
      fr.onload = () => ok(String(fr.result).split(',')[1])
      fr.readAsDataURL(arq)
    })

    try {
      await fetch('/quadro?t=${token}', { method: 'POST', body: b64 })
      s.textContent = 'foto enviada — cadastre o rosto na Íris'
      s.className = 'on'
    } catch { s.textContent = 'não consegui falar com o PC' }
  }

  if (aoVivoPossivel) {
    // A tela apagando para a transmissão no celular. Dizer isso é mais
    // honesto que descobrir depois que o alarme parou de funcionar às 3h.
    s.insertAdjacentHTML('afterend',
      '<p style="color:#6d7f8b;font-size:12px;max-width:420px;text-align:center">' +
      'Mantenha esta aba aberta e a tela acesa. O navegador para a câmera quando ' +
      'a tela apaga.</p>')
  }
</script></body></html>`
}

function responder(req: IncomingMessage, res: ServerResponse): void {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)

  // O token vale pra TUDO, inclusive a página: sem isso, quem estiver na
  // rede descobre o caminho e passa a empurrar quadros por conta própria.
  if (url.searchParams.get('t') !== segredo) {
    res.writeHead(403).end('token inválido')
    return
  }

  if (url.pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina(segredo))
    return
  }

  if (url.pathname === '/quadro' && req.method === 'POST') {
    void corpo(req).then((b) => {
      if (!b) {
        res.writeHead(413).end()
        return
      }
      aoQuadro?.(b.toString('utf8'))
      res.writeHead(204).end()
    })
    return
  }

  if (url.pathname === '/estado' && req.method === 'GET') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(lerEstado()))
    return
  }

  res.writeHead(404).end()
}

/**
 * Sobe o servidor e devolve o endereço + o QR em SVG.
 *
 * Idempotente: chamar de novo devolve o mesmo endereço em vez de subir um
 * segundo servidor na mesma porta — o painel pode pedir o QR quantas vezes
 * quiser sem derrubar o celular que já está transmitindo.
 */
export async function abrirServidor(
  aoReceberQuadro: (jpegBase64: string) => void,
  estado: Estado
): Promise<{ url: string; qr: string } | { erro: string }> {
  aoQuadro = aoReceberQuadro
  lerEstado = estado

  const ip = ipLocal()
  if (!ip)
    return { erro: 'esta máquina não está numa rede — sem Wi-Fi não há como o celular chegar' }

  if (!segredo) segredo = randomBytes(8).toString('hex')

  if (!servidor) {
    servidor = createServer(responder)
    const subiu = await new Promise<string>((resolve) => {
      servidor!.once('error', (e) => resolve(e.message))
      // 0.0.0.0 e não 127.0.0.1: o celular é outro dispositivo, e localhost
      // não é alcançável de fora da máquina.
      servidor!.listen(PORTA, '0.0.0.0', () => resolve(''))
    })

    if (subiu) {
      servidor = null
      return { erro: `não consegui abrir a porta ${PORTA}: ${subiu}` }
    }
  }

  const url = `http://${ip}:${PORTA}/?t=${segredo}`
  // SVG e não PNG: escala sem serrilhar na tela do painel, e o celular lê
  // melhor um QR nítido — leitura falha é o modo de falha mais chato aqui,
  // porque parece que o QR está errado.
  const qr = await QRCode.toString(url, { type: 'svg', margin: 1, width: 240 })
  return { url, qr }
}

export function fecharServidor(): void {
  servidor?.close()
  servidor = null
  aoQuadro = null
  segredo = ''
}

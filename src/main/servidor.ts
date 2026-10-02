import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { randomBytes, X509Certificate } from 'crypto'
import { createServer as createHttpsServer } from 'https'
import { certificadoLocal } from './tlsLocal'
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
 *   FOTO — `<input capture>` permite abrir a câmera nativa do
 *   celular, devolve a imagem e ela sobe. Basta pra cadastrar um rosto e pra
 *   demonstrar reconhecimento, que é o caso de uso mais comum aqui.
 *
 *   VÍDEO AO VIVO (só em contexto seguro) — `navigator.mediaDevices` só
 *   EXISTE em https:// ou localhost. Em http:// na rede local ele é
 *   `undefined`, e o erro que o Safari dá é "undefined is not an object" —
 *   que parece falta de permissão e não é: é o objeto não ter sido criado.
 *   Não há contorno em JavaScript; a exigência é do navegador.
 *
 * HTTPS local é opcional. A CA é exclusiva deste computador e a chave
 * privada fica cifrada pelo sistema. O usuário instala o certificado no
 * celular e habilita sua confiança. Tokens HTTP e HTTPS são independentes.
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

type Estado = () => { rostos: number; desconhecidos: number; conhecidos: string[] }

// Cada câmera tem servidor, token e ciclo de vida próprios.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function criarServidorCelular(PORTA = 8790, PORTA_SEGURA = 8791) {
  let servidor: ReturnType<typeof createServer> | null = null
  let segredo = ''
  let seguro: ReturnType<typeof createHttpsServer> | null = null
  let segredoSeguro = ''
  let raizPublica = ''
  let impressao = ''
  let geracaoServidor = 0
  const controles = new Set<ServerResponse>()
  let aoQuadro: ((jpegBase64: string, foto?: boolean) => void) | null = null
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
      if (Number(req.headers['content-length']) > TETO_POST) {
        req.resume()
        resolve(null)
        return
      }

      const partes: Buffer[] = []
      let total = 0
      let concluido = false

      req.on('data', (p: Buffer) => {
        if (concluido) return
        total += p.length
        if (total > TETO_POST) {
          concluido = true
          partes.length = 0
          resolve(null)
          return
        }
        partes.push(p)
      })
      req.on('end', () => {
        if (!concluido) resolve(Buffer.concat(partes))
      })
      req.on('aborted', () => resolve(null))
      req.on('error', () => resolve(null))
    })
  }

  /**
   * A página que o celular abre. Autocontida de propósito: sem build, sem
   * bundle — o navegador do celular recebe um arquivo. A imagem é convertida
   * e reduzida antes do envio: uma foto original de celular passa facilmente
   * do limite do servidor quando representada em base64.
   */
  function pagina(token: string): string {
    return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Íris — conectar celular</title>
<style>
  :root { color-scheme:dark; font:15px/1.6 -apple-system,system-ui,sans-serif }
  * { box-sizing:border-box }
  body { margin:0; min-height:100svh; padding:28px 20px; color:#e9f7ff;
    background:radial-gradient(ellipse at top,#102d45 0,transparent 65%),#07101b }
  main { max-width:480px; margin:0 auto }
  .brand { color:#62e2ef; font-size:12px; letter-spacing:.26em; text-transform:uppercase }
  h1 { margin:20px 0 8px; font-size:30px; line-height:1.2; letter-spacing:-.04em }
  p { color:#a7bfd2; margin:0 0 18px }
  .panel { margin:22px 0; padding:20px; border:1px solid #243a4d; border-radius:20px;
    background:#0b1827; box-shadow:0 18px 60px #0003 }
  .mode { display:inline-block; color:#79e3ed; padding:5px 10px; border:1px solid #2c6570;
    border-radius:30px; font-size:11px; text-transform:uppercase; letter-spacing:.1em }
  video,img { width:100%; max-height:360px; object-fit:contain; background:#040a12;
    border:1px solid #243a4d; border-radius:12px; margin:16px 0 }
  button { width:100%; min-height:48px; margin-top:12px; border:1px solid #315066;
    border-radius:12px; padding:12px 16px; background:#14283b; color:#e9f7ff;
    font:inherit; font-size:14px; font-weight:600; cursor:pointer }
  button.primary { color:#041824; background:#71e2ec; border-color:#71e2ec }
  button:disabled { opacity:.45; cursor:wait }
  button:focus-visible { outline:3px solid #fff; outline-offset:3px }
  #s { min-height:48px; margin:18px 0 0; color:#bad0df; font-size:13px }
  #s.on { color:#89e9c0 } #s.error { color:#ffb4b4 }
  .note { font-size:12px; color:#8fa8bc }
  [hidden] { display:none !important }
</style></head><body>
<main>
<div class="brand">Íris / conexão local</div>
<h1>Seu celular.<br>Os olhos da Íris.</h1>
<p>Envie uma foto para visualizar no computador e cadastrar uma pessoa autorizada.</p>
<section class="panel" aria-label="Enviar imagem">
<span class="mode" id="modo">Foto pelo celular</span>
<video id="v" playsinline muted hidden></video>
<img id="preview" alt="Prévia da foto selecionada" hidden>
<button id="b" hidden>Ligar câmera ao vivo</button>
<button id="tirar" class="primary">Tirar foto</button>
<input id="f" type="file" accept="image/*" capture="environment" hidden>
<button id="escolher">Escolher da galeria</button>
<input id="galeria" type="file" accept="image/*" hidden>
<p id="s" role="status" aria-live="polite">Escolha uma foto ou abra a câmera do celular.</p>
</section>
<p class="note" id="limite">O QR envia fotos individuais. Nesta conexão HTTP, o navegador não libera
vídeo ao vivo. Para transmissão contínua, conecte o celular como webcam no computador ou use um app MJPEG.</p>
<p class="note">Mantenha a Íris aberta e os dois aparelhos na mesma rede. A foto é reduzida no celular
antes de ser enviada. Prefira um rosto de frente, com boa iluminação.</p>
</main>
<script>
  const v = document.getElementById('v'), s = document.getElementById('s')
  const b = document.getElementById('b'), f = document.getElementById('f')
  const galeria = document.getElementById('galeria'), preview = document.getElementById('preview')
  const tirar = document.getElementById('tirar'), escolher = document.getElementById('escolher')
  let timer = null, ocupado = false, iniciando = false, geracao = 0, falhas = 0
  const aoVivoPossivel = Boolean(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia)

  function status(texto, classe = '') { s.textContent = texto; s.className = classe }
  function atualizarBotoes() {
    tirar.disabled = escolher.disabled = ocupado || Boolean(timer) || iniciando
    b.disabled = ocupado || iniciando
  }
  tirar.onclick = () => { if (!ocupado) f.click() }
  escolher.onclick = () => { if (!ocupado) galeria.click() }

  if (aoVivoPossivel) {
    const controle = new EventSource('/controle?t=${token}')
    controle.addEventListener('parar', () => {
      parar(); controle.close(); status('Conexão encerrada no computador. Gere um novo QR para retomar.')
    })
    window.addEventListener('pagehide', () => controle.close())
    b.hidden = false
    document.getElementById('limite').textContent =
      'A conexão permite vídeo ao vivo. Mantenha esta aba aberta e a tela acesa durante a transmissão.'
  }

  function parar() {
    geracao++
    if (timer) clearInterval(timer)
    timer = null
    if (v.srcObject) v.srcObject.getTracks().forEach((track) => track.stop())
    v.srcObject = null; v.hidden = true
    b.textContent = 'Ligar câmera ao vivo'
    document.getElementById('modo').textContent = 'Foto pelo celular'
    atualizarBotoes()
  }

  b.onclick = async () => {
    if (timer) { parar(); status('Transmissão encerrada. Você pode enviar uma foto.'); return }
    iniciando = true; atualizarBotoes()
    const ciclo = geracao
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: 640, height: 480 }
      })
      if (ciclo !== geracao) { stream.getTracks().forEach(t => t.stop()); return }
      v.srcObject = stream
      await v.play()
      v.hidden = false; preview.hidden = true
      b.textContent = 'Parar transmissão'
      document.getElementById('modo').textContent = 'Vídeo ao vivo'
      status('Câmera ligada. Enviando o primeiro quadro…')
      timer = setInterval(enviar, 200)
    } catch (e) { parar(); status('Não consegui abrir a câmera. Confira a permissão ou envie uma foto.', 'error') }
    finally { iniciando = false; atualizarBotoes() }
  }

  const c = document.createElement('canvas')

  async function postar(b64, foto = false) {
    if (b64.length > ${TETO_POST}) throw new Error('A foto ainda está grande demais. Escolha outra imagem menor.')
    const controle = new AbortController()
    const limite = setTimeout(() => controle.abort(), 15000)
    try {
      const resposta = await fetch('/quadro?t=${token}' + (foto ? '&foto=1' : ''), {
        method:'POST', body:b64, signal:controle.signal
      })
      if (!resposta.ok) {
        if (resposta.status === 401 || resposta.status === 403)
          throw new Error('Esta conexão expirou. Abra um novo QR na Íris e conecte novamente.')
        if (resposta.status === 413)
          throw new Error('O computador recusou o tamanho da foto. Escolha uma imagem menor.')
        throw new Error('O computador não aceitou a foto (erro ' + resposta.status + '). Tente novamente.')
      }
    } catch (e) {
      if (e.name === 'AbortError' || e instanceof TypeError)
        throw new Error('Não consegui enviar ao computador. Confira o Wi-Fi e se a Íris está aberta, e tente novamente.')
      throw e
    } finally { clearTimeout(limite) }
  }

  async function enviar() {
    if (ocupado || !v.videoWidth) return
    ocupado = true; atualizarBotoes()
    try {
      c.width = v.videoWidth; c.height = v.videoHeight
      c.getContext('2d').drawImage(v, 0, 0)
      await postar(c.toDataURL('image/jpeg', 0.6).split(',')[1])
      falhas = 0
      status('Transmitindo para a Íris.', 'on')
    } catch (e) {
      if (/expirou/.test(e.message) || ++falhas >= 3) {
        parar(); status('Transmissão parada após perda da conexão. Reconecte pelo QR.', 'error'); return
      }
      status('Reconectando automaticamente… ' + e.message, 'error')
      await new Promise(ok => setTimeout(ok, 3000))
    }
    finally { ocupado = false; atualizarBotoes() }
  }

  async function normalizar(arq) {
    if (!arq.size) throw new Error('O arquivo está vazio. Escolha outra foto.')
    if (arq.size > 40 * 1024 * 1024) throw new Error('Escolha uma foto de até 40 MB.')
    const url = URL.createObjectURL(arq)
    try {
      const img = await new Promise((ok, falhou) => {
        const foto = new Image()
        foto.onload = () => ok(foto)
        foto.onerror = () => falhou(new Error('Não consegui abrir esta imagem. Se for HEIC/HEIF, exporte como JPG ou PNG e tente novamente.'))
        foto.src = url
      })
      const escala = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * escala))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * escala))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Não consegui preparar a foto neste navegador. Tente outro navegador.')
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      return canvas.toDataURL('image/jpeg', 0.82)
    } finally { URL.revokeObjectURL(url) }
  }

  async function enviarFoto(ev) {
    const arq = ev.target.files && ev.target.files[0]
    if (!arq || ocupado || timer) return
    ocupado = true; atualizarBotoes(); status('Preparando e enviando a foto…')
    try {
      const foto = await normalizar(arq)
      preview.src = foto; preview.hidden = false
      await postar(foto.split(',')[1], true)
      status('Foto recebida no computador. Na Íris, revise a imagem e cadastre a pessoa autorizada.', 'on')
    } catch (e) { status(e.message || 'Não consegui enviar a foto. Tente novamente.', 'error') }
    finally { ev.target.value = ''; ocupado = false; atualizarBotoes() }
  }
  f.onchange = galeria.onchange = enviarFoto
  window.addEventListener('pagehide', parar)
</script></body></html>`
  }

  function responder(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Referrer-Policy', 'no-referrer')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const token = 'encrypted' in req.socket ? segredoSeguro : segredo

    // O token vale pra TUDO, inclusive a página: sem isso, quem estiver na
    // rede descobre o caminho e passa a empurrar quadros por conta própria.
    if (!token || url.searchParams.get('t') !== token) {
      res.writeHead(403).end('token inválido')
      return
    }
    if (url.pathname === '/certificado.cer' && req.method === 'GET' && raizPublica) {
      res
        .writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-disposition': 'attachment; filename="Iris-Camera-Local.cer"'
        })
        .end(new X509Certificate(raizPublica).raw)
      return
    }
    if (url.pathname === '/controle' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' })
      res.write(': conectado\n\n')
      controles.add(res)
      req.on('close', () => controles.delete(res))
      return
    }

    if (url.pathname === '/' && req.method === 'GET') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(pagina(token))
      return
    }

    if (url.pathname === '/quadro' && req.method === 'POST') {
      const sessao = geracaoServidor
      void corpo(req).then((b) => {
        if (sessao !== geracaoServidor) {
          res.writeHead(403).end()
          return
        }
        if (!b) {
          res.writeHead(413).end()
          return
        }
        aoQuadro?.(b.toString('utf8'), url.searchParams.get('foto') === '1')
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
  async function abrirServidor(
    aoReceberQuadro: (jpegBase64: string, foto?: boolean) => void,
    estado: Estado
  ): Promise<{ url: string; qr: string } | { erro: string }> {
    aoQuadro = aoReceberQuadro
    lerEstado = estado

    const ip = ipLocal()
    if (!ip)
      return { erro: 'esta máquina não está numa rede — sem Wi-Fi não há como o celular chegar' }

    if (!segredo) segredo = randomBytes(16).toString('hex')

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

  function fecharServidor(): void {
    geracaoServidor++
    for (const controle of controles) controle.end('event: parar\ndata: {}\n\n')
    controles.clear()
    seguro?.closeAllConnections()
    seguro?.close()
    seguro = null
    segredoSeguro = ''
    servidor?.closeAllConnections()
    servidor?.close()
    servidor = null
    aoQuadro = null
    segredo = ''
  }

  async function abrirServidorSeguro(
    aoReceberQuadro: (jpeg: string, foto?: boolean) => void,
    estado: Estado
  ): Promise<
    { url: string; qr: string; certificadoQr: string; impressao: string } | { erro: string }
  > {
    const ciclo = geracaoServidor
    try {
      const local = await abrirServidor(aoReceberQuadro, estado)
      if ('erro' in local) return local
      const ip = new URL(local.url).hostname
      if (!seguro) {
        const tls = await certificadoLocal(ip)
        if (ciclo !== geracaoServidor) return { erro: 'Conexão cancelada.' }
        raizPublica = tls.raiz
        impressao = tls.impressao
        segredoSeguro = randomBytes(32).toString('hex')
        const novo = createHttpsServer(
          { key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' },
          responder
        )
        await new Promise<void>((resolve, reject) => {
          novo.once('error', reject)
          novo.listen(PORTA_SEGURA, '0.0.0.0', resolve)
        })
        if (ciclo !== geracaoServidor) {
          novo.close()
          return { erro: 'Conexão cancelada.' }
        }
        seguro = novo
      }
      const url = `https://${ip}:${PORTA_SEGURA}/?t=${segredoSeguro}`
      const certificado = new URL(local.url)
      certificado.pathname = '/certificado.cer'
      return {
        url,
        qr: await QRCode.toString(url, { type: 'svg' }),
        certificadoQr: await QRCode.toString(certificado.href, { type: 'svg' }),
        impressao
      }
    } catch (e) {
      return { erro: `Não foi possível iniciar HTTPS: ${(e as Error).message}` }
    }
  }
  return { abrirServidor, abrirServidorSeguro, fecharServidor }
}
export const { abrirServidor, abrirServidorSeguro, fecharServidor } = criarServidorCelular()

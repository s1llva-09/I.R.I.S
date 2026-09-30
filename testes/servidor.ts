import { app, BrowserWindow, nativeImage } from 'electron'
import { request } from 'http'
import { request as requestHttps } from 'https'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { abrirServidor, abrirServidorSeguro, fecharServidor } from '../src/main/servidor'

mkdirSync('out/testes', { recursive: true })
app.setPath('userData', mkdtempSync(join(process.cwd(), 'out/testes/servidor-')))
app.commandLine.appendSwitch('use-fake-device-for-media-stream')
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

/**
 * Self-check do servidor da câmera do celular (2.6). Sem celular: o que
 * precisa ser verdade é o TOKEN barrando e a página subindo.
 *
 *   npm run teste:servidor
 */
function ok(c: boolean, o: string): void {
  console.log(`${c ? '✓' : '✗'} ${o}`)
  if (!c) throw new Error(o)
}

function buscar(
  url: string,
  envio?: { corpo: string; chunked?: boolean }
): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve) => {
    const req = request(
      url,
      {
        method: envio ? 'POST' : 'GET',
        headers: envio
          ? envio.chunked
            ? { 'transfer-encoding': 'chunked' }
            : { 'content-length': Buffer.byteLength(envio.corpo) }
          : undefined
      },
      (res) => {
        let corpo = ''
        res.on('data', (d) => (corpo += d))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo }))
      }
    )
    req.on('error', () => resolve({ status: 0, corpo: '' }))
    req.setTimeout(10000, () => req.destroy(new Error('tempo limite do teste')))
    req.end(envio?.corpo)
  })
}

type ResultadoFoto = { texto: string; erro: boolean; bloqueadoDurante: boolean; liberado: boolean }

/** Executa o fluxo real de seleção, canvas e envio no Chromium do Electron. */
async function selecionarFoto(
  janela: BrowserWindow,
  resposta?: number | 'rede' | 'invalida'
): Promise<ResultadoFoto> {
  return janela.webContents.executeJavaScript(`(async () => {
    const tipo = ${JSON.stringify(resposta ?? 'ok')}
    const fetchOriginal = window.fetch
    if (typeof tipo === 'number') window.fetch = async () => new Response('', { status:tipo })
    if (tipo === 'rede') window.fetch = async () => { throw new TypeError('Failed to fetch') }
    const tela = document.createElement('canvas')
    tela.width = 2600; tela.height = 1900
    const ctx = tela.getContext('2d')
    ctx.fillStyle = '#73deef'; ctx.fillRect(0, 0, tela.width, tela.height)
    const blob = await new Promise((resolve) => tela.toBlob(resolve, 'image/png'))
    const arquivo = tipo === 'invalida'
      ? new File(['nao-e-uma-imagem'], 'foto.heic', { type:'image/heic' })
      : new File([blob], 'foto-grande.png', { type:'image/png' })
    const transferencia = new DataTransfer()
    transferencia.items.add(arquivo)
    const entrada = document.getElementById('galeria')
    entrada.files = transferencia.files
    try {
      const enviando = entrada.onchange({ target:entrada })
      const bloqueadoDurante = document.getElementById('escolher').disabled && document.getElementById('tirar').disabled
      await enviando
      return {
        texto:document.getElementById('s').textContent,
        erro:document.getElementById('s').classList.contains('error'),
        bloqueadoDurante,
        liberado:!document.getElementById('escolher').disabled && entrada.value === ''
      }
    } finally { window.fetch = fetchOriginal }
  })()`)
}

async function main(): Promise<void> {
  await app.whenReady()
  let janela: BrowserWindow | null = null
  let codigo = 0
  try {
    const quadros: Array<{ jpeg: string; foto?: boolean }> = []
    const r = await abrirServidor(
      (jpeg, foto) => quadros.push({ jpeg, foto }),
      () => ({ rostos: 1, desconhecidos: 0, conhecidos: ['teste'] })
    )
    if ('erro' in r) throw new Error(r.erro)

    ok(r.qr.includes('<svg'), 'o QR sai em SVG')
    ok(r.url.includes('?t='), 'e a URL carrega o token')

    const semToken = await buscar(r.url.split('?')[0])
    ok(semToken.status === 403, 'sem token, a página é recusada')

    const tokenErrado = await buscar(`${r.url.split('?')[0]}?t=naoehotoken`)
    ok(tokenErrado.status === 403, 'com token errado também')

    const certo = await buscar(r.url)
    ok(certo.status === 200, 'com o token certo, a página vem')
    ok(certo.corpo.includes('getUserMedia'), 'e ela pede a câmera do navegador')

    // A degradação em http:// é o conserto do "undefined is not an object":
    // a página tem que DIZER que o navegador não libera câmera fora de
    // https, e oferecer a foto, em vez de estourar num objeto inexistente.
    ok(
      certo.corpo.includes('aoVivoPossivel'),
      'e checa se o navegador expõe a câmera antes de tentar'
    )
    ok(certo.corpo.includes('capture="environment"'), 'oferece captura de foto no celular')
    ok(certo.corpo.includes('Escolher da galeria'), 'permite também escolher uma foto existente')

    const base = r.url.split('?')[0]
    const token = r.url.split('?t=')[1]
    const endpoint = `${base}quadro?t=${token}`
    const rejeitado = await buscar(`${base}quadro?t=incorreto`, { corpo: 'imagem' })
    ok(
      rejeitado.status === 403 && quadros.length === 0,
      'foto sem token válido não chega ao aplicativo'
    )

    const grande = 'a'.repeat(3_000_001)
    const muitoGrande = await buscar(endpoint, { corpo: grande })
    ok(muitoGrande.status === 413, 'arquivo grande retorna HTTP 413 em vez de derrubar a conexão')
    const chunkedGrande = await buscar(endpoint, { corpo: grande, chunked: true })
    ok(
      chunkedGrande.status === 413 && quadros.length === 0,
      'limita também upload sem Content-Length'
    )

    janela = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    await janela.loadURL(r.url)
    const foto = await selecionarFoto(janela)
    ok(
      !foto.erro && foto.texto.includes('Foto recebida'),
      'confirma sucesso apenas após o computador receber a foto'
    )
    ok(
      foto.bloqueadoDurante && foto.liberado,
      'bloqueia envio duplicado e libera os botões ao terminar'
    )
    ok(
      quadros.length === 1 && quadros[0].foto === true,
      'foto enviada traz a origem de imagem estática'
    )
    const bytes = Buffer.from(quadros[0].jpeg, 'base64')
    const tamanho = nativeImage.createFromBuffer(bytes).getSize()
    ok(bytes[0] === 0xff && bytes[1] === 0xd8, 'PNG do celular é convertido para JPEG')
    ok(
      tamanho.width === 1600 && tamanho.height < 1600,
      'foto é reduzida a 1600 pixels mantendo a proporção'
    )

    const expirou = await selecionarFoto(janela, 403)
    ok(
      expirou.erro && expirou.texto.includes('novo QR') && expirou.liberado,
      'token expirado pede novo QR e permite tentar novamente'
    )
    const tamanhoRecusado = await selecionarFoto(janela, 413)
    ok(
      tamanhoRecusado.erro && tamanhoRecusado.texto.includes('tamanho'),
      'HTTP 413 não é apresentado como sucesso'
    )
    const semRede = await selecionarFoto(janela, 'rede')
    ok(semRede.erro && semRede.texto.includes('Wi-Fi'), 'falha de rede orienta conferir a conexão')
    const invalida = await selecionarFoto(janela, 'invalida')
    ok(
      invalida.erro && invalida.texto.includes('HEIC/HEIF') && invalida.liberado,
      'imagem que não decodifica orienta exportar JPG/PNG'
    )
    ok(quadros.length === 1, 'nenhum envio com erro foi entregue como foto válida')

    await buscar(endpoint, { corpo: quadros[0].jpeg })
    ok(quadros[1].foto === false, 'envio antigo sem marcador continua sendo quadro da transmissão')

    const estado = await buscar(`${r.url.split('?')[0]}estado?t=${r.url.split('?t=')[1]}`)
    ok(JSON.parse(estado.corpo).conhecidos[0] === 'teste', 'o /estado devolve a leitura atual')

    const denovo = await abrirServidor(
      () => {},
      () => ({ rostos: 0, desconhecidos: 0, conhecidos: [] })
    )
    ok(!('erro' in denovo) && denovo.url === r.url, 'chamar de novo não sobe um segundo servidor')

    let recebidos = 0
    const seguro = await abrirServidorSeguro(
      () => recebidos++,
      () => ({ rostos: 0, desconhecidos: 0, conhecidos: [] })
    )
    if ('erro' in seguro) throw new Error(seguro.erro)
    const ca = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'camera-tls/autoridade.json'), 'utf8')
    ).cert
    const consultar = (url: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const req = requestHttps(url, { ca }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
        req.end()
      })
    ok((await consultar(seguro.url)) === 200, 'HTTPS valida a cadeia e o IP com a CA local')
    const invasao = new URL(seguro.url)
    invasao.searchParams.set('t', new URL(r.url).searchParams.get('t')!)
    ok((await consultar(invasao.href)) === 403, 'token HTTP não autoriza a sessão HTTPS')
    const certificado = new URL(r.url)
    certificado.pathname = '/certificado.cer'
    ok(
      (await buscar(certificado.href)).status === 200,
      'certificado público disponível para instalar no celular'
    )
    janela.webContents.session.setCertificateVerifyProc((req, callback) => {
      callback(req.hostname === new URL(seguro.url).hostname ? 0 : -3)
    })
    await janela.loadURL(seguro.url)
    ok(
      await janela.webContents.executeJavaScript(
        'window.isSecureContext && !document.getElementById("b").hidden'
      ),
      'página HTTPS habilita vídeo ao vivo'
    )
    await janela.webContents.executeJavaScript('document.getElementById("b").click()')
    for (let i = 0; i < 50 && recebidos < 2; i++)
      await new Promise((resolve) => setTimeout(resolve, 100))
    ok(recebidos >= 2, 'câmera simulada envia quadros contínuos pelo HTTPS')
    fecharServidor()
    await new Promise((resolve) => setTimeout(resolve, 500))
    ok(
      await janela.webContents.executeJavaScript('document.getElementById("v").srcObject === null'),
      'encerrar a sessão desliga a câmera remota'
    )

    console.log('\nOK')
  } catch (e) {
    console.log(`\n✗ ${(e as Error).message}`)
    codigo = 1
  }
  janela?.destroy()
  fecharServidor()
  app.exit(codigo)
}

void main()

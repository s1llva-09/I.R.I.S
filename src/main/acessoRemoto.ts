import { createServer as httpsServer } from 'https'
import { createServer as httpServer } from 'http'
import { networkInterfaces } from 'os'
import { randomBytes, timingSafeEqual, X509Certificate } from 'crypto'
import QRCode from 'qrcode'
import { certificadoLocal } from './tlsLocal'
import { safeStorage, nativeImage } from 'electron'
import icon from '../../resources/icon.png?asset'
import { lerConfig, gravarConfig } from './banco'
import { chavePublicaPush, cadastrarPush, revogarPush } from './notificacoesCelular'
import { paginaCelular, workerCelular } from './paginaCelular'
import type { EstadoVigilancia } from '../shared/vigilancia'
import type { criarCentralCameras } from './centralCameras'

export function enderecosPrivados(): string[] {
  return Object.values(networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address)
    .filter((ip) =>
      /^10\.|^192\.168\.|^172\.(1[6-9]|2\d|3[01])\.|^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(
        ip
      )
    )
}
export class AcessoRemoto {
  private servidor: ReturnType<typeof httpsServer> | null = null
  private certificado: ReturnType<typeof httpServer> | null = null
  private segredo = ''
  private ciclo = 0
  parar(): void {
    this.ciclo++
    this.segredo = ''
    this.servidor?.closeAllConnections()
    this.servidor?.close()
    this.certificado?.closeAllConnections()
    this.certificado?.close()
    this.servidor = null
    this.certificado = null
  }
  constructor(
    private central: ReturnType<typeof criarCentralCameras>,
    private vigia: () => EstadoVigilancia
  ) {}
  revogar(): void {
    this.parar()
    gravarConfig('acessoCelular', null)
    revogarPush()
  }
  async restaurar(): Promise<void> {
    const salvo = lerConfig('acessoCelular') as { ip: string } | null
    if (salvo && enderecosPrivados().includes(salvo.ip)) await this.abrir(salvo.ip)
  }
  async abrir(
    ip: string
  ): Promise<{ url: string; qr: string; certificadoQr: string; impressao: string }> {
    if (!enderecosPrivados().includes(ip))
      throw new Error('Escolha um endereço privado deste computador (LAN ou VPN).')
    this.parar()
    const ciclo = this.ciclo
    const tls = await certificadoLocal(ip)
    if (ciclo !== this.ciclo) throw new Error('Acesso cancelado.')
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Armazenamento seguro indisponível.')
    const salvo = lerConfig('acessoCelular') as { ip: string; segredo: string } | null
    this.segredo = salvo
      ? safeStorage.decryptString(Buffer.from(salvo.segredo, 'base64'))
      : randomBytes(32).toString('hex')
    const origem = `https://${ip}:8798`
    const autenticar = (valor: string): boolean =>
      !!this.segredo &&
      /^[a-f0-9]{64}$/.test(valor) &&
      timingSafeEqual(Buffer.from(valor), Buffer.from(this.segredo))
    const server = httpsServer(
      { key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' },
      (req, res) => {
        res.setHeader('Cache-Control', 'no-store')
        res.setHeader('Referrer-Policy', 'no-referrer')
        res.setHeader('X-Content-Type-Options', 'nosniff')
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; img-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; worker-src 'self'; frame-ancestors 'none'"
        )
        let url: URL
        try {
          url = new URL(req.url ?? '/', origem)
        } catch {
          res.writeHead(400).end()
          return
        }
        if (req.method === 'POST' && req.headers.origin !== origem) {
          res.writeHead(403).end()
          return
        }
        if (url.pathname === '/sessao' && req.method === 'POST') {
          let corpo = ''
          req.on('data', (d) => {
            corpo += d
            if (corpo.length > 128) req.destroy()
          })
          req.on('end', () => {
            if (!autenticar(corpo)) {
              res.writeHead(403).end()
              return
            }
            res.setHeader(
              'Set-Cookie',
              `iris=${this.segredo}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=7776000`
            )
            res.writeHead(204).end()
          })
          return
        }
        if (url.pathname === '/' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(paginaCelular)
          return
        }
        if (url.pathname === '/sw.js' && req.method === 'GET') {
          res
            .writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' })
            .end(workerCelular)
          return
        }
        if (url.pathname === '/manifest.webmanifest' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/manifest+json' }).end(
            JSON.stringify({
              id: '/',
              name: 'Íris Segurança',
              short_name: 'Íris',
              start_url: '/',
              scope: '/',
              display: 'standalone',
              background_color: '#101216',
              theme_color: '#101216',
              icons: [{ src: '/icone.png', sizes: '512x512', type: 'image/png' }]
            })
          )
          return
        }
        if (url.pathname === '/icone.png' && req.method === 'GET') {
          res
            .writeHead(200, { 'content-type': 'image/png' })
            .end(nativeImage.createFromPath(icon).resize({ width: 512, height: 512 }).toPNG())
          return
        }
        if (url.pathname === '/sair' && req.method === 'POST') {
          res.setHeader('Set-Cookie', 'iris=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0')
          res.writeHead(204).end()
          return
        }
        const cookie =
          (req.headers.cookie ?? '')
            .split(';')
            .map((x) => x.trim())
            .find((x) => x.startsWith('iris='))
            ?.slice(5) ?? ''
        if (!autenticar(cookie)) {
          res.writeHead(403).end()
          return
        }
        if (url.pathname === '/seguranca' && req.method === 'GET') {
          const v = this.vigia()
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify({
              modo: v.modo,
              erro: v.erro,
              cameras: v.cameras.map((c) => ({
                ...c,
                nome: this.central.listar().find((x) => x.id === c.id)?.nome ?? 'Câmera'
              })),
              eventos: v.eventos.slice(0, 50).map((e) => ({
                id: e.id,
                momento: e.momento,
                camera: e.camera,
                texto: e.texto,
                temImagem: !!e.imagem
              }))
            })
          )
          return
        }
        if (url.pathname.startsWith('/evento/') && req.method === 'GET') {
          const evento = this.vigia().eventos.find((e) => e.id === url.pathname.slice(8))
          if (!evento?.imagem) {
            res.writeHead(404).end()
            return
          }
          res
            .writeHead(200, { 'content-type': 'image/jpeg' })
            .end(Buffer.from(evento.imagem.replace(/^data:image\/jpeg;base64,/, ''), 'base64'))
          return
        }
        if (url.pathname === '/push/chave' && req.method === 'GET') {
          try {
            const key = chavePublicaPush()
            res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ key }))
          } catch {
            res.writeHead(503).end()
          }
          return
        }
        if (url.pathname === '/push/inscrever' && req.method === 'POST') {
          let corpo = ''
          req.on('data', (d) => {
            corpo += d
            if (corpo.length > 5000) req.destroy()
          })
          req.on('end', () => {
            try {
              if (!autenticar(cookie)) throw new Error('Acesso revogado.')
              const d = JSON.parse(corpo)
              cadastrarPush(d.subscription, d.nome)
              res.writeHead(200, { 'content-type': 'application/json' }).end('{}')
            } catch (e) {
              res
                .writeHead(400, { 'content-type': 'application/json' })
                .end(JSON.stringify({ erro: (e as Error).message }))
            }
          })
          return
        }
        if (url.pathname === '/estado' && req.method === 'GET') {
          res.writeHead(200, { 'content-type': 'application/json' }).end(
            JSON.stringify(
              this.central.listar().map((c) => {
                const q = this.central.quadro(c.id)
                return {
                  id: c.id,
                  nome: c.nome,
                  ambiente: c.ambiente,
                  sinal: !!q && !q.foto && Date.now() - q.momento < 6000
                }
              })
            )
          )
          return
        }
        if (url.pathname.startsWith('/frame/') && req.method === 'GET') {
          const q = this.central.quadro(url.pathname.slice(7))
          if (!q || q.foto || Date.now() - q.momento > 6000) {
            res.writeHead(410).end()
            return
          }
          res.writeHead(200, { 'content-type': 'image/jpeg' }).end(Buffer.from(q.jpeg, 'base64'))
          return
        }
        res.writeHead(404).end()
      }
    )
    const cert = httpServer((_req, res) => {
      res
        .writeHead(200, {
          'content-type': 'application/x-x509-ca-cert',
          'content-disposition': 'attachment; filename="Iris-Camera-Local.cer"'
        })
        .end(new X509Certificate(tls.raiz).raw)
    })
    this.servidor = server
    this.certificado = cert
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(8798, ip, resolve)
      })
      await new Promise<void>((resolve, reject) => {
        cert.once('error', reject)
        cert.listen(8799, ip, resolve)
      })
      if (ciclo !== this.ciclo) throw new Error('Acesso cancelado.')
      gravarConfig('acessoCelular', {
        ip,
        segredo: safeStorage.encryptString(this.segredo).toString('base64')
      })
      const url = `${origem}/#${this.segredo}`
      return {
        url,
        qr: await QRCode.toString(url, { type: 'svg' }),
        certificadoQr: await QRCode.toString(`http://${ip}:8799/`, { type: 'svg' }),
        impressao: tls.impressao
      }
    } catch (e) {
      if (ciclo === this.ciclo) this.parar()
      throw e
    }
  }
}

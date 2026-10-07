import { app, BrowserWindow, session, nativeImage } from 'electron'
import assert from 'node:assert/strict'
import { request } from 'https'
import { writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes, createECDH } from 'crypto'
import { VigiaMotor } from '../src/main/vigiaMotor'
import {
  horarioAtivo,
  pontoNaZona,
  validarAjustes,
  PADRAO_VIGILANCIA,
  type EventoVigilancia,
  type EstadoVigilancia
} from '../src/shared/vigilancia'
import type { QuadroCamera } from '../src/shared/cameras'

app.setPath('userData', process.env.IRIS_TESTE_DIR!)
app.disableHardwareAcceleration()
void app.whenReady().then(async () => {
  let remoto: { parar: () => void } | null = null
  let win: BrowserWindow | null = null
  try {
    const quadrado = [
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.2 },
      { x: 0.8, y: 0.8 },
      { x: 0.2, y: 0.8 }
    ]
    assert.equal(pontoNaZona({ x: 0.5, y: 0.5 }, quadrado), true)
    assert.equal(pontoNaZona({ x: 0.1, y: 0.5 }, quadrado), false)
    assert.equal(pontoNaZona({ x: 0.2, y: 0.5 }, quadrado), true)
    const config = structuredClone(PADRAO_VIGILANCIA)
    config.cameras = [
      { cameraId: 'a', zonas: [{ id: 'entrada', nome: 'Entrada', pontos: quadrado }] }
    ]
    assert.deepEqual(validarAjustes(config), config)
    assert.throws(() => validarAjustes({ ...config, permanencia: 0 }))
    assert.throws(() =>
      validarAjustes({ ...config, cameras: [config.cameras[0], config.cameras[0]] })
    )
    const agenda = { ativa: true, inicio: '22:00', fim: '06:00', dias: [1] }
    assert.equal(horarioAtivo(agenda, new Date(2026, 9, 5, 23)), true)
    assert.equal(horarioAtivo(agenda, new Date(2026, 9, 6, 5)), true)
    assert.equal(horarioAtivo(agenda, new Date(2026, 9, 6, 6)), false)
    assert.equal(horarioAtivo(agenda, new Date(2026, 9, 6, 23)), false)
    let agora = 100000,
      chamadas = 0
    const quadros = new Map<string, QuadroCamera>()
    const eventos: EventoVigilancia[] = []
    let pessoas = [{ score: 0.9, box: { xmin: 0.3, ymin: 0.1, xmax: 0.5, ymax: 0.6 } }]
    let resolver: ((valor: typeof pessoas) => void) | null = null
    const motor = new VigiaMotor({
      listar: () => [
        { id: 'a', nome: 'Sala', ambiente: 'Sala', tipo: 'webcam', endereco: 'teste' }
      ],
      quadro: (id) => quadros.get(id) ?? null,
      analisar: async () => {
        chamadas++
        if (resolver === null) return pessoas
        return new Promise((r) => {
          resolver = r
        })
      },
      evento: (e) => eventos.push(e),
      agora: () => agora
    })
    const frame = (): void => {
      quadros.set('a', { id: 'a', momento: agora, jpeg: 'teste', foto: false })
    }
    motor.armar(config)
    frame()
    await motor.tique()
    assert.equal(eventos.length, 0, 'Uma única detecção não alerta')
    await motor.tique()
    assert.equal(chamadas, 1, 'Não reanalisa a mesma imagem')
    agora += 2000
    frame()
    await motor.tique()
    assert.equal(eventos.length, 0, 'Passagem rápida não alerta')
    agora += 1000
    frame()
    await motor.tique()
    assert.equal(eventos.filter((e) => e.tipo === 'pessoa').length, 1)
    agora += 1000
    frame()
    await motor.tique()
    assert.equal(eventos.length, 1, 'Intervalo impede duplicação')
    pessoas = [{ score: 0.9, box: { xmin: 0.3, ymin: 0.1, xmax: 0.5, ymax: 0.95 } }]
    agora += 1000
    frame()
    await motor.tique()
    assert.equal(eventos.length, 1, 'Os pés fora da área não disparam')
    agora += 16000
    await motor.tique()
    assert.equal(eventos.filter((e) => e.tipo === 'offline').length, 1)
    await motor.tique()
    assert.equal(
      eventos.filter((e) => e.tipo === 'offline').length,
      1,
      'Uma queda gera só um aviso'
    )
    frame()
    await motor.tique()
    assert.equal(eventos.filter((e) => e.tipo === 'recuperada').length, 1)
    motor.parar()
    motor.armar(config)
    agora += 16000
    quadros.set('a', { id: 'a', momento: agora, jpeg: 'teste', foto: true })
    await motor.tique()
    assert.match(eventos.at(-1)!.texto, /estática/)
    motor.parar()
    motor.armar(config)
    resolver = () => {}
    agora += 1000
    frame()
    const pendente = motor.tique()
    motor.parar()
    resolver!([{ score: 1, box: { xmin: 0.2, ymin: 0.2, xmax: 0.7, ymax: 0.7 } }])
    await pendente
    assert.deepEqual(motor.estado(), [], 'Resultado atrasado não reativa a proteção')
    console.log(
      'PASS perímetro: geometria, horários, permanência, intervalo, queda, recuperação, foto e cancelamento'
    )
    const banco = await import('../src/main/banco')
    banco.salvarEventoPerimetro({ ...eventos[0], id: 'antigo', momento: Date.now() - 8 * 86400000 })
    banco.salvarEventoPerimetro({
      ...eventos[0],
      id: 'recente',
      momento: Date.now(),
      entrega: 'pendente'
    })
    banco.salvarEventoPerimetro({
      ...eventos[0],
      id: 'enviado',
      momento: Date.now(),
      entrega: 'enviado'
    })
    assert.equal(banco.listarEventosPerimetro(7).length, 2, 'Retenção remove eventos vencidos')
    assert.deepEqual(
      banco.listarEventosPerimetro(7, true).map((e) => e.id),
      ['recente'],
      'Fila só lê eventos pendentes'
    )
    banco.apagarEventosPerimetro()
    assert.equal(banco.listarEventosPerimetro().length, 0)
    console.log('PASS histórico: persistência, retenção, seleção de pendentes e exclusão')

    const { cadastrarPush, estadoPush, FilaAlertas, revogarPush } =
      await import('../src/main/notificacoesCelular')
    const ec = createECDH('prime256v1')
    ec.generateKeys()
    const keys = {
      auth: randomBytes(16).toString('base64url'),
      p256dh: ec.getPublicKey().toString('base64url')
    }
    assert.throws(() => cadastrarPush({ endpoint: 'https://127.0.0.1/privado', keys }, 'teste'))
    assert.throws(() =>
      cadastrarPush({ endpoint: 'https://fcm.googleapis.com.evil.example/push', keys }, 'teste')
    )
    cadastrarPush({ endpoint: 'https://fcm.googleapis.com/fixture/um', keys }, 'Celular A')
    cadastrarPush({ endpoint: 'https://web.push.apple.com/fixture/dois', keys }, 'Celular B')
    assert.equal(estadoPush().dispositivos.length, 2)
    let falhar = true
    const enviados: string[] = []
    let evento: EventoVigilancia = {
      id: 'fila',
      momento: Date.now(),
      cameraId: 'a',
      camera: 'Sala',
      tipo: 'pessoa',
      texto: 'Teste isolado',
      entrega: 'pendente'
    }
    const fila = new FilaAlertas(
      () => [evento],
      (e) => {
        evento = e
      },
      async (sub) => {
        enviados.push(sub.endpoint)
        if (sub.endpoint.endsWith('dois') && falhar) throw Error('rede')
        return { statusCode: 201, body: '', headers: {} }
      },
      () => agora
    )
    agora = Date.now()
    await fila.tique()
    assert.equal(evento.entrega, 'pendente')
    assert.equal(evento.enviados?.length, 1)
    falhar = false
    agora += 31000
    await fila.tique()
    assert.equal(evento.entrega, 'enviado')
    assert.equal(
      enviados.filter((s) => s.endsWith('um')).length,
      1,
      'Repetição não duplica sucesso de outro celular'
    )
    const webpush = (await import('web-push')).default
    const original = webpush.sendNotification
    webpush.sendNotification = async function (this: typeof webpush, sub, payload, options) {
      assert.equal(this, webpush, 'Transporte mantém o contexto da biblioteca')
      assert.ok(payload)
      assert.ok(
        this.generateRequestDetails(sub, payload, options).body,
        'Payload push é cifrado antes do envio'
      )
      return { statusCode: 201, body: '', headers: {} }
    }
    try {
      evento = { ...evento, id: 'padrao', enviados: [], entrega: 'pendente' }
      await new FilaAlertas(
        () => [evento],
        (e) => {
          evento = e
        }
      ).tique()
      assert.equal(evento.entrega, 'enviado')
    } finally {
      webpush.sendNotification = original
    }
    evento = { ...evento, id: 'velho', momento: agora - 3600001, entrega: 'pendente' }
    await fila.tique()
    assert.equal(evento.entrega, 'falhou')
    evento = { ...evento, id: 'cancelado', momento: agora, entrega: 'pendente', enviados: [] }
    let concluir: () => void = () => {}
    const cancelada = new FilaAlertas(
      () => [evento],
      (e) => {
        evento = e
      },
      () =>
        new Promise((r) => {
          concluir = () => r({ statusCode: 201, body: '', headers: {} })
        }),
      () => agora
    )
    const envio = cancelada.tique()
    cancelada.cancelar()
    concluir()
    await envio
    assert.equal(evento.entrega, 'pendente', 'Envio em andamento não ressuscita histórico apagado')
    revogarPush()
    await fila.tique()
    assert.equal(evento.entrega, 'desativado')
    console.log(
      'PASS fila push: destinos validados, envio parcial, repetição, expiração e cancelamento; transporte simulado'
    )

    const { criarCentralCameras } = await import('../src/main/centralCameras')
    const { AcessoRemoto, enderecosPrivados } = await import('../src/main/acessoRemoto')
    let salvas: import('../src/shared/cameras').CameraSalva[] = []
    const central = criarCentralCameras(
      () => salvas,
      (cs) => {
        salvas = cs
      },
      () => {}
    )
    const c = central.salvar({
      id: '',
      nome: 'Sala de teste',
      ambiente: 'Sala',
      tipo: 'webcam',
      endereco: 'fixture'
    })
    await central.conectar(c.id)
    const jpeg = nativeImage
      .createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
          'base64'
        )
      )
      .toJPEG(70)
      .toString('base64')
    central.receberWebcam(c.id, 'sessao-invalida', jpeg)
    assert.equal(central.quadro(c.id), null)
    central.falhaWebcam(c.id, central.listar()[0].sessao!, true)
    assert.match(central.listar()[0].erro, /Permita/)
    central.receberWebcam(c.id, central.listar()[0].sessao!, jpeg)
    assert.ok(central.quadro(c.id))
    assert.equal(central.listar()[0].erro, '')
    const estado: EstadoVigilancia = {
      modo: 'armado',
      erro: '',
      modelo: 'fixture',
      ajustes: config,
      cameras: [],
      eventos: [
        { ...evento, id: 'evento', entrega: 'desativado', imagem: 'data:image/jpeg;base64,' + jpeg }
      ],
      notificacoes: { configurado: false, dispositivos: [] }
    }
    const acesso = new AcessoRemoto(central, () => estado)
    remoto = acesso
    const ip = enderecosPrivados()[0]
    assert.ok(ip, 'Teste exige uma interface privada')
    const pareamento = await acesso.abrir(ip)
    const origem = new URL(pareamento.url).origin
    const requisitar = (
      caminho: string,
      metodo = 'GET',
      cookie = '',
      corpo = '',
      origin = origem
    ): Promise<{ status: number; headers: import('http').IncomingHttpHeaders; body: string }> =>
      new Promise((resolve, reject) => {
        const req = request(
          origem + caminho,
          {
            method: metodo,
            rejectUnauthorized: false,
            headers: { Origin: origin, Cookie: cookie, 'content-type': 'text/plain' }
          },
          (res) => {
            const chunks: Buffer[] = []
            res.on('data', (d) => chunks.push(d))
            res.on('end', () =>
              resolve({
                status: res.statusCode!,
                headers: res.headers,
                body: Buffer.concat(chunks).toString()
              })
            )
          }
        )
        req.on('error', reject)
        req.end(corpo)
      })
    assert.equal((await requisitar('/estado')).status, 403)
    assert.equal((await requisitar('/frame/' + c.id)).status, 403)
    const token = new URL(pareamento.url).hash.slice(1)
    assert.equal(
      (await requisitar('/sessao', 'POST', '', token, 'https://intruso.example')).status,
      403
    )
    const login = await requisitar('/sessao', 'POST', '', token)
    assert.equal(login.status, 204)
    assert.match(login.headers['set-cookie']![0], /HttpOnly; Secure; SameSite=Strict/)
    const cookie = login.headers['set-cookie']![0].split(';')[0]
    const lista = await requisitar('/estado', 'GET', cookie)
    assert.equal(JSON.parse(lista.body)[0].nome, 'Sala de teste')
    assert.ok(!lista.body.includes('fixture'), 'Dispositivo e endereços internos não são expostos')
    assert.equal((await requisitar('/frame/' + c.id, 'GET', cookie)).status, 200)
    assert.equal((await requisitar('/evento/evento', 'GET', cookie)).status, 200)
    assert.equal(
      (await requisitar('/vigilancia/armar', 'POST', cookie)).status,
      404,
      'Painel do celular tem somente consulta'
    )
    assert.equal((await requisitar('/manifest.webmanifest')).status, 200)
    assert.match((await requisitar('/sw.js')).body, /notificationclick/)
    const isolated = session.fromPartition('teste-iris-celular')
    isolated.setCertificateVerifyProc((_req, cb) => cb(0))
    isolated.setPermissionRequestHandler((_wc, _p, cb) => cb(false))
    win = new BrowserWindow({
      width: 390,
      height: 844,
      useContentSize: true,
      show: false,
      webPreferences: { offscreen: true, session: isolated, backgroundThrottling: false }
    })
    await win.loadURL(pareamento.url)
    for (let i = 0; i < 50; i++) {
      if (
        await win.webContents.executeJavaScript(
          "document.getElementById('conexao').textContent==='PC conectado'"
        )
      )
        break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(
      await win.webContents.executeJavaScript("document.getElementById('status').textContent"),
      'Fora de casa · ativo'
    )
    assert.equal(
      await win.webContents.executeJavaScript("document.querySelector('main h2').textContent"),
      'Sala de teste'
    )
    assert.equal(
      await win.webContents.executeJavaScript('location.hash'),
      '',
      'Segredo removido da barra de endereço'
    )
    assert.equal(
      await win.webContents.executeJavaScript('document.documentElement.scrollWidth<=innerWidth'),
      true
    )
    writeFileSync(
      join(process.env.IRIS_TESTE_DIR!, 'celular.png'),
      (await win.webContents.capturePage()).toPNG()
    )
    await win.webContents.executeJavaScript("document.querySelector('[data-aba=eventos]').click()")
    for (let i = 0; i < 30; i++) {
      if (await win.webContents.executeJavaScript("!!document.querySelector('.evento')")) break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.match(
      await win.webContents.executeJavaScript("document.getElementById('eventos').textContent"),
      /Teste isolado/
    )
    await win.webContents.executeJavaScript(
      "navigator.serviceWorker.getRegistration=async()=>({});document.getElementById('sair').click()"
    )
    for (let i = 0; i < 30; i++) {
      if (
        await win.webContents.executeJavaScript(
          "document.getElementById('status').textContent==='Painel desconectado.'"
        )
      )
        break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(
      await win.webContents.executeJavaScript("fetch('/estado').then(r=>r.status)"),
      403,
      'Sair apaga a sessão mesmo sem suporte a push'
    )
    await win.webContents.executeJavaScript(
      `document.getElementById('link').value=${JSON.stringify(pareamento.url)};document.getElementById('confirmar').click()`
    )
    for (let i = 0; i < 30; i++) {
      if (
        await win.webContents.executeJavaScript(
          "document.getElementById('conexao').textContent==='PC conectado'"
        )
      )
        break
      await new Promise((r) => setTimeout(r, 100))
    }
    assert.equal(
      await win.webContents.executeJavaScript("document.getElementById('parear').hidden"),
      true,
      'App pode parear pelo link depois de instalado'
    )
    acesso.revogar()
    await acesso.abrir(ip)
    assert.equal(
      (await requisitar('/estado', 'GET', cookie)).status,
      403,
      'Revogação invalida sessões existentes'
    )
    central.pararTudo()
    assert.equal(central.quadro(c.id), null)
    console.log(
      'PASS Íris móvel: HTTPS, sessão, origem, imagens autenticadas, PWA, layout de 390px, histórico e revogação'
    )
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  } finally {
    win?.destroy()
    remoto?.parar()
  }
})

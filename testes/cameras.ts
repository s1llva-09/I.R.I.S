import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { request } from 'https'
import { mkdirSync, mkdtempSync, readFileSync } from 'fs'
import { join } from 'path'
import { criarCentralCameras } from '../src/main/centralCameras'
import { criarConexaoCamera } from '../src/main/camera'
import { criarServidorCelular } from '../src/main/servidor'
import type { CameraSalva, QuadroCamera } from '../src/shared/cameras'

mkdirSync('out/testes', { recursive: true })
app.setPath('userData', mkdtempSync(join(process.cwd(), 'out/testes/cameras-')))
const esperar = async (condicao: () => boolean): Promise<void> => {
  for (let i = 0; i < 70 && !condicao(); i++)
    await new Promise((resolve) => setTimeout(resolve, 100))
  assert.ok(condicao(), 'Condição não atingida no tempo esperado')
}
void app.whenReady().then(async () => {
  let codigo = 0
  let salvas: CameraSalva[] = []
  const quadros: QuadroCamera[] = []
  const central = criarCentralCameras(
    () => structuredClone(salvas),
    (cs) => {
      salvas = structuredClone(cs)
    },
    (q) => quadros.push(q)
  )
  const abertas = new Map<string, number>()
  const servidor = createServer((req, res) => {
    const rota = req.url ?? ''
    abertas.set(rota, (abertas.get(rota) ?? 0) + 1)
    res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' })
    const quadro = Buffer.from([255, 216, rota === '/sala' ? 1 : 2, 255, 217])
    res.write(quadro)
    const timer = setInterval(() => res.write(quadro), 100)
    req.on('close', () => {
      clearInterval(timer)
      abertas.set(rota, (abertas.get(rota) ?? 1) - 1)
    })
  })
  const a = criarServidorCelular(8900, 8901),
    b = criarServidorCelular(8902, 8903)
  try {
    await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(servidor.address() as { port: number }).port}`
    const sala = central.salvar({
      id: '',
      nome: 'Câmera 1',
      ambiente: 'Sala',
      tipo: 'rede',
      endereco: base + '/sala'
    })
    const quarto = central.salvar({
      id: '',
      nome: 'Câmera 2',
      ambiente: 'Quarto',
      tipo: 'rede',
      endereco: base + '/quarto'
    })
    await Promise.all([central.conectar(sala.id), central.conectar(quarto.id)])
    await esperar(() => new Set(quadros.map((q) => q.id)).size === 2)
    assert.notEqual(
      quadros.find((q) => q.id === sala.id)?.jpeg,
      quadros.find((q) => q.id === quarto.id)?.jpeg
    )
    const sessao = central.listar()[0].sessao
    central.salvar({ ...sala, nome: 'Sala principal' })
    assert.equal(central.listar()[0].sessao, sessao, 'renomear preserva a conexão')
    central.parar(sala.id)
    const antes = quadros.filter((q) => q.id === sala.id).length
    const antesQuarto = quadros.filter((q) => q.id === quarto.id).length
    await esperar(() => quadros.filter((q) => q.id === quarto.id).length > antesQuarto + 1)
    assert.equal(
      quadros.filter((q) => q.id === sala.id).length,
      antes,
      'pausar sala não deixa quadros atrasados'
    )
    assert.equal(central.listar().find((c) => c.id === quarto.id)?.ligada, true)
    central.salvar({ ...quarto, endereco: base + '/novo' })
    assert.equal(
      central.listar().find((c) => c.id === quarto.id)?.ligada,
      false,
      'mudar endereço encerra a conexão antiga'
    )
    assert.throws(() => central.salvar({ ...sala, endereco: 'rtsp://camera/video' }), /MJPEG/)
    const recarregada = criarCentralCameras(
      () => structuredClone(salvas),
      () => {},
      () => {}
    )
    assert.equal(recarregada.listar()[0].nome, 'Sala principal')
    assert.equal(
      recarregada.listar()[0].ligada,
      false,
      'cadastros não iniciam câmera automaticamente'
    )
    central.remover(sala.id)
    assert.equal(central.listar().length, 1)
    await central.conectar(quarto.id)
    central.pararTudo()
    assert.ok(central.listar().every((c) => !c.ligada && c.ultimoQuadro === null))
    console.log(
      'PASS mosaico: duas fontes simultâneas, edição, persistência, pausa e remoção isoladas'
    )

    // ESP32-CAM atende um cliente: visor e mosaico precisam dividir a conexão.
    const visor = criarConexaoCamera()
    let noVisor = 0
    const entrada = central.salvar({
      id: '',
      nome: 'Porta',
      ambiente: 'Entrada',
      tipo: 'rede',
      endereco: base + '/porta'
    })
    await central.conectar(entrada.id)
    visor.conectar(base + '/porta', () => noVisor++)
    await esperar(() => noVisor > 2 && quadros.some((q) => q.id === entrada.id))
    assert.equal(abertas.get('/porta'), 1, 'visor e mosaico usam uma conexão só')
    central.parar(entrada.id)
    const vistos = noVisor
    await esperar(() => noVisor > vistos + 2)
    assert.equal(abertas.get('/porta'), 1, 'pausar o mosaico não derruba o visor')
    visor.desconectarCamera()
    await esperar(() => abertas.get('/porta') === 0)
    console.log(
      'PASS câmera de um cliente: visor e mosaico dividem a conexão e saem sem derrubar o outro'
    )

    let recebidosA = 0,
      recebidosB = 0
    const estado = (): { rostos: number; desconhecidos: number; conhecidos: string[] } => ({
      rostos: -1,
      desconhecidos: 0,
      conhecidos: []
    })
    const [pa, pb] = await Promise.all([
      a.abrirServidorSeguro(() => recebidosA++, estado),
      b.abrirServidorSeguro(() => recebidosB++, estado)
    ])
    if ('erro' in pa || 'erro' in pb) throw new Error(JSON.stringify([pa, pb]))
    assert.notEqual(pa.url, pb.url)
    assert.equal(pa.impressao, pb.impressao, 'celulares simultâneos usam a mesma CA')
    const ca = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'camera-tls/autoridade.json'), 'utf8')
    ).cert
    const enviar = (base: string, token?: string): Promise<number> =>
      new Promise((resolve, reject) => {
        const url = new URL(base)
        url.pathname = '/quadro'
        if (token) url.searchParams.set('t', token)
        const req = request(url, { ca, method: 'POST' }, (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        })
        req.on('error', reject)
        req.end('/9j/AAAA')
      })
    assert.equal(await enviar(pa.url), 204)
    assert.equal(await enviar(pb.url), 204)
    assert.equal(await enviar(pa.url, new URL(pb.url).searchParams.get('t')!), 403)
    assert.deepEqual([recebidosA, recebidosB], [1, 1])
    a.fecharServidor()
    assert.equal(await enviar(pb.url), 204)
    assert.deepEqual([recebidosA, recebidosB], [1, 2])
    console.log(
      'PASS celulares: dois HTTPS simultâneos, pareamentos isolados e fechamento independente'
    )
  } catch (e) {
    console.error(e)
    codigo = 1
  } finally {
    central.pararTudo()
    a.fecharServidor()
    b.fecharServidor()
    servidor.closeAllConnections()
    servidor.close()
    app.exit(codigo)
  }
})

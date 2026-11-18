import { app } from 'electron'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { createServer } from 'http'

mkdirSync('out/testes', { recursive: true })
const dir = mkdtempSync(join(process.cwd(), 'out/testes/seguranca-'))
process.env.IRIS_BANCO = join(dir, 'teste.sqlite')
app.setPath('userData', dir)
void app.whenReady().then(async () => {
  const b = await import('../src/main/banco')
  try {
    b.cadastrarRosto('Teste', Array(384).fill(0.2))
    assert.equal(b.rostosCadastrados()[0].descritores.length, 3)
    b.cadastrarRosto('Legado', Array(128).fill(0.1))
    assert.equal(b.rostosCadastrados().find((r) => r.nome === 'Legado')?.descritores.length, 1)
    assert.throws(() => b.cadastrarRosto('Inválido', [NaN]))
    b.registrarEventoVisual('Com imagem', 'data:image/jpeg;base64,/9j/AAAA')
    b.limparSeguranca('imagens')
    assert.equal(b.eventosVisuais()[0].miniatura, null)
    assert.equal(b.eventosVisuais()[0].texto, 'Com imagem')
    for (let i = 0; i < 205; i++) b.registrarEventoVisual(`Evento ${i}`)
    assert.equal(b.eventosVisuais().length, 50)
    assert.equal(b.eventosVisuais()[0].texto, 'Evento 204')
    b.limparSeguranca('historico')
    assert.equal(b.eventosVisuais().length, 0)
    assert.equal(b.rostosCadastrados().length, 2)
    const camera = await import('../src/main/camera')
    let conexoes = 0
    let quadros = 0
    const servidor = createServer((_req, res) => {
      conexoes++
      res.writeHead(200, { 'content-type': 'multipart/x-mixed-replace; boundary=frame' })
      res.write(Buffer.from([255, 216, 1, 2, 255, 217]))
      if (conexoes === 1) res.end()
    })
    try {
      await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve))
      const porta = (servidor.address() as { port: number }).port
      camera.conectar(`http://127.0.0.1:${porta}/video`, () => quadros++)
      for (let i = 0; i < 60 && quadros < 2; i++)
        await new Promise((resolve) => setTimeout(resolve, 100))
      assert.equal(quadros, 2, 'MJPEG reconecta após fim do stream')
      camera.desconectarCamera()
      await new Promise((resolve) => setTimeout(resolve, 4200))
      assert.equal(conexoes, 2, 'desconectar impede reconexão tardia')
    } finally {
      camera.desconectarCamera()
      servidor.closeAllConnections()
      servidor.close()
    }
    console.log('PASS: cadastro múltiplo/legado, validação, miniaturas, limite e exclusão isolada')
    app.exit(0)
  } catch (e) {
    console.error(e)
    app.exit(1)
  }
})

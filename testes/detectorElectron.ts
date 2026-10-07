import { app } from 'electron'
import { DetectorPessoas } from '../src/main/detectorPessoas'
import { join, resolve } from 'path'
import { mkdirSync, readFileSync } from 'fs'
import assert from 'node:assert/strict'

const dir = resolve('out/testes/detector')
mkdirSync(join(dir, 'profile'), { recursive: true })
app.setPath('userData', join(dir, 'profile'))
void app.whenReady().then(async () => {
  const detector = new DetectorPessoas(join(dir, 'modelos'))
  try {
    await detector.iniciar()
    const pessoas = await detector.analisar(
      readFileSync(join(dir, 'bus.jpg')).toString('base64'),
      0.65
    )
    assert.ok(pessoas.length >= 2)
    detector.parar()
    const pendente = detector.iniciar()
    const cancelado = assert.rejects(pendente, /encerrado/)
    detector.parar()
    await cancelado
    console.log(
      'PASS detector no Electron: worker compartilhado, modelo real, análise e cancelamento'
    )
    app.exit(0)
  } catch (e) {
    console.error(e)
    detector.parar()
    app.exit(1)
  }
})

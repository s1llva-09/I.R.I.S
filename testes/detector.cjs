/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Download apenas do modelo público e de uma imagem de teste; nenhuma câmera é acessada.
const { Worker } = require('node:worker_threads')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const sharp = require('sharp')
const dir = path.resolve('out/testes/detector')
fs.mkdirSync(dir, { recursive: true })
const worker = new Worker(path.resolve('out/main/detector-pessoas.js'), {
  workerData: { cache: path.join(dir, 'modelos') }
})
const esperar = () =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.removeListener('message', receber)
      reject(Error('Detector excedeu o tempo de teste'))
    }, 300000)
    const receber = (m) => {
      clearTimeout(timer)
      if (m.erro) reject(Error(m.erro))
      else resolve(m)
    }
    worker.once('message', receber)
    worker.once('error', reject)
  })
;(async () => {
  assert.equal((await esperar()).pronto, true)
  const arquivo = path.join(dir, 'bus.jpg')
  if (!fs.existsSync(arquivo)) {
    const r = await fetch(
      'https://raw.githubusercontent.com/ultralytics/ultralytics/main/ultralytics/assets/bus.jpg'
    )
    assert.equal(r.ok, true)
    fs.writeFileSync(arquivo, Buffer.from(await r.arrayBuffer()))
  }
  const imagem = await sharp(arquivo).resize({ width: 640 }).jpeg().toBuffer()
  let resposta = esperar()
  worker.postMessage({ id: 1, jpeg: imagem.toString('base64'), confianca: 0.65 })
  const positivo = await resposta
  assert.ok(positivo.pessoas.length >= 2, 'Detectar pessoas reais no exemplo público')
  for (const p of positivo.pessoas) {
    assert.equal(p.label, 'person')
    assert.ok(p.score >= 0.65)
    assert.ok(
      p.box.xmin >= 0 && p.box.xmax <= 1 && p.box.ymin >= 0 && p.box.ymax <= 1,
      'Coordenadas normalizadas'
    )
  }
  const vazio = await sharp({
    create: { width: 640, height: 480, channels: 3, background: '#101010' }
  })
    .jpeg()
    .toBuffer()
  resposta = esperar()
  worker.postMessage({ id: 2, jpeg: vazio.toString('base64'), confianca: 0.65 })
  assert.equal((await resposta).pessoas.length, 0, 'Imagem vazia não gera pessoa')
  resposta = esperar()
  worker.postMessage({ id: 3, jpeg: 'invalido', confianca: 0.65 })
  await assert.rejects(resposta, /analisar/)
  console.log(
    `PASS detector real: ${positivo.pessoas.length} pessoas no exemplo, vazio sem pessoa e JPEG inválido tratado`
  )
})()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(async () => {
    await worker.terminate()
    if (!process.exitCode) {
      const { spawnSync } = require('node:child_process')
      const env = { ...process.env }
      delete env.ELECTRON_RUN_AS_NODE
      const r = spawnSync(require('electron'), ['out/main/teste-detector.js'], {
        env,
        stdio: 'inherit',
        windowsHide: true
      })
      if (r.error) throw r.error
      process.exitCode = r.status ?? 1
    }
  })

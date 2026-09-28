// Regressões do ciclo do sensor, sem webcam, GPU ou Electron reais.
// Executar: node --test testes/presenca.cjs
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function -- Harness CommonJS executável pelo Node, com stubs de APIs do navegador. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const codigo = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/renderer/src/presenca.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText
const flush = () => new Promise((resolve) => setImmediate(resolve))
const pendente = () => {
  let resolve
  let reject
  const promise = new Promise((sim, nao) => {
    resolve = sim
    reject = nao
  })
  return { promise, resolve, reject }
}
const face = {
  descriptor: new Float32Array(128),
  detection: { box: { x: 10, y: 15, width: 30, height: 40 } }
}

function ambiente({ detectar = async () => [face], obterCamera, carregar = async () => {} } = {}) {
  let agora = 10_000
  let proximoTimer = 0
  let chamadasCamera = 0
  const timers = new Map()
  const imagens = []
  const videos = []

  class Imagem {
    naturalWidth = 0
    naturalHeight = 0
    constructor() {
      imagens.push(this)
    }
    carregar() {
      this.naturalWidth = 640
      this.naturalHeight = 480
      this.onload?.()
    }
  }
  class Video {
    readyState = 2
    videoWidth = 640
    videoHeight = 480
    constructor() {
      videos.push(this)
    }
    addEventListener() {}
    requestVideoFrameCallback(cb) {
      this.proximoQuadro = cb
      return 1
    }
    async play() {
      this.proximoQuadro?.()
    }
    pause() {}
  }
  const criarStream = () => {
    const eventos = new Map()
    const track = {
      readyState: 'live',
      muted: false,
      paradas: 0,
      stop() {
        this.readyState = 'ended'
        this.paradas++
      },
      addEventListener(evento, cb) {
        eventos.set(evento, cb)
      },
      emitir(evento) {
        eventos.get(evento)?.()
      }
    }
    return { track, getTracks: () => [track], getVideoTracks: () => [track] }
  }
  const padrao = criarStream()
  const faceapi = {
    tf: { setBackend: async () => true, ready: async () => {} },
    nets: {
      tinyFaceDetector: { loadFromUri: carregar },
      faceLandmark68Net: { loadFromUri: async () => {} },
      faceRecognitionNet: { loadFromUri: async () => {} }
    },
    TinyFaceDetectorOptions: class {},
    LabeledFaceDescriptors: class {
      constructor(label) {
        this.label = label
      }
    },
    FaceMatcher: class {
      findBestMatch() {
        return { label: 'Autorizado' }
      }
    },
    detectAllFaces: () => ({ withFaceLandmarks: () => ({ withFaceDescriptors: detectar }) })
  }
  const modulo = { exports: {} }
  vm.runInNewContext(codigo, {
    module: modulo,
    exports: modulo.exports,
    require: (nome) => (nome === '@vladmandic/face-api' ? faceapi : {}),
    Image: Imagem,
    HTMLVideoElement: Video,
    Float32Array,
    Date: class extends Date {
      static now() {
        return agora
      }
    },
    performance: { now: () => agora },
    console: { warn() {} },
    URL: { createObjectURL: () => 'blob:teste', revokeObjectURL() {} },
    document: { createElement: () => new Video() },
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          chamadasCamera++
          return obterCamera ? obterCamera() : Promise.resolve(padrao)
        }
      }
    },
    clearInterval: (id) => timers.delete(id),
    window: {
      setInterval: (cb) => {
        const id = ++proximoTimer
        timers.set(id, cb)
        return id
      }
    }
  })
  return {
    api: modulo.exports,
    imagens,
    videos,
    criarStream,
    padrao,
    cameraChamadas: () => chamadasCamera,
    avancar: (ms) => {
      agora += ms
    },
    tique: async () => {
      for (const cb of [...timers.values()]) cb()
      await flush()
    },
    quadro: () => {
      modulo.exports.receberQuadro('jpeg-de-teste')
      const img = imagens.at(-1)
      img.carregar()
      return img
    }
  }
}

test('quadros de rede vencidos removem imagem, caixas e leitura, e novos quadros recuperam', async () => {
  const a = ambiente()
  const leituras = []
  a.api.prepararFonteRede()
  a.quadro()
  const parar = await a.api.iniciarPresenca((l) => leituras.push(l))
  await flush()
  assert.equal(a.api.estadoSensor().fonte, 'rede')
  assert.equal(a.api.estadoSensor().sinal, true)
  assert.equal(a.cameraChamadas(), 0)
  assert.equal(leituras.at(-1).rostos, 1)
  assert.equal(a.api.ultimasCaixas().length, 1)
  assert.equal(a.api.temFonteTeste(), false)
  a.avancar(6001)
  assert.equal(a.api.fonteAtual(), null)
  assert.equal(a.api.ultimasCaixas().length, 0)
  assert.equal(a.api.estadoSensor().sinal, false)
  await a.tique()
  assert.equal(leituras.at(-1).rostos, -1)
  a.quadro()
  await a.tique()
  assert.equal(leituras.at(-1).rostos, 1)
  assert.equal(a.api.estadoSensor().erro, null)
  parar()
})

test('decodificação atrasada não substitui quadro novo nem restaura fonte desconectada', async () => {
  const a = ambiente()
  a.api.prepararFonteRede()
  const parar = await a.api.iniciarPresenca(() => {})
  a.api.receberQuadro('antigo')
  const antigo = a.imagens.at(-1)
  a.api.receberQuadro('novo')
  const novo = a.imagens.at(-1)
  novo.carregar()
  antigo.carregar()
  assert.equal(a.api.fonteAtual(), novo)
  a.api.receberQuadro('pendente')
  const pend = a.imagens.at(-1)
  a.api.pararQuadros()
  pend.carregar()
  assert.equal(a.api.fonteAtual(), null)
  assert.equal(a.api.estadoSensor().fonte, 'nenhuma')
  parar()
})

test('resultado de inferência anterior não republica rosto depois de reiniciar', async () => {
  const primeira = pendente()
  let execucoes = 0
  const a = ambiente({
    detectar: () => (++execucoes === 1 ? primeira.promise : Promise.resolve([]))
  })
  const antigas = []
  const novas = []
  a.api.prepararFonteRede()
  a.quadro()
  const pararAntigo = await a.api.iniciarPresenca((l) => antigas.push(l))
  await flush()
  const pararNovo = await a.api.iniciarPresenca((l) => novas.push(l))
  pararAntigo()
  primeira.resolve([face])
  await flush()
  assert.equal(a.api.estadoSensor().ativo, true)
  assert.equal(
    antigas.some((l) => l.rostos > 0),
    false
  )
  assert.equal(novas.at(-1).rostos, 0)
  assert.equal(a.api.ultimasCaixas().length, 0)
  pararNovo()
})

test('getUserMedia atrasado para a stream antiga sem desligar a nova; mute limpa leitura', async () => {
  const antigo = pendente()
  let tentativas = 0
  let nova
  const a = ambiente({
    obterCamera: () => (++tentativas === 1 ? antigo.promise : Promise.resolve(nova))
  })
  const antiga = a.criarStream()
  nova = a.criarStream()
  const inicioAntigo = a.api.iniciarPresenca(() => {})
  await flush()
  const leituras = []
  const pararNovo = await a.api.iniciarPresenca((l) => leituras.push(l))
  antigo.resolve(antiga)
  const pararAntigo = await inicioAntigo
  await flush()
  pararAntigo()
  assert.equal(antiga.track.paradas, 1)
  assert.equal(nova.track.paradas, 0)
  assert.equal(leituras.at(-1).rostos, 1)
  nova.track.muted = true
  nova.track.emitir('mute')
  assert.equal(leituras.at(-1).rostos, -1)
  assert.equal(a.api.estadoSensor().sinal, false)
  assert.equal(a.api.ultimasCaixas().length, 0)
  pararNovo()
  assert.equal(nova.track.paradas, 1)
})

test('parada síncrona cancela início pendente e erro de modelos não analisa foto/rede', async () => {
  const modelo = pendente()
  const a = ambiente({ carregar: () => modelo.promise })
  const inicio = a.api.iniciarPresenca(() => {})
  a.api.pararPresenca()
  modelo.resolve()
  await inicio
  assert.equal(a.cameraChamadas(), 0)
  assert.equal(a.api.estadoSensor().ativo, false)
  let analises = 0
  const b = ambiente({
    carregar: async () => {
      throw new Error('modelos ausentes')
    },
    detectar: async () => {
      analises++
      return []
    }
  })
  b.api.prepararFonteRede()
  b.quadro()
  await b.api.iniciarPresenca(() => {})
  assert.equal(b.api.estadoSensor().modelos, 'erro')
  assert.equal(b.api.estadoSensor().ativo, false)
  assert.equal(analises, 0)
})

test('aguardar primeiro frame é sinal indisponível; foto não é vídeo ao vivo', async () => {
  const a = ambiente()
  const leituras = []
  a.api.prepararFonteRede()
  const parar = await a.api.iniciarPresenca((l) => leituras.push(l))
  assert.equal(leituras.at(-1).rostos, -1)
  assert.equal(a.api.estadoSensor().sinal, false)
  const foto = a.api.definirFonteTeste({})
  a.imagens.at(-1).carregar()
  await foto
  await a.tique()
  assert.equal(a.api.estadoSensor().fonte, 'teste')
  assert.equal(a.api.estadoSensor().ultimoQuadroEm, null)
  assert.equal(a.api.temFonteTeste(), true)
  a.avancar(10_000)
  assert.equal(a.api.estadoSensor().sinal, true)
  parar()
  assert.equal(a.api.fonteAtual(), null)
})

test('desligar e religar durante carga compartilhada de modelos só inicia a câmera atual', async () => {
  const modelo = pendente()
  let cargas = 0
  const a = ambiente({
    carregar: () => {
      cargas++
      return modelo.promise
    }
  })
  const antigas = []
  const novas = []
  const inicioAntigo = a.api.iniciarPresenca((l) => antigas.push(l))
  a.api.pararPresenca()
  const inicioNovo = a.api.iniciarPresenca((l) => novas.push(l))
  modelo.resolve()
  const [pararAntigo, pararNovo] = await Promise.all([inicioAntigo, inicioNovo])
  await flush()
  pararAntigo()
  assert.equal(cargas, 1)
  assert.equal(a.cameraChamadas(), 1)
  assert.equal(a.api.estadoSensor().ativo, true)
  assert.equal(a.api.estadoSensor().sinal, true)
  assert.equal(
    antigas.some((l) => l.rostos >= 0),
    false
  )
  assert.equal(novas.at(-1).rostos, 1)
  pararNovo()
})

test('webcam sem novos frames expira apesar de track live e volta com novo frame', async () => {
  const a = ambiente()
  const leituras = []
  const parar = await a.api.iniciarPresenca((l) => leituras.push(l))
  await flush()
  assert.equal(a.api.estadoSensor().sinal, true)
  a.avancar(6001)
  assert.equal(a.padrao.track.readyState, 'live')
  assert.equal(a.api.fonteAtual(), null)
  assert.equal(a.api.ultimasCaixas().length, 0)
  await a.tique()
  assert.equal(leituras.at(-1).rostos, -1)
  assert.match(a.api.estadoSensor().erro, /câmera local/)
  a.videos[0].proximoQuadro()
  await a.tique()
  assert.equal(a.api.estadoSensor().sinal, true)
  assert.equal(a.api.estadoSensor().erro, null)
  assert.equal(leituras.at(-1).rostos, 1)
  parar()
})

test('quadros em trânsito após desligar não reativam nem reselecionam rede', async () => {
  const a = ambiente()
  a.api.prepararFonteRede()
  a.quadro()
  await a.api.iniciarPresenca(() => {})
  a.api.pararPresenca()
  a.api.pararQuadros()
  const imagensAntes = a.imagens.length
  a.api.receberQuadro('quadro-atrasado')
  assert.equal(a.imagens.length, imagensAntes)
  assert.equal(a.api.estadoSensor().fonte, 'nenhuma')
  assert.equal(a.api.estadoSensor().sinal, false)
  const parar = await a.api.iniciarPresenca(() => {})
  assert.equal(a.cameraChamadas(), 1)
  assert.equal(a.api.estadoSensor().fonte, 'camera')
  parar()
})

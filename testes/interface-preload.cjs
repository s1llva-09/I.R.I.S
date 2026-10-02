// Isolated UI fixture: no application IPC, cameras, network, speech or disk writes.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron smoke-test preload. */
const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()
const noop = () => {}
let eventosVisuais = [
  { id: 1, momento: '2026-09-30T01:00:00Z', texto: 'Presença simulada', miniatura: null }
]
const subscribe = (name) => (callback) => {
  const callbacks = listeners.get(name) || new Set()
  callbacks.add(callback)
  listeners.set(name, callbacks)
  return () => callbacks.delete(callback)
}
const emit = (name, ...args) => {
  for (const callback of listeners.get(name) || []) callback(...args)
}
const cfg = {
  llmChave: '•••••••• (fixture)',
  llmModelo: 'modelo-de-teste',
  llmModeloVisao: 'visao-de-teste',
  llmReservas: ['reserva-de-teste'],
  tavilyChave: '',
  atalho: 'Control+Space',
  tetoDiario: 45,
  limiarRisco: 3,
  vozAtiva: false,
  cameraAtiva: false,
  cameraId: '',
  limiarFacial: 0.6,
  modoSeguranca: false,
  vozRitmo: 1,
  gatilhosDesligados: []
}
let populated = false
let rejectNextSave = false
let cameras = []
const api = {
  enviar: async () => ({ ok: false, erro: 'Resposta simulada para verificação da interface.' }),
  estado: async () => ({
    foco: { programa: 'Ambiente de teste', titulo: 'Fixture sem acesso ao desktop' },
    uso: { usadas: 0, teto: 45, restantes: 45 },
    ferramentas: []
  }),
  aoReceberTexto: subscribe('texto'),
  aoUsarFerramenta: subscribe('ferramenta'),
  aoGerarVisual: subscribe('visual'),
  aoDetectarInjecao: subscribe('injecao'),
  aoPedirAprovacao: subscribe('aprovacao'),
  aoAvisar: subscribe('aviso'),
  avisosPendentes: async () => [],
  responderAprovacao: noop,
  rotular: noop,
  falar: noop,
  pararFala: noop,
  mudo: noop,
  presenca: noop,
  central: {
    listar: async () => cameras.map((c) => ({ ...c })),
    salvar: async (c) => {
      const salva = {
        ...c,
        id: c.id || String(cameras.length + 1),
        ligada: false,
        sessao: null,
        ultimoQuadro: null,
        foto: false,
        erro: ''
      }
      cameras = c.id
        ? cameras.map((x) => (x.id === c.id ? { ...x, ...c } : x))
        : [...cameras, salva]
      return salva
    },
    remover: async (id) => {
      cameras = cameras.filter((c) => c.id !== id)
    },
    conectar: async (id) => {
      cameras = cameras.map((c) =>
        c.id === id ? { ...c, ligada: true, sessao: String(Date.now()) } : c
      )
    },
    parar: async (id) => {
      cameras = cameras.map((c) => (c.id === id ? { ...c, ligada: false, sessao: null } : c))
    },
    pararTudo: async () => {
      cameras = cameras.map((c) => ({ ...c, ligada: false, sessao: null }))
    },
    aoFrame: subscribe('centralFrame'),
    aoPausar: subscribe('centralPausar')
  },
  seguranca: {
    visuais: async () => eventosVisuais,
    limpar: async (tipo) => {
      if (tipo === 'historico') eventosVisuais = []
    },
    privacidade: async () => {
      await api.central.pararTudo()
      emit('centralPausar')
      cfg.cameraAtiva = false
      emit('camera', false)
    },
    painel: async () => ({
      rostos: populated ? [{ nome: 'Pessoa de teste', criado_em: '2026-09-28T12:00:00.000Z' }] : [],
      alarmes: populated
        ? [
            {
              id: 1,
              momento: '2026-09-28T12:01:00.000Z',
              resultado: 'Evento simulado: pessoa sem correspondência no cadastro.'
            }
          ]
        : [],
      decisoes: populated
        ? [
            {
              id: 2,
              momento: '2026-09-28T12:02:00.000Z',
              ferramenta: 'acao_de_teste',
              argumentos: '{}',
              decisao: JSON.stringify({
                escore: 5,
                limiar: 3,
                confirma: true,
                motivos: ['Contexto externo simulado'],
                sinais: [{ sinal: 'Contexto externo simulado', peso: 2 }]
              })
            }
          ]
        : []
    }),
    salvarMedicao: async () => 'resultado-simulado.json',
    aoMudarGaleria: subscribe('galeria'),
    aoMudarCamera: subscribe('camera'),
    aoAbrirPorta: subscribe('abrirPorta'),
    aoAbrir: subscribe('abrirSeguranca'),
    aoPedirRosto: subscribe('pedirRosto')
  },
  camera: {
    conectar: async () => false,
    desconectar: async () => {},
    erro: async () => '',
    procurar: async () => [],
    testar: async () => 'Teste isolado: nenhum endereço foi acessado.',
    qr: async (seguro) => ({
      ...(seguro
        ? {
            certificadoQr: '<svg viewBox="0 0 10 10"><path d="M1 1h8v8H1z" /></svg>',
            impressao: 'AA:BB:CC:DD:EE:FF'
          }
        : {}),
      url: 'http://127.0.0.1:8790/?t=fixture',
      qr: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M1 1h8v8H1z" /></svg>'
    }),
    aoFrame: subscribe('frame')
  },
  rostos: {
    lista: async () => [],
    cadastrar: async () => {},
    esquecer: async () => true,
    galeria: async () => []
  },
  config: {
    ler: async () => ({ ...cfg }),
    gravar: async (key, value) => {
      if (rejectNextSave) {
        rejectNextSave = false
        return false
      }
      cfg[key] = value
      return true
    },
    primeira: async () => false,
    gatilhos: async () => ['disco_cheio', 'build_concluido']
  }
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('__uiTest', {
  populate: () => {
    populated = true
  },
  failNextSave: () => {
    rejectNextSave = true
  },
  emit,
  config: () => ({ ...cfg })
})
window.addEventListener('error', (event) => ipcRenderer.send('ui-test:error', event.message))
window.addEventListener('unhandledrejection', (event) =>
  ipcRenderer.send('ui-test:error', String(event.reason))
)

// Isolated UI fixture: no application IPC, cameras, network, speech or disk writes.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Electron smoke-test preload. */
const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()
const noop = () => {}
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
  seguranca: {
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
    qr: async () => ({ erro: 'Servidor desabilitado neste teste.' }),
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

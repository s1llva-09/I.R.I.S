import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

/**
 * Ponte entre o renderer (browser, inseguro) e o main (Node inteiro).
 * Exponha funções específicas, nunca o ipcRenderer cru.
 */

// Helper: registra um listener e devolve a função que o cancela.
// Sem o cancelamento, o useEffect do React acumula listeners a cada
// render e você vê tudo duplicado — é o bug mais comum aqui.
function ouvir<T extends unknown[]>(canal: string, callback: (...args: T) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    callback(...(args as T))
  ipcRenderer.on(canal, listener)
  return () => ipcRenderer.removeListener(canal, listener)
}

const api = {
  /** Manda a conversa e espera a resposta final. Os pedaços chegam antes. */
  enviar: (historico: unknown[]): Promise<{ ok: boolean; texto?: string; erro?: string }> =>
    ipcRenderer.invoke('chat:enviar', historico),

  /**
   * O que a Izze sabe agora: janela em foco e cota do dia.
   *
   * invoke e não evento: o renderer pergunta quando quer desenhar. Empurrar
   * do main significaria mandar 2 mensagens por segundo pra uma janela que
   * na maior parte do tempo está escondida na bandeja.
   */
  estado: (): Promise<{
    foco: { programa: string; titulo: string } | null
    uso: { usadas: number; teto: number; restantes: number }
  }> => ipcRenderer.invoke('estado:ler'),

  /** Pedaços de texto do stream. */
  aoReceberTexto: (cb: (texto: string) => void): (() => void) => ouvir('chat:delta', cb),

  /** Disparado toda vez que o modelo decide executar uma ferramenta. */
  aoUsarFerramenta: (cb: (nome: string, argumentos: string) => void): (() => void) =>
    ouvir('chat:ferramenta', cb),

  /** Dados estruturados que uma ferramenta devolveu pra desenhar na tela. */
  aoGerarVisual: (cb: (visual: Visual) => void): (() => void) => ouvir('chat:visual', cb),

  // send e não invoke: falar é disparar e esquecer, ninguém espera resposta.
  /** Fala uma frase pelo SAPI do Windows (roda no main). */
  falar: (texto: string): void => ipcRenderer.send('voz:falar', texto),

  /** Corta a fala em andamento e o que estiver na fila. */
  pararFala: (): void => ipcRenderer.send('voz:parar'),

  /** O main travou esperando: uma ferramenta de nível 3 quer rodar. */
  aoPedirAprovacao: (cb: (id: string, nome: string, args: string) => void): (() => void) =>
    ouvir('aprovacao:pedido', cb),

  /** Destrava o main. O id amarra a resposta ao pedido que a originou. */
  responderAprovacao: (id: string, ok: boolean): void => {
    ipcRenderer.send('aprovacao:resposta', id, ok)
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (erro) {
    console.error(erro)
  }
} else {
  // Sem contextIsolation não existe ponte: escreve direto no window.
  // Os dois @ts-ignore são porque o tipo do Window declara essas props como
  // somente-leitura — atribuir aqui é justamente o fallback.
  // @ts-ignore fallback sem contextIsolation
  window.electron = electronAPI
  // @ts-ignore fallback sem contextIsolation
  window.api = api
}

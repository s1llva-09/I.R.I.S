import { ElectronAPI } from '@electron-toolkit/preload'

// Só descreve o que o preload expôs. Não gera código.
declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      enviar: (historico: unknown[]) => Promise<{ ok: boolean; texto?: string; erro?: string }>
      estado: () => Promise<{
        foco: { programa: string; titulo: string } | null
        uso: { usadas: number; teto: number; restantes: number }
      }>
      aoReceberTexto: (cb: (texto: string) => void) => () => void
      aoUsarFerramenta: (cb: (nome: string, argumentos: string) => void) => () => void
      aoGerarVisual: (cb: (visual: Visual) => void) => () => void
      falar: (texto: string) => void
      pararFala: () => void
      aoPedirAprovacao: (cb: (id: string, nome: string, args: string) => void) => () => void
      responderAprovacao: (id: string, ok: boolean) => void
    }
  }
}

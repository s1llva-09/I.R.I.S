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
        ferramentas: { nome: string; aprova: Aprova }[]
      }>
      aoReceberTexto: (cb: (texto: string) => void) => () => void
      aoUsarFerramenta: (cb: (nome: string, argumentos: string) => void) => () => void
      aoGerarVisual: (cb: (visual: Visual) => void) => () => void
      falar: (texto: string) => void
      pararFala: () => void
      mudo: (mudo: boolean) => void
      aoAvisar: (cb: (aviso: Aviso) => void) => () => void
      avisosPendentes: () => Promise<Aviso[]>
      rotular: (id: number, util: boolean) => void
      aoDetectarInjecao: (cb: (ferramenta: string, achados: string[]) => void) => () => void
      aoPedirAprovacao: (
        cb: (id: string, nome: string, args: string, risco: Avaliacao) => void
      ) => () => void
      responderAprovacao: (id: string, ok: boolean) => void
      config: {
        ler: () => Promise<Record<string, unknown>>
        gravar: (chave: string, valor: unknown) => Promise<boolean>
        primeira: () => Promise<boolean>
        gatilhos: () => Promise<string[]>
      }
    }
  }
}

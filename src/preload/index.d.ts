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
      presenca: (
        leitura: { rostos: number; desconhecidos: number; conhecidos: string[] },
        miniatura?: string
      ) => void
      camera: {
        conectar: (url: string) => Promise<boolean>
        desconectar: () => Promise<void>
        erro: () => Promise<string>
        procurar: () => Promise<{ url: string; tipo: string; servidor: string }[]>
        testar: (alvo: string) => Promise<string>
        qr: (
          seguro?: boolean
        ) => Promise<
          { url: string; qr: string; certificadoQr?: string; impressao?: string } | { erro: string }
        >
        aoFrame: (cb: (jpegBase64: string, foto?: boolean) => void) => () => void
      }
      vigilancia: {
        estado: () => Promise<import('../shared/vigilancia').EstadoVigilancia>
        salvar: (valor: import('../shared/vigilancia').AjustesVigilancia) => Promise<void>
        armar: () => Promise<void>
        desarmar: () => Promise<void>
        limpar: () => Promise<void>
        repetir: (id: string) => Promise<void>
        testar: () => Promise<void>
        removerCelular: (id: string) => Promise<void>
        enderecos: () => Promise<string[]>
        abrirCelular: (
          ip: string
        ) => Promise<{ url: string; qr: string; certificadoQr: string; impressao: string }>
        revogarCelular: () => Promise<void>
      }
      central: {
        falhaWebcam: (id: string, sessao: string, permissao: boolean) => void
        sair: () => Promise<void>
        quadro: (id: string) => Promise<import('../shared/cameras').QuadroCamera | null>
        webcam: (id: string, sessao: string, jpeg: string) => void
        listar: () => Promise<import('../shared/cameras').CameraPainel[]>
        salvar: (
          camera: import('../shared/cameras').CameraSalva
        ) => Promise<import('../shared/cameras').CameraSalva>
        remover: (id: string) => Promise<void>
        conectar: (id: string) => Promise<void>
        parar: (id: string) => Promise<void>
        pararTudo: () => Promise<void>
        aoFrame: (cb: (quadro: import('../shared/cameras').QuadroCamera) => void) => () => void
        aoPausar: (cb: () => void) => () => void
      }
      seguranca: {
        visuais: () => Promise<
          { id: number; momento: string; texto: string; miniatura: string | null }[]
        >
        limpar: (tipo: 'imagens' | 'historico') => Promise<void>
        privacidade: () => Promise<void>
        painel: () => Promise<{
          rostos: { nome: string; criado_em: string }[]
          alarmes: { id: number; momento: string; resultado: string }[]
          decisoes: { id: number; momento: string; ferramenta: string; decisao: string }[]
        }>
        aoAbrir: (cb: () => void) => () => void
        aoAbrirPorta: (cb: () => void) => () => void
        aoMudarCamera: (cb: (ligada: boolean) => void) => () => void
        aoMudarGaleria: (cb: () => void) => () => void
        salvarMedicao: (dados: unknown) => Promise<string>
        aoPedirRosto: (cb: (id: string) => Promise<number[] | string>) => () => void
      }
      rostos: {
        lista: () => Promise<{ nome: string; criado_em: string }[]>
        cadastrar: (nome: string, descritor: number[]) => Promise<void>
        esquecer: (nome: string) => Promise<boolean>
        galeria: () => Promise<{ nome: string; descritor: number[] }[]>
      }
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

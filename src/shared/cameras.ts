export type CameraSalva = {
  id: string
  nome: string
  ambiente: string
  tipo: 'rede' | 'celular' | 'webcam'
  endereco: string
}
export type PareamentoCamera = {
  url: string
  qr: string
  certificadoQr?: string
  impressao?: string
}
export type CameraPainel = CameraSalva & {
  ligada: boolean
  sessao: string | null
  ultimoQuadro: number | null
  foto: boolean
  erro: string
  pareamento?: PareamentoCamera
}
export type QuadroCamera = { id: string; jpeg: string; foto: boolean; momento: number }

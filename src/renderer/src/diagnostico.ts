import { fonteAtual, tamanhoFonte, ultimasCaixas } from './presenca'

export function diagnosticarImagem(): { luz: number | null; avisos: string[] } {
  const fonte = fonteAtual()
  if (!fonte) return { luz: null, avisos: ['Sem imagem recente. Confira a conexão.'] }
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 32
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return { luz: null, avisos: ['Diagnóstico de iluminação indisponível.'] }
  ctx.drawImage(fonte, 0, 0, 32, 32)
  const pixels = ctx.getImageData(0, 0, 32, 32).data
  let soma = 0
  for (let i = 0; i < pixels.length; i += 4)
    soma += pixels[i] * 0.2126 + pixels[i + 1] * 0.7152 + pixels[i + 2] * 0.0722
  const luz = Math.round((soma / 1024 / 255) * 100)
  const avisos: string[] = []
  if (luz < 20) avisos.push('Pouca luz: ilumine o rosto pela frente.')
  if (luz > 90) avisos.push('Imagem muito clara: evite luz direta na câmera.')
  const caixas = ultimasCaixas(),
    { w, h } = tamanhoFonte()
  if (!caixas.length) avisos.push('Nenhum rosto localizado. Posicione-se no centro.')
  if (caixas.length > 1) avisos.push('Para cadastro, mantenha apenas uma pessoa na imagem.')
  for (const c of caixas) {
    if (c.w / w < 0.12) avisos.push('Aproxime o rosto da câmera.')
    if (c.x < w * 0.03 || c.y < h * 0.03 || c.x + c.w > w * 0.97 || c.y + c.h > h * 0.97)
      avisos.push('Rosto perto da borda: centralize o enquadramento.')
  }
  return { luz, avisos: [...new Set(avisos)] }
}

export function miniaturaAtual(): string | undefined {
  const fonte = fonteAtual(),
    { w, h } = tamanhoFonte()
  if (!fonte || !w || !h) return
  const canvas = document.createElement('canvas')
  canvas.width = 240
  canvas.height = Math.max(1, Math.round((h / w) * 240))
  if (canvas.height > 480) canvas.height = 480
  canvas.getContext('2d')?.drawImage(fonte, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.55)
}

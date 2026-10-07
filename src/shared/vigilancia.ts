export type Ponto = { x: number; y: number }
export type Zona = { id: string; nome: string; pontos: Ponto[] }
export type ProtecaoCamera = { cameraId: string; zonas: Zona[] }
export type AjustesVigilancia = {
  cameras: ProtecaoCamera[]
  permanencia: number
  intervalo: number
  confianca: number
  guardarImagem: boolean
  retencaoDias: number
  agenda: { ativa: boolean; inicio: string; fim: string; dias: number[] }
}
export type PessoaDetectada = {
  score: number
  box: { xmin: number; ymin: number; xmax: number; ymax: number }
}
export type EventoVigilancia = {
  id: string
  momento: number
  cameraId: string
  camera: string
  tipo: 'pessoa' | 'offline' | 'recuperada' | 'sistema'
  texto: string
  imagem?: string
  entrega: 'pendente' | 'enviado' | 'falhou' | 'desativado'
  erro?: string
  enviados?: string[]
}
export type SaudeCamera = {
  id: string
  ultimoQuadro: number | null
  ultimaAnalise: number | null
  pessoas: number
  erro: string
}
export const PADRAO_VIGILANCIA: AjustesVigilancia = {
  cameras: [],
  permanencia: 3,
  intervalo: 120,
  confianca: 0.65,
  guardarImagem: false,
  retencaoDias: 7,
  agenda: { ativa: false, inicio: '22:00', fim: '06:00', dias: [0, 1, 2, 3, 4, 5, 6] }
}
export type EstadoVigilancia = {
  modo: 'desarmado' | 'preparando' | 'armado' | 'erro'
  erro: string
  modelo: string
  ajustes: AjustesVigilancia
  cameras: SaudeCamera[]
  eventos: EventoVigilancia[]
  notificacoes: { configurado: boolean; dispositivos: { id: string; nome: string }[] }
}

export function pontoNaZona(p: Ponto, pontos: Ponto[]): boolean {
  let dentro = false
  for (let i = 0, j = pontos.length - 1; i < pontos.length; j = i++) {
    const a = pontos[i],
      b = pontos[j]
    const cross = (p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)
    if (
      Math.abs(cross) < 1e-8 &&
      p.x >= Math.min(a.x, b.x) &&
      p.x <= Math.max(a.x, b.x) &&
      p.y >= Math.min(a.y, b.y) &&
      p.y <= Math.max(a.y, b.y)
    )
      return true
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
      dentro = !dentro
  }
  return dentro
}
export function horarioAtivo(agenda: AjustesVigilancia['agenda'], data = new Date()): boolean {
  if (!agenda.ativa) return false
  const minuto = data.getHours() * 60 + data.getMinutes()
  const ler = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3))
  const inicio = ler(agenda.inicio),
    fim = ler(agenda.fim)
  if (inicio < fim) return agenda.dias.includes(data.getDay()) && minuto >= inicio && minuto < fim
  return (
    (minuto >= inicio && agenda.dias.includes(data.getDay())) ||
    (minuto < fim && agenda.dias.includes((data.getDay() + 6) % 7))
  )
}
export function validarAjustes(valor: AjustesVigilancia): AjustesVigilancia {
  if (!valor || !Array.isArray(valor.cameras) || valor.cameras.length > 12)
    throw new Error('Configuração de câmeras inválida.')
  if (typeof valor.guardarImagem !== 'boolean')
    throw new Error('Escolha se deseja guardar imagens.')
  for (const [campo, min, max] of [
    ['permanencia', 1, 60],
    ['intervalo', 30, 3600],
    ['confianca', 0.3, 0.95],
    ['retencaoDias', 1, 30]
  ] as const)
    if (!Number.isFinite(valor[campo]) || valor[campo] < min || valor[campo] > max)
      throw new Error(`Valor inválido: ${campo}`)
  const ids = new Set<string>()
  for (const c of valor.cameras) {
    if (
      !c ||
      typeof c.cameraId !== 'string' ||
      ids.has(c.cameraId) ||
      !Array.isArray(c.zonas) ||
      !c.zonas.length ||
      c.zonas.length > 5
    )
      throw new Error('Selecione áreas distintas para cada câmera.')
    ids.add(c.cameraId)
    const zonas = new Set<string>()
    for (const z of c.zonas) {
      if (
        !z ||
        typeof z.id !== 'string' ||
        !z.id ||
        zonas.has(z.id) ||
        typeof z.nome !== 'string' ||
        !z.nome.trim() ||
        z.nome.length > 60 ||
        !Array.isArray(z.pontos) ||
        z.pontos.length < 3 ||
        z.pontos.length > 12 ||
        z.pontos.some(
          (p) =>
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            p.x < 0 ||
            p.x > 1 ||
            p.y < 0 ||
            p.y > 1
        )
      )
        throw new Error('Área inválida: marque de 3 a 12 pontos na imagem.')
      zonas.add(z.id)
      const area =
        Math.abs(
          z.pontos.reduce((s, p, i) => {
            const q = z.pontos[(i + 1) % z.pontos.length]
            return s + p.x * q.y - q.x * p.y
          }, 0)
        ) / 2
      if (area < 0.002) throw new Error('A área protegida é pequena demais.')
    }
  }
  const a = valor.agenda
  if (
    !a ||
    typeof a.ativa !== 'boolean' ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.inicio) ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(a.fim) ||
    a.inicio === a.fim ||
    !Array.isArray(a.dias) ||
    a.dias.some((d) => !Number.isInteger(d) || d < 0 || d > 6) ||
    (a.ativa && !a.dias.length)
  )
    throw new Error('Defina horários diferentes e dias válidos na agenda.')
  return structuredClone(valor)
}

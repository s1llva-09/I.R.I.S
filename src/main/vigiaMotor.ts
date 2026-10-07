import { randomUUID } from 'crypto'
import {
  pontoNaZona,
  type AjustesVigilancia,
  type EventoVigilancia,
  type PessoaDetectada,
  type SaudeCamera
} from '../shared/vigilancia'
import type { CameraSalva, QuadroCamera } from '../shared/cameras'

type Dependencias = {
  listar: () => CameraSalva[]
  quadro: (id: string) => QuadroCamera | null
  analisar: (jpeg: string, confianca: number) => Promise<PessoaDetectada[]>
  evento: (e: EventoVigilancia, jpeg?: string) => void
  agora?: () => number
}
export class VigiaMotor {
  private geracao = 0
  private ativo = false
  private inicio = 0
  private ocupado = false
  private indice = 0
  private ajustes: AjustesVigilancia | null = null
  private saude = new Map<string, SaudeCamera>()
  private visitas = new Map<string, { desde: number; ultima: number; leituras: number }>()
  private avisados = new Map<string, number>()
  private offline = new Set<string>()
  constructor(private dep: Dependencias) {}
  private agora(): number {
    return this.dep.agora?.() ?? Date.now()
  }
  armar(ajustes: AjustesVigilancia): void {
    this.parar()
    this.ativo = true
    this.inicio = this.agora()
    this.ajustes = structuredClone(ajustes)
    for (const c of ajustes.cameras)
      this.saude.set(c.cameraId, {
        id: c.cameraId,
        ultimoQuadro: null,
        ultimaAnalise: null,
        pessoas: 0,
        erro: ''
      })
  }
  parar(): void {
    this.geracao++
    this.ativo = false
    this.saude.clear()
    this.visitas.clear()
    this.avisados.clear()
    this.offline.clear()
  }
  estado(): SaudeCamera[] {
    return [...this.saude.values()].map((s) => ({ ...s }))
  }
  private emitir(id: string, tipo: EventoVigilancia['tipo'], texto: string, jpeg?: string): void {
    const c = this.dep.listar().find((c) => c.id === id)
    this.dep.evento(
      {
        id: randomUUID(),
        momento: this.agora(),
        cameraId: id,
        camera: c?.nome ?? 'Sistema',
        tipo,
        texto,
        entrega: 'pendente'
      },
      jpeg
    )
  }
  async tique(): Promise<void> {
    if (!this.ativo || !this.ajustes) return
    const agora = this.agora(),
      ciclo = this.geracao,
      ajustes = this.ajustes
    for (const c of ajustes.cameras) {
      const s = this.saude.get(c.cameraId)!,
        q = this.dep.quadro(c.cameraId)
      s.ultimoQuadro = q && !q.foto ? q.momento : null
      if (!q || q.foto || agora - q.momento > 15000) {
        s.erro = q?.foto
          ? 'Foto estática não serve para vigilância contínua.'
          : 'Sem vídeo recente.'
        if (agora - this.inicio >= 15000 && !this.offline.has(c.cameraId)) {
          this.offline.add(c.cameraId)
          this.emitir(c.cameraId, 'offline', s.erro)
        }
        for (const z of c.zonas) this.visitas.delete(c.cameraId + ':' + z.id)
      } else if (this.offline.delete(c.cameraId)) {
        s.erro = ''
        this.emitir(c.cameraId, 'recuperada', 'A câmera voltou a transmitir.')
      }
      if (
        q &&
        !q.foto &&
        agora - q.momento <= 15000 &&
        agora - (s.ultimaAnalise ?? this.inicio) > 15000
      ) {
        s.erro =
          'Vídeo disponível, mas sem análise recente. Reduza as câmeras protegidas ou verifique o detector.'
      }
    }
    if (this.ocupado || !ajustes.cameras.length) return
    const c = ajustes.cameras[this.indice++ % ajustes.cameras.length],
      s = this.saude.get(c.cameraId)!
    const q = this.dep.quadro(c.cameraId)
    if (
      !q ||
      q.foto ||
      agora - q.momento > 6000 ||
      (s.ultimaAnalise !== null && q.momento <= s.ultimaAnalise)
    )
      return
    this.ocupado = true
    try {
      const pessoas = await this.dep.analisar(q.jpeg, ajustes.confianca)
      if (ciclo !== this.geracao || !this.ativo) return
      if (this.agora() - q.momento > 15000) {
        s.erro = 'Análise atrasada; resultado descartado.'
        return
      }
      s.ultimaAnalise = q.momento
      s.pessoas = pessoas.length
      s.erro = ''
      for (const z of c.zonas) {
        const chave = c.cameraId + ':' + z.id
        const dentro = pessoas.some(
          (p) =>
            p.score >= ajustes.confianca &&
            pontoNaZona({ x: (p.box.xmin + p.box.xmax) / 2, y: p.box.ymax }, z.pontos)
        )
        if (!dentro) {
          this.visitas.delete(chave)
          continue
        }
        let v = this.visitas.get(chave)
        if (!v || q.momento - v.ultima > 15000) {
          v = { desde: q.momento, ultima: q.momento, leituras: 0 }
          this.visitas.set(chave, v)
        }
        v.ultima = q.momento
        v.leituras++
        if (
          v.leituras >= 2 &&
          q.momento - v.desde >= ajustes.permanencia * 1000 &&
          this.agora() - (this.avisados.get(chave) ?? -Infinity) >= ajustes.intervalo * 1000
        ) {
          this.avisados.set(chave, this.agora())
          this.emitir(
            c.cameraId,
            'pessoa',
            `Pessoa detectada na área ${z.nome}. Verifique a imagem.`,
            q.jpeg
          )
        }
      }
    } catch {
      if (ciclo !== this.geracao) return
      s.erro = 'Análise indisponível. Tentando novamente.'
      if (this.agora() - (this.avisados.get('erro:' + c.cameraId) ?? -Infinity) > 300_000) {
        this.avisados.set('erro:' + c.cameraId, this.agora())
        this.emitir(c.cameraId, 'sistema', s.erro)
      }
    } finally {
      this.ocupado = false
    }
  }
}

import type { Worker } from 'worker_threads'
import criarWorker from './detectorPessoasWorker.ts?nodeWorker'
import { join } from 'path'
import { app } from 'electron'
import type { PessoaDetectada } from '../shared/vigilancia'

export class DetectorPessoas {
  constructor(private cache = join(app.getPath('userData'), 'modelos-pessoas')) {}
  private worker: Worker | null = null
  private pronto: Promise<void> | null = null
  private rejeitarInicio: ((e: Error) => void) | null = null
  private pendente: {
    resolve: (p: PessoaDetectada[]) => void
    reject: (e: Error) => void
    timer: NodeJS.Timeout
  } | null = null
  iniciar(): Promise<void> {
    if (this.pronto) return this.pronto
    this.pronto = new Promise((resolve, reject) => {
      this.rejeitarInicio = reject
      const worker = criarWorker({ workerData: { cache: this.cache } })
      this.worker = worker
      const timeout = setTimeout(
        () => this.parar('O download do detector demorou demais. Tente novamente.'),
        300_000
      )
      worker.on('message', (m) => {
        if (this.worker !== worker) return
        if (m.pronto) {
          clearTimeout(timeout)
          this.rejeitarInicio = null
          resolve()
          return
        }
        if (this.rejeitarInicio && m.erro) {
          clearTimeout(timeout)
          this.parar(m.erro)
          return
        }
        const p = this.pendente
        if (!p) return
        clearTimeout(p.timer)
        this.pendente = null
        if (m.erro) p.reject(new Error(m.erro))
        else p.resolve(m.pessoas)
      })
      worker.on('error', () => {
        clearTimeout(timeout)
        if (this.worker === worker) this.parar('Detector indisponível. Desarme e tente novamente.')
      })
      worker.on('exit', () => {
        clearTimeout(timeout)
        if (this.worker === worker) this.parar('O processo do detector encerrou.')
      })
    })
    return this.pronto
  }
  async analisar(jpeg: string, confianca: number): Promise<PessoaDetectada[]> {
    await this.iniciar()
    if (this.pendente) throw new Error('Detector ocupado')
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.parar('A análise excedeu 30 segundos.'), 30_000)
      this.pendente = { resolve, reject, timer }
      this.worker!.postMessage({ id: 1, jpeg, confianca })
    })
  }
  parar(motivo = 'Detector encerrado'): void {
    const w = this.worker
    this.worker = null
    this.pronto = null
    this.rejeitarInicio?.(new Error(motivo))
    this.rejeitarInicio = null
    if (this.pendente) {
      clearTimeout(this.pendente.timer)
      this.pendente.reject(new Error(motivo))
      this.pendente = null
    }
    void w?.terminate()
  }
}

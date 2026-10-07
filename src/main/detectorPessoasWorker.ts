import { parentPort, workerData } from 'worker_threads'
import type { ObjectDetectionPipeline } from '@huggingface/transformers'

let detector: ObjectDetectionPipeline
async function iniciar(): Promise<void> {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers')
  env.cacheDir = workerData.cache
  detector = await pipeline('object-detection', 'Xenova/yolos-tiny', { dtype: 'q8', device: 'cpu' })
  parentPort!.on('message', async ({ id, jpeg, confianca }) => {
    try {
      const imagem = await RawImage.fromBlob(
        new Blob([Buffer.from(jpeg, 'base64')], { type: 'image/jpeg' })
      )
      const saida = await detector(imagem, { threshold: confianca, percentage: true })
      const limitar = (n: number): number => Math.max(0, Math.min(1, n))
      const pessoas = saida
        .filter((p) => p.label === 'person')
        .map((p) => ({
          ...p,
          box: {
            xmin: limitar(p.box.xmin),
            ymin: limitar(p.box.ymin),
            xmax: limitar(p.box.xmax),
            ymax: limitar(p.box.ymax)
          }
        }))
        .filter((p) => p.box.xmax > p.box.xmin && p.box.ymax > p.box.ymin)
      parentPort!.postMessage({ id, pessoas })
    } catch {
      parentPort!.postMessage({ id, erro: 'Não foi possível analisar esta imagem.' })
    }
  })
  parentPort!.postMessage({ pronto: true })
}
void iniciar().catch(() =>
  parentPort!.postMessage({
    erro: 'Falha ao carregar o detector. Confira a internet no primeiro download e tente novamente.'
  })
)

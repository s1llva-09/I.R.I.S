import { useEffect, useRef, useState, type JSX } from 'react'
import { estadoSensor, fonteAtual, tamanhoFonte, ultimasCaixas } from './presenca'
import { Arco, Camera } from './icones'
import './assets/visor.css'

/** Preview uses the same local source and detections as the risk engine. */
export default function Visor({
  ativo,
  alerta
}: {
  ativo: boolean
  alerta?: boolean
}): JSX.Element {
  const tela = useRef<HTMLCanvasElement>(null)
  const quadro = useRef<HTMLDivElement>(null)
  const [sensor, setSensor] = useState(estadoSensor)
  const [expandido, setExpandido] = useState(false)

  useEffect(() => {
    const id = window.setInterval(() => setSensor(estadoSensor()), 500)
    const mudouTela = (): void => setExpandido(document.fullscreenElement === quadro.current)
    document.addEventListener('fullscreenchange', mudouTela)
    return () => {
      clearInterval(id)
      document.removeEventListener('fullscreenchange', mudouTela)
    }
  }, [])

  useEffect(() => {
    const canvasAtual = tela.current
    const desenhar = (): void => {
      const canvas = tela.current
      if (!canvas) return
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const fonte = fonteAtual()
      const { w, h } = tamanhoFonte()
      if (!ativo || !fonte || !w || !h) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }
      const unidade = Math.min(window.devicePixelRatio || 1, 2)
      const largura = Math.round(canvas.clientWidth * unidade)
      const altura = Math.round(canvas.clientHeight * unidade)
      if (!largura || !altura) return
      if (canvas.width !== largura || canvas.height !== altura) {
        canvas.width = largura
        canvas.height = altura
      }
      ctx.clearRect(0, 0, largura, altura)
      const escala = Math.min(largura / w, altura / h)
      const dx = (largura - w * escala) / 2
      const dy = (altura - h * escala) / 2
      try {
        ctx.drawImage(fonte, dx, dy, w * escala, h * escala)
      } catch {
        return
      }
      ctx.lineWidth = 1.5 * unidade
      ctx.font = `500 ${10 * unidade}px "Segoe UI", sans-serif`
      for (const c of ultimasCaixas()) {
        const x = dx + c.x * escala,
          y = dy + c.y * escala
        const cw = c.w * escala,
          ch = c.h * escala
        const cor = c.nome ? '#73e2ba' : alerta ? '#ff788b' : '#63dcf2'
        ctx.strokeStyle = cor
        ctx.strokeRect(x, y, cw, ch)
        const braco = Math.min(14 * unidade, cw / 3, ch / 3)
        ctx.lineWidth = 3 * unidade
        for (const [cx, cy, sx, sy] of [
          [x, y, 1, 1],
          [x + cw, y, -1, 1],
          [x, y + ch, 1, -1],
          [x + cw, y + ch, -1, -1]
        ]) {
          ctx.beginPath()
          ctx.moveTo(cx + braco * sx, cy)
          ctx.lineTo(cx, cy)
          ctx.lineTo(cx, cy + braco * sy)
          ctx.stroke()
        }
        ctx.lineWidth = 1.5 * unidade
        const texto = c.nome ?? (alerta ? 'NÃO RECONHECIDO' : 'ROSTO DETECTADO')
        const labelW = Math.min(largura, ctx.measureText(texto).width + 14 * unidade)
        const labelX = Math.max(0, Math.min(x, largura - labelW))
        const labelY = Math.max(0, y - 22 * unidade)
        ctx.fillStyle = cor
        ctx.fillRect(labelX, labelY, labelW, 20 * unidade)
        ctx.fillStyle = '#070b14'
        ctx.fillText(texto, labelX + 7 * unidade, labelY + 14 * unidade, labelW - 14 * unidade)
      }
    }
    desenhar()
    const id = window.setInterval(desenhar, 80)
    return () => {
      clearInterval(id)
      canvasAtual?.getContext('2d')?.clearRect(0, 0, canvasAtual.width, canvasAtual.height)
    }
  }, [ativo, alerta])

  const sinal = ativo && sensor.sinal
  const teste = sensor.fonte === 'teste'
  const carregando = ativo && sensor.modelos === 'carregando'
  const titulo = !ativo
    ? 'Seu olhar sobre o ambiente'
    : sensor.erro
      ? 'Câmera indisponível'
      : carregando
        ? 'Preparando a visão local'
        : 'Aguardando sinal da câmera'
  return (
    <div
      ref={quadro}
      className={`camera-viewport ${sinal ? 'has-signal' : ''} ${alerta && sinal ? 'has-alert' : ''}`}
    >
      <canvas ref={tela} aria-label="Imagem da câmera com marcações dos rostos detectados" />
      <div className="camera-topline">
        <span className={`camera-badge ${sinal && !teste ? 'is-live' : ''}`}>
          <i />
          {sinal ? (teste ? 'IMAGEM DE TESTE' : 'AO VIVO') : 'SEM TRANSMISSÃO'}
        </span>
        <span className="camera-channel">
          {teste ? 'FONTE DE TESTE' : sensor.fonte === 'rede' ? 'CÂMERA DE REDE' : 'CÂMERA LOCAL'} /
          01
        </span>
      </div>
      {!sinal && (
        <div className="camera-empty">
          <div className="camera-empty-icon">
            {carregando ? (
              <Arco width={32} height={32} className="arco" />
            ) : (
              <Camera width={32} height={32} />
            )}
          </div>
          <strong>{titulo}</strong>
          <p>
            {sensor.erro && ativo
              ? sensor.erro
              : !ativo
                ? 'Ative uma câmera para acompanhar a imagem e o reconhecimento em tempo real.'
                : carregando
                  ? 'Carregando os modelos de reconhecimento neste dispositivo.'
                  : 'Confira a conexão e selecione a fonte nos controles da câmera.'}
          </p>
          <span>
            USB <i /> REDE LOCAL <i /> CELULAR
          </span>
        </div>
      )}
      <div className="camera-corner corner-tl" />
      <div className="camera-corner corner-tr" />
      <div className="camera-corner corner-bl" />
      <div className="camera-corner corner-br" />
      <div className="camera-bottomline">
        <span>
          {sinal
            ? `${sensor.largura} × ${sensor.altura} · ${teste ? 'SIMULAÇÃO' : 'VISUALIZAÇÃO LOCAL'}`
            : 'NENHUMA IMAGEM SENDO EXIBIDA'}
        </span>
        <button
          onClick={() => {
            const pedido = expandido
              ? document.exitFullscreen()
              : quadro.current?.requestFullscreen()
            pedido?.catch(() => {})
          }}
          title={expandido ? 'Sair da tela cheia' : 'Expandir câmera'}
          aria-label={expandido ? 'Sair da tela cheia' : 'Expandir câmera'}
        >
          <svg
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            aria-hidden
          >
            <path d="M6 2H2v4m8-4h4v4M2 10v4h4m4 0h4v-4" />
          </svg>
        </button>
      </div>
    </div>
  )
}

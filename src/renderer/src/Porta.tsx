import { useEffect, useState, type JSX } from 'react'
import Rosto from './Rosto'
import { estadoDoRosto } from '../../reconhecimento'
import Visor from './Visor'
import { estadoSensor, type Leitura } from './presenca'

/** Estado do reconhecimento e imagem da câmera para consulta no modo porta. */
export default function Porta({
  visao,
  aoFechar
}: {
  visao: Leitura
  aoFechar?: () => void
}): JSX.Element {
  const estado = estadoDoRosto(visao)
  const alerta = estado === 'alerta'

  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`door-monitor ${alerta ? 'alarme' : ''}`}>
      <div className="door-header">
        <div>
          <h1>Íris · porta</h1>
          <span>{visao.rostos < 0 ? 'sensor desligado' : `${visao.rostos} em quadro`}</span>
        </div>
        <time>{agora.toLocaleTimeString('pt-BR')}</time>

        {aoFechar && (
          <button onClick={aoFechar} className="security-button">
            Fechar
          </button>
        )}
      </div>

      <div className="door-content">
        <Rosto estado={estado} nome={visao.conhecidos.join(', ')} disponivel={visao.rostos >= 0} />
        <section className="door-feed" aria-label="Câmera do modo porta">
          <h2>Imagem da câmera</h2>
          <Visor ativo={estadoSensor().ativo} alerta={alerta} />
        </section>
      </div>
    </div>
  )
}

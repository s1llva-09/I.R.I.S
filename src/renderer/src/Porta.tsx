import { useEffect, useState, type JSX } from 'react'
import Rosto from './Rosto'
import { estadoDoRosto } from '../../reconhecimento'
import Visor from './Visor'
import { estadoSensor, type Leitura } from './presenca'
import { Escudo } from './icones'
import { NomeMarca } from './Marca'

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
  const sensor = estadoSensor()

  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`door-monitor ${alerta ? 'alarme' : ''}`}>
      <div className="door-header">
        <div>
          <h1>
            <NomeMarca /> · porta
          </h1>
          <span>Monitor de presença</span>
        </div>
        <div className="door-clock">
          <span>Horário local</span>
          <time>{agora.toLocaleTimeString('pt-BR')}</time>
        </div>

        {aoFechar && (
          <button onClick={aoFechar} className="security-button">
            Fechar
          </button>
        )}
      </div>

      <div className="door-content">
        <section className="door-feed" aria-label="Câmera do modo porta">
          <div className="door-feed-heading">
            <h2>Imagem da câmera</h2>
            <span>Fonte do reconhecimento</span>
          </div>
          <Visor ativo={sensor.ativo} alerta={alerta} />
        </section>
        <div className="door-presence">
          <Rosto
            estado={estado}
            nome={visao.conhecidos.join(', ')}
            disponivel={visao.rostos >= 0}
          />
          <dl className="door-readings" aria-label="Última leitura de presença">
            <div>
              <dt>Rostos na imagem</dt>
              <dd>{visao.rostos < 0 ? '—' : visao.rostos}</dd>
            </div>
            <div>
              <dt>Sem cadastro</dt>
              <dd>{visao.rostos < 0 ? '—' : visao.desconhecidos}</dd>
            </div>
          </dl>
          <p className="door-privacy">
            <Escudo />
            Os rostos são analisados neste computador.
          </p>
        </div>
      </div>
    </div>
  )
}

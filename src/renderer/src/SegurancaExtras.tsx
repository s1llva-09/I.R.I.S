import { useEffect, useState, type JSX } from 'react'
import { diagnosticarImagem } from './diagnostico'
import { definirFonteTeste, pararPresenca, pararQuadros, type EstadoSensor } from './presenca'

export default function SegurancaExtras({
  sensor,
  aoMudar
}: {
  sensor: EstadoSensor
  aoMudar: () => void
}): JSX.Element {
  const [qualidade, setQualidade] = useState<ReturnType<typeof diagnosticarImagem>>({
    luz: null,
    avisos: []
  })
  const [eventos, setEventos] = useState<Awaited<ReturnType<typeof window.api.seguranca.visuais>>>(
    []
  )
  const [miniaturas, setMiniaturas] = useState(false)
  const [mensagem, setMensagem] = useState('')
  const [erroRede, setErroRede] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [agora, setAgora] = useState(Date.now)
  const [confirmar, setConfirmar] = useState<'imagens' | 'historico' | null>(null)
  useEffect(() => {
    let vivo = true
    void window.api.config.ler().then((c) => {
      if (vivo) setMiniaturas(Boolean(c.miniaturasSeguranca))
    })
    const atualizar = async (): Promise<void> => {
      try {
        const [lista, rede] = await Promise.all([
          window.api.seguranca.visuais(),
          window.api.camera.erro()
        ])
        if (vivo) {
          setErroRede(rede)
          setAgora(Date.now())
          setEventos(lista)
          setQualidade(diagnosticarImagem())
        }
      } catch {
        if (vivo) setMensagem('Não foi possível atualizar o histórico visual.')
      }
    }
    void atualizar()
    const timer = window.setInterval(() => void atualizar(), 2000)
    return () => {
      vivo = false
      window.clearInterval(timer)
    }
  }, [])
  const executar = async (tarefa: () => Promise<void>): Promise<void> => {
    if (ocupado) return
    setOcupado(true)
    try {
      await tarefa()
    } catch (e) {
      setMensagem((e as Error).message)
    } finally {
      setOcupado(false)
    }
  }
  return (
    <section className="security-panel security-extras">
      <h2>Diagnóstico e privacidade</h2>
      <div className="security-diagnostics">
        <span>
          Conexão{' '}
          <strong>
            {!sensor.ativo
              ? 'Pausada'
              : sensor.sinal
                ? 'Recebendo imagem'
                : erroRede.includes('Reconectando') || sensor.erro?.includes('Reconectando')
                  ? 'Reconectando…'
                  : 'Sem sinal'}
          </strong>
        </span>
        <span>
          Último quadro{' '}
          <strong>
            {sensor.fonte === 'teste'
              ? 'Foto estática'
              : sensor.ultimoQuadroEm
                ? `há ${Math.max(0, Math.floor((agora - sensor.ultimoQuadroEm) / 1000))}s`
                : '—'}
          </strong>
        </span>
        <span>
          Luminosidade média <strong>{qualidade.luz === null ? '—' : `${qualidade.luz}%`}</strong>
        </span>
      </div>
      <p>
        {qualidade.avisos.join(' ') ||
          'Iluminação e enquadramento sem alertas. Estimativa visual, não garantia de reconhecimento.'}
      </p>
      <div className="security-source-actions">
        <button
          className="security-button"
          disabled={ocupado}
          onClick={() =>
            void executar(async () => {
              pararPresenca()
              pararQuadros()
              await definirFonteTeste(null)
              await window.api.seguranca.privacidade()
              aoMudar()
              setMensagem(
                'Privacidade ativada: câmera, análise e conexões encerradas. Para retomar, use Ativar câmera.'
              )
            })
          }
        >
          Ativar privacidade
        </button>
        <label className="security-consent">
          <input
            type="checkbox"
            checked={miniaturas}
            disabled={ocupado}
            onChange={(e) => {
              const ativa = e.target.checked
              void executar(async () => {
                if (!(await window.api.config.gravar('miniaturasSeguranca', ativa)))
                  throw new Error('Não foi possível salvar a preferência.')
                setMiniaturas(ativa)
                aoMudar()
                setMensagem(
                  ativa
                    ? 'Novos eventos podem guardar miniaturas neste computador.'
                    : 'Novos eventos sem imagens. Para remover as anteriores, use Apagar imagens.'
                )
              })
            }}
          />
          Guardar miniaturas de eventos
        </label>
        <button
          className="security-button"
          disabled={ocupado}
          onClick={() => setConfirmar('imagens')}
        >
          Apagar imagens
        </button>
        <button
          className="security-button"
          disabled={ocupado}
          onClick={() => setConfirmar('historico')}
        >
          Apagar histórico de presença
        </button>
      </div>
      {confirmar && (
        <div className="security-notice" role="alert">
          <span>
            {confirmar === 'imagens'
              ? 'Remover todas as miniaturas salvas?'
              : 'Remover eventos visuais e alarmes de presença? As decisões de risco permanecem.'}
          </span>
          <button
            disabled={ocupado}
            onClick={() =>
              void executar(async () => {
                await window.api.seguranca.limpar(confirmar)
                setEventos(await window.api.seguranca.visuais())
                setConfirmar(null)
                aoMudar()
                setMensagem('Registros removidos.')
              })
            }
          >
            Confirmar exclusão
          </button>
          <button onClick={() => setConfirmar(null)}>Cancelar</button>
        </div>
      )}
      {mensagem && <p role="status">{mensagem}</p>}
      <h3>Histórico visual</h3>
      <p>
        Até 200 eventos locais; mostrando os 50 mais recentes. Miniaturas desativadas por padrão.
      </p>
      <div className="security-visual-history">
        {!eventos.length && <p>Nenhuma mudança de presença registrada.</p>}
        {eventos.map((e) => (
          <article key={e.id}>
            {e.miniatura && (
              <img src={e.miniatura} alt="Imagem capturada no evento" loading="lazy" />
            )}
            <div>
              <time>{new Date(e.momento).toLocaleString('pt-BR')}</time>
              <p>{e.texto}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

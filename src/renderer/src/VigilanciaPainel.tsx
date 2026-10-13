import { useEffect, useRef, useState, type JSX } from 'react'
import type { CameraPainel } from '../../shared/cameras'
import {
  PADRAO_VIGILANCIA,
  type AjustesVigilancia,
  type EstadoVigilancia,
  type Ponto
} from '../../shared/vigilancia'
import './assets/vigilancia.css'
import { Fechar } from './icones'

const rotulos = {
  desarmado: 'Proteção desarmada',
  preparando: 'Preparando análise local…',
  armado: 'Fora de casa · ativo',
  erro: 'Proteção indisponível'
}
const entregas = {
  pendente: 'Aguardando envio',
  enviado: 'Aceito pelo serviço de notificações',
  falhou: 'Falha no envio',
  desativado: 'Sem envio ao celular'
}
const dias = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export default function VigilanciaPainel(): JSX.Element {
  const [estado, setEstado] = useState<EstadoVigilancia | null>(null)
  const [ajustes, setAjustes] = useState<AjustesVigilancia>(() =>
    structuredClone(PADRAO_VIGILANCIA)
  )
  const [cameras, setCameras] = useState<CameraPainel[]>([])
  const [selecionada, setSelecionada] = useState('')
  const [imagem, setImagem] = useState('')
  const [momento, setMomento] = useState(0)
  const [agora, setAgora] = useState(Date.now)
  const [pontos, setPontos] = useState<Ponto[]>([])
  const [nome, setNome] = useState('Entrada')
  const [erro, setErro] = useState('')
  const [aviso, setAviso] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [alterado, setAlterado] = useState(false)
  const [enderecos, setEnderecos] = useState<string[]>([])
  const [ip, setIp] = useState('')
  const [qr, setQr] = useState<Awaited<
    ReturnType<typeof window.api.vigilancia.abrirCelular>
  > | null>(null)
  const [confirmacao, setConfirmacao] = useState<'limpar' | 'revogar' | null>(null)
  const vivo = useRef(false),
    carregado = useRef(false),
    executando = useRef(false)
  const atualizar = async (sincronizar = false): Promise<void> => {
    const [e, cs] = await Promise.all([window.api.vigilancia.estado(), window.api.central.listar()])
    if (!vivo.current) return
    setEstado(e)
    setCameras(cs)
    setAgora(Date.now())
    if (!carregado.current || sincronizar) {
      setAjustes(e.ajustes)
      carregado.current = true
      setAlterado(false)
    }
  }
  useEffect(() => {
    vivo.current = true
    void atualizar().catch((e) => setErro((e as Error).message))
    void window.api.vigilancia
      .enderecos()
      .then((ips) => {
        if (vivo.current) {
          setEnderecos(ips)
          setIp(ips[0] ?? '')
        }
      })
      .catch(() => {})
    const timer = window.setInterval(
      () => void atualizar().catch(() => setErro('Não foi possível atualizar a proteção.')),
      2000
    )
    return () => {
      vivo.current = false
      window.clearInterval(timer)
    }
    // A edição local permanece intacta durante as consultas de estado.
  }, [])
  useEffect(() => {
    let cancelado = false
    const receber = (q: import('../../shared/cameras').QuadroCamera | null): void => {
      if (!cancelado && q?.id === selecionada) {
        setImagem(`data:image/jpeg;base64,${q.jpeg}`)
        setMomento(q.momento)
      }
    }
    const parar = window.api.central.aoFrame(receber)
    if (selecionada)
      void window.api.central
        .quadro(selecionada)
        .then(receber)
        .catch(() => {})
    return () => {
      cancelado = true
      parar()
    }
  }, [selecionada])
  const executar = async (tarefa: () => Promise<void>, sincronizar = false): Promise<void> => {
    if (executando.current) return
    executando.current = true
    setOcupado(true)
    setErro('')
    setAviso('')
    try {
      await tarefa()
      await atualizar(sincronizar)
    } catch (e) {
      if (vivo.current) setErro((e as Error).message)
    } finally {
      executando.current = false
      if (vivo.current) setOcupado(false)
    }
  }
  const mudar = (valor: AjustesVigilancia): void => {
    setAjustes(valor)
    setAlterado(true)
  }
  const bloqueado = ocupado || estado?.modo === 'armado' || estado?.modo === 'preparando'
  const zonas = ajustes.cameras.find((c) => c.cameraId === selecionada)?.zonas ?? []
  const adicionar = (): void => {
    if (pontos.length < 3 || !nome.trim() || zonas.length >= 5) return
    const lista = [...zonas, { id: crypto.randomUUID(), nome: nome.trim(), pontos }]
    mudar({
      ...ajustes,
      cameras: [
        ...ajustes.cameras.filter((c) => c.cameraId !== selecionada),
        { cameraId: selecionada, zonas: lista }
      ]
    })
    setPontos([])
  }
  const saudaveis =
    estado?.cameras.filter(
      (c) => !c.erro && c.ultimaAnalise !== null && agora - c.ultimaAnalise < 15000
    ).length ?? 0
  return (
    <section className="security-panel vigia-panel" aria-labelledby="vigia-titulo">
      <div className="vigia-heading">
        <div>
          <p className="security-eyebrow">Proteção por áreas</p>
          <h2 id="vigia-titulo">Fora de casa</h2>
          <p>
            Marque as áreas. A Íris observa as câmeras e avisa quando uma pessoa permanece nelas.
          </p>
        </div>
        <span className={`vigia-mode vigia-mode-${estado?.modo ?? 'desarmado'}`}>
          {estado ? rotulos[estado.modo] : 'Carregando…'}
        </span>
      </div>
      <div className="vigia-metrics">
        <div>
          <strong>{ajustes.cameras.length}</strong>
          <span>Câmeras protegidas</span>
        </div>
        <div>
          <strong>
            {saudaveis}/{estado?.cameras.length ?? 0}
          </strong>
          <span>Com análise recente</span>
        </div>
        <div>
          <strong>{estado?.notificacoes.dispositivos.length ?? 0}</strong>
          <span>Celulares com alertas</span>
        </div>
        <div>
          <strong>{ajustes.permanencia}s</strong>
          <span>Confirmação na área</span>
        </div>
      </div>
      {estado?.erro && (
        <p className="security-source-error" role="alert">
          {estado.erro}
        </p>
      )}
      {erro && (
        <p className="security-source-error" role="alert">
          {erro}
        </p>
      )}
      {aviso && (
        <p role="status" className="security-notice">
          {aviso}
        </p>
      )}
      <div className="vigia-actions">
        <button
          className="security-button security-button-primary"
          disabled={!estado || ocupado || bloqueado || !ajustes.cameras.length}
          onClick={() =>
            void executar(async () => {
              await window.api.vigilancia.salvar(ajustes)
              await window.api.vigilancia.armar()
            }, true)
          }
        >
          Ativar Fora de casa
        </button>
        <button
          className="security-button"
          disabled={!estado || estado.modo === 'desarmado'}
          onClick={() => {
            void window.api.vigilancia
              .desarmar()
              .then(() => atualizar(true))
              .catch((e) => setErro((e as Error).message))
          }}
        >
          Desarmar proteção
        </button>
        <span className="vigia-hint">
          Continua com a janela minimizada. Mantenha o computador ligado.
        </span>
      </div>
      {estado?.modo === 'preparando' && (
        <p role="status">
          O primeiro uso baixa o detector de pessoas. Depois a análise usa o modelo salvo no
          computador.
        </p>
      )}
      {!estado?.notificacoes.configurado && (
        <p className="vigia-hint">
          Os avisos ficam neste computador. Pareie a Íris no celular e ative as notificações para
          recebê-los à distância.
        </p>
      )}
      {!!estado?.cameras.length && (
        <div className="vigia-health">
          {estado.cameras.map((s) => (
            <div key={s.id} className={s.erro ? 'vigia-health-bad' : ''}>
              <strong>{cameras.find((c) => c.id === s.id)?.nome ?? 'Câmera'}</strong>
              <span>
                {s.erro ||
                  (s.ultimaAnalise
                    ? `${s.pessoas} pessoa(s) · análise há ${Math.max(0, Math.floor((agora - s.ultimaAnalise) / 1000))}s`
                    : 'Aguardando primeira análise')}
              </span>
            </div>
          ))}
        </div>
      )}
      <details className="vigia-details" open={!ajustes.cameras.length}>
        <summary>Áreas protegidas e regras {alterado && '· alterações não salvas'}</summary>
        <fieldset disabled={bloqueado} className="vigia-fieldset">
          <div className="vigia-form-row">
            <label>
              Câmera para marcar a área
              <select
                value={selecionada}
                onChange={(e) => {
                  setSelecionada(e.target.value)
                  setImagem('')
                  setMomento(0)
                  setPontos([])
                }}
              >
                <option value="">Escolha uma câmera</option>
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome} · {c.ambiente}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="security-button"
              disabled={!selecionada}
              onClick={() =>
                void executar(async () => {
                  await window.api.central.conectar(selecionada)
                })
              }
            >
              Conectar prévia
            </button>
          </div>
          {selecionada && (
            <>
              <p className="vigia-hint">
                Clique em 3 a 12 pontos para desenhar a área. A confirmação usa a posição dos pés da
                pessoa; marque o chão que deseja proteger.
              </p>
              <div
                className="vigia-zone-editor"
                data-testid="zone-editor"
                onClick={(e) => {
                  if (!imagem || bloqueado || pontos.length >= 12) return
                  const r = e.currentTarget.getBoundingClientRect()
                  const ponto = {
                    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
                    y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
                  }
                  setPontos((atuais) => (atuais.length >= 12 ? atuais : [...atuais, ponto]))
                }}
              >
                {imagem ? (
                  <img src={imagem} alt="Prévia para marcar a área protegida" />
                ) : (
                  <div className="vigia-zone-empty">Conecte a câmera e aguarde a imagem.</div>
                )}
                <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">
                  {zonas.map((z) => (
                    <polygon
                      key={z.id}
                      points={z.pontos.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')}
                      className="vigia-zone-saved"
                    />
                  ))}
                  <polyline points={pontos.map((p) => `${p.x * 1000},${p.y * 1000}`).join(' ')} />
                  {pontos.map((p, i) => (
                    <circle key={i} cx={p.x * 1000} cy={p.y * 1000} r="7" />
                  ))}
                </svg>
              </div>
              <p className="vigia-hint">
                {pontos.length}/12 pontos ·{' '}
                {momento ? `Quadro de ${new Date(momento).toLocaleTimeString()}` : 'Sem imagem'} ·{' '}
                {zonas.length}/5 áreas nesta câmera
              </p>
              <div className="vigia-form-row">
                <label>
                  Nome da área
                  <input maxLength={60} value={nome} onChange={(e) => setNome(e.target.value)} />
                </label>
                <button
                  className="security-button"
                  disabled={!pontos.length}
                  onClick={() => setPontos(pontos.slice(0, -1))}
                >
                  Desfazer ponto
                </button>
                <button
                  className="security-button"
                  disabled={!imagem}
                  onClick={() =>
                    setPontos([
                      { x: 0, y: 0 },
                      { x: 1, y: 0 },
                      { x: 1, y: 1 },
                      { x: 0, y: 1 }
                    ])
                  }
                >
                  Usar imagem inteira
                </button>
                <button
                  className="security-button"
                  disabled={pontos.length < 3 || !nome.trim() || zonas.length >= 5}
                  onClick={adicionar}
                >
                  Adicionar área
                </button>
              </div>
            </>
          )}
          <div className="vigia-zone-list">
            {ajustes.cameras.map((c) => (
              <div key={c.cameraId}>
                <strong>
                  {cameras.find((x) => x.id === c.cameraId)?.nome ?? 'Câmera removida'}
                </strong>
                {c.zonas.map((z) => (
                  <span key={z.id}>
                    {z.nome}
                    <button
                      aria-label={`Remover área ${z.nome}`}
                      onClick={() =>
                        mudar({
                          ...ajustes,
                          cameras: ajustes.cameras
                            .map((x) =>
                              x.cameraId === c.cameraId
                                ? { ...x, zonas: x.zonas.filter((y) => y.id !== z.id) }
                                : x
                            )
                            .filter((x) => x.zonas.length)
                        })
                      }
                    >
                      <Fechar width={14} height={14} />
                    </button>
                  </span>
                ))}
              </div>
            ))}
          </div>
          <div className="vigia-form-grid">
            <label>
              Permanência para confirmar (segundos)
              <input
                type="number"
                min={1}
                max={60}
                value={ajustes.permanencia}
                onChange={(e) => mudar({ ...ajustes, permanencia: Number(e.target.value) })}
              />
            </label>
            <label>
              Intervalo entre alertas da área (segundos)
              <input
                type="number"
                min={30}
                max={3600}
                value={ajustes.intervalo}
                onChange={(e) => mudar({ ...ajustes, intervalo: Number(e.target.value) })}
              />
            </label>
            <label>
              Confiança mínima do detector
              <input
                type="number"
                min={0.3}
                max={0.95}
                step={0.05}
                value={ajustes.confianca}
                onChange={(e) => mudar({ ...ajustes, confianca: Number(e.target.value) })}
              />
            </label>
            <label>
              Manter eventos por (dias)
              <input
                type="number"
                min={1}
                max={30}
                value={ajustes.retencaoDias}
                onChange={(e) => mudar({ ...ajustes, retencaoDias: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="vigia-check">
            <input
              type="checkbox"
              checked={ajustes.guardarImagem}
              onChange={(e) => mudar({ ...ajustes, guardarImagem: e.target.checked })}
            />
            Guardar uma imagem nos eventos de pessoa
          </label>
          <p className="vigia-hint">
            Imagens ficam no histórico local e podem ser consultadas no celular pareado. Por padrão,
            só o texto é guardado.
          </p>
          <label className="vigia-check">
            <input
              type="checkbox"
              checked={ajustes.agenda.ativa}
              onChange={(e) =>
                mudar({ ...ajustes, agenda: { ...ajustes.agenda, ativa: e.target.checked } })
              }
            />
            Ativar automaticamente por horário
          </label>
          {ajustes.agenda.ativa && (
            <>
              <div className="vigia-form-row">
                <label>
                  Início
                  <input
                    type="time"
                    value={ajustes.agenda.inicio}
                    onChange={(e) =>
                      mudar({ ...ajustes, agenda: { ...ajustes.agenda, inicio: e.target.value } })
                    }
                  />
                </label>
                <label>
                  Fim
                  <input
                    type="time"
                    value={ajustes.agenda.fim}
                    onChange={(e) =>
                      mudar({ ...ajustes, agenda: { ...ajustes.agenda, fim: e.target.value } })
                    }
                  />
                </label>
              </div>
              <div className="vigia-actions">
                {dias.map((d, i) => (
                  <label key={d} className="vigia-check">
                    <input
                      type="checkbox"
                      checked={ajustes.agenda.dias.includes(i)}
                      onChange={(e) =>
                        mudar({
                          ...ajustes,
                          agenda: {
                            ...ajustes.agenda,
                            dias: e.target.checked
                              ? [...ajustes.agenda.dias, i]
                              : ajustes.agenda.dias.filter((x) => x !== i)
                          }
                        })
                      }
                    />
                    {d}
                  </label>
                ))}
              </div>
              <p className="vigia-hint">
                Horário do computador. Se cruzar a meia-noite, o dia escolhido é o dia de início.
                Desarmar manualmente também desliga a agenda.
              </p>
            </>
          )}
          <button
            className="security-button security-button-primary"
            disabled={!alterado}
            onClick={() =>
              void executar(async () => {
                await window.api.vigilancia.salvar(ajustes)
                setAviso('Áreas e regras salvas.')
              }, true)
            }
          >
            Salvar proteção
          </button>
        </fieldset>
        {bloqueado && <p className="vigia-hint">Desarme a proteção para editar.</p>}
      </details>
      <details className="vigia-details">
        <summary>Íris no celular · câmeras, eventos e notificações</summary>
        <p>
          Um painel instalável para iPhone e Android. Confira a proteção, veja as câmeras e receba
          os avisos da Íris.
        </p>
        <div className="vigia-form-row">
          <label>
            Endereço privado do computador
            <select value={ip} onChange={(e) => setIp(e.target.value)}>
              {enderecos.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <button
            className="security-button"
            disabled={ocupado || !ip}
            onClick={() =>
              void executar(async () => {
                setQr(await window.api.vigilancia.abrirCelular(ip))
              })
            }
          >
            Parear Íris no celular
          </button>
        </div>
        <p className="vigia-hint">
          No Wi-Fi de casa, use o endereço da rede local. Fora de casa, use o endereço de uma VPN
          privada instalada no PC e no celular. O QR da rede local sozinho não funciona no 4G/5G.
        </p>
        {qr && (
          <div className="vigia-pairing">
            <div>
              <h3>1. Confiar neste computador</h3>
              <div dangerouslySetInnerHTML={{ __html: qr.certificadoQr }} />
              <p>
                Instale o certificado uma vez. iPhone: instale o perfil e habilite em Geral → Sobre
                → Certificados Confiáveis. Android: Segurança → Instalar certificado de CA.
              </p>
              <code>{qr.impressao}</code>
              <p className="vigia-hint">Confira a impressão antes de confiar no certificado.</p>
            </div>
            <div>
              <h3>2. Abrir e instalar a Íris</h3>
              <div dangerouslySetInnerHTML={{ __html: qr.qr }} />
              <p>
                iPhone: Safari → Compartilhar → Adicionar à Tela de Início. Android: Chrome →
                Instalar aplicativo. Abra pelo ícone e toque em Ativar notificações.
              </p>
              <button
                className="security-button"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(qr.url)
                    .then(() => setAviso('Link de pareamento copiado. Mantenha-o privado.'))
                    .catch(() => setErro('Não foi possível copiar.'))
                }
              >
                Copiar link privado
              </button>
              <p className="vigia-hint">
                iPhone requer iOS 16.4 ou posterior para notificações. Se o app pedir novo
                pareamento, cole esse link dentro dele.
              </p>
            </div>
          </div>
        )}
        <div className="vigia-device-list">
          {estado?.notificacoes.dispositivos.map((d) => (
            <div key={d.id}>
              <span>{d.nome}</span>
              <button
                className="security-button"
                disabled={ocupado}
                onClick={() =>
                  void executar(async () => {
                    await window.api.vigilancia.removerCelular(d.id)
                  })
                }
              >
                Remover notificações
              </button>
            </div>
          ))}
        </div>
        <div className="vigia-actions">
          <button
            className="security-button"
            disabled={ocupado || !estado?.notificacoes.configurado}
            onClick={() =>
              void executar(async () => {
                await window.api.vigilancia.testar()
                setAviso('Teste entrou na fila. Confira a entrega no histórico e no celular.')
              })
            }
          >
            Enviar alerta de teste
          </button>
          <button className="security-button" onClick={() => setConfirmacao('revogar')}>
            Revogar todos os acessos
          </button>
        </div>
      </details>
      <details className="vigia-details">
        <summary>Histórico da proteção · {estado?.eventos.length ?? 0} eventos</summary>
        <div className="vigia-actions">
          <span className="vigia-hint">
            Até 500 registros; os 100 mais recentes aparecem aqui. Retenção:{' '}
            {estado?.ajustes.retencaoDias ?? 7} dias.
          </span>
          <button className="security-button" onClick={() => setConfirmacao('limpar')}>
            Apagar histórico
          </button>
        </div>
        {!estado?.eventos.length && <p className="vigia-hint">Nenhum evento registrado.</p>}
        <div className="vigia-events">
          {estado?.eventos.map((e) => (
            <article key={e.id}>
              <div>
                <time>{new Date(e.momento).toLocaleString()}</time>
                <strong>{e.camera}</strong>
                <p>{e.texto}</p>
                <small>
                  {entregas[e.entrega]}
                  {e.erro && ` · ${e.erro}`}
                </small>
                {e.entrega === 'falhou' && (
                  <button
                    className="security-button"
                    disabled={ocupado}
                    onClick={() =>
                      void executar(async () => {
                        await window.api.vigilancia.repetir(e.id)
                      })
                    }
                  >
                    Tentar envio novamente
                  </button>
                )}
              </div>
              {e.imagem && <img src={e.imagem} alt={`Evento em ${e.camera}`} loading="lazy" />}
            </article>
          ))}
        </div>
      </details>
      {confirmacao && (
        <div className="security-notice" role="alert">
          <span>
            {confirmacao === 'limpar'
              ? 'Apagar todos os eventos e imagens de perímetro?'
              : 'Desconectar todos os celulares e cancelar suas notificações? Será necessário parear novamente.'}
          </span>
          <button
            className="security-button"
            disabled={ocupado}
            onClick={() =>
              void executar(async () => {
                if (confirmacao === 'limpar') await window.api.vigilancia.limpar()
                else {
                  await window.api.vigilancia.revogarCelular()
                  setQr(null)
                }
                setConfirmacao(null)
              })
            }
          >
            Confirmar
          </button>
          <button className="security-button" onClick={() => setConfirmacao(null)}>
            Cancelar
          </button>
        </div>
      )}
      <p className="vigia-hint">
        Detecção local de pessoas; iluminação e enquadramento influenciam o resultado. Fotos avulsas
        não contam como vídeo. Avisos de queda de câmera exigem que a Íris e o computador continuem
        online.
      </p>
    </section>
  )
}

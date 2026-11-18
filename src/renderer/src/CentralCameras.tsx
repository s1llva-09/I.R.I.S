import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { CameraSalva, CameraPainel } from '../../shared/cameras'
import { listarCameras } from './presenca'
import { Adicionar, Camera, Colunas, Iniciar, Pausa, Ampliar, Escudo } from './icones'
import './assets/cameras.css'

const novaCamera = (): CameraSalva => ({
  id: '',
  nome: '',
  ambiente: '',
  tipo: 'rede',
  endereco: ''
})

function CameraCard({
  camera,
  editar,
  remover,
  alternar,
  ocupado
}: {
  camera: CameraPainel
  editar: () => void
  remover: () => void
  alternar: () => void
  ocupado: boolean
}): JSX.Element {
  const card = useRef<HTMLElement>(null)
  const [imagem, setImagem] = useState('')
  const [ultimo, setUltimo] = useState(0)
  const [agora, setAgora] = useState(Date.now)
  const [foto, setFoto] = useState(false)
  const [erro, setErro] = useState('')
  const ativa = camera.ligada

  useEffect(() => {
    let morto = false,
      versao = 0
    const parar = window.api.central.aoFrame((q) => {
      if (q.id !== camera.id || !ativa) return
      const atual = ++versao
      const img = new Image()
      img.onload = () => {
        if (morto || atual !== versao) return
        setImagem(img.src)
        setUltimo(Date.now())
        setFoto(q.foto)
        setErro('')
      }
      img.onerror = () => {
        if (!morto && atual === versao) setErro('Imagem inválida recebida.')
      }
      img.src = `data:image/jpeg;base64,${q.jpeg}`
    })
    return () => {
      morto = true
      parar()
    }
  }, [camera.id, ativa])

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const sinal = ativa && ultimo > 0 && ((foto && camera.tipo !== 'webcam') || agora - ultimo < 6000)
  return (
    <article className="camera-card" ref={card} data-camera-id={camera.id}>
      <header>
        <div>
          <small>{camera.ambiente}</small>
          <h3>{camera.nome}</h3>
        </div>
        <span
          className={`camera-connection ${sinal ? 'camera-online' : ativa ? 'camera-waiting' : ''} ${
            sinal && !(foto && camera.tipo !== 'webcam') ? 'is-live' : ''
          }`}
        >
          <i aria-hidden="true" />
          {!ativa
            ? 'Pausada'
            : sinal
              ? foto && camera.tipo !== 'webcam'
                ? 'Foto'
                : 'Ao vivo'
              : 'Sem sinal'}
        </span>
      </header>
      <div className="camera-tile-viewport">
        <img
          src={imagem || undefined}
          alt={`Imagem de ${camera.nome}`}
          style={{ visibility: sinal ? 'visible' : 'hidden' }}
        />
        {!sinal && (
          <div className="camera-tile-empty">
            <Camera width={24} height={24} />
            <strong>
              {!ativa
                ? 'Pronta para conectar'
                : camera.tipo === 'celular'
                  ? 'Aguardando o celular'
                  : 'Aguardando imagem'}
            </strong>
            <p>
              {ativa
                ? erro || camera.erro || 'A imagem aparece quando a fonte começar a transmitir.'
                : 'Conecte esta câmera para acompanhar o ambiente.'}
            </p>
          </div>
        )}
        {sinal && (
          <span className="camera-tile-time">
            {foto && camera.tipo !== 'webcam'
              ? 'Imagem estática'
              : `Último quadro há ${Math.max(0, Math.floor((agora - ultimo) / 1000))}s`}
          </span>
        )}
      </div>
      <footer>
        <button className="camera-connect" onClick={alternar} disabled={ocupado}>
          {ativa ? <Pausa /> : <Iniciar />}
          {ativa ? 'Pausar' : camera.tipo === 'celular' ? 'Conectar celular' : 'Conectar'}
        </button>
        <button
          onClick={() =>
            void card.current?.requestFullscreen().catch(() => setErro('Não foi possível ampliar.'))
          }
        >
          <Ampliar />
          Ampliar
        </button>
        <button onClick={editar} disabled={ocupado}>
          Editar
        </button>
        <button className="camera-remove" onClick={remover} disabled={ocupado}>
          Remover
        </button>
      </footer>
      {erro && sinal && (
        <p className="camera-card-error" role="alert">
          {erro}
        </p>
      )}
      {camera.pareamento && ativa && (
        <details className="camera-pairing">
          <summary>QR de {camera.nome} · conectar celular</summary>
          <p>
            No mesmo Wi-Fi, instale o certificado deste computador uma vez. iPhone: instale o perfil
            e habilite em Geral → Sobre → Certificados Confiáveis. Android: Segurança → Instalar
            certificado de CA.
          </p>
          {camera.pareamento.certificadoQr && (
            <>
              <strong>1. Certificado local</strong>
              <div dangerouslySetInnerHTML={{ __html: camera.pareamento.certificadoQr }} />
              <code>{camera.pareamento.impressao}</code>
              <p>
                Confira a impressão antes de confiar. A chave privada fica neste computador. Remova
                o certificado nas configurações do celular quando deixar de usar.
              </p>
            </>
          )}
          <strong>2. Transmitir para {camera.nome}</strong>
          <div dangerouslySetInnerHTML={{ __html: camera.pareamento.qr }} />
          <p>
            Abra no Safari/Chrome, permita a câmera e toque em Ligar câmera ao vivo. Mantenha a tela
            ligada. Este QR pertence apenas a esta câmera; não compartilhe.
          </p>
          <button
            onClick={() =>
              void navigator.clipboard
                .writeText(camera.pareamento!.url)
                .catch(() => setErro('Não foi possível copiar o link.'))
            }
          >
            Copiar link
          </button>
        </details>
      )}
    </article>
  )
}

export default function CentralCameras(): JSX.Element {
  const [cameras, setCameras] = useState<CameraPainel[]>([])
  const [form, setForm] = useState<CameraSalva | null>(null)
  const [webcams, setWebcams] = useState<{ id: string; nome: string }[]>([])
  const [filtro, setFiltro] = useState('')
  const [erro, setErro] = useState('')
  const [ocupado, setOcupado] = useState(false)
  const [remocao, setRemocao] = useState<CameraPainel | null>(null)
  const [colunas, setColunas] = useState(2)
  const vivo = useRef(false),
    executando = useRef(false),
    geracao = useRef(0)
  const atualizar = useCallback(async (): Promise<void> => {
    const lista = await window.api.central.listar()
    if (vivo.current) setCameras(lista)
  }, [])
  useEffect(() => {
    vivo.current = true
    void atualizar().catch(() => setErro('Não foi possível carregar as câmeras.'))
    const timer = window.setInterval(
      () => void atualizar().catch(() => setErro('Falha ao atualizar o painel.')),
      2000
    )
    const parar = window.api.central.aoPausar(() => {
      geracao.current++

      void atualizar().catch(() => {})
    })
    return () => {
      vivo.current = false
      // Contador de cancelamento, não uma referência a elemento DOM.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      geracao.current++
      parar()
      window.clearInterval(timer)
      void window.api.central.sair().catch(() => {})
    }
  }, [atualizar])
  const executar = async (tarefa: () => Promise<void>): Promise<void> => {
    if (executando.current) return
    executando.current = true
    setOcupado(true)
    setErro('')
    try {
      await tarefa()
      await atualizar()
    } catch (e) {
      if (vivo.current) setErro((e as Error).message)
    } finally {
      executando.current = false
      if (vivo.current) setOcupado(false)
    }
  }
  const editar = (c: CameraSalva): void => {
    setForm({ ...c })
    void listarCameras()
      .then(setWebcams)
      .catch(() => setErro('Não foi possível listar as webcams.'))
  }
  const ambientes = [...new Set(cameras.map((c) => c.ambiente))].sort()
  return (
    <section
      id="seguranca-cameras"
      className="security-panel camera-control"
      aria-labelledby="central-cameras-titulo"
      aria-busy={ocupado}
    >
      <div className="camera-control-heading">
        <div>
          <div className="camera-title-row">
            <h2 id="central-cameras-titulo">Suas câmeras</h2>
            <span
              className="camera-count"
              aria-label={`${cameras.length} de 12 câmeras cadastradas`}
            >
              {cameras.length}/12
            </span>
          </div>
          <p>Imagens e conexões organizadas por ambiente.</p>
        </div>
        <button
          className="security-button security-button-primary"
          disabled={ocupado || cameras.length >= 12}
          title={cameras.length >= 12 ? 'Limite de 12 câmeras atingido' : undefined}
          onClick={() => editar(novaCamera())}
        >
          <Adicionar width={16} height={16} /> Adicionar câmera
        </button>
      </div>
      {cameras.length > 0 && (
        <div className="camera-toolbar">
          <label>
            Ambiente{' '}
            <select
              aria-label="Filtrar ambiente"
              value={filtro}
              onChange={(e) => setFiltro(e.target.value)}
            >
              <option value="">Todos</option>
              {ambientes.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          <div className="camera-layout-field">
            <span>Visualização</span>
            <div className="camera-layout-options" role="group" aria-label="Colunas do mosaico">
              {[1, 2, 3].map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-label={`${n} ${n === 1 ? 'coluna' : 'colunas'}`}
                  aria-pressed={colunas === n}
                  title={`${n} ${n === 1 ? 'coluna' : 'colunas'}`}
                  onClick={() => setColunas(n)}
                >
                  <Colunas quantidade={n} />
                  <span>{n}</span>
                </button>
              ))}
            </div>
          </div>
          <button
            className="security-button camera-batch-connect"
            disabled={ocupado || !cameras.length}
            onClick={() =>
              void executar(async () => {
                const ciclo = geracao.current
                const falhas: string[] = []
                for (const c of cameras) {
                  if (!vivo.current || ciclo !== geracao.current) break
                  {
                    try {
                      await window.api.central.conectar(c.id)
                    } catch (e) {
                      falhas.push(`${c.nome}: ${(e as Error).message}`)
                    }
                  }
                }
                if (falhas.length) throw new Error(falhas.join(' · '))
              })
            }
          >
            Conectar todas
          </button>
          <button
            className="security-button"
            onClick={() => {
              geracao.current++

              void window.api.central
                .pararTudo()
                .then(atualizar)
                .catch(() => setErro('Não foi possível encerrar as conexões.'))
            }}
          >
            Pausar todas
          </button>
        </div>
      )}
      {erro && (
        <p role="alert" className="security-source-error">
          {erro}
        </p>
      )}
      {form && (
        <form
          className="camera-edit-form"
          onSubmit={(e) => {
            e.preventDefault()
            void executar(async () => {
              await window.api.central.salvar(form)
              setForm(null)
              setFiltro('')
            })
          }}
        >
          <div className="camera-form-heading">
            <h3>{form.id ? 'Editar câmera' : 'Adicionar câmera'}</h3>
            <p>Identifique o ambiente e escolha a origem da imagem.</p>
          </div>
          <label>
            Nome
            <input
              required
              maxLength={60}
              value={form.nome}
              onChange={(e) => setForm({ ...form, nome: e.target.value })}
              placeholder="Câmera da sala"
            />
          </label>
          <label>
            Ambiente
            <input
              required
              maxLength={60}
              value={form.ambiente}
              onChange={(e) => setForm({ ...form, ambiente: e.target.value })}
              placeholder="Sala, Quarto, Garagem…"
            />
          </label>
          <label>
            Origem da imagem
            <select
              value={form.tipo}
              onChange={(e) =>
                setForm({ ...form, tipo: e.target.value as CameraSalva['tipo'], endereco: '' })
              }
            >
              <option value="rede">Câmera de rede · MJPEG</option>
              <option value="celular">Celular · navegador HTTPS</option>
              <option value="webcam">Webcam / USB / Camo</option>
            </select>
          </label>
          {form.tipo === 'rede' && (
            <label>
              Endereço do vídeo
              <input
                required
                type="url"
                value={form.endereco}
                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                placeholder="http://192.168.1.20:4747/video"
              />
              <small>Use a URL MJPEG HTTP; RTSP/HLS precisam de conversor.</small>
            </label>
          )}
          {form.tipo === 'webcam' && (
            <label>
              Dispositivo
              <button
                type="button"
                className="security-button"
                disabled={ocupado}
                onClick={() =>
                  void executar(async () => {
                    const stream = await navigator.mediaDevices.getUserMedia({
                      video: true,
                      audio: false
                    })
                    stream.getTracks().forEach((t) => t.stop())
                    setWebcams(await listarCameras())
                  })
                }
              >
                Autorizar e atualizar webcams
              </button>
              <select
                required
                value={form.endereco}
                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
              >
                <option value="">Escolha uma webcam</option>
                {webcams
                  .filter((c) => c.id)
                  .map((c) => (
                    <option value={c.id} key={c.id}>
                      {c.nome}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {form.tipo === 'celular' && (
            <p>Salve e clique em Conectar celular no cartão. Cada celular recebe seu próprio QR.</p>
          )}
          <div className="camera-form-actions">
            <button className="security-button security-button-primary" disabled={ocupado}>
              Salvar câmera
            </button>
            <button
              type="button"
              className="security-button"
              disabled={ocupado}
              onClick={() => setForm(null)}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}
      {remocao && (
        <div className="security-notice" role="alert">
          <span>
            Remover {remocao.nome} de {remocao.ambiente}?
          </span>
          <button
            disabled={ocupado}
            onClick={() =>
              void executar(async () => {
                await window.api.central.remover(remocao.id)
                setRemocao(null)
                setFiltro('')
              })
            }
          >
            Confirmar remoção
          </button>
          <button onClick={() => setRemocao(null)}>Cancelar</button>
        </div>
      )}
      {!cameras.length && !form && (
        <div className="camera-control-empty">
          <div className="camera-empty-emblem">
            <Camera width={28} height={28} />
          </div>
          <h3>Adicione sua primeira câmera</h3>
          <p>Conecte uma câmera de rede, uma webcam ou o celular para acompanhar cada ambiente.</p>
          <button className="security-button" onClick={() => editar(novaCamera())}>
            <Adicionar />
            Adicionar câmera
          </button>
        </div>
      )}
      <div className={`camera-mosaic camera-columns-${colunas}`}>
        {cameras.map((c) => (
          <div key={c.id} hidden={!!filtro && c.ambiente !== filtro}>
            <CameraCard
              key={`${c.id}:${c.sessao ?? ''}`}
              camera={c}
              editar={() => editar(c)}
              ocupado={ocupado}
              remover={() => setRemocao(c)}
              alternar={() => {
                if (ocupado) return
                void executar(async () => {
                  if (c.ligada) await window.api.central.parar(c.id)
                  else await window.api.central.conectar(c.id)
                })
              }}
            />
          </div>
        ))}
      </div>
      <details className="camera-control-note">
        <summary>
          <Escudo />
          Sobre o monitoramento das câmeras
        </summary>
        <p>
          Visualização simultânea, sem gravação de vídeo. Câmeras protegidas continuam monitorando
          ao sair desta tela ou minimizar a Íris. O reconhecimento facial analisa somente a fonte
          selecionada no visor individual.
        </p>
      </details>
    </section>
  )
}

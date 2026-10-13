import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import Visor from './Visor'
import CentralCameras from './CentralCameras'
import { Adicionar, Externo, Fechar } from './icones'
import VigilanciaPainel from './VigilanciaPainel'
import SegurancaExtras from './SegurancaExtras'
import { diagnosticarImagem } from './diagnostico'
import {
  aoMudarCameras,
  capturarDescritor,
  definirFonteTeste,
  definirGaleria,
  definirLimiar,
  estadoSensor,
  fonteAtual,
  listarCameras,
  medirReconhecimento,
  pararQuadros,
  prepararFonteRede,
  validarFoto,
  type Leitura,
  type Medicao
} from './presenca'
import './assets/security.css'

type Painel = Awaited<ReturnType<typeof window.api.seguranca.painel>>
type IconeNome = 'camera' | 'shield' | 'people' | 'pulse' | 'arrow' | 'refresh' | 'settings'

function Icone({ nome }: { nome: IconeNome }): JSX.Element {
  const caminhos: Record<IconeNome, string> = {
    camera: 'M3 6h12v12H3z M15 10l6-3v10l-6-3 M7 3h5',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M8 12l3 3 5-6',
    people:
      'M15 21v-3a5 5 0 0 0-10 0v3 M17 13a5 5 0 0 1 4 5v3 M10 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M17 3a4 4 0 0 1 0 8',
    pulse: 'M2 12h4l3-7 5 14 3-7h5',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    refresh: 'M20 8a8 8 0 0 0-14-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 14 3l3-3 M16 16h5v5',
    settings: 'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6'
  }
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={caminhos[nome]} />
    </svg>
  )
}

const hora = (iso: string): string => {
  const data = new Date(iso)
  return Number.isNaN(data.getTime())
    ? 'Horário indisponível'
    : data.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
}

function lerDecisao(json: string): Avaliacao | null {
  try {
    const valor = JSON.parse(json)
    if (
      !valor ||
      typeof valor !== 'object' ||
      !Number.isFinite(valor.escore) ||
      !Number.isFinite(valor.limiar)
    )
      return null
    return {
      ...valor,
      sinais: Array.isArray(valor.sinais)
        ? valor.sinais.filter(
            (s: { sinal?: unknown; peso?: unknown }) =>
              typeof s?.sinal === 'string' && typeof s?.peso === 'number'
          )
        : [],
      motivos: Array.isArray(valor.motivos)
        ? valor.motivos.filter((m: unknown) => typeof m === 'string')
        : []
    }
  } catch {
    return null
  }
}

export default function Seguranca({
  visao,
  aoFechar,
  aoTrocarFonte
}: {
  visao: Leitura
  aoFechar: () => void
  aoTrocarFonte: () => void
}): JSX.Element {
  const [dados, setDados] = useState<Painel | null>(null)
  const [erroPainel, setErroPainel] = useState('')
  const [atualizado, setAtualizado] = useState<Date | null>(null)
  const [sensor, setSensor] = useState(estadoSensor)
  const [agora, setAgora] = useState(Date.now)
  const [nome, setNome] = useState('')
  const [amostras, setAmostras] = useState<number[][]>([])
  const ultimaFotoCadastro = useRef<unknown>(null)
  const [consentimento, setConsentimento] = useState(false)
  const [cadastroAberto, setCadastroAberto] = useState(false)
  const [estado, setEstado] = useState('')
  const [erroAcao, setErroAcao] = useState(false)
  const [arrastando, setArrastando] = useState(false)
  const [ocupado, setOcupado] = useState('')
  const [cameras, setCameras] = useState<{ id: string; nome: string }[]>([])
  const [cameraId, setCameraId] = useState('')
  const [ligada, setLigada] = useState(false)
  const [configPronta, setConfigPronta] = useState(false)
  const [limiar, setLimiar] = useState(0.6)
  const [medicao, setMedicao] = useState<Medicao[] | null>(null)
  const [medindo, setMedindo] = useState('')
  const [url, setUrl] = useState('')
  const [achadas, setAchadas] = useState<{ url: string; tipo: string }[]>([])
  const [qr, setQr] = useState<{
    svg: string
    url: string
    certificadoQr?: string
    impressao?: string
  } | null>(null)
  const [fontesAbertas, setFontesAbertas] = useState(false)
  const [abaEventos, setAbaEventos] = useState<'alarmes' | 'decisoes'>('alarmes')
  const fontes = useRef<HTMLDetailsElement>(null)
  const painelCamera = useRef<HTMLElement>(null)
  const entradaFoto = useRef<HTMLInputElement>(null)
  const montado = useRef(false)
  const recarregando = useRef(false)
  const executando = useRef(false)

  const recarregar = useCallback(async (): Promise<void> => {
    if (recarregando.current) return
    recarregando.current = true
    try {
      const painel = await window.api.seguranca.painel()
      if (!montado.current) return
      setDados(painel)
      setAtualizado(new Date())
      setErroPainel('')
    } catch {
      if (montado.current)
        setErroPainel(
          'Não foi possível atualizar o histórico. Os últimos dados disponíveis foram mantidos.'
        )
    } finally {
      recarregando.current = false
    }
  }, [])

  const atualizarGaleria = useCallback(async (): Promise<void> => {
    definirGaleria(await window.api.rostos.galeria())
    await recarregar()
  }, [recarregar])

  useEffect(() => {
    montado.current = true
    const primeiraAtualizacao = window.setTimeout(() => void recarregar(), 0)
    const carregarConfig = async (): Promise<void> => {
      try {
        const c = await window.api.config.ler()
        if (!montado.current) return
        setCameraId(String(c.cameraId ?? ''))
        setLigada(Boolean(c.cameraAtiva))
        const valor = Number(c.limiarFacial ?? 0.6)
        setLimiar(Number.isFinite(valor) ? valor : 0.6)
        setConfigPronta(true)
      } catch {
        if (montado.current) setEstado('Não foi possível carregar as configurações da câmera.')
      }
    }
    const carregarCameras = async (): Promise<void> => {
      try {
        const lista = await listarCameras()
        if (montado.current) setCameras(lista)
      } catch {
        if (montado.current) setCameras([])
      }
    }
    void carregarConfig()
    void carregarCameras()
    const pararDispositivos = aoMudarCameras(() => void carregarCameras())
    const pararCamera = window.api.seguranca.aoMudarCamera(() => void carregarConfig())
    const pararGaleria = window.api.seguranca.aoMudarGaleria(() => {
      void atualizarGaleria().catch(() =>
        setEstado('Não foi possível atualizar os rostos autorizados.')
      )
    })
    const telemetria = window.setInterval(() => {
      setSensor(estadoSensor())
      setAgora(Date.now())
    }, 1000)
    const historico = window.setInterval(() => void recarregar(), 5000)
    return () => {
      montado.current = false
      pararDispositivos()
      pararCamera()
      pararGaleria()
      window.clearInterval(telemetria)
      window.clearInterval(historico)
      window.clearTimeout(primeiraAtualizacao)
    }
  }, [atualizarGaleria, recarregar])

  const executar = async (acao: string, tarefa: () => Promise<void>): Promise<void> => {
    if (executando.current) return
    executando.current = true
    setOcupado(acao)
    setEstado('')
    setErroAcao(false)
    try {
      await tarefa()
    } catch (erro) {
      setErroAcao(true)
      if (montado.current)
        setEstado(
          erro instanceof Error
            ? erro.message
            : 'Não foi possível concluir esta ação. Tente novamente.'
        )
    } finally {
      executando.current = false
      if (['qr', 'rede'].includes(acao)) aoTrocarFonte()
      if (montado.current) {
        setOcupado('')
        setSensor(estadoSensor())
      }
    }
  }

  const gravar = async (chave: string, valor: unknown): Promise<void> => {
    if (!(await window.api.config.gravar(chave, valor)))
      throw new Error('A configuração não foi salva. Tente novamente.')
  }
  const ativarSensor = async (): Promise<void> => {
    await gravar('cameraAtiva', true)
    setLigada(true)
  }
  const alternarSensor = (): void => {
    void executar('sensor', async () => {
      const proxima = !ligada
      await gravar('cameraAtiva', proxima)
      setLigada(proxima)
      aoTrocarFonte()
      if (!proxima) {
        await window.api.camera.desconectar()
        pararQuadros()
      }
      setEstado(
        proxima ? 'Sensor ativado. Aguardando imagem e análise.' : 'Sensor de presença desativado.'
      )
    })
  }
  const abrirFontes = (): void => {
    setFontesAbertas(true)
    window.requestAnimationFrame(() =>
      fontes.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }
  const voltarCamera = async (): Promise<void> => {
    await window.api.camera.desconectar()
    pararQuadros()
    await definirFonteTeste(null)
    setQr(null)
    aoTrocarFonte()
    setEstado('Fonte alterada para a câmera do sistema.')
  }
  const carregarFoto = (arquivo: File): void => {
    void executar('foto', async () => {
      const invalida = validarFoto(arquivo)
      if (invalida) throw new Error(invalida)
      const erro = await definirFonteTeste(arquivo)
      if (erro) throw new Error(erro)
      // Só substitui a conexão depois de a imagem ter sido decodificada.
      if (!ligada) await ativarSensor()
      await window.api.camera.desconectar()
      pararQuadros()
      setQr(null)
      aoTrocarFonte()
      setEstado(`Foto carregada: ${arquivo.name}. A imagem fica no visor para análise e cadastro.`)
      painelCamera.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const conectarCelular = (seguro = false): void => {
    void executar('qr', async () => {
      await ativarSensor()
      await window.api.camera.desconectar()
      prepararFonteRede()
      setQr(null)
      const resposta = await window.api.camera.qr(seguro)
      if ('erro' in resposta) throw new Error(resposta.erro)
      setQr({ ...resposta, svg: resposta.qr })
      setEstado(
        seguro
          ? 'HTTPS pronto. Instale o certificado no celular e abra o QR de transmissão.'
          : 'QR pronto. Abra no iPhone ou Android, na mesma rede Wi-Fi, e envie uma foto.'
      )
    })
  }
  const cadastrar = (): void => {
    void executar('cadastro', async () => {
      if (!nome.trim()) throw new Error('Informe o nome da pessoa antes de cadastrar.')
      if (!consentimento)
        throw new Error('Confirme a autorização da pessoa para cadastrar o rosto.')
      if (!ligada || !sensor.sinal)
        throw new Error('Conecte uma câmera ou carregue uma foto antes de cadastrar.')
      const qualidade = diagnosticarImagem()
      if (qualidade.avisos.length) throw new Error(qualidade.avisos.join(' '))
      const fonte = fonteAtual()
      if (sensor.fonte === 'teste' && fonte === ultimaFotoCadastro.current)
        throw new Error('Envie outra foto com um ângulo diferente para a próxima etapa.')
      const descritor = await capturarDescritor()
      if (typeof descritor === 'string') throw new Error(descritor)
      if (amostras.length && Math.hypot(...descritor.map((v, i) => v - amostras[0][i])) > 0.6)
        throw new Error(
          'A captura difere muito da primeira. Mantenha a mesma pessoa e melhore a iluminação.'
        )
      const novas = [...amostras, [...descritor]]
      if (novas.length < 3) {
        ultimaFotoCadastro.current = fonte
        setAmostras(novas)
        setEstado(`Captura ${novas.length}/3 concluída. Ajuste levemente o ângulo para continuar.`)
        return
      }
      await window.api.rostos.cadastrar(nome.trim(), novas.flat())
      setAmostras([])
      ultimaFotoCadastro.current = null
      await atualizarGaleria()
      setNome('')
      setConsentimento(false)
      setCadastroAberto(false)
      setEstado('Pessoa cadastrada. A comparação facial foi atualizada.')
    })
  }

  const sinal = ligada && sensor.sinal
  const analiseAtual =
    sinal &&
    visao.rostos >= 0 &&
    sensor.ultimaAnaliseEm !== null &&
    agora - sensor.ultimaAnaliseEm < 8000
  const alerta = analiseAtual && visao.desconhecidos > 0
  const fonteNome =
    sensor.fonte === 'teste'
      ? (sensor.fotoNome ?? 'Foto de teste')
      : sensor.fonte === 'rede'
        ? 'Câmera de rede'
        : (cameras.find((c) => c.id === cameraId)?.nome ?? 'Câmera principal')
  const estadoNome = !ligada
    ? 'Monitoramento pausado'
    : !sinal
      ? 'Aguardando sinal'
      : sensor.fonte === 'teste'
        ? 'Analisando foto'
        : 'Monitoramento ativo'
  const analiseTitulo = !ligada
    ? 'Pronto quando você estiver.'
    : !sinal
      ? 'Aguardando uma imagem.'
      : !analiseAtual
        ? 'Preparando reconhecimento.'
        : alerta
          ? 'Pessoa não reconhecida.'
          : visao.rostos === 0
            ? 'Nenhum rosto no enquadramento.'
            : dados?.rostos.length
              ? 'Presença reconhecida.'
              : 'Presença detectada.'
  const analiseTexto =
    sensor.erro ||
    (!ligada
      ? 'Conecte uma câmera para acompanhar o ambiente e iniciar a análise local.'
      : !sinal
        ? 'Confira a conexão da câmera. A análise começa assim que uma imagem estiver disponível.'
        : !analiseAtual
          ? 'A imagem já está disponível. Aguarde a próxima leitura do sensor.'
          : alerta
            ? 'Há um rosto sem correspondência no cadastro. Verifique a imagem antes de tomar uma decisão.'
            : visao.rostos === 0
              ? 'O sensor está analisando a imagem. Nenhuma pessoa foi detectada nesta leitura.'
              : dados?.rostos.length
                ? visao.conhecidos.join(', ') || 'Consulte a imagem para verificar a presença.'
                : 'Cadastre uma pessoa autorizada para habilitar a comparação facial.')
  const idadeAnalise = sensor.ultimaAnaliseEm
    ? Math.max(0, Math.floor((agora - sensor.ultimaAnaliseEm) / 1000))
    : null
  const statusModelos = {
    'nao-carregado': 'Em espera',
    carregando: 'Carregando',
    pronto: 'Disponível',
    erro: 'Indisponível'
  }[sensor.modelos]
  const eventos = abaEventos === 'alarmes' ? dados?.alarmes : dados?.decisoes

  return (
    <div className={`security-dashboard ${alerta ? 'security-has-alert' : ''}`}>
      <input
        ref={entradaFoto}
        id="security-foto"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/bmp,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.bmp,.gif,.avif"
        hidden
        disabled={!!ocupado || !configPronta}
        onChange={(e) => {
          const arquivo = e.target.files?.[0]
          e.target.value = ''
          if (arquivo) carregarFoto(arquivo)
        }}
      />
      <div className="security-page-heading">
        <div>
          <p className="security-eyebrow">Monitoramento</p>
          <h1>
            Central de <span>segurança</span>
          </h1>
          <p>Acompanhe as câmeras, configure a proteção e consulte os eventos.</p>
        </div>
        <div className="security-heading-actions">
          <button className="security-button security-button-quiet" onClick={aoFechar}>
            Voltar ao assistente <Icone nome="arrow" />
          </button>
          <button
            className={`security-button ${ligada ? '' : 'security-button-primary'}`}
            disabled={!!ocupado || !configPronta}
            onClick={alternarSensor}
          >
            <Icone nome="camera" />{' '}
            {ocupado === 'sensor' ? 'Atualizando…' : ligada ? 'Pausar sensor' : 'Ativar câmera'}
          </button>
        </div>
      </div>

      <CentralCameras />
      <VigilanciaPainel />
      <div className="security-section-heading">
        <h2>Reconhecimento facial</h2>
        <p>Cadastro e análise da fonte selecionada no visor.</p>
      </div>
      <div className="security-metrics" aria-label="Resumo do monitoramento">
        {[
          {
            icon: 'camera' as const,
            label: 'Fonte do reconhecimento',
            value: sinal ? '1' : '0',
            detail: sinal ? fonteNome : 'Nenhuma imagem disponível',
            color: 'cyan'
          },
          {
            icon: 'people' as const,
            label: 'Rostos detectados',
            value: analiseAtual ? String(visao.rostos) : '—',
            detail: analiseAtual ? 'Na leitura mais recente' : 'Aguardando análise',
            color: 'purple'
          },
          {
            icon: 'shield' as const,
            label: 'Pessoas autorizadas',
            value: dados ? String(dados.rostos.length) : '—',
            detail: 'Cadastros salvos neste dispositivo',
            color: 'green'
          },
          {
            icon: 'pulse' as const,
            label: 'Alarmes recentes',
            value: dados ? String(dados.alarmes.length) : '—',
            detail: 'Últimos registros · até 10 eventos',
            color: 'amber'
          }
        ].map((metrica) => (
          <div className={`security-metric security-accent-${metrica.color}`} key={metrica.label}>
            <div className="security-metric-top">
              <span>{metrica.label}</span>
              <Icone nome={metrica.icon} />
            </div>
            <strong>{metrica.value}</strong>
            <p title={metrica.detail}>{metrica.detail}</p>
          </div>
        ))}
      </div>

      <div className="security-monitor-grid">
        <section
          ref={painelCamera}
          className={`security-panel security-camera-panel ${arrastando ? 'is-dragging' : ''}`}
          aria-labelledby="camera-titulo"
          onDragOver={(e) => {
            e.preventDefault()
            if (!ocupado && configPronta) setArrastando(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setArrastando(false)
          }}
          onDrop={(e) => {
            e.preventDefault()
            setArrastando(false)
            if (ocupado || !configPronta) return
            if (e.dataTransfer.files.length !== 1) {
              setEstado('Arraste uma foto por vez para o visor.')
              setErroAcao(true)
              return
            }
            carregarFoto(e.dataTransfer.files[0])
          }}
        >
          <div className="security-panel-heading">
            <div className="security-heading-with-icon">
              <Icone nome="camera" />
              <div>
                <h2 id="camera-titulo">Visão do ambiente</h2>
                <p>{fonteNome}</p>
              </div>
            </div>
            <span className={`security-badge ${sinal ? 'security-badge-cyan' : ''}`}>
              <i />{' '}
              {sinal
                ? sensor.fonte === 'teste'
                  ? 'FOTO DE TESTE'
                  : 'SINAL RECEBIDO'
                : 'SEM SINAL'}
            </span>
          </div>
          <div className="security-source-actions">
            <button
              type="button"
              className="security-button"
              disabled={!!ocupado || !configPronta}
              onClick={() => entradaFoto.current?.click()}
            >
              <Icone nome="camera" />
              {ocupado === 'foto' ? 'Carregando foto…' : 'Adicionar foto'}
            </button>
            <button
              type="button"
              className="security-button security-button-quiet"
              onClick={abrirFontes}
            >
              Usar celular <Icone nome="arrow" />
            </button>
            <span>{arrastando ? 'Solte a foto aqui' : 'ou arraste uma foto para o visor'}</span>
          </div>
          {erroAcao && estado && (
            <p className="security-source-error" role="alert">
              {estado}
            </p>
          )}
          <div className="security-camera-feed">
            <Visor ativo={ligada} alerta={alerta} />
          </div>
          <div className="security-camera-footer">
            <span>
              <Icone nome="shield" /> Análise local · sem gravação de vídeo
            </span>
            <button onClick={abrirFontes}>
              Gerenciar fontes <Icone nome="settings" />
            </button>
          </div>
        </section>

        <section className="security-panel security-analysis" aria-labelledby="analise-titulo">
          <div className="security-panel-heading">
            <div className="security-heading-with-icon">
              <Icone nome="pulse" />
              <h2 id="analise-titulo">Análise do ambiente</h2>
            </div>
            <span className="security-micro-label">Local</span>
          </div>
          <div className="security-analysis-copy" aria-live="polite">
            <span className={`security-status ${alerta ? 'is-alert' : ''}`}>
              <i />
              {alerta ? 'Atenção necessária' : estadoNome}
            </span>
            <h3>{analiseTitulo}</h3>
            <p>{analiseTexto}</p>
          </div>
          <div className="security-analysis-details">
            <div>
              <span>Reconhecimento facial</span>
              <strong>{statusModelos}</strong>
            </div>
            <div>
              <span>Última análise</span>
              <strong>
                {idadeAnalise === null
                  ? 'Aguardando'
                  : idadeAnalise < 2
                    ? 'Agora'
                    : `Há ${idadeAnalise}s`}
              </strong>
            </div>
            <div>
              <span>Tempo de processamento</span>
              <strong>
                {sensor.duracaoAnaliseMs === null
                  ? '—'
                  : `${Math.round(sensor.duracaoAnaliseMs)} ms`}
              </strong>
            </div>
            <div>
              <span>Resolução da imagem</span>
              <strong>
                {sinal && sensor.largura ? `${sensor.largura} × ${sensor.altura}` : '—'}
              </strong>
            </div>
          </div>
          <div className="security-privacy-note">
            <Icone nome="shield" />
            <p>
              Comparação facial neste computador. Os rostos cadastrados podem ser removidos a
              qualquer momento.
            </p>
          </div>
        </section>
      </div>

      {(estado || ocupado) && (
        <div className={`security-notice ${erroAcao ? 'security-notice-error' : ''}`} role="status">
          <Icone nome="pulse" />
          <span>{estado || 'Processando solicitação…'}</span>
          <button
            onClick={() => setEstado('')}
            aria-label="Dispensar mensagem"
            disabled={!!ocupado}
          >
            <Fechar width={14} height={14} />
          </button>
        </div>
      )}
      {erroPainel && (
        <div className="security-notice security-notice-error" role="alert">
          {erroPainel}
          <button onClick={() => void recarregar()}>Tentar novamente</button>
        </div>
      )}

      <div className="security-secondary-grid">
        <section className="security-panel security-events" aria-labelledby="atividade-titulo">
          <div className="security-panel-heading">
            <div>
              <h2 id="atividade-titulo">Atividade de segurança</h2>
              <p>O histórico real das decisões e dos alertas.</p>
            </div>
            <button
              className="security-icon-button"
              onClick={() => void recarregar()}
              aria-label="Atualizar histórico"
            >
              <Icone nome="refresh" />
            </button>
          </div>
          <div className="security-tabs" aria-label="Tipo de atividade">
            <button
              aria-pressed={abaEventos === 'alarmes'}
              onClick={() => setAbaEventos('alarmes')}
            >
              Alarmes <span>{dados?.alarmes.length ?? '—'}</span>
            </button>
            <button
              aria-pressed={abaEventos === 'decisoes'}
              onClick={() => setAbaEventos('decisoes')}
            >
              Decisões de risco <span>{dados?.decisoes.length ?? '—'}</span>
            </button>
          </div>
          <div className="security-event-list">
            {!dados ? (
              <div className="security-empty">
                <Icone nome="pulse" />
                <h3>{erroPainel ? 'Histórico indisponível' : 'Carregando atividade…'}</h3>
                <p>
                  {erroPainel
                    ? 'Tente atualizar o painel.'
                    : 'Consultando os registros deste dispositivo.'}
                </p>
              </div>
            ) : !eventos?.length ? (
              <div className="security-empty">
                <Icone nome="shield" />
                <h3>
                  {abaEventos === 'alarmes'
                    ? 'Nenhum alarme registrado'
                    : 'Nenhuma decisão registrada'}
                </h3>
                <p>
                  {abaEventos === 'alarmes'
                    ? 'Os próximos alertas do monitoramento aparecerão aqui.'
                    : 'Quando uma ação exigir avaliação, seus motivos aparecerão aqui.'}
                </p>
              </div>
            ) : abaEventos === 'alarmes' ? (
              dados.alarmes.map((evento) => (
                <article className="security-event" key={evento.id}>
                  <span className="security-event-dot" />
                  <div>
                    <h3>Alerta de presença</h3>
                    <p>{evento.resultado}</p>
                  </div>
                  <time dateTime={evento.momento}>{hora(evento.momento)}</time>
                </article>
              ))
            ) : (
              dados.decisoes.map((evento) => {
                const decisao = lerDecisao(evento.decisao)
                return (
                  <article className="security-event security-decision" key={evento.id}>
                    <span className="security-event-dot security-event-dot-purple" />
                    <div>
                      <h3>{evento.ferramenta.replaceAll('_', ' ')}</h3>
                      <p>
                        {decisao
                          ? `Risco ${decisao.escore} · limiar ${decisao.limiar}${decisao.confirma ? ' · confirmação necessária' : ''}`
                          : 'Detalhes deste registro indisponíveis.'}
                      </p>
                      {decisao && (
                        <details>
                          <summary>Ver motivos</summary>
                          <ul>
                            {decisao.sinais.length ? (
                              decisao.sinais.map((s, i) => (
                                <li key={i}>
                                  {s.sinal}{' '}
                                  <strong>
                                    {s.peso >= 0 ? '+' : ''}
                                    {s.peso}
                                  </strong>
                                </li>
                              ))
                            ) : decisao.motivos.length ? (
                              decisao.motivos.map((motivo, i) => <li key={i}>{motivo}</li>)
                            ) : (
                              <li>O registro não contém sinais detalhados.</li>
                            )}
                          </ul>
                        </details>
                      )}
                    </div>
                    <time dateTime={evento.momento}>{hora(evento.momento)}</time>
                  </article>
                )
              })
            )}
          </div>
          <div className="security-panel-footnote">
            <span className="security-tiny-dot" />
            Atualização automática a cada 5s
            <span>{atualizado ? atualizado.toLocaleTimeString('pt-BR') : '—'}</span>
          </div>
        </section>

        <section className="security-panel security-roster" aria-labelledby="pessoas-titulo">
          <div className="security-panel-heading">
            <div>
              <h2 id="pessoas-titulo">Pessoas autorizadas</h2>
              <p>Reconhecidas, com consentimento.</p>
            </div>
            <span className="security-count">{dados?.rostos.length ?? '—'}</span>
          </div>
          <div className="security-roster-list">
            {dados?.rostos.length ? (
              dados.rostos.map((pessoa) => (
                <div className="security-person" key={pessoa.nome}>
                  <span className="security-avatar">
                    {pessoa.nome.trim().slice(0, 2).toUpperCase()}
                  </span>
                  <div>
                    <strong>{pessoa.nome}</strong>
                    <span>
                      {analiseAtual && visao.conhecidos.includes(pessoa.nome)
                        ? 'Detectada agora'
                        : `Cadastro · ${hora(pessoa.criado_em).split(',')[0]}`}
                    </span>
                  </div>
                  <button
                    disabled={!!ocupado}
                    aria-label={`Remover cadastro de ${pessoa.nome}`}
                    onClick={() =>
                      void executar('remover', async () => {
                        if (!(await window.api.rostos.esquecer(pessoa.nome)))
                          throw new Error(
                            'O cadastro não foi removido. Atualize o painel e tente novamente.'
                          )
                        await atualizarGaleria()
                        setEstado(`Cadastro de ${pessoa.nome} removido.`)
                      })
                    }
                  >
                    Remover
                  </button>
                </div>
              ))
            ) : (
              <div className="security-empty">
                <Icone nome="people" />
                <h3>{dados ? 'Nenhuma pessoa cadastrada' : 'Carregando cadastros…'}</h3>
                <p>Adicione uma pessoa para comparar os rostos detectados na imagem.</p>
              </div>
            )}
          </div>
          <div className="security-roster-actions">
            <button
              className="security-button"
              aria-expanded={cadastroAberto}
              onClick={() => {
                setCadastroAberto(!cadastroAberto)
                setAmostras([])
                ultimaFotoCadastro.current = null
              }}
            >
              <Adicionar width={15} height={15} /> Cadastrar pessoa
            </button>
          </div>
          {cadastroAberto && (
            <form
              className="security-registration"
              onSubmit={(e) => {
                e.preventDefault()
                cadastrar()
              }}
            >
              <label htmlFor="security-nome">Nome da pessoa</label>
              <input
                id="security-nome"
                value={nome}
                onChange={(e) => {
                  setNome(e.target.value)
                  setAmostras([])
                  ultimaFotoCadastro.current = null
                }}
                placeholder="Uma pessoa de frente para a câmera"
                maxLength={80}
                required
              />
              <label className="security-consent">
                <input
                  type="checkbox"
                  checked={consentimento}
                  onChange={(e) => setConsentimento(e.target.checked)}
                  required
                />
                <span>
                  A pessoa autoriza o cadastro do rosto para reconhecimento local e sabe que pode
                  pedir sua remoção.
                </span>
              </label>
              <p>
                Etapa {amostras.length + 1}/3:{' '}
                {
                  [
                    'Olhe de frente para a câmera.',
                    'Vire levemente o rosto para a esquerda.',
                    'Vire levemente o rosto para a direita.'
                  ][amostras.length]
                }{' '}
                Mantenha uma pessoa na imagem. Em fotos, envie uma imagem diferente a cada etapa.
              </p>
              <button
                className="security-button security-button-primary"
                type="submit"
                disabled={!!ocupado || !consentimento}
              >
                {ocupado === 'cadastro'
                  ? 'Analisando rosto…'
                  : amostras.length === 2
                    ? 'Concluir cadastro'
                    : `Capturar ${amostras.length + 1}/3`}
              </button>
            </form>
          )}
        </section>
      </div>

      <SegurancaExtras
        sensor={sensor}
        aoMudar={() => {
          aoTrocarFonte()
          void recarregar()
          setAmostras([])
          ultimaFotoCadastro.current = null
          setQr(null)
        }}
      />
      <details
        className="security-panel security-management"
        ref={fontes}
        open={fontesAbertas}
        onToggle={(e) => setFontesAbertas(e.currentTarget.open)}
      >
        <summary>
          <span className="security-heading-with-icon">
            <Icone nome="settings" />
            <span>
              <strong>Conexões e calibração</strong>
              <small>iPhone, Android, webcam e fotos — escolha como conectar</small>
            </span>
          </span>
          <span className="security-disclosure">+</span>
        </summary>
        <div className="security-phone-guide">
          <div>
            <span className="security-guide-number">01</span>
            <h3>Vídeo ao vivo · iPhone e Android</h3>
            <p>
              Instale Camo no celular e Camo Studio no PC. Conecte por cabo USB ou pelo pareamento
              Wi-Fi do Camo. Depois escolha a câmera Camo na lista abaixo.
            </p>
            <a
              href="https://camo.com/support/camo/camo-getting-started"
              target="_blank"
              rel="noreferrer"
            >
              Guia do Camo <Externo width={13} height={13} />
            </a>
          </div>
          <div>
            <span className="security-guide-number">02</span>
            <h3>Android conectado ao Windows</h3>
            <p>
              No Windows 11, vincule um Android compatível em Bluetooth e dispositivos →
              Dispositivos móveis e habilite a câmera conectada. Ela aparece como webcam na lista.
            </p>
            <a
              href="https://support.microsoft.com/en-gb/windows/apps/phonelink/use-your-mobile-device-s-camera"
              target="_blank"
              rel="noreferrer"
            >
              Requisitos e passo a passo <Externo width={13} height={13} />
            </a>
          </div>
          <div>
            <span className="security-guide-number">03</span>
            <h3>Foto pelo navegador · sem instalar</h3>
            <p>
              Gere o QR abaixo, abra no Safari ou Chrome do celular e envie uma foto. O QR da Íris
              usa HTTP local: ele envia fotos; não habilita vídeo contínuo nesse endereço.
            </p>
            <button
              className="security-text-button"
              onClick={() => conectarCelular()}
              disabled={!!ocupado || !configPronta}
            >
              Gerar QR para enviar foto
            </button>
          </div>
        </div>
        <div className="security-management-grid">
          <section className="security-control-section">
            <h3>Fonte de imagem</h3>
            <label htmlFor="security-camera">Câmera deste computador</label>
            <select
              id="security-camera"
              value={cameraId}
              disabled={!!ocupado || !configPronta}
              onChange={(e) => {
                const id = e.target.value
                void executar('fonte', async () => {
                  await gravar('cameraId', id)
                  setCameraId(id)
                  await voltarCamera()
                })
              }}
            >
              <option value="">Câmera padrão do sistema</option>
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.nome}
                </option>
              ))}
            </select>
            <p className="security-help">
              Webcams USB e celulares configurados como webcam aparecem nesta lista.
            </p>
            <div className="security-control-row">
              <button
                className="security-button"
                disabled={!!ocupado || !configPronta}
                onClick={() => conectarCelular()}
              >
                Enviar foto pelo celular
              </button>
              <button
                className="security-button"
                disabled={!!ocupado || !configPronta}
                onClick={() => conectarCelular(true)}
              >
                Celular ao vivo · HTTPS
              </button>
              <button
                type="button"
                className="security-button"
                disabled={!!ocupado || !configPronta}
                onClick={() => entradaFoto.current?.click()}
              >
                Escolher foto do PC
              </button>
            </div>
            <p className="security-help">
              JPG, PNG, WebP, BMP, GIF ou AVIF · até 25 MB. Para HEIC/HEIF do iPhone, exporte como
              JPG/PNG ou envie pelo QR.
            </p>
            {(sensor.fonte === 'rede' || sensor.fonte === 'teste' || qr) && (
              <button
                className="security-text-button"
                disabled={!!ocupado}
                onClick={() => void executar('fonte', voltarCamera)}
              >
                Voltar para a webcam
              </button>
            )}
            {qr && (
              <div className="security-qr">
                {qr.certificadoQr && (
                  <div className="security-tls-guide">
                    <h3>1. Preparar o celular (uma vez por computador)</h3>
                    <p>
                      Escaneie este QR para baixar o certificado público Iris Camera Local. Ele
                      permite confiar no HTTPS deste computador. Instale somente se este for seu
                      computador e confira a impressão SHA-256.
                    </p>
                    <div dangerouslySetInnerHTML={{ __html: qr.certificadoQr }} />
                    <code>{qr.impressao}</code>
                    <p>
                      iPhone: Ajustes → Geral → VPN e Gerenciamento de Dispositivo → instalar
                      perfil. Depois Geral → Sobre → Certificados Confiáveis → habilitar Iris Camera
                      Local.
                    </p>
                    <p>
                      Android: Configurações → Segurança → Criptografia e credenciais → Instalar
                      certificado → Certificado de CA. Os nomes variam por fabricante.
                    </p>
                    <p>
                      Para remover a confiança depois, exclua esse certificado nas mesmas
                      configurações. A chave privada permanece protegida neste computador.
                    </p>
                    <h3>2. Conectar e transmitir</h3>
                    <p>
                      Escaneie o QR abaixo no Safari ou Chrome, autorize a câmera e toque em Ligar
                      câmera ao vivo. Mantenha a aba aberta e a tela ligada. O QR é a chave de
                      pareamento; não compartilhe.
                    </p>
                  </div>
                )}
                <div dangerouslySetInnerHTML={{ __html: qr.svg }} />
                <p>{qr.url}</p>
                <button
                  className="security-button"
                  onClick={() =>
                    void executar('copiar', async () => {
                      await navigator.clipboard.writeText(qr.url)
                      setEstado('Link copiado. Abra no celular conectado ao mesmo Wi-Fi.')
                    })
                  }
                >
                  Copiar link
                </button>
                <small>
                  Mesmo Wi-Fi nos dois dispositivos. A foto enviada permanece no visor até você
                  trocar a fonte ou pausar o sensor. Se a página não abrir, confira se o Windows
                  permite a Íris na rede privada.
                </small>
              </div>
            )}
            <label htmlFor="security-url">Câmera de rede / endereço do stream</label>
            <input
              id="security-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.0.50:81/stream"
            />
            <div className="security-control-row">
              <button
                className="security-button security-button-primary"
                disabled={!!ocupado || !configPronta || !url.trim()}
                onClick={() =>
                  void executar('rede', async () => {
                    await ativarSensor()
                    prepararFonteRede()
                    if (!(await window.api.camera.conectar(url.trim())))
                      throw new Error('Não foi possível iniciar a conexão. Verifique o endereço.')
                    setEstado('Conexão solicitada. O painel indicará quando uma imagem chegar.')
                  })
                }
              >
                Conectar
              </button>
              <button
                className="security-button"
                disabled={!!ocupado || !url.trim()}
                onClick={() =>
                  void executar('testar', async () =>
                    setEstado(await window.api.camera.testar(url.trim()))
                  )
                }
              >
                Testar endereço
              </button>
              <button
                className="security-button"
                disabled={!!ocupado}
                onClick={() =>
                  void executar('procurar', async () => {
                    setEstado('Procurando câmeras na rede…')
                    const lista = await window.api.camera.procurar()
                    setAchadas(lista)
                    if (lista[0]) setUrl(lista[0].url)
                    setEstado(
                      lista.length
                        ? `${lista.length} fonte(s) encontrada(s). Selecione e conecte.`
                        : 'Nenhuma câmera encontrada. Confira se os dispositivos estão na mesma rede.'
                    )
                  })
                }
              >
                {ocupado === 'procurar' ? 'Procurando…' : 'Buscar na rede'}
              </button>
            </div>
            <p className="security-help">
              Para apps com stream MJPEG, cole o endereço de vídeo (ex.:
              http://IP_DO_CELULAR:4747/video no DroidCam). Links RTSP, HLS ou a página inicial do
              app não são streams MJPEG.
            </p>
            {achadas.map((fonte) => (
              <button
                className="security-found-source"
                key={fonte.url}
                onClick={() => setUrl(fonte.url)}
                aria-pressed={fonte.url === url}
              >
                <span>{fonte.url}</span>
                <small>{fonte.tipo}</small>
              </button>
            ))}
          </section>

          <section className="security-control-section">
            <h3>Calibração do reconhecimento</h3>
            <p className="security-help">
              Compare resultados com fotos conhecidas antes de alterar a sensibilidade. Luz e ângulo
              afetam o reconhecimento.
            </p>
            <label htmlFor="security-limiar" className="security-range-label">
              Limiar de comparação <strong>{limiar.toFixed(2)}</strong>
            </label>
            <input
              id="security-limiar"
              type="range"
              min={0.4}
              max={0.8}
              step={0.05}
              value={limiar}
              disabled={!!ocupado || !configPronta}
              onChange={(e) => {
                const valor = Number(e.target.value)
                void executar('limiar', async () => {
                  await gravar('limiarFacial', valor)
                  definirLimiar(valor)
                  setLimiar(valor)
                  setEstado('Limiar de comparação atualizado.')
                })
              }}
            />
            <div className="security-range-ends">
              <span>Mais restritivo</span>
              <span>Mais permissivo</span>
            </div>
            <label
              className={`security-button security-file-button ${ocupado ? 'is-disabled' : ''}`}
            >
              Medir com um conjunto de fotos
              <input
                type="file"
                multiple
                accept="image/*"
                disabled={!!ocupado}
                onChange={(e) => {
                  const arquivos = [...(e.target.files ?? [])]
                  e.target.value = ''
                  if (!arquivos.length) return
                  void executar('medicao', async () => {
                    setMedicao(null)
                    setMedindo('Preparando medição…')
                    const resultado = await medirReconhecimento(arquivos, (feito, total) =>
                      setMedindo(`Analisando ${feito}/${total} fotos…`)
                    )
                    setMedicao(resultado.medicoes)
                    setMedindo(
                      resultado.semRosto.length
                        ? `${resultado.semRosto.length} foto(s) sem rosto detectado.`
                        : 'Medição concluída.'
                    )
                    const caminho = await window.api.seguranca.salvarMedicao({
                      quando: new Date().toISOString(),
                      cadastrados: resultado.cadastrados,
                      semRosto: resultado.semRosto,
                      medicoes: resultado.medicoes
                    })
                    setMedindo(
                      (texto) => `${texto} Relatório salvo em ${caminho.split(/[\\/]/).pop()}.`
                    )
                  })
                }}
              />
            </label>
            <p className="security-help" role="status">
              {medindo || 'Nomeie as fotos pela pessoa: ana_01.jpg, joao_02.jpg, estranho_01.jpg.'}
            </p>
            {medicao && (
              <div className="security-table-wrapper">
                <table>
                  <caption>Resultados medidos nas fotos selecionadas</caption>
                  <thead>
                    <tr>
                      <th>Limiar</th>
                      <th>Acertos</th>
                      <th>Falso aceite</th>
                      <th>Falsa rejeição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {medicao.map((m) => (
                      <tr
                        key={m.limiar}
                        className={Math.abs(m.limiar - limiar) < 0.001 ? 'is-selected' : ''}
                      >
                        <td>{m.limiar.toFixed(2)}</td>
                        <td>
                          {m.acertos}/{m.total}
                        </td>
                        <td className={m.falsoAceite ? 'security-danger' : ''}>{m.falsoAceite}</td>
                        <td>{m.falsoRejeite}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="security-calibration-note">
              <Icone nome="shield" />
              <p>
                Reconhecimento é um sinal de contexto. Verifique a imagem e os motivos antes de
                autorizar ações sensíveis.
              </p>
            </div>
          </section>
        </div>
      </details>
      <footer className="security-page-footer">
        <span>Íris</span>
        <span>Visibilidade para decidir. Controle para agir.</span>
      </footer>
    </div>
  )
}

// O 'type JSX' é obrigatório no React 19: o namespace JSX global sumiu,
// agora vem do pacote. Sem ele, "Cannot find namespace 'JSX'".
import {
  capturarDescritor,
  definirGaleria,
  definirLimiar,
  iniciarPresenca,
  receberQuadro
} from './presenca'
import Seguranca from './Seguranca'
import Porta from './Porta'
import { useEffect, useRef, useState, type JSX } from 'react'
import Painel from './Painel'
import { Arco, Atencao, Mudo, Prompt, Pulso, Seta, Som } from './icones'
import { alternarVoz, criarLeitor, parar } from './voz'
import Config from './Config'

type Mensagem = {
  role: 'user' | 'assistant'
  content: string
  /** Ferramentas que o modelo executou nesta resposta. Só pra exibir. */
  ferramentas?: { nome: string; args: string }[]
  /** Dados que as ferramentas devolveram pra desenhar. Nunca vão pra API. */
  visuais?: Visual[]
  /** Mensagem crua da falha. Presente = esta resposta não aconteceu. */
  erro?: string
  /** Nome do gatilho, quando a Íris falou sem ninguém ter perguntado. */
  gatilho?: string
  /** Linha em `execucoes` deste aviso. É o que o rótulo atualiza. */
  avisoId?: number
  /** O veredito do usuário. undefined = ainda não rotulado. */
  util?: boolean
  /** Quando o gatilho disparou. Nem sempre é quando você leu. */
  momento?: string
}

type Estado = Awaited<ReturnType<typeof window.api.estado>>

// ---------------------------------------------------------------
// Peças da barra de status
// ---------------------------------------------------------------

/**
 * Rótulo da calha. É a cabeça de seção da página de manual: versalete
 * monoespaçado à esquerda, conteúdo pendurado à direita. Toda a interface
 * usa esta mesma calha — é o que substitui a coluna de balõezinhos.
 */
function Calha({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="w-[104px] shrink-0 pt-px text-right font-hud text-[11px] leading-5 tracking-[0.2em] text-tinta-3 select-none">
      {children}
    </div>
  )
}

/**
 * Escada segmentada da cota. Não é anel de progresso nem número gigante:
 * é a régua de LED de um instrumento, que se lê de relance sem ler número.
 * O número exato vai no title, pra quando você quiser saber de verdade.
 */
function Escada({ uso }: { uso: Estado['uso'] }): JSX.Element {
  const SEGMENTOS = 14
  const cheios = Math.min(SEGMENTOS, Math.ceil((uso.usadas / uso.teto) * SEGMENTOS))
  // Vira vermelho no último quinto — o ponto em que faltar cota deixa de ser
  // informação e vira aviso.
  const apertado = uso.restantes <= uso.teto * 0.2

  return (
    <div
      className="flex items-center gap-2"
      title={`${uso.usadas} de ${uso.teto} chamadas hoje · restam ${uso.restantes}`}
    >
      <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3">COTA</span>
      <div
        className="flex gap-[2px]"
        role="meter"
        aria-valuenow={uso.usadas}
        aria-valuemax={uso.teto}
      >
        {Array.from({ length: SEGMENTOS }, (_, i) => (
          <span
            key={i}
            className={`h-3 w-[3px] ${
              i < cheios ? (apertado ? 'bg-perigo' : 'bg-sinal') : 'bg-fio-forte'
            }`}
          />
        ))}
      </div>
      <span
        className={`font-mono text-[11px] tabular-nums ${apertado ? 'text-perigo' : 'text-tinta-2'}`}
      >
        {uso.restantes}
      </span>
    </div>
  )
}

/**
 * O ANUNCIADOR — a peça mais importante da tela.
 *
 * A Íris sabe em que janela você está; até agora isso vivia só no prompt do
 * modelo e não aparecia em lugar nenhum. Aqui ele é o mostrador central da
 * barra: o mecanismo do produto, visível. A varredura só roda quando o
 * PROGRAMA muda, não a cada título — senão viraria estrobo enquanto você
 * troca de aba.
 */
function Anunciador({ foco }: { foco: Estado['foco'] }): JSX.Element {
  if (!foco) {
    return <span className="font-mono text-[11px] text-tinta-3">nenhuma janela lida ainda</span>
  }

  return (
    <div key={foco.programa} className="anunciador flex min-w-0 items-baseline gap-2">
      <span className="font-mono text-[11px] text-sinal">{foco.programa}</span>
      {foco.titulo && (
        <span className="truncate text-[12px] text-tinta-2" title={foco.titulo}>
          {foco.titulo}
        </span>
      )}
    </div>
  )
}

// ---------------------------------------------------------------

export default function App(): JSX.Element {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [rascunho, setRascunho] = useState('')
  const [pensando, setPensando] = useState(false)
  // O valor real vem da config logo abaixo; `true` é só o primeiro frame,
  // antes do IPC responder.
  const [vozAtiva, setVozAtiva] = useState(true)
  const [estado, setEstado] = useState<Estado | null>(null)

  // Fila, não um pedido só: o modelo pode pedir duas ferramentas de nível 3
  // no mesmo turno, e elas chegam em paralelo (Promise.all). Com um estado
  // único o segundo pedido sobrescreveria o primeiro, cujo main ficaria
  // travado até o timeout de 2min. Mostra a primeira, resolve, anda a fila.
  const [aprovacoes, setAprovacoes] = useState<
    { id: string; comando: string; explicacao: string; risco: Avaliacao }[]
  >([])

  // Um só, e não fila: o aviso é sobre o TURNO ter lido conteúdo hostil.
  // Três detecções no mesmo turno não são três notícias diferentes.
  const [injecao, setInjecao] = useState<{ ferramenta: string } | null>(null)

  /**
   * A tela de ajustes (I.1). Abre SOZINHA quando não há chave configurada —
   * é o único estado em que o app não faz nada e a causa não aparece em
   * lugar nenhum: sem isto o primeiro uso numa máquina nova é digitar uma
   * pergunta e receber um 401 cru.
   */
  const [config, setConfig] = useState(false)

  /**
   * A TROCA que o `ver_tela` fez pra ficar em nível 1 (2.3).
   *
   * Print é o dado mais invasivo do catálogo, mas pedir confirmação a cada
   * "o que tá errado aqui?" mataria a ferramenta. O que compra a dispensa é
   * isto: você nunca é fotografado sem ver. O ponto acende no cabeçalho
   * quando a captura acontece, e o chip do `ver_tela` fica no histórico da
   * mensagem pra sempre.
   *
   * 2s e não o tempo real da captura: ela leva ~200ms, e um ponto que pisca
   * por 200ms é a mesma coisa que ponto nenhum.
   */
  const [capturando, setCapturando] = useState(false)

  /** O painel de segurança está aberto? Abre por voz, fecha no botão. */
  const [seguranca, setSeguranca] = useState(false)

  /**
   * MODO PORTA, e ele nasce lido do hash.
   *
   * `#porta` na URL entra direto na tela do dispositivo, sem passar pelo
   * chat. É o que permite abrir uma segunda janela dedicada — ou apontar um
   * display pro app — em vez de ter que navegar até lá com o mouse todo
   * boot. Um kiosk que precisa de dois cliques pra virar kiosk não serve.
   */
  const [porta, setPorta] = useState(() => window.location.hash === '#porta')

  /**
   * MODO SEGURANÇA — o recorte que o trabalho apresenta.
   *
   * Muda a abertura (identidade e escopo, em vez da lista de 25 comandos) e
   * abre direto no painel. Não desliga nada: as ferramentas do dia a dia
   * continuam funcionando se você pedir, só param de OCUPAR a tela — numa
   * defesa, o que está na tela é o que a banca acha que o trabalho é.
   */
  const [modoSeguranca, setModoSeguranca] = useState(false)

  /**
   * Muda quando a câmera é ligada/desligada por fala. Serve só de gatilho
   * pro efeito do sensor: o laço vive num useEffect e não relê a config
   * sozinho, então sem isto "liga a câmera" só valeria no próximo boot.
   */
  const [cameraGeracao, setCameraGeracao] = useState(0)

  /** A última leitura da câmera. rostos -1 = desligada ou indisponível. */
  const [visao, setVisao] = useState({ rostos: -1, desconhecidos: 0, conhecidos: [] as string[] })

  useEffect(() => {
    window.api.config.primeira().then((primeira) => primeira && setConfig(true))
    // O mudo do cabeçalho nasce da config, senão ele volta ligado a cada boot
    // e o interruptor dos ajustes vira decoração.
    window.api.config.ler().then((c) => {
      setVozAtiva(Boolean(c.vozAtiva))

      if (c.modoSeguranca) {
        setModoSeguranca(true)
        // Abre no painel, e só no primeiro boot: reabrir a cada render faria
        // o "fechar" não fechar nada.
        setSeguranca(true)
      }
    })
  }, [])

  /**
   * ESC fecha a tela que estiver por cima.
   *
   * As duas são overlays em `absolute inset-0`: sem isto o único jeito de
   * voltar é achar o "fechar" no canto, e a tecla que todo mundo aperta
   * primeiro não fazia nada. Segurança antes de ajustes porque ela abre por
   * cima — a de cima é a que fecha.
   */
  useEffect(() => {
    const esc = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (porta) setPorta(false)
      else if (seguranca) setSeguranca(false)
      else if (config) setConfig(false)
    }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [porta, seguranca, config])

  /**
   * O hash acompanha o estado nos dois sentidos: fechar o modo porta tira o
   * `#porta` da URL, senão recarregar a janela voltaria pra ele — e o
   * usuário que fechou a tela a veria de novo sem entender por quê.
   */
  useEffect(() => {
    const alvo = porta ? '#porta' : ''
    if (window.location.hash !== alvo) {
      history.replaceState(null, '', window.location.pathname + alvo)
    }
  }, [porta])

  useEffect(() => {
    const pararAbrir = window.api.seguranca.aoAbrir(() => setSeguranca(true))
    const pararPorta = window.api.seguranca.aoAbrirPorta(() => setPorta(true))

    // Os quadros da câmera de rede chegam aqui e não no painel: a câmera da
    // porta tem que continuar sendo lida com o painel fechado, senão o
    // alarme só funcionaria com alguém olhando a tela.
    const pararFrames = window.api.camera.aoFrame(receberQuadro)

    const pararCamera = window.api.seguranca.aoMudarCamera(() => {
      setCameraGeracao((g) => g + 1)
      // O modo pode ter mudado por fala junto: relê em vez de adivinhar.
      window.api.config.ler().then((c) => setModoSeguranca(Boolean(c.modoSeguranca)))
    })

    const pararGaleria = window.api.seguranca.aoMudarGaleria(() => {
      window.api.rostos.galeria().then(definirGaleria)
    })

    /**
     * A Íris pediu um descritor pra cadastrar por voz.
     *
     * Fica no App e não no painel porque a câmera roda aqui: cadastrar por
     * voz precisa funcionar com o painel FECHADO, que é o caso inteiro —
     * "cadastra o João" dito de longe, sem ninguém no teclado.
     */
    const pararRosto = window.api.seguranca.aoPedirRosto(async () => {
      const d = await capturarDescritor()
      return typeof d === 'string' ? d : [...d]
    })

    return () => {
      pararAbrir()
      pararPorta()
      pararFrames()
      pararRosto()
      pararCamera()
      pararGaleria()
    }
  }, [])

  /**
   * SENSOR DE PRESENÇA (2.6).
   *
   * Mora no renderer porque `getUserMedia` só existe aqui, e sobe pra main
   * só a contagem. Amarrado ao `cameraAtiva`: desligar nos Ajustes apaga a
   * luz da webcam de verdade, não só o efeito.
   */
  useEffect(() => {
    let parar: (() => void) | null = null
    let morto = false

    window.api.config.ler().then(async (c) => {
      if (!c.cameraAtiva || morto) return setVisao({ rostos: -1, desconhecidos: 0, conhecidos: [] })

      // O cadastro ANTES do primeiro tique: começar com a galeria vazia
      // faria todo mundo — você inclusive — aparecer como desconhecido no
      // primeiro segundo, e isso é um alarme de vigilância disparado por
      // ordem de carregamento.
      definirLimiar(Number(c.limiarFacial))
      definirGaleria(await window.api.rostos.galeria())
      if (morto) return

      iniciarPresenca(
        (l) => {
          setVisao(l)
          window.api.presenca(l)
        },
        String(c.cameraId ?? '')
      ).then((p) => {
        // A janela pode ter desmontado enquanto o modelo carregava.
        if (morto) p()
        else parar = p
      })
    })

    return () => {
      morto = true
      parar?.()
      // A main não pode continuar achando que tem olho depois que a janela
      // fechou: -1 é 'desconhecida', que não escala nada.
      window.api.presenca({ rostos: -1, desconhecidos: 0, conhecidos: [] })
    }
  }, [config, cameraGeracao])
  const fimDaLista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  // Um leitor por janela, criado na primeira render. O argumento do useRef
  // é avaliado toda render, mas só o primeiro valor é guardado — o resto
  // vira lixo imediato, e é barato o bastante pra não valer um useMemo.
  const leitor = useRef(criarLeitor())

  // O efeito dos eventos roda com [] e enxergaria `pensando` congelado em
  // false pra sempre. O ref é o valor de agora.
  const pensandoRef = useRef(false)
  useEffect(() => {
    pensandoRef.current = pensando
  }, [pensando])

  // ---------- avisos de gatilho ----------
  useEffect(() => {
    /**
     * ANTES da última mensagem quando há stream em curso.
     *
     * O `alterarUltima` de baixo assume que a última mensagem é a do
     * assistente que está sendo preenchida. Um aviso empilhado no fim durante
     * o stream roubaria esse lugar e o resto da resposta iria parar dentro do
     * aviso. O gatilho já evita disparar enquanto você conversa (o `ocupado`
     * no main), mas um disparo que COMEÇOU antes da sua pergunta ainda chega
     * aqui no meio dela.
     */
    const inserir = (aviso: Aviso): void =>
      setMensagens((atual) => {
        const copia = [...atual]
        copia.splice(pensandoRef.current ? copia.length - 1 : copia.length, 0, {
          role: 'assistant',
          content: aviso.texto,
          gatilho: aviso.gatilho,
          avisoId: aviso.id,
          momento: aviso.momento
        })
        return copia
      })

    // O que disparou com a janela na bandeja. Só na montagem: a fila esvazia
    // na leitura, e daí em diante os avisos chegam pelo evento.
    window.api.avisosPendentes().then((fila) => fila.forEach(inserir))

    return window.api.aoAvisar(inserir)
  }, [])

  // ---------- eventos vindos do main ----------
  useEffect(() => {
    // Helper: mexe só na última mensagem, que é sempre a do assistente.
    const alterarUltima = (fn: (m: Mensagem) => Mensagem): void =>
      setMensagens((atual) => {
        const copia = [...atual]
        const ultima = copia[copia.length - 1]
        if (ultima?.role === 'assistant') copia[copia.length - 1] = fn(ultima)
        return copia
      })

    const pararTexto = window.api.aoReceberTexto((pedaco) => {
      // Alimenta a fala ANTES de renderizar: o leitor só solta frase
      // completa, então ele já vai atrasado em relação ao texto na tela.
      leitor.current.alimentar(pedaco)
      alterarUltima((m) => ({ ...m, content: m.content + pedaco }))
    })

    const pararFerramenta = window.api.aoUsarFerramenta((nome, args) => {
      alterarUltima((m) => ({ ...m, ferramentas: [...(m.ferramentas ?? []), { nome, args }] }))
      if (nome === 'ver_tela') {
        setCapturando(true)
        setTimeout(() => setCapturando(false), 2000)
      }
    })

    const pararVisual = window.api.aoGerarVisual((visual) =>
      alterarUltima((m) => ({ ...m, visuais: [...(m.visuais ?? []), visual] }))
    )

    const pararInjecao = window.api.aoDetectarInjecao((ferramenta) => setInjecao({ ferramenta }))

    const pararAprovacao = window.api.aoPedirAprovacao((id, nome, args, risco) => {
      // A voz cala: isso exige atenção.
      parar()

      /**
       * Só o rodar_powershell tem 'comando' e 'explicacao'. Qualquer outra
       * ferramenta chega aqui pela ESCALADA da contaminação, com os args
       * dela — e antes isso caía num modal de campos vazios, que é o pior
       * jeito de pedir uma decisão. O args cru é o fallback honesto.
       *
       * Nada lança: JSON quebrado derrubaria o listener e deixaria o main
       * travado os 2min inteiros do timeout esperando resposta.
       */
      let p: { comando?: string; explicacao?: string } = {}
      try {
        p = JSON.parse(args) ?? {}
      } catch {
        /* args cru serve */
      }

      setAprovacoes((f) => [
        ...f,
        {
          id,
          comando: p.comando ?? args,
          explicacao: p.explicacao ?? `Executar ${nome}.`,
          risco
        }
      ])
    })

    // Cancela os cinco no desmonte. Em dev o React monta duas vezes
    // (StrictMode) — sem isso o texto duplica.
    return () => {
      pararTexto()
      pararFerramenta()
      pararVisual()
      pararInjecao()
      pararAprovacao()
    }
  }, [])

  /**
   * Foco e cota, por pergunta e não por empurrão.
   *
   * 1,5s é bem mais lento que o vigia do main (500ms) de propósito: a barra
   * é pra ser lida de relance, e um mostrador que troca 2x por segundo não
   * se lê, pisca. Para quando a janela some pra bandeja — ninguém precisa
   * de IPC rodando pra desenhar pixel que não existe.
   */
  useEffect(() => {
    const ler = (): void => {
      if (document.hidden) return
      window.api.estado().then(setEstado)
    }
    ler()
    const id = setInterval(ler, 1500)
    document.addEventListener('visibilitychange', ler)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', ler)
    }
  }, [])

  useEffect(() => {
    fimDaLista.current?.scrollIntoView({ behavior: 'smooth' })
  }, [mensagens])

  // O Ctrl+Space traz a janela; o cursor já tem que estar no campo, senão
  // todo atalho custa um clique depois.
  useEffect(() => {
    const focar = (): void => campo.current?.focus()
    focar()
    window.addEventListener('focus', focar)
    return () => window.removeEventListener('focus', focar)
  }, [])

  // ---------- envio ----------
  async function enviar(): Promise<void> {
    const texto = rascunho.trim()
    if (!texto || pensando) return

    // Corta a fala anterior: mandar coisa nova no meio significa que você
    // não quer mais ouvir a resposta velha.
    parar()

    // O aviso é do turno que passou. Some quando começa o próximo.
    setInjecao(null)

    // O histórico enviado à API é só até a mensagem do usuário.
    // A mensagem vazia do assistente é o espaço na UI pro stream preencher.
    const historico: Mensagem[] = [...mensagens, { role: 'user', content: texto }]

    setMensagens([...historico, { role: 'assistant', content: '' }])
    setRascunho('')
    setPensando(true)

    // Manda só role/content — a API não conhece o campo 'ferramentas'.
    const resposta = await window.api.enviar(
      historico.map(({ role, content }) => ({ role, content }))
    )

    if (!resposta.ok) {
      setMensagens((atual) => {
        const copia = [...atual]
        copia[copia.length - 1] = { role: 'assistant', content: '', erro: resposta.erro }
        return copia
      })
    }

    setPensando(false)
    // A cota mudou agora; não espera o próximo tique de 1,5s pra mostrar.
    window.api.estado().then(setEstado)
    // O que sobrou no buffer sem pontuação no fim.
    leitor.current.finalizar()
  }

  // O veredito sobre um aviso automático. Grava e pinta.
  function rotular(i: number, util: boolean): void {
    const m = mensagens[i]
    if (m?.avisoId === undefined) return
    window.api.rotular(m.avisoId, util)
    setMensagens((atual) => atual.map((x, j) => (j === i ? { ...x, util } : x)))
  }

  // Responde o primeiro da fila e anda pro próximo.
  function responder(ok: boolean): void {
    const pedido = aprovacoes[0]
    if (!pedido) return
    window.api.responderAprovacao(pedido.id, ok)
    setAprovacoes((f) => f.slice(1))
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  // ---------- render ----------
  return (
    // relative: é o que o inset-0 do modal de aprovação usa como referência
    <div className="relative flex h-full flex-col bg-fundo text-tinta antialiased">
      {/*
        BARRA DE STATUS — a linha de estado de uma janela de console.
        Wordmark, o que ela está vendo, o que ela está fazendo, quanto resta.
        Tudo que a Íris sabe sobre agora, numa linha só.
      */}
      {/*
        h-10 e pr-[140px] casam com o titleBarOverlay do main: a barra tem
        exatamente a altura da faixa nativa, e a reserva à direita é o espaço
        dos três botões do Windows. Mexer num número exige mexer no outro.
        A faixa inteira arrasta a janela, menos os controles.
      */}
      {/*
        O ALARME NA MOLDURA DA JANELA.
        O ponto de 6px no cabeçalho continua, mas ele é para quem já está
        lendo a barra. Este é para quem está com a Íris num canto da tela e
        olhando outra coisa — e, no modo porta, para quem passa pela sala.
        Estado puro: acende só enquanto a leitura atual tem desconhecido.
      */}
      {visao.desconhecidos > 0 && (
        <div className="alarme pointer-events-none absolute inset-0 z-30" aria-hidden />
      )}

      <header className="relative h-10 shrink-0 border-b border-fio bg-chapa [-webkit-app-region:drag]">
        <div className="flex h-full items-center gap-4 pr-[140px] pl-5">
          <h1 className="font-mono text-[12px] font-semibold tracking-[0.3em] text-tinta">ÍRIS</h1>

          <div className="h-3.5 w-px bg-fio-forte" />

          {/* min-w-0 é o que permite o truncate do título funcionar dentro
              do flex — sem ele o texto empurra a barra inteira. */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-hud text-[11px] tracking-[0.2em] text-tinta-3">
              EM FOCO
            </span>
            <Anunciador foco={estado?.foco ?? null} />
          </div>

          {/*
            INDICADOR DE CÂMERA (2.6). Obrigatório, não decorativo: uma
            câmera ligada sem sinal visível é a coisa que faz um usuário
            desinstalar o app — e a LGPD trata transparência como requisito,
            não cortesia. Some por completo com o sensor desligado, porque
            um ícone apagado ainda parece uma câmera.
          */}
          {visao.rostos >= 0 && (
            <button
              onClick={() => setSeguranca(true)}
              className="flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]"
              title={
                visao.desconhecidos > 0
                  ? `${visao.desconhecidos} pessoa(s) não cadastrada(s) — clique para abrir a segurança`
                  : visao.rostos === 0
                    ? 'Ninguém em frente à câmera — clique para abrir a segurança'
                    : `Reconhecido: ${visao.conhecidos.join(', ')} — clique para abrir a segurança`
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  visao.desconhecidos > 0
                    ? 'bg-perigo'
                    : visao.rostos === 0
                      ? 'bg-tinta-3'
                      : 'bg-sinal'
                }`}
              />
              <span
                className={`font-hud text-[11px] tracking-[0.2em] ${
                  visao.desconhecidos > 0 ? 'text-perigo' : 'text-tinta-3'
                }`}
              >
                {visao.desconhecidos > 0
                  ? `${visao.desconhecidos} NÃO CADASTRADO`
                  : visao.rostos === 0
                    ? 'AUSENTE'
                    : visao.conhecidos.join(' · ').toUpperCase() || `${visao.rostos} PESSOAS`}
              </span>
            </button>
          )}

          {estado && <Escada uso={estado.uso} />}

          <div className="h-3.5 w-px bg-fio-forte" />

          {/* O arco só existe enquanto há processo pra medir. Em espera ele
              some — anel girando à toa é o "extra crap" que o filme corta. */}
          <span
            className={`flex items-center gap-2 font-hud text-[11px] tracking-[0.2em] ${
              pensando ? 'text-sinal' : 'text-tinta-3'
            }`}
          >
            {pensando && <Arco width={12} height={12} className="arco shrink-0" />}
            {pensando ? 'PROCESSANDO' : 'EM ESPERA'}
          </span>

          <button
            onClick={() => {
              const novo = !vozAtiva
              setVozAtiva(novo)
              alternarVoz(novo)
              // O botão do cabeçalho e o interruptor dos ajustes são o MESMO
              // estado. Sem gravar aqui, mudar num não aparece no outro e o
              // mudo volta ligado no boot seguinte.
              window.api.config.gravar('vozAtiva', novo)
            }}
            title={vozAtiva ? 'Silenciar a voz' : 'Ativar a voz'}
            aria-pressed={vozAtiva}
            className={`[-webkit-app-region:no-drag] transition-colors ${
              vozAtiva ? 'text-tinta-2 hover:text-sinal' : 'text-tinta-3 hover:text-tinta'
            }`}
          >
            {vozAtiva ? <Som /> : <Mudo />}
          </button>

          {capturando && (
            <span
              title="capturando a tela"
              className="flex shrink-0 items-center gap-1.5 font-hud text-[11px] tracking-[0.2em] text-perigo"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-perigo" />
              TELA
            </span>
          )}

          {/*
            SEGURANÇA no cabeçalho, e não só por voz.
            O indicador ao lado some quando a câmera está desligada — que é
            justamente quando você precisa entrar pra ligá-la. Um caminho que
            só existe depois de a feature estar ligada não serve pra ligar a
            feature.
          */}
          <button
            onClick={() => setSeguranca(true)}
            title="Segurança"
            className={`[-webkit-app-region:no-drag] shrink-0 font-hud text-[11px] tracking-[0.2em] transition-colors ${
              visao.desconhecidos > 0
                ? 'text-perigo hover:text-perigo'
                : 'text-tinta-3 hover:text-sinal'
            }`}
          >
            SEGURANÇA
          </button>

          <button
            onClick={() => setPorta(true)}
            title="Modo porta — rosto e câmera em tela cheia"
            className="[-webkit-app-region:no-drag] shrink-0 font-hud text-[11px] tracking-[0.2em] text-tinta-3 transition-colors hover:text-sinal"
          >
            PORTA
          </button>

          <button
            onClick={() => setConfig(true)}
            title="Ajustes"
            className="[-webkit-app-region:no-drag] shrink-0 font-hud text-[11px] tracking-[0.2em] text-tinta-3 transition-colors hover:text-sinal"
          >
            AJUSTES
          </button>
        </div>
      </header>

      {/*
        Vazio, a abertura fica centrada na vertical. Ancorada no topo sobrava
        um buraco de 400px embaixo; ancorada embaixo o buraco só subiu. Uma
        janela de 780px com 200px de conteúdo não tem como esconder a folga —
        então ela vira margem simétrica, que se lê como composição em vez de
        página pela metade.
      */}
      <main
        className={`flex-1 overflow-y-auto px-5 py-7 ${
          mensagens.length === 0 ? 'flex flex-col justify-center' : ''
        }`}
      >
        {mensagens.length === 0 ? (
          <Masthead seguranca={modoSeguranca} />
        ) : (
          <div className="space-y-7">
            {mensagens.map((m, i) => (
              <article key={i} className="flex gap-5">
                {/* A calha é onde a interface diz QUEM falou, então é onde a
                    diferença tem que aparecer: um aviso automático não é uma
                    resposta, e ler os dois como "ÍRIS" apagaria a única coisa
                    que o usuário precisa saber — que ninguém perguntou nada. */}
                <Calha>
                  {m.role === 'user' ? (
                    'VOCÊ'
                  ) : m.gatilho ? (
                    <span className="text-hud">GATILHO</span>
                  ) : (
                    'ÍRIS'
                  )}
                </Calha>

                {/* O aviso automático tem corpo PRÓPRIO, não o corpo normal
                    com um enfeite: ele não streama, não tem gráfico, não tem
                    log de ferramenta pra mostrar, e termina numa pergunta que
                    nenhuma resposta faz. Enfiá-lo no mesmo corpo custaria
                    quatro condicionais aninhados pra desligar tudo isso. */}
                {m.gatilho ? (
                  <Transmissao m={m} onRotular={(u) => rotular(i, u)} />
                ) : (
                  <div className="min-w-0 flex-1">
                    {/* Log de invocação, na forma da SINOPSE do manual: o nome
                      da ferramenta e o que ela recebeu, alinhados em coluna. */}
                    {m.ferramentas && m.ferramentas.length > 0 && (
                      <ul className="mb-3 space-y-1">
                        {m.ferramentas.map((f, j) => (
                          <li
                            key={j}
                            className="flex items-center gap-2 font-mono text-[11px] leading-5"
                          >
                            <Seta width={11} height={11} className="shrink-0 text-tinta-3" />
                            <span className="shrink-0 text-sinal">{f.nome}</span>
                            <span className="truncate text-tinta-3" title={f.args}>
                              {f.args && f.args !== '{}' ? f.args : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Antes do texto: o gráfico chega junto com a chamada da
                      ferramenta, enquanto a frase do modelo ainda está streamando. */}
                    {m.visuais?.map((v, j) => (
                      <Painel key={j} visual={v} />
                    ))}

                    {m.erro ? (
                      <Falha erro={m.erro} />
                    ) : (
                      // max-w em ch: a janela tem 1100px e uma linha de texto
                      // com 1000px de largura não se lê, se varre.
                      <div className="max-w-[72ch] leading-[1.65] whitespace-pre-wrap select-text">
                        {m.content}
                        {pensando && i === mensagens.length - 1 && (
                          <span className="cursor ml-px inline-block h-[1.05em] w-[7px] translate-y-[2px] bg-sinal" />
                        )}
                      </div>
                    )}
                  </div>
                )}
              </article>
            ))}
            <div ref={fimDaLista} />
          </div>
        )}
      </main>

      {/* O aviso fica ENCOSTADO no prompt, não no topo da conversa: é a
          última coisa que você lê antes de responder, e a decisão que ele
          deve mudar é a próxima que você toma. Na calha do resto da
          interface, sem caixa própria — não é um alerta de navegador. */}
      {injecao && (
        <div className="flex shrink-0 items-start gap-5 border-t border-fio bg-chapa px-5 py-3 text-perigo">
          <Calha>INJEÇÃO</Calha>
          <p className="max-w-[72ch] flex-1 leading-[1.65] text-tinta-2 select-text">
            O conteúdo lido por <span className="font-mono text-tinta">{injecao.ferramenta}</span>{' '}
            continha instruções. Foi tratado como dado e ignorado.
          </p>
        </div>
      )}

      {/* PROMPT. A calha continua: o mesmo alinhamento do corpo, então o que
          você digita nasce na mesma coluna em que ela responde. */}
      <footer className="group shrink-0 border-t border-fio bg-chapa px-5 py-3">
        <div className="flex items-start gap-5">
          {/*
            É o cursor do prompt que acende, não uma caixa em volta do campo.
            Um retângulo âmber de 1000px de largura desenharia um formulário
            no meio de uma interface que não tem nenhum outro — e o anel de
            foco padrão do :focus-visible fazia exatamente isso.
          */}
          <div className="flex w-[104px] shrink-0 justify-end pt-2 text-tinta-3 transition-colors group-focus-within:text-sinal">
            <Prompt />
          </div>
          <textarea
            ref={campo}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onKeyDown={aoTeclar}
            rows={1}
            placeholder="Manda o comando…"
            aria-label="Comando para a Íris"
            className="max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 leading-[1.65] text-tinta caret-sinal outline-none select-text placeholder:text-tinta-3 focus-visible:outline-none"
          />
          <button
            onClick={enviar}
            disabled={pensando || !rascunho.trim()}
            className="shrink-0 self-end border border-fio-forte px-3 py-1.5 font-hud text-[11px] tracking-[0.16em] text-tinta-2 transition-colors not-disabled:hover:border-sinal not-disabled:hover:text-sinal disabled:opacity-35"
          >
            ENTER
          </button>
        </div>
      </footer>

      {/* Só o primeiro da fila. Ao responder, ele sai e o próximo aparece. */}
      {aprovacoes[0] && (
        <Aprovacao pedido={aprovacoes[0]} naFila={aprovacoes.length - 1} onResponder={responder} />
      )}

      {porta && <Porta visao={visao} aoFechar={() => setPorta(false)} />}

      {seguranca && (
        <Seguranca
          visao={visao}
          aoFechar={() => setSeguranca(false)}
          aoTrocarFonte={() => setCameraGeracao((g) => g + 1)}
        />
      )}

      {config && (
        <Config
          aoFechar={() => {
            setConfig(false)
            // Relê o que a tela mexeu: o interruptor de voz de lá é o mesmo
            // botão do cabeçalho, e sair dos ajustes com os dois discordando
            // é o tipo de detalhe que faz o app parecer quebrado.
            window.api.config.ler().then((c) => setVozAtiva(Boolean(c.vozAtiva)))
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Estados
// ---------------------------------------------------------------

/**
 * O estado vazio aparece toda vez que você chama pelo Ctrl+Space, ou seja,
 * dezenas de vezes por dia — e é justamente por isso que ele encolheu.
 *
 * Era uma página de manual: os 25 nomes de ferramenta em monospace, mais um
 * parágrafo explicando os dois triângulos de aprovação. Parecia completude e
 * era ruído. Ninguém lê 25 identificadores pra decidir o que digitar — você
 * digita; e a diferença entre os triângulos se aprende na primeira vez que
 * um modal aparece, não relendo a legenda na trigésima abertura do dia.
 *
 * Ficou o que responde as duas perguntas que a tela vazia tem: o que é isto,
 * e como eu falo com ela. O catálogo continua vivo no main — a Íris responde
 * "o que você sabe fazer?" quando a pergunta existir, em vez de responder
 * sempre, pra ninguém.
 */
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }): JSX.Element {
  return (
    <section className="flex gap-5">
      <Calha>{titulo}</Calha>
      <div className="max-w-[72ch] flex-1 leading-[1.65] text-tinta-2">{children}</div>
    </section>
  )
}

// Destaca as palavras que a DESCRIÇÃO está definindo. <em> pelo significado
// (é um termo sendo citado), sem itálico porque a Cascadia não tem itálico
// de verdade e o navegador inclinaria a fonte na marra.
const termo = 'text-tinta not-italic'

function Masthead({ seguranca }: { seguranca: boolean }): JSX.Element {
  return (
    <div className="space-y-5">
      <Secao titulo="NOME">
        {seguranca
          ? 'íris — interface de resposta inteligente e segura'
          : 'íris — assistente que enxerga a máquina e age nela'}
      </Secao>

      {/* A LINHA QUE A BANCA LÊ PRIMEIRO, e a única que sobrou de prosa.
          No modo normal não aparece: o dia a dia não precisa de tese,
          precisa de campo de texto. */}
      {seguranca && (
        <Secao titulo="ESCOPO">
          Reconhecimento facial local com decisão de risco <em className={termo}>auditável</em>.
          Presença física entra no cálculo de confiança, e toda recusa guarda a própria cadeia
          causal — quais sinais, quanto cada um pesou, qual era o limiar.
        </Secao>
      )}

      <Secao titulo="ATALHOS">
        Ctrl+Space abre e esconde · Enter envia · Shift+Enter quebra linha
      </Secao>
    </div>
  )
}

/**
 * A TRANSMISSÃO — o corpo de um aviso que ela deu sem ninguém pedir.
 *
 * É a única coisa que aparece na tela sem você ter feito nada, então não pode
 * chegar com a mesma cara de uma resposta. Três decisões carregam isso, e
 * nenhuma delas é enfeite:
 *
 * COLCHETES em vez de texto solto. O aviso não é fala, é LEITURA de
 * instrumento, e o colchete é a moldura que emoldura sem cercar. Em CYAN e
 * não âmbar: âmbar é acento crítico e some da tela quando nada é crítico —
 * gastá-lo num disco enchendo o esvazia justamente pro modal de aprovação,
 * que é o único lugar onde ele precisa gritar. Cyan é o que a paleta reserva
 * pra dado secundário, e um aviso automático é exatamente isso: não é
 * resposta sua, não é decisão, é leitura.
 *
 * DESTRAVAR, a mecânica de keyhole. O DESIGN.md reserva ela pra "coisa que
 * NASCE na tela", e não existe caso mais literal: um painel de dado nasce
 * porque você pediu; este nasce sozinho.
 *
 * A HORA, em mono. Um aviso pode ter ficado horas na fila com a janela na
 * bandeja, e chegar sem marca de tempo faz a interface mentir sobre quando
 * aquilo foi lido. Absoluta e não "há 2 minutos": relativo envelhece na tela
 * sem ninguém re-renderizar, e instrumento mostra leitura, não estimativa que
 * apodrece.
 *
 * O VEREDITO no pé é a única peça da interface que existe pela MEDIÇÃO e não
 * pelo uso — precisão de gatilho não se infere de comportamento: abrir a
 * janela depois da notificação não quer dizer que serviu, e ignorar não quer
 * dizer que atrapalhou, porque você pode já saber do disco cheio. Some depois
 * de respondido, e não responder é resposta válida: vira "não rotulado", sai
 * da conta de precisão e aparece como cobertura.
 */
function Transmissao({
  m,
  onRotular
}: {
  m: Mensagem
  onRotular: (util: boolean) => void
}): JSX.Element {
  const hora = m.momento
    ? new Date(m.momento).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null

  const botao =
    'border border-fio-forte px-2.5 py-1 font-hud text-[11px] tracking-[0.16em] text-tinta-3 transition-colors'

  return (
    <div className="colchetes colchetes-dado destravar min-w-0 flex-1 px-4 py-3.5">
      <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] leading-5">
        <Pulso width={12} height={12} className="shrink-0 text-hud" />
        <span className="text-hud">{m.gatilho}</span>
        <span className="text-tinta-3">disparou sozinho</span>
        {hora && <span className="ml-auto text-tinta-3 tabular-nums">{hora}</span>}
      </div>

      <div className="max-w-[72ch] leading-[1.65] whitespace-pre-wrap select-text">{m.content}</div>

      {m.util !== undefined ? (
        <p className="mt-3 font-hud text-[11px] tracking-[0.2em] text-tinta-3">
          {m.util ? 'MARCADO ÚTIL' : 'MARCADO RUÍDO'}
        </p>
      ) : (
        <div className="mt-3.5 flex items-center gap-2">
          <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3">VALEU?</span>
          <button
            onClick={() => onRotular(true)}
            className={`${botao} hover:border-hud hover:text-hud`}
          >
            ÚTIL
          </button>
          <button
            onClick={() => onRotular(false)}
            className={`${botao} hover:border-perigo hover:text-perigo`}
          >
            RUÍDO
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * Erro nomeia o problema E a saída. "Falhou: fetch failed" não diz o que
 * fazer; a rede caída e a chave errada pedem ações diferentes.
 */
function Falha({ erro }: { erro: string }): JSX.Element {
  const semRede = /fetch|network|ENOTFOUND|ETIMEDOUT|socket/i.test(erro)
  const chave = /401|403|api key|unauthorized|credential/i.test(erro)

  const saida = semRede
    ? 'Sem resposta do OpenRouter. Confira a conexão e mande de novo.'
    : chave
      ? 'A chave do OpenRouter foi recusada. Verifique MAIN_VITE_LLM_KEY no .env.'
      : 'Tente de novo; se repetir, o modelo em MAIN_VITE_LLM_MODELO pode ter saído do ar.'

  return (
    <div className="max-w-[72ch] border-l border-perigo pl-4">
      <p className="leading-[1.65] text-tinta">{saida}</p>
      <p className="mt-1.5 font-mono text-[11px] leading-5 text-tinta-3 select-text">{erro}</p>
    </div>
  )
}

/**
 * O modal de aprovação é o único momento em que a interface interrompe você,
 * e o único onde ler errado custa caro. Então ele é a entrada de manual
 * COMPLETA do comando: o que faz, o que roda, e as duas saídas — nessa ordem,
 * porque é a ordem em que a decisão se forma.
 */
function Aprovacao({
  pedido,
  naFila,
  onResponder
}: {
  pedido: { comando: string; explicacao: string; risco: Avaliacao }
  naFila: number
  onResponder: (ok: boolean) => void
}): JSX.Element {
  const recusar = useRef<HTMLButtonElement>(null)

  // Recusar é o padrão do teclado: quem chegou aqui sem ler não deve executar
  // por reflexo. Esc também recusa.
  useEffect(() => {
    recusar.current?.focus()
    const aoTeclar = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onResponder(false)
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [onResponder])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Aprovação necessária"
      className="absolute inset-0 z-50 flex items-center justify-center bg-fundo/85 p-8"
    >
      {/* colchetes-vivo: este é o único painel do app que exige decisão, e é
          o único cujos cantos acendem em âmbar. destravar: ele nasce na tela,
          então entra pela mecânica de keyhole como os painéis de dado. */}
      <div className="colchetes colchetes-vivo destravar w-full max-w-2xl bg-chapa p-px shadow-[0_18px_50px_-12px_rgba(0,0,0,0.85)]">
        <div className="flex items-center gap-2.5 border-b border-fio px-5 py-3 text-perigo">
          <Atencao />
          <span className="font-hud text-[11px] tracking-[0.24em]">APROVAÇÃO NECESSÁRIA</span>
          {naFila > 0 && (
            <span className="ml-auto font-hud text-[11px] tracking-[0.2em] text-tinta-3">
              +{naFila} NA FILA
            </span>
          )}
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* PRIMEIRO, acima do que o comando faz: é a resposta pra "por que
              ele parou AGORA se antes não parava". Sem isto, uma confirmação
              que aparece de vez em quando parece aleatória — e o que parece
              aleatório se aprende a clicar sem ler, que é o fim de qualquer
              barreira. Também é o que torna a decisão auditável. */}
          {pedido.risco.motivos.length > 0 && (
            <section className="flex gap-5">
              <Calha>POR QUE PAREI</Calha>
              <ul className="flex max-w-[64ch] flex-1 flex-wrap gap-x-4 gap-y-1 leading-[1.65]">
                {pedido.risco.motivos.map((m) => (
                  <li key={m} className="text-tinta-2 select-text">
                    {m}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="flex gap-5">
            <Calha>O QUE FAZ</Calha>
            <p className="max-w-[64ch] flex-1 leading-[1.65] select-text">{pedido.explicacao}</p>
          </section>

          <section className="flex gap-5">
            <Calha>COMANDO</Calha>
            <pre className="max-h-56 min-w-0 flex-1 overflow-auto bg-sulco px-3.5 py-3 font-mono text-[12px] leading-[1.6] whitespace-pre-wrap text-tinta select-text">
              {pedido.comando}
            </pre>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-fio px-5 py-3">
          <button
            ref={recusar}
            onClick={() => onResponder(false)}
            className="border border-fio-forte px-4 py-2 font-hud text-[11px] tracking-[0.16em] text-tinta-2 transition-colors hover:border-tinta-3 hover:text-tinta"
          >
            RECUSAR
          </button>
          <button
            onClick={() => onResponder(true)}
            className="border border-perigo px-4 py-2 font-hud text-[11px] tracking-[0.16em] text-perigo transition-colors hover:bg-perigo hover:text-fundo"
          >
            EXECUTAR
          </button>
        </div>
      </div>
    </div>
  )
}

// O 'type JSX' é obrigatório no React 19: o namespace JSX global sumiu,
// agora vem do pacote. Sem ele, "Cannot find namespace 'JSX'".
import {
  capturarDescritor,
  definirGaleria,
  definirLimiar,
  iniciarPresenca,
  pararPresenca,
  pararQuadros,
  receberFoto,
  receberQuadro
} from './presenca'
import Seguranca from './Seguranca'
import Porta from './Porta'
import { useEffect, useRef, useState, type JSX } from 'react'
import Painel from './Painel'
import { Atencao, Enviar, Prompt, Pulso, Seta } from './icones'
import Shell, { BoasVindas, type Destino } from './Shell'
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

function Calha({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="message-label">{children}</div>
}

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
  const [seguranca, setSeguranca] = useState(true)

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

      // A preferência de abertura vale apenas no boot; navegar não religa a câmera.
      setSeguranca(Boolean(c.modoSeguranca))
    })
  }, [])

  useEffect(() => {
    if (!config) window.api.config.ler().then((c) => setVozAtiva(Boolean(c.vozAtiva)))
  }, [config])

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
    const pararAbrir = window.api.seguranca.aoAbrir(() => {
      setConfig(false)
      setPorta(false)
      setSeguranca(true)
    })
    const pararPorta = window.api.seguranca.aoAbrirPorta(() => {
      setConfig(false)
      setPorta(true)
    })

    // Os quadros da câmera de rede chegam aqui e não no painel: a câmera da
    // porta tem que continuar sendo lida com o painel fechado, senão o
    // alarme só funcionaria com alguém olhando a tela.
    const pararFrames = window.api.camera.aoFrame((jpeg, foto) => {
      if (foto) void receberFoto(jpeg)
      else receberQuadro(jpeg)
    })

    const pararCamera = window.api.seguranca.aoMudarCamera(() => {
      setCameraGeracao((g) => g + 1)
      // O modo pode ter mudado por fala junto: relê em vez de adivinhar.
      window.api.config.ler().then((c) => {
        if (c.modoSeguranca) setSeguranca(true)
      })
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
      if (morto) return
      if (!c.cameraAtiva) {
        pararQuadros()
        await window.api.camera.desconectar()
        if (!morto) setVisao({ rostos: -1, desconhecidos: 0, conhecidos: [] })
        return
      }

      // O cadastro ANTES do primeiro tique: começar com a galeria vazia
      // faria todo mundo — você inclusive — aparecer como desconhecido no
      // primeiro segundo, e isso é um alarme de vigilância disparado por
      // ordem de carregamento.
      definirLimiar(Number(c.limiarFacial))
      definirGaleria(await window.api.rostos.galeria())
      if (morto) return

      iniciarPresenca(
        (l) => {
          if (morto) return
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
      pararPresenca()
      // A main não pode continuar achando que tem olho depois que a janela
      // fechou: -1 é 'desconhecida', que não escala nada.
      window.api.presenca({ rostos: -1, desconhecidos: 0, conhecidos: [] })
    }
  }, [cameraGeracao])
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

  function navegar(destino: Destino): void {
    setConfig(destino === 'ajustes')
    setSeguranca(destino === 'seguranca')
    setPorta(destino === 'porta')
  }

  return (
    <Shell
      destino={config ? 'ajustes' : porta ? 'porta' : seguranca ? 'seguranca' : 'assistente'}
      navegar={navegar}
      voz={vozAtiva}
      alternarVoz={() => {
        const novo = !vozAtiva
        setVozAtiva(novo)
        alternarVoz(novo)
        window.api.config.gravar('vozAtiva', novo)
      }}
      pensando={pensando}
      estado={estado}
      rostos={visao.rostos}
      desconhecidos={visao.desconhecidos}
      capturando={capturando}
    >
      <div className="conversation" hidden={config || seguranca || porta}>
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
            <BoasVindas
              aoSeguranca={() => navegar('seguranca')}
              aoComando={(texto) => {
                setRascunho(texto)
                campo.current?.focus()
              }}
            />
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
        <footer className="composer group shrink-0">
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
              placeholder="Pergunte ou dê um comando à Íris…"
              aria-label="Comando para a Íris"
              className="max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 leading-[1.65] text-tinta caret-sinal outline-none select-text placeholder:text-tinta-3 focus-visible:outline-none"
            />
            <button
              onClick={enviar}
              aria-label="Enviar comando"
              title="Enviar comando (Enter)"
              disabled={pensando || !rascunho.trim()}
              className="shrink-0 self-end border border-fio-forte px-3 py-1.5 font-hud text-[11px] tracking-[0.16em] text-tinta-2 transition-colors not-disabled:hover:border-sinal not-disabled:hover:text-sinal disabled:opacity-35"
            >
              <Enviar width={17} height={17} />
            </button>
          </div>
          <div className="composer-help">
            <span>Converse com a sua inteligência</span>
            <span>Enter para enviar · Shift + Enter para nova linha</span>
          </div>
        </footer>
      </div>

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
          aoSeguranca={() => navegar('seguranca')}
          aoFechar={() => {
            setConfig(false)
            // Relê o que a tela mexeu: o interruptor de voz de lá é o mesmo
            // botão do cabeçalho, e sair dos ajustes com os dois discordando
            // é o tipo de detalhe que faz o app parecer quebrado.
            window.api.config.ler().then((c) => setVozAtiva(Boolean(c.vozAtiva)))
          }}
        />
      )}
    </Shell>
  )
}

// ---------------------------------------------------------------
// Estados
// ---------------------------------------------------------------

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
      className="absolute inset-0 z-[80] flex items-center justify-center bg-fundo/85 p-8"
    >
      {/* colchetes-vivo: este é o único painel do app que exige decisão, e é
          o único cujos cantos acendem em âmbar. destravar: ele nasce na tela,
          então entra pela mecânica de keyhole como os painéis de dado. */}
      <div className="approval-surface destravar w-full max-w-2xl p-px">
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

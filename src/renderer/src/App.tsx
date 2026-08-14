// O 'type JSX' é obrigatório no React 19: o namespace JSX global sumiu,
// agora vem do pacote. Sem ele, "Cannot find namespace 'JSX'".
import { useEffect, useRef, useState, type JSX } from 'react'
import Painel from './Painel'
import { Atencao, Mudo, Prompt, Som } from './icones'
import { alternarVoz, criarLeitor, parar } from './voz'

type Mensagem = {
  role: 'user' | 'assistant'
  content: string
  /** Ferramentas que o modelo executou nesta resposta. Só pra exibir. */
  ferramentas?: { nome: string; args: string }[]
  /** Dados que as ferramentas devolveram pra desenhar. Nunca vão pra API. */
  visuais?: Visual[]
  /** Mensagem crua da falha. Presente = esta resposta não aconteceu. */
  erro?: string
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
    <div className="w-[104px] shrink-0 pt-px text-right font-mono text-[10px] leading-5 tracking-[0.18em] text-tinta-3 select-none">
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
      <span className="font-mono text-[10px] tracking-[0.18em] text-tinta-3">COTA</span>
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
 * A Izze sabe em que janela você está; até agora isso vivia só no prompt do
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
  const [vozAtiva, setVozAtiva] = useState(true)
  const [estado, setEstado] = useState<Estado | null>(null)

  // Fila, não um pedido só: o modelo pode pedir duas ferramentas de nível 3
  // no mesmo turno, e elas chegam em paralelo (Promise.all). Com um estado
  // único o segundo pedido sobrescreveria o primeiro, cujo main ficaria
  // travado até o timeout de 2min. Mostra a primeira, resolve, anda a fila.
  const [aprovacoes, setAprovacoes] = useState<
    { id: string; comando: string; explicacao: string }[]
  >([])
  const fimDaLista = useRef<HTMLDivElement>(null)
  const campo = useRef<HTMLTextAreaElement>(null)

  // Um leitor por janela, criado na primeira render. O argumento do useRef
  // é avaliado toda render, mas só o primeiro valor é guardado — o resto
  // vira lixo imediato, e é barato o bastante pra não valer um useMemo.
  const leitor = useRef(criarLeitor())

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

    const pararFerramenta = window.api.aoUsarFerramenta((nome, args) =>
      alterarUltima((m) => ({ ...m, ferramentas: [...(m.ferramentas ?? []), { nome, args }] }))
    )

    const pararVisual = window.api.aoGerarVisual((visual) =>
      alterarUltima((m) => ({ ...m, visuais: [...(m.visuais ?? []), visual] }))
    )

    const pararAprovacao = window.api.aoPedirAprovacao((id, _nome, args) => {
      // A voz cala: isso exige atenção.
      parar()

      // args vem do modelo. JSON quebrado aqui derrubaria o listener e o
      // main ficaria travado 2min esperando resposta — então recusa na hora.
      try {
        const { comando, explicacao } = JSON.parse(args)
        setAprovacoes((f) => [...f, { id, comando, explicacao }])
      } catch {
        window.api.responderAprovacao(id, false)
      }
    })

    // Cancela os quatro no desmonte. Em dev o React monta duas vezes
    // (StrictMode) — sem isso o texto duplica.
    return () => {
      pararTexto()
      pararFerramenta()
      pararVisual()
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
        Tudo que a Izze sabe sobre agora, numa linha só.
      */}
      {/*
        h-10 e pr-[140px] casam com o titleBarOverlay do main: a barra tem
        exatamente a altura da faixa nativa, e a reserva à direita é o espaço
        dos três botões do Windows. Mexer num número exige mexer no outro.
        A faixa inteira arrasta a janela, menos os controles.
      */}
      <header className="relative h-10 shrink-0 border-b border-fio bg-chapa [-webkit-app-region:drag]">
        <div className="flex h-full items-center gap-4 pr-[140px] pl-5">
          <h1 className="font-mono text-[12px] font-semibold tracking-[0.3em] text-tinta">IZZE</h1>

          <div className="h-3.5 w-px bg-fio-forte" />

          {/* min-w-0 é o que permite o truncate do título funcionar dentro
              do flex — sem ele o texto empurra a barra inteira. */}
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="shrink-0 font-mono text-[10px] tracking-[0.18em] text-tinta-3">
              EM FOCO
            </span>
            <Anunciador foco={estado?.foco ?? null} />
          </div>

          {estado && <Escada uso={estado.uso} />}

          <div className="h-3.5 w-px bg-fio-forte" />

          <span
            className={`font-mono text-[10px] tracking-[0.18em] ${
              pensando ? 'text-sinal' : 'text-tinta-3'
            }`}
          >
            {pensando ? 'PROCESSANDO' : 'EM ESPERA'}
          </span>

          <button
            onClick={() => {
              const novo = !vozAtiva
              setVozAtiva(novo)
              alternarVoz(novo)
            }}
            title={vozAtiva ? 'Silenciar a voz' : 'Ativar a voz'}
            aria-pressed={vozAtiva}
            className={`[-webkit-app-region:no-drag] transition-colors ${
              vozAtiva ? 'text-tinta-2 hover:text-sinal' : 'text-tinta-3 hover:text-tinta'
            }`}
          >
            {vozAtiva ? <Som /> : <Mudo />}
          </button>
        </div>

        {/* A varredura contínua. Mesma linguagem do anunciador: enquanto ela
            pensa, o instrumento está rastreando. */}
        {pensando && (
          <div className="absolute inset-x-0 bottom-0 h-px overflow-hidden">
            <div className="rastro h-px w-1/4 bg-sinal" />
          </div>
        )}
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
          <Masthead />
        ) : (
          <div className="space-y-7">
            {mensagens.map((m, i) => (
              <article key={i} className="flex gap-5">
                <Calha>{m.role === 'user' ? 'VOCÊ' : 'IZZE'}</Calha>

                <div className="min-w-0 flex-1">
                  {/* Log de invocação, na forma da SINOPSE do manual: o nome
                      da ferramenta e o que ela recebeu, alinhados em coluna. */}
                  {m.ferramentas && m.ferramentas.length > 0 && (
                    <ul className="mb-3 space-y-1">
                      {m.ferramentas.map((f, j) => (
                        <li key={j} className="flex gap-2 font-mono text-[11px] leading-5">
                          <span className="text-tinta-3">▸</span>
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
              </article>
            ))}
            <div ref={fimDaLista} />
          </div>
        )}
      </main>

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
            aria-label="Comando para a Izze"
            className="max-h-40 min-w-0 flex-1 resize-none border-none bg-transparent py-1.5 leading-[1.65] text-tinta caret-sinal outline-none select-text placeholder:text-tinta-3 focus-visible:outline-none"
          />
          <button
            onClick={enviar}
            disabled={pensando || !rascunho.trim()}
            className="shrink-0 self-end border border-fio-forte px-3 py-1.5 font-mono text-[11px] tracking-[0.15em] text-tinta-2 transition-colors not-disabled:hover:border-sinal not-disabled:hover:text-sinal disabled:opacity-35"
          >
            ENTER
          </button>
        </div>
      </footer>

      {/* Só o primeiro da fila. Ao responder, ele sai e o próximo aparece. */}
      {aprovacoes[0] && (
        <Aprovacao pedido={aprovacoes[0]} naFila={aprovacoes.length - 1} onResponder={responder} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------
// Estados
// ---------------------------------------------------------------

/**
 * O estado vazio aparece toda vez que você chama pelo Ctrl+Space, ou seja,
 * dezenas de vezes por dia. "Aguardando comando." desperdiça essa tela.
 * Aqui ele é a abertura de uma página de manual: o que ela é e o que ela
 * sabe fazer, na mesma calha do resto da interface.
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

function Masthead(): JSX.Element {
  return (
    <div className="space-y-5">
      <Secao titulo="NOME">izze — assistente que enxerga a máquina e age nela</Secao>

      <Secao titulo="SINOPSE">
        <span className="font-mono text-[13px]">
          izze [pergunta] | abrir | listar | analisar | powershell
        </span>
      </Secao>

      <Secao titulo="DESCRIÇÃO">
        Ela lê a janela em que você está a cada meio segundo, então <em className={termo}>isso</em>,{' '}
        <em className={termo}>aqui</em> e <em className={termo}>o que eu tô fazendo</em> já têm
        referente. Comandos destrutivos param e pedem aprovação antes de rodar.
      </Secao>

      <Secao titulo="ATALHOS">
        Ctrl+Space abre e esconde · Enter envia · Shift+Enter quebra linha
      </Secao>
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
  pedido: { comando: string; explicacao: string }
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
      <div className="w-full max-w-2xl border border-fio-forte bg-chapa shadow-[0_18px_50px_-12px_rgba(0,0,0,0.75)]">
        <div className="flex items-center gap-2.5 border-b border-fio px-5 py-3 text-perigo">
          <Atencao />
          <span className="font-mono text-[10px] tracking-[0.22em]">APROVAÇÃO NECESSÁRIA</span>
          {naFila > 0 && (
            <span className="ml-auto font-mono text-[10px] tracking-[0.18em] text-tinta-3">
              +{naFila} NA FILA
            </span>
          )}
        </div>

        <div className="space-y-5 px-5 py-5">
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
            className="border border-fio-forte px-4 py-2 font-mono text-[11px] tracking-[0.15em] text-tinta-2 transition-colors hover:border-tinta-3 hover:text-tinta"
          >
            RECUSAR
          </button>
          <button
            onClick={() => onResponder(true)}
            className="border border-perigo px-4 py-2 font-mono text-[11px] tracking-[0.15em] text-perigo transition-colors hover:bg-perigo hover:text-fundo"
          >
            EXECUTAR
          </button>
        </div>
      </div>
    </div>
  )
}

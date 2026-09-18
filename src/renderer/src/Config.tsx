import { useEffect, useState, type JSX, type ReactNode } from 'react'

/**
 * A tela que tira as chaves do .env (I.1).
 *
 * Painel deslizante por cima da conversa, não rota separada: o app tem uma
 * tela só, e um roteador pra dois destinos é peça pra manter em troca de
 * nada.
 *
 * Grava no BLUR e não a cada tecla. Com onChange, colar uma chave de API
 * dispararia uma escrita por caractere — cada uma passando pelo safeStorage,
 * e a última vencendo por acidente de ordem.
 */

type Cfg = Record<string, unknown>

export default function Config({ aoFechar }: { aoFechar: () => void }): JSX.Element {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [gatilhos, setGatilhos] = useState<string[]>([])
  const [salvo, setSalvo] = useState('')

  useEffect(() => {
    window.api.config.ler().then(setCfg)
    // A lista vem do main: os gatilhos que existem de verdade, não uma cópia
    // escrita aqui que envelhece no primeiro gatilho novo.
    window.api.config.gatilhos().then(setGatilhos)
  }, [])

  async function alterar(chave: string, valor: unknown): Promise<void> {
    await window.api.config.gravar(chave, valor)
    setCfg((c) => c && { ...c, [chave]: valor })
    setSalvo(chave)
    setTimeout(() => setSalvo(''), 1500)
  }

  if (!cfg) {
    return (
      <div className="absolute inset-0 z-40 bg-fundo px-6 py-5 font-hud text-[11px] tracking-[0.2em] text-tinta-3">
        CARREGANDO…
      </div>
    )
  }

  const semChave = !cfg.llmChave

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-fundo px-6 py-5">
      <div className="mx-auto max-w-lg space-y-6 pb-10">
        <div className="flex items-center justify-between border-b border-fio pb-3">
          <h2 className="font-mono text-[12px] font-semibold tracking-[0.3em] text-sinal">
            AJUSTES
          </h2>
          <button
            onClick={aoFechar}
            className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase transition-colors hover:text-tinta"
          >
            fechar
          </button>
        </div>

        {/*
          O aviso existe porque a tela abre SOZINHA no primeiro boot, e sem
          uma linha explicando por quê ela parece um painel que apareceu do
          nada. Some assim que a chave entra.
        */}
        {semChave && (
          <p className="border-l border-sinal pl-4 text-[13px] leading-[1.65] text-tinta-2">
            Sem chave da OpenRouter a Íris não responde. Pegue uma em{' '}
            <span className="font-mono text-tinta">openrouter.ai/keys</span> e cole abaixo — ela é
            guardada criptografada nesta máquina, nunca em texto puro.
          </p>
        )}

        <Campo
          id="llmChave"
          rotulo="CHAVE OPENROUTER"
          cfg={cfg}
          salvo={salvo}
          alterar={alterar}
          dica="Fica cifrada pela conta do Windows. Copiar o arquivo pra outro PC não leva a chave junto."
        />
        <Campo id="llmModelo" rotulo="MODELO" cfg={cfg} salvo={salvo} alterar={alterar} />
        <Campo
          id="llmModeloVisao"
          rotulo="MODELO COM VISÃO"
          cfg={cfg}
          salvo={salvo}
          alterar={alterar}
          dica="Usado só no turno em que ela tira um print. Precisa suportar imagem — um modelo sem visão responde sobre a tela de cabeça, sem avisar que não viu."
        />

        <Campo
          id="tavilyChave"
          rotulo="CHAVE TAVILY"
          cfg={cfg}
          salvo={salvo}
          alterar={alterar}
          dica="Opcional — é o que liga a busca na web. Sem ela a Íris responde só do que já sabe. tavily.com"
        />

        {/*
          Lista virando texto separado por vírgula, e não um editor de itens:
          são duas ou três strings que mudam uma vez por semestre.
        */}
        <Campo
          id="llmReservas"
          rotulo="MODELOS RESERVA"
          cfg={cfg}
          salvo={salvo}
          dica="Separados por vírgula. Todos precisam suportar ferramentas, senão a Íris vira só um chat quando cair pra reserva."
          converter={(t) =>
            t
              .split(',')
              .map((m) => m.trim())
              .filter(Boolean)
          }
          exibir={(v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))}
          alterar={alterar}
        />

        <Campo
          id="atalho"
          rotulo="ATALHO GLOBAL"
          cfg={cfg}
          salvo={salvo}
          alterar={alterar}
          dica="Ex: Control+Space, Alt+Space. Inválido volta pro Control+Space sozinho."
        />

        <Campo
          id="tetoDiario"
          rotulo="TETO DIÁRIO DE CHAMADAS"
          cfg={cfg}
          salvo={salvo}
          alterar={alterar}
          converter={Number}
          dica="Abaixo do teto real do provedor de propósito: as retentativas do SDK gastam cota e não são contadas."
        />

        <div>
          <Rotulo id="limiarRisco" salvo={salvo}>
            LIMIAR DE RISCO — {String(cfg.limiarRisco)}
          </Rotulo>
          <input
            type="range"
            min={1}
            max={6}
            value={Number(cfg.limiarRisco)}
            onChange={(e) => alterar('limiarRisco', Number(e.target.value))}
            className="w-full accent-sinal"
          />
          <Dica>
            Menor = confirma mais, executa menos sozinha. Maior = o contrário. Nível 3 nunca desce
            abaixo do limiar por bom histórico, então subir isto não dispensa a confirmação de ação
            irreversível.
          </Dica>
        </div>

        <label className="flex items-center justify-between border-t border-fio pt-4">
          <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            VOZ ATIVA
          </span>
          <input
            type="checkbox"
            checked={Boolean(cfg.vozAtiva)}
            onChange={(e) => alterar('vozAtiva', e.target.checked)}
            className="h-4 w-4 accent-sinal"
          />
        </label>

        <label className="flex items-center justify-between border-t border-fio pt-4">
          <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            MODO SEGURANÇA
          </span>
          <input
            type="checkbox"
            checked={Boolean(cfg.modoSeguranca)}
            onChange={(e) => alterar('modoSeguranca', e.target.checked)}
            className="h-4 w-4 accent-sinal"
          />
        </label>
        <Dica>
          A abertura passa a falar do sistema de segurança em vez de listar os 25 comandos, e a Íris
          abre direto no painel. Nada é desligado — as ferramentas do dia a dia continuam
          respondendo se você pedir, só param de ocupar a tela.
        </Dica>

        <label className="flex items-center justify-between border-t border-fio pt-4">
          <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            CÂMERA (PRESENÇA)
          </span>
          <input
            type="checkbox"
            checked={Boolean(cfg.cameraAtiva)}
            onChange={(e) => alterar('cameraAtiva', e.target.checked)}
            className="h-4 w-4 accent-sinal"
          />
        </label>
        <Dica>
          Conta os rostos em frente à tela a cada 1,5s, dentro do seu PC. Nenhum frame é gravado e
          nada sai da máquina. Com a cadeira vazia, toda ação de risco médio passa a pedir
          confirmação; com alguém não cadastrado na frente, qualquer ação para e pergunta.
        </Dica>

        {Boolean(cfg.cameraAtiva) && (
          <Dica>
            Cadastro de rostos autorizados fica no painel de segurança — peça &ldquo;abre a
            segurança&rdquo; pra Íris, ou diga &ldquo;cadastra meu rosto como …&rdquo;.
          </Dica>
        )}

        <div>
          <Rotulo id="vozRitmo" salvo={salvo}>
            RITMO DA VOZ — {String(cfg.vozRitmo)}
          </Rotulo>
          <input
            type="range"
            min={-10}
            max={10}
            value={Number(cfg.vozRitmo)}
            onChange={(e) => alterar('vozRitmo', Number(e.target.value))}
            className="w-full accent-sinal"
          />
          {/* A faixa é a do SAPI, não um multiplicador: 0 é a velocidade
              natural da voz, e ela vale já na frase seguinte. */}
          <Dica>0 é a velocidade natural. Negativo devagar, positivo rápido.</Dica>
        </div>

        {/*
          Um interruptor por gatilho, e o que se GRAVA é a lista dos
          desligados. Gravar os ligados faria todo gatilho novo nascer calado,
          porque o nome dele não estaria na lista antiga.
        */}
        {gatilhos.length > 0 && (
          <div className="border-t border-fio pt-4">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
                GATILHOS
              </span>
              {salvo === 'gatilhosDesligados' && (
                <span className="font-mono text-[10px] text-ok">salvo</span>
              )}
            </div>

            {gatilhos.map((nome) => {
              const desligados = (cfg.gatilhosDesligados as string[]) ?? []
              const ligado = !desligados.includes(nome)
              return (
                <label key={nome} className="flex items-center justify-between py-1.5">
                  <span className="font-mono text-[13px] text-tinta-2">{nome}</span>
                  <input
                    type="checkbox"
                    checked={ligado}
                    onChange={() =>
                      alterar(
                        'gatilhosDesligados',
                        ligado ? [...desligados, nome] : desligados.filter((g) => g !== nome)
                      )
                    }
                    className="h-4 w-4 accent-sinal"
                  />
                </label>
              )
            })}
            <Dica>
              Desmarcado para de verificar na hora, sem reiniciar. Útil antes de uma apresentação —
              o pior momento pra um aviso de disco é aquele.
            </Dica>
          </div>
        )}
      </div>
    </div>
  )
}

function Rotulo({
  id,
  salvo,
  children
}: {
  id: string
  salvo: string
  children: ReactNode
}): JSX.Element {
  return (
    <div className="mb-1.5 flex items-baseline justify-between">
      <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
        {children}
      </span>
      {salvo === id && <span className="font-mono text-[10px] text-ok">salvo</span>}
    </div>
  )
}

function Dica({ children }: { children: ReactNode }): JSX.Element {
  return <p className="mt-1.5 text-[11px] leading-[1.5] text-tinta-3">{children}</p>
}

function Campo({
  id,
  rotulo,
  cfg,
  salvo,
  alterar,
  dica,
  converter,
  exibir
}: {
  id: string
  rotulo: string
  cfg: Cfg
  salvo: string
  alterar: (chave: string, valor: unknown) => void
  dica?: string
  converter?: (texto: string) => unknown
  exibir?: (valor: unknown) => string
}): JSX.Element {
  const atual = exibir ? exibir(cfg[id]) : String(cfg[id] ?? '')

  return (
    <label className="block">
      <Rotulo id={id} salvo={salvo}>
        {rotulo}
      </Rotulo>
      <input
        /*
          key={atual} força o React a recriar o input quando o valor salvo
          muda por fora — sem isso o defaultValue congela no primeiro render e
          a chave mascarada nunca aparece depois de você colar uma nova.
        */
        key={atual}
        defaultValue={atual}
        onBlur={(e) => {
          if (e.target.value === atual) return
          alterar(id, converter ? converter(e.target.value) : e.target.value)
        }}
        className="w-full border border-fio bg-sulco px-3 py-2 font-mono text-[13px] text-tinta outline-none transition-colors focus:border-sinal"
      />
      {dica && <Dica>{dica}</Dica>}
    </label>
  )
}

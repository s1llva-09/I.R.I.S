import { useEffect, useState, type JSX, type ReactNode } from 'react'
import { Escudo, Seta } from './icones'

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

export default function Config({
  aoFechar,
  aoSeguranca
}: {
  aoFechar: () => void
  aoSeguranca: () => void
}): JSX.Element {
  const [cfg, setCfg] = useState<Cfg | null>(null)
  const [gatilhos, setGatilhos] = useState<string[]>([])
  const [salvo, setSalvo] = useState('')
  const [erro, setErro] = useState('')

  useEffect(() => {
    window.api.config.ler().then(setCfg)
    // A lista vem do main: os gatilhos que existem de verdade, não uma cópia
    // escrita aqui que envelhece no primeiro gatilho novo.
    window.api.config.gatilhos().then(setGatilhos)
  }, [])

  async function alterar(chave: string, valor: unknown): Promise<void> {
    try {
      if (!(await window.api.config.gravar(chave, valor)))
        throw new Error('Valor inválido. Confira a configuração antes de salvar.')
      setCfg((c) => c && { ...c, [chave]: valor })
      setSalvo(chave)
      setErro('')
      setTimeout(() => setSalvo(''), 1500)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar a configuração.')
    }
  }

  if (!cfg) {
    return (
      <div className="absolute inset-0 z-40 bg-fundo px-6 py-5 font-sans text-[12px] text-tinta-3">
        Carregando configurações…
      </div>
    )
  }

  const semChave = !cfg.llmChave

  return (
    <div className="settings-page absolute inset-0 z-40 overflow-y-auto px-7 py-7">
      <div className="mx-auto max-w-lg space-y-6 pb-10">
        <div className="settings-heading flex items-center justify-between border-b border-fio pb-5">
          <div>
            <h2 className="font-mono text-[12px] font-semibold text-sinal">Configurações</h2>
            <p>Ajustes do assistente e preferências deste dispositivo.</p>
          </div>
          <button
            onClick={aoFechar}
            className="font-sans text-[12px] text-tinta-3 transition-colors hover:text-tinta"
          >
            Fechar
          </button>
        </div>
        {erro && <p role="alert">{erro}</p>}

        <div className="settings-layout">
          <aside className="settings-index">
            <nav aria-label="Seções das configurações">
              {[
                ['ajustes-conexao', 'Conexão e modelos'],
                ['ajustes-uso', 'Uso e segurança'],
                ['ajustes-voz', 'Voz'],
                ...(gatilhos.length ? [['ajustes-avisos', 'Avisos automáticos']] : [])
              ].map(([id, titulo]) => (
                <button
                  key={id}
                  onClick={() => document.getElementById(id)?.scrollIntoView({ block: 'start' })}
                >
                  {titulo}
                </button>
              ))}
            </nav>
            <button className="settings-security-link" onClick={aoSeguranca}>
              <Escudo width={25} height={25} />
              <span>
                <strong>Central de segurança</strong>
                <small>Câmeras, reconhecimento e atividade do ambiente</small>
              </span>
              <Seta />
            </button>
            <p>Campos de texto são salvos ao sair deles.</p>
          </aside>
          <div className="settings-sections">
            {/*
          O aviso existe porque a tela abre SOZINHA no primeiro boot, e sem
          uma linha explicando por quê ela parece um painel que apareceu do
          nada. Some assim que a chave entra.
        */}
            {semChave && (
              <p className="border-l border-sinal pl-4 text-[13px] leading-[1.65] text-tinta-2">
                Para usar o assistente, insira sua chave da OpenRouter. Ela pode ser criada em{' '}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                  openrouter.ai/keys
                </a>{' '}
                e será armazenada com criptografia neste computador.
              </p>
            )}
            <section
              className="settings-group"
              id="ajustes-conexao"
              aria-labelledby="ajustes-conexao-titulo"
            >
              <div className="settings-group-heading">
                <h3 id="ajustes-conexao-titulo">Conexão e modelos</h3>
                <p>Serviços usados para consultas, comandos e análise de imagens.</p>
              </div>
              <div className="settings-group-fields">
                <Campo
                  id="llmChave"
                  rotulo="Chave OpenRouter"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="Armazenada com a proteção de credenciais do sistema operacional."
                />
                <Campo
                  id="llmModelo"
                  rotulo="Modelo principal"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                />
                <Campo
                  id="llmModeloVisao"
                  rotulo="Modelo com visão"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="Usado para analisar capturas de tela. Escolha um modelo que aceite imagens."
                />
                <Campo
                  id="tavilyChave"
                  rotulo="Chave Tavily"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="Opcional. Habilita a busca na web pelo serviço Tavily."
                />
                <Campo
                  id="estoqueUrl"
                  rotulo="Site do estoque"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="Opcional. Endereço do estoque-iris, como http://127.0.0.1:5000."
                />
                <Campo
                  id="estoqueToken"
                  rotulo="Token do estoque"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="O mesmo valor de IRIS_API_TOKEN no site do estoque."
                />
                {/*
          Lista virando texto separado por vírgula, e não um editor de itens:
          são duas ou três strings que mudam uma vez por semestre.
        */}
                <Campo
                  id="llmReservas"
                  rotulo="Modelos de reserva"
                  cfg={cfg}
                  salvo={salvo}
                  dica="Separe os modelos por vírgula. Todos devem aceitar chamadas de ferramentas."
                  converter={(t) =>
                    t
                      .split(',')
                      .map((m) => m.trim())
                      .filter(Boolean)
                  }
                  exibir={(v) => (Array.isArray(v) ? v.join(', ') : String(v ?? ''))}
                  alterar={alterar}
                />
              </div>
            </section>
            <section
              className="settings-group"
              id="ajustes-uso"
              aria-labelledby="ajustes-uso-titulo"
            >
              <div className="settings-group-heading">
                <h3 id="ajustes-uso-titulo">Uso e segurança</h3>
                <p>Limites de solicitações, confirmações e abertura do aplicativo.</p>
              </div>
              <div className="settings-group-fields">
                <Campo
                  id="atalho"
                  rotulo="Atalho global"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  dica="Exemplos: Control+Space ou Alt+Space. Atalhos inválidos usam Control+Space."
                />
                <Campo
                  id="tetoDiario"
                  rotulo="Limite diário de solicitações"
                  cfg={cfg}
                  salvo={salvo}
                  alterar={alterar}
                  converter={Number}
                  dica="Use um valor abaixo da cota do provedor, pois novas tentativas também podem consumir solicitações."
                />
                <div>
                  <Rotulo id="limiarRisco" salvo={salvo}>
                    Limiar de risco · {String(cfg.limiarRisco)}
                  </Rotulo>
                  <input
                    id="limiarRisco"
                    aria-labelledby="rotulo-limiarRisco"
                    type="range"
                    min={1}
                    max={6}
                    value={Number(cfg.limiarRisco)}
                    onChange={(e) => alterar('limiarRisco', Number(e.target.value))}
                    className="w-full accent-sinal"
                  />
                  <Dica>
                    Valores menores exigem mais confirmações. Ações irreversíveis continuam sujeitas
                    à aprovação, independentemente deste ajuste.
                  </Dica>
                </div>
                <label className="flex items-center justify-between border-t border-fio pt-4">
                  <span className="font-sans text-[12px] text-tinta-3">
                    Abrir na central de segurança
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg.modoSeguranca)}
                    onChange={(e) => alterar('modoSeguranca', e.target.checked)}
                    className="h-4 w-4 accent-sinal"
                  />
                </label>
                <Dica>
                  Escolha a tela inicial da próxima abertura. A câmera continua sendo ativada e
                  pausada pela central de segurança.
                </Dica>
              </div>
            </section>
            <section
              className="settings-group"
              id="ajustes-voz"
              aria-labelledby="ajustes-voz-titulo"
            >
              <div className="settings-group-heading">
                <h3 id="ajustes-voz-titulo">Voz</h3>
                <p>Ative as respostas em áudio e ajuste a velocidade da fala.</p>
              </div>
              <div className="settings-group-fields">
                <label className="flex items-center justify-between border-t border-fio pt-4">
                  <span className="font-sans text-[12px] text-tinta-3">Respostas por voz</span>
                  <input
                    type="checkbox"
                    checked={Boolean(cfg.vozAtiva)}
                    onChange={(e) => alterar('vozAtiva', e.target.checked)}
                    className="h-4 w-4 accent-sinal"
                  />
                </label>
                <div>
                  <Rotulo id="vozRitmo" salvo={salvo}>
                    Velocidade da voz · {String(cfg.vozRitmo)}
                  </Rotulo>
                  <input
                    id="vozRitmo"
                    aria-labelledby="rotulo-vozRitmo"
                    type="range"
                    min={-10}
                    max={10}
                    value={Number(cfg.vozRitmo)}
                    onChange={(e) => alterar('vozRitmo', Number(e.target.value))}
                    className="w-full accent-sinal"
                  />
                  {/* A faixa é a do SAPI, não um multiplicador: 0 é a velocidade
              natural da voz, e ela vale já na frase seguinte. */}
                  <Dica>
                    Zero usa a velocidade natural. Valores negativos reduzem o ritmo; positivos
                    aumentam.
                  </Dica>
                </div>
              </div>
            </section>
            <section className="settings-group" id="ajustes-avisos" aria-label="Avisos automáticos">
              {/*
          Um interruptor por gatilho, e o que se GRAVA é a lista dos
          desligados. Gravar os ligados faria todo gatilho novo nascer calado,
          porque o nome dele não estaria na lista antiga.
        */}
              {gatilhos.length > 0 && (
                <div className="settings-alerts">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3>Avisos automáticos</h3>
                    {salvo === 'gatilhosDesligados' && (
                      <span className="font-mono text-[11px] text-ok">salvo</span>
                    )}
                  </div>

                  {gatilhos.map((nome) => {
                    const desligados = (cfg.gatilhosDesligados as string[]) ?? []
                    const ligado = !desligados.includes(nome)
                    return (
                      <label key={nome} className="flex items-center justify-between py-1.5">
                        <span className="font-sans text-[13px] text-tinta-2">
                          {nome.replaceAll('_', ' ')}
                        </span>
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
                    Desative um aviso para interromper sua verificação imediatamente, sem reiniciar
                    o aplicativo.
                  </Dica>
                </div>
              )}
            </section>
          </div>
        </div>
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
      <label htmlFor={id} id={`rotulo-${id}`} className="font-sans text-[12px] text-tinta-3">
        {children}
      </label>
      {salvo === id && <span className="font-mono text-[11px] text-ok">salvo</span>}
    </div>
  )
}

function Dica({ children, id }: { children: ReactNode; id?: string }): JSX.Element {
  return (
    <p id={id} className="mt-1.5 text-[12px] leading-[1.5] text-tinta-3">
      {children}
    </p>
  )
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
    <div className="settings-field">
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
        id={id}
        aria-labelledby={`rotulo-${id}`}
        aria-describedby={dica ? `dica-${id}` : undefined}
        defaultValue={atual}
        onBlur={(e) => {
          if (e.target.value === atual) return
          alterar(id, converter ? converter(e.target.value) : e.target.value)
        }}
        className="w-full border border-fio bg-sulco px-3 py-2 font-mono text-[13px] text-tinta outline-none transition-colors focus:border-sinal"
      />
      {dica && <Dica id={`dica-${id}`}>{dica}</Dica>}
    </div>
  )
}

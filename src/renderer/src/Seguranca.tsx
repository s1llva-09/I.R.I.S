import { useEffect, useState, type JSX } from 'react'
import Visor from './Visor'
import {
  capturarDescritor,
  definirFonteTeste,
  definirGaleria,
  aoMudarCameras,
  definirLimiar,
  listarCameras,
  medirReconhecimento,
  pararQuadros,
  temFonteTeste,
  type Medicao,
  type Leitura
} from './presenca'

/**
 * PAINEL DE SEGURANÇA (2.6).
 *
 * Existe porque as funções de segurança estavam em Ajustes, atrás de dois
 * cliques, junto de ritmo da voz e atalho de teclado. Segurança escondida
 * numa tela de preferências é segurança que ninguém abre — e a hora em que
 * você quer ver quem está na sala é a hora em que você NÃO quer caçar menu.
 *
 * Abre por voz (`seguranca`), e é uma tela só: quem está sendo visto agora,
 * quem está autorizado, o que disparou alarme, e por que a Íris parou.
 */

type Painel = {
  rostos: { nome: string; criado_em: string }[]
  alarmes: { id: number; momento: string; resultado: string }[]
  decisoes: { id: number; momento: string; ferramenta: string; decisao: string }[]
}

const hora = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })

export default function Seguranca({
  visao,
  aoFechar,
  aoTrocarFonte
}: {
  visao: Leitura
  aoFechar: () => void
  /**
   * O laço do sensor vive no App e não relê nada sozinho. Trocar de câmera
   * ou pôr uma foto sem religar só valeria no próximo boot — e o seletor
   * pareceria quebrado, que é o pior tipo de bug de UI: o que faz a pessoa
   * duvidar da feature inteira.
   */
  aoTrocarFonte: () => void
}): JSX.Element {
  const [dados, setDados] = useState<Painel | null>(null)
  const [nome, setNome] = useState('')
  const [estado, setEstado] = useState('')
  const [cameras, setCameras] = useState<{ id: string; nome: string }[]>([])
  const [cameraId, setCameraId] = useState('')
  const [teste, setTeste] = useState(temFonteTeste())
  const [ligada, setLigada] = useState(false)
  const [limiar, setLimiar] = useState(0.6)
  const [medicao, setMedicao] = useState<Medicao[] | null>(null)
  const [medindo, setMedindo] = useState('')
  const [url, setUrl] = useState('')
  const [achadas, setAchadas] = useState<{ url: string; tipo: string }[]>([])
  const [qr, setQr] = useState('')

  const recarregar = (): void => {
    window.api.seguranca.painel().then(setDados)
    // A galeria em uso no laço também: sem isto o rosto recém-cadastrado
    // segue como desconhecido até o próximo boot, bem na hora da demo.
    window.api.rostos.galeria().then(definirGaleria)
  }

  useEffect(() => {
    recarregar()
    listarCameras().then(setCameras)

    // Plugar o cabo com o painel aberto é o caso normal de quem usa o
    // celular como webcam USB — a lista tem que acompanhar.
    const pararDispositivos = aoMudarCameras(() => listarCameras().then(setCameras))
    window.api.config.ler().then((c) => {
      setCameraId(String(c.cameraId ?? ''))
      setLigada(Boolean(c.cameraAtiva))
      setLimiar(Number(c.limiarFacial ?? 0.6))
    })

    return pararDispositivos
  }, [])

  const cadastrar = async (): Promise<void> => {
    if (!nome.trim()) return setEstado('dê um nome primeiro')
    setEstado('olhando…')
    const d = await capturarDescritor()
    if (typeof d === 'string') return setEstado(d)
    await window.api.rostos.cadastrar(nome.trim(), [...d])
    setNome('')
    setEstado('cadastrado')
    recarregar()
  }

  const alerta = visao.desconhecidos > 0

  return (
    <div
      className={`absolute inset-0 z-40 overflow-y-auto bg-fundo px-6 py-5 ${
        alerta ? 'alarme' : ''
      }`}
    >
      <div className="destravar mx-auto max-w-lg space-y-6 pb-10">
        <div className="flex items-baseline justify-between border-b border-fio pb-3">
          <h2
            className={`font-mono text-[12px] font-semibold tracking-[0.3em] uppercase ${
              alerta ? 'text-perigo' : 'text-sinal'
            }`}
          >
            Segurança
          </h2>
          <button
            onClick={aoFechar}
            className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase hover:text-tinta"
          >
            fechar
          </button>
        </div>

        {/* O VISOR primeiro, acima até do resumo em texto: quem abre esta
            tela quer VER a porta. O texto embaixo é pra quem só passou o
            olho, e pra quando a câmera está desligada. */}
        <Visor ativo={visao.rostos >= 0} alerta={alerta} />

        {/* AGORA — o que a câmera está vendo neste segundo. Primeiro de
            propósito: é a única linha da tela que responde "e agora?". */}
        <div className={`border-l-2 pl-4 ${alerta ? 'border-perigo' : 'border-fio-forte'}`}>
          <p className={`text-[15px] ${alerta ? 'text-perigo' : 'text-tinta'}`}>
            {visao.rostos < 0
              ? 'Câmera desligada'
              : visao.rostos === 0
                ? 'Ninguém em frente à câmera'
                : alerta
                  ? `${visao.desconhecidos} pessoa(s) NÃO CADASTRADA(S)`
                  : `${visao.conhecidos.join(', ')}`}
          </p>
          <p className="mt-1 font-hud text-[11px] tracking-[0.15em] text-tinta-3">
            {visao.rostos < 0
              ? 'ligue o sensor logo abaixo para começar'
              : alerta
                ? 'toda ação de risco está parando para pedir confirmação'
                : 'nenhum frame é gravado · nada sai desta máquina'}
          </p>
        </div>

        {/* FONTE — de onde vem a imagem. Fica aqui e não em Ajustes porque
            "qual câmera" é a primeira pergunta de quem tem duas, e a última
            que alguém vai procurar numa tela de preferências. */}
        <section className="space-y-2">
          <h3 className="regua font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            Fonte
          </h3>

          {/*
            O LIGA/DESLIGA mora aqui também.
            O painel dizia "ligue em ajustes" — mandando pra exatamente a
            tela que esta existe pra evitar. Quem abre a segurança com a
            câmera desligada quer ligar a câmera, não navegar.
          */}
          <label className="flex items-center justify-between border border-fio px-2 py-1">
            <span className="font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase">
              Sensor de presença
            </span>
            <input
              type="checkbox"
              checked={ligada}
              onChange={(e) => {
                setLigada(e.target.checked)
                window.api.config.gravar('cameraAtiva', e.target.checked)
                aoTrocarFonte()
              }}
              className="h-4 w-4 accent-sinal"
            />
          </label>

          <select
            value={cameraId}
            onChange={(e) => {
              setCameraId(e.target.value)
              // Grava E reinicia o laço: trocar de câmera sem religar só
              // valeria no próximo boot, e o seletor pareceria quebrado.
              window.api.config.gravar('cameraId', e.target.value)
              aoTrocarFonte()
            }}
            className="w-full border border-fio bg-fundo px-2 py-1 text-[13px] text-tinta"
          >
            <option value="">câmera padrão do sistema</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>

          {/*
            O CELULAR COMO CÂMERA, sem instalar nada.
            Primeiro na seção porque é o caminho que funciona de primeira:
            os outros dois dependem de app de terceiro configurado certo ou
            de hardware que ainda não existe.
          */}
          <button
            onClick={async () => {
              setEstado('subindo servidor…')
              const r = await window.api.camera.qr()
              if ('erro' in r) return setEstado(r.erro)
              setQr(r.qr)
              setUrl(r.url)
              setEstado('leia o QR com a câmera do celular')
              setTeste(true)
              aoTrocarFonte()
            }}
            className="w-full border border-fio px-3 py-2 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta"
          >
            Usar o celular como câmera
          </button>

          {qr && (
            <div className="colchetes flex flex-col items-center gap-2 bg-chapa p-3">
              {/* O SVG vem do main já pronto. `dangerouslySetInnerHTML` com
                  conteúdo que ESTE processo gerou a partir de uma URL que
                  ele mesmo montou — não há entrada de terceiro no caminho. */}
              <div className="[&_svg]:h-40 [&_svg]:w-40" dangerouslySetInnerHTML={{ __html: qr }} />
              <p className="text-center font-mono text-[11px] break-all text-tinta-3">{url}</p>
              <p className="text-center font-hud text-[11px] tracking-[0.15em] text-tinta-3">
                aponte a câmera do celular no QR. Vídeo ao vivo exige https — em http a página
                oferece foto, que basta pra cadastrar rosto. Pra vídeo contínuo, use um app que
                SIRVA a câmera no celular e o campo abaixo.
              </p>
            </div>
          )}

          {/* CÂMERA DA PORTA. Um stream MJPEG é um <img> que se atualiza, e o
              pipeline já aceita <img> — então a câmera do hardware entra pelo
              mesmo caminho da foto de teste, sem código novo. */}
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="http://192.168.0.50:81/stream  (câmera da porta)"
              className="min-w-0 flex-1 border border-fio bg-transparent px-2 py-1 text-[12px] text-tinta"
            />
            <button
              onClick={async () => {
                if (!url.trim()) return setEstado('digite o endereço que o app do celular mostra')
                setEstado('testando…')
                setEstado(await window.api.camera.testar(url))
              }}
              className="border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta"
            >
              Testar
            </button>
            <button
              onClick={async () => {
                setEstado('procurando na rede…')
                setAchadas([])
                const r = await window.api.camera.procurar()
                setAchadas(r)
                setEstado(
                  r.length
                    ? `${r.length} fonte(s) de imagem na rede`
                    : 'não achei câmera na rede — o app do celular está aberto e na mesma Wi-Fi?'
                )
                // Preenche a melhor: MJPEG vem primeiro do main, então a
                // primeira da lista é a que dá vídeo contínuo.
                if (r[0]) setUrl(r[0].url)
              }}
              className="border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta"
            >
              Procurar
            </button>
            <button
              onClick={async () => {
                if (!url.trim()) {
                  await window.api.camera.desconectar()
                  pararQuadros()
                  setEstado('câmera de rede desligada')
                  setTeste(temFonteTeste())
                  return aoTrocarFonte()
                }

                setEstado('conectando…')
                await window.api.camera.conectar(url)
                setTeste(true)
                aoTrocarFonte()

                /**
                 * O veredito vem do MAIN, depois de 5s. Dizer "conectado" na
                 * hora seria mentir: o `conectar` só dispara o pedido, e
                 * quem sabe se chegou quadro é quem está lendo o socket.
                 */
                setTimeout(async () => {
                  const erro = await window.api.camera.erro()
                  setEstado(erro || 'recebendo quadros')
                }, 5000)
              }}
              className="border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta"
            >
              Conectar
            </button>
          </div>

          <div className="flex items-center gap-2">
            <label className="cursor-pointer border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta">
              Usar foto
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0] ?? null
                  const erro = await definirFonteTeste(f)
                  setEstado(erro)
                  setTeste(temFonteTeste())
                  aoTrocarFonte()
                }}
              />
            </label>
            {teste && (
              <button
                onClick={async () => {
                  await definirFonteTeste(null)
                  setTeste(false)
                  aoTrocarFonte()
                }}
                className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase hover:text-tinta"
              >
                voltar pra câmera
              </button>
            )}
          </div>

          {/* As outras candidatas, se houver mais de uma: com celular e
              notebook servindo imagem ao mesmo tempo, adivinhar qual é a da
              porta seria chute — quem sabe é você. */}
          {achadas.length > 1 &&
            achadas.map((a) => (
              <button
                key={a.url}
                onClick={() => setUrl(a.url)}
                className={`block w-full text-left font-mono text-[12px] ${
                  a.url === url ? 'text-sinal' : 'text-tinta-3 hover:text-tinta-2'
                }`}
              >
                {a.url} <span className="font-hud">· {a.tipo}</span>
              </button>
            ))}

          <p className="font-hud text-[11px] leading-relaxed tracking-[0.15em] text-tinta-3">
            {teste
              ? 'LENDO DE UMA FOTO — o reconhecimento, o alarme e a escalada de risco correm pelo mesmo caminho da câmera'
              : 'sem webcam? uma foto passa pelo mesmo caminho e dá a mesma resposta toda vez'}
          </p>
        </section>

        {/* CADASTRO — o consentimento acontece aqui, então a data e o apagar
            ficam juntos. Base biométrica sem saída não tem consentimento. */}
        <section className="space-y-2">
          <h3 className="regua font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            Autorizados
          </h3>
          <div className="flex gap-2">
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && cadastrar()}
              placeholder="nome de quem está na frente da câmera"
              className="min-w-0 flex-1 border border-fio bg-transparent px-2 py-1 text-[13px] text-tinta"
            />
            <button
              onClick={cadastrar}
              className="border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta"
            >
              Cadastrar
            </button>
          </div>
          {estado && <p className="font-hud text-[11px] text-tinta-3">{estado}</p>}

          {dados?.rostos.length ? (
            dados.rostos.map((r) => (
              <div
                key={r.nome}
                className="flex items-center justify-between border-b border-fio py-1 text-[13px] text-tinta-2"
              >
                <span>
                  {r.nome}
                  <span className="ml-2 text-tinta-3">
                    desde {new Date(r.criado_em).toLocaleDateString('pt-BR')}
                  </span>
                </span>
                <button
                  onClick={() => window.api.rostos.esquecer(r.nome).then(recarregar)}
                  className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase hover:text-perigo"
                >
                  apagar
                </button>
              </div>
            ))
          ) : (
            <p className="text-[13px] text-tinta-3">
              Ninguém cadastrado — o alarme fica inativo até existir alguém pra comparar.
            </p>
          )}
        </section>

        {/* PRECISÃO — o número que falta pra 2.6 deixar de ser "funciona".
            Fica no painel e não num script à parte porque os modelos e a
            galeria já estão carregados aqui: rodar por fora significaria
            montar tudo de novo num processo sem DOM. */}
        <section className="space-y-2">
          <h3 className="regua font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            Precisão
          </h3>

          <div className="flex items-center gap-3">
            <label className="cursor-pointer border border-fio px-3 py-1 font-hud text-[11px] tracking-[0.2em] text-tinta-2 uppercase hover:text-tinta">
              Medir com fotos
              <input
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={async (e) => {
                  const fs = [...(e.target.files ?? [])]
                  if (!fs.length) return
                  setMedicao(null)
                  const r = await medirReconhecimento(fs, (f, t) => setMedindo(`lendo ${f}/${t}…`))
                  setMedindo(
                    r.semRosto.length ? `${r.semRosto.length} foto(s) sem rosto detectado` : ''
                  )
                  setMedicao(r.medicoes)
                  const onde = await window.api.seguranca.salvarMedicao({
                    quando: new Date().toISOString(),
                    cadastrados: r.cadastrados,
                    semRosto: r.semRosto,
                    medicoes: r.medicoes
                  })
                  setMedindo((m) => `${m}${m ? ' · ' : ''}salvo em ${onde.split(/[\\/]/).pop()}`)
                }}
              />
            </label>

            <span className="font-hud text-[11px] tracking-[0.15em] text-tinta-3">
              limiar {limiar.toFixed(2)}
            </span>
            <input
              type="range"
              min={0.4}
              max={0.8}
              step={0.05}
              value={limiar}
              onChange={(e) => {
                const v = Number(e.target.value)
                setLimiar(v)
                definirLimiar(v)
                window.api.config.gravar('limiarFacial', v)
              }}
              className="flex-1 accent-sinal"
            />
          </div>

          <p className="font-hud text-[11px] leading-relaxed tracking-[0.15em] text-tinta-3">
            {medindo ||
              'nomeie as fotos com quem está nelas: pablo_01.jpg, joao_02.jpg, estranho_01.jpg'}
          </p>

          {medicao && (
            <table className="w-full text-[12px] tabular-nums">
              <thead>
                <tr className="font-hud text-[10px] tracking-[0.15em] text-tinta-3 uppercase">
                  <td className="py-1">limiar</td>
                  <td>acertos</td>
                  <td title="estranho reconhecido como autorizado — o erro grave">falso aceite</td>
                  <td title="autorizado tratado como estranho">falso rejeite</td>
                </tr>
              </thead>
              <tbody>
                {medicao.map((m) => (
                  <tr
                    key={m.limiar}
                    className={`border-t border-fio ${
                      Math.abs(m.limiar - limiar) < 0.001 ? 'text-sinal' : 'text-tinta-2'
                    }`}
                  >
                    <td className="py-1">{m.limiar.toFixed(2)}</td>
                    <td>
                      {m.acertos}/{m.total}
                    </td>
                    <td className={m.falsoAceite ? 'text-perigo' : ''}>{m.falsoAceite}</td>
                    <td>{m.falsoRejeite}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="space-y-1">
          <h3 className="regua font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            Alarmes
          </h3>
          {dados?.alarmes.length ? (
            dados.alarmes.map((a) => (
              <p key={a.id} className="text-[13px] text-tinta-2">
                <span className="mr-2 font-hud text-[11px] text-tinta-3">{hora(a.momento)}</span>
                {a.resultado}
              </p>
            ))
          ) : (
            <p className="text-[13px] text-tinta-3">Nenhum alarme registrado.</p>
          )}
        </section>

        {/* AUDITORIA — a conta de cada recusa, com os pesos daquele momento.
            É o Art. 20 da LGPD virando tela em vez de promessa. */}
        <section className="space-y-2">
          <h3 className="regua font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
            Por que parei
          </h3>
          {dados?.decisoes.length ? (
            dados.decisoes.map((d) => {
              const a = JSON.parse(d.decisao) as Avaliacao
              return (
                <div key={d.id} className="border-b border-fio pb-2 text-[13px]">
                  <p className="text-tinta-2">
                    <span className="mr-2 font-hud text-[11px] text-tinta-3">
                      {hora(d.momento)}
                    </span>
                    {d.ferramenta}
                  </p>
                  <p className="mt-0.5 font-mono text-[11px] text-tinta-3">
                    nível {a.nivel}
                    {(a.sinais ?? []).map((x, i) => (
                      <span key={i} className={x.peso > 0 ? 'text-sinal' : 'text-ok'}>
                        {' '}
                        {x.peso >= 0 ? '+' : ''}
                        {x.peso} {x.sinal}
                      </span>
                    ))}{' '}
                    = {a.escore} (limiar {a.limiar})
                  </p>
                </div>
              )
            })
          ) : (
            <p className="text-[13px] text-tinta-3">Nenhuma decisão de risco registrada ainda.</p>
          )}
        </section>
      </div>
    </div>
  )
}

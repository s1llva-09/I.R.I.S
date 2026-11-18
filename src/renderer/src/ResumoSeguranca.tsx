import { useEffect, useState, type CSSProperties, type JSX } from 'react'

// Os tipos vêm da ponte do preload, como no resto do renderer.
type EstadoVigilancia = Awaited<ReturnType<typeof window.api.vigilancia.estado>>
type CameraPainel = Awaited<ReturnType<typeof window.api.central.listar>>[number]

/**
 * VISÃO GERAL da central: a primeira leitura responde "está protegido, as
 * câmeras estão vendo, aconteceu alguma coisa?" antes de qualquer controle.
 *
 * Todo número sai de uma fonte real (vigilância, câmeras do mosaico,
 * cadastro facial). Enquanto a fonte não respondeu, o valor é "—", nunca um
 * zero que pareceria "está tudo calmo".
 */

/** O mesmo critério do painel do celular: mais velho que isto não é transmissão. */
const SINAL_VALIDO = 6000
const DIA = 86_400_000

type Tom = 'ok' | 'atencao' | 'perigo' | 'neutro'

function haQuanto(momento: number, agora: number): string {
  const min = Math.round((agora - momento) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `há ${h} h`
  return new Date(momento).toLocaleDateString('pt-BR')
}

const MODO: Record<EstadoVigilancia['modo'], { valor: string; tom: Tom }> = {
  armado: { valor: 'Armada', tom: 'ok' },
  preparando: { valor: 'Preparando', tom: 'atencao' },
  erro: { valor: 'Com falha', tom: 'perigo' },
  desarmado: { valor: 'Desarmada', tom: 'neutro' }
}

export default function ResumoSeguranca(): JSX.Element {
  const [vigilancia, setVigilancia] = useState<EstadoVigilancia | null>(null)
  const [cameras, setCameras] = useState<CameraPainel[] | null>(null)
  const [autorizados, setAutorizados] = useState<number | null>(null)
  const [agora, setAgora] = useState(() => Date.now())

  useEffect(() => {
    let vivo = true
    const ler = async (): Promise<void> => {
      // Cada fonte separada: uma que falha mostra "—" sem apagar as outras.
      const [v, c, r] = await Promise.allSettled([
        window.api.vigilancia.estado(),
        window.api.central.listar(),
        window.api.rostos.lista()
      ])
      if (!vivo) return
      setVigilancia(v.status === 'fulfilled' ? v.value : null)
      setCameras(c.status === 'fulfilled' ? c.value : null)
      setAutorizados(r.status === 'fulfilled' ? r.value.length : null)
      setAgora(Date.now())
    }
    void ler()
    const id = window.setInterval(() => void ler(), 5000)
    return () => {
      vivo = false
      window.clearInterval(id)
    }
  }, [])

  const modo = vigilancia ? MODO[vigilancia.modo] : null
  const agenda = vigilancia?.ajustes.agenda
  const transmitindo = cameras?.filter(
    (c) => c.ligada && !c.foto && c.ultimoQuadro !== null && agora - c.ultimoQuadro < SINAL_VALIDO
  ).length
  const alertas = vigilancia?.eventos.filter((e) => e.tipo === 'pessoa' && agora - e.momento < DIA)
  const ultimo = vigilancia?.eventos[0]

  const blocos: { rotulo: string; valor: string; detalhe: string; tom: Tom }[] = [
    {
      rotulo: 'Proteção',
      valor: modo?.valor ?? '—',
      detalhe:
        vigilancia?.modo === 'erro' && vigilancia.erro
          ? vigilancia.erro
          : agenda?.ativa
            ? `Agenda das ${agenda.inicio} às ${agenda.fim}`
            : 'Sem agenda automática',
      tom: modo?.tom ?? 'neutro'
    },
    {
      rotulo: 'Câmeras transmitindo',
      valor: cameras ? `${transmitindo}/${cameras.length}` : '—',
      detalhe: !cameras
        ? 'Sem leitura das câmeras'
        : !cameras.length
          ? 'Nenhuma câmera cadastrada'
          : transmitindo === cameras.length
            ? 'Todas com imagem ao vivo'
            : `${cameras.length - (transmitindo ?? 0)} sem imagem ao vivo agora`,
      tom: !cameras?.length ? 'neutro' : transmitindo === cameras.length ? 'ok' : 'atencao'
    },
    {
      rotulo: 'Alertas em 24 h',
      valor: alertas ? String(alertas.length) : '—',
      detalhe: !alertas
        ? 'Sem leitura da vigilância'
        : alertas.length
          ? `Último ${haQuanto(alertas[0].momento, agora)}`
          : 'Nenhuma ocorrência',
      tom: alertas?.length ? 'perigo' : 'neutro'
    },
    {
      rotulo: 'Último evento',
      valor: ultimo ? haQuanto(ultimo.momento, agora) : vigilancia ? 'Nenhum' : '—',
      detalhe: ultimo ? `${ultimo.camera} · ${ultimo.texto}` : 'Nenhum evento registrado',
      tom: 'neutro'
    },
    {
      rotulo: 'Pessoas autorizadas',
      valor: autorizados === null ? '—' : String(autorizados),
      detalhe: 'No cadastro facial',
      tom: 'neutro'
    }
  ]

  return (
    <section className="resumo-seguranca" aria-label="Visão geral da segurança">
      <dl>
        {blocos.map((b, i) => (
          <div
            key={b.rotulo}
            className={`resumo-bloco tom-${b.tom}`}
            style={{ '--i': i } as CSSProperties}
          >
            <dt>{b.rotulo}</dt>
            <dd>
              <strong>{b.valor}</strong>
              <span title={b.detalhe}>{b.detalhe}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

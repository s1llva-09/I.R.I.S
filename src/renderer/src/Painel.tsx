import type { JSX } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'

/**
 * Desenha um Visual. O tipo vem de src/tipos.d.ts (global) — este arquivo
 * não define nada, senão as duas cópias saem de sincronia.
 *
 * A ferramenta é quem decide o formato: 'tipo' escolhe o desenho e
 * eixoX/eixoY dizem quais campos ler. Nada aqui é específico de ferramenta.
 *
 * O registro é o mesmo do resto do app: chapa fosca, fio de cabelo, número
 * em monoespaçado tabular. O dado é a tinta; a moldura é quase invisível.
 */

// Espelham os tokens do main.css. O recharts pinta em SVG por prop, não por
// classe, então não dá pra usar as variáveis do tema aqui — se mexer lá,
// mexa aqui. É a única duplicação de cor do projeto.
const SINAL = '#e8a33d'
const HUD = '#5bc8e8'
const FIO = 'rgba(234,242,246,0.10)'
const TINTA = '#eaf2f6'
const TINTA_3 = '#6d7f8b'

/**
 * Série categórica na ordem do Mark III: o BRANCO vem primeiro.
 *
 * A série principal é o traço branco do capacete; âmbar e cyan entram como
 * acento nas seguintes. Começar pelo âmbar faria a cor de "crítico" pintar
 * a primeira barra de todo gráfico — e aí ela não significa mais nada.
 */
const CORES = [TINTA, SINAL, HUD, '#6fd39a', '#ff5646', '#9b8fd1']

// Eixo e grade recuam. O dado é que tem que aparecer, não a moldura.
const eixo = { fill: TINTA_3, fontSize: 10, fontFamily: 'Cascadia Mono, Consolas, monospace' }
const dica = {
  cursor: { fill: 'rgba(234,242,246,0.04)' },
  contentStyle: {
    background: '#0b1219',
    border: `1px solid rgba(234,242,246,0.22)`,
    borderRadius: 0,
    fontSize: 12,
    fontFamily: 'Cascadia Mono, Consolas, monospace',
    boxShadow: '0 8px 24px -8px rgba(0,0,0,0.85)'
  },
  labelStyle: { color: TINTA_3, fontSize: 10, letterSpacing: '0.12em' },
  itemStyle: { color: TINTA }
}

/** Legenda da pizza, no vocabulário da escada de cota: barra fina + rótulo. */
function Legenda({ v }: { v: Visual }): JSX.Element {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 px-4 pb-4">
      {v.dados.map((linha, i) => (
        <li key={i} className="flex items-center gap-2 font-mono text-[11px] text-tinta-2">
          <span className="h-3 w-[3px] shrink-0" style={{ background: CORES[i % CORES.length] }} />
          <span className="truncate">{String(linha[v.eixoX ?? ''] ?? '')}</span>
          <span className="tabular-nums text-tinta-3">{String(linha[v.eixoY ?? ''] ?? '')}</span>
        </li>
      ))}
    </ul>
  )
}

/** Cada entrada recebe o Visual inteiro e devolve o desenho. */
const DESENHOS: Record<Visual['tipo'], (v: Visual) => JSX.Element> = {
  barra: (v) => (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={v.dados} margin={{ top: 14, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke={FIO} vertical={false} />
        {/* Nome de arquivo é longo. interval={0} força TODOS os rótulos
            (o recharts esconde metade quando aperta), a inclinação dá espaço
            e o corte em 16 evita que um nome gigante coma o gráfico.
            O nome inteiro continua no tooltip. */}
        <XAxis
          dataKey={v.eixoX}
          interval={0}
          angle={-35}
          textAnchor="end"
          height={70}
          tickFormatter={(t: string) => (t.length > 16 ? t.slice(0, 15) + '…' : t)}
          tick={eixo}
          axisLine={{ stroke: FIO }}
          tickLine={false}
        />
        <YAxis tick={eixo} axisLine={false} tickLine={false} width={46} />
        <Tooltip {...dica} />
        {/* Wireframe translúcido, não laje sólida: contorno de 1px com miolo
            a 18%. Sólido em branco vira o objeto mais pesado da tela e rouba
            o olho do texto — e é a barra que tem que ser lida, não gritada.
            Canto reto porque o mundo inteiro é ortogonal. */}
        <Bar
          dataKey={v.eixoY ?? ''}
          fill={TINTA}
          fillOpacity={0.18}
          stroke={TINTA}
          strokeWidth={1}
          maxBarSize={44}
        />
      </BarChart>
    </ResponsiveContainer>
  ),

  linha: (v) => (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={v.dados} margin={{ top: 14, right: 16, bottom: 8, left: 0 }}>
        <CartesianGrid stroke={FIO} vertical={false} />
        <XAxis dataKey={v.eixoX} tick={eixo} axisLine={{ stroke: FIO }} tickLine={false} />
        <YAxis tick={eixo} axisLine={false} tickLine={false} width={46} />
        <Tooltip {...dica} cursor={{ stroke: TINTA_3, strokeWidth: 1 }} />
        {/* type="linear" e não "monotone": curva suave inventa valor entre
            dois pontos medidos. Instrumento liga os pontos que leu. */}
        <Line
          type="linear"
          dataKey={v.eixoY ?? ''}
          stroke={TINTA}
          strokeWidth={1.5}
          dot={{ r: 2, fill: TINTA, strokeWidth: 0 }}
          activeDot={{ r: 3.5 }}
        />
      </LineChart>
    </ResponsiveContainer>
  ),

  pizza: (v) => (
    <>
      <ResponsiveContainer width="100%" height={230}>
        <PieChart>
          {/* Sem 'label': os rótulos padrão do recharts saem em cinza claro,
              fora da grade e por cima uns dos outros. A legenda embaixo lê
              melhor e ainda mostra o valor. */}
          <Pie
            data={v.dados}
            dataKey={v.eixoY ?? ''}
            nameKey={v.eixoX}
            outerRadius={92}
            innerRadius={52}
            paddingAngle={1}
            stroke="#0b1219"
            strokeWidth={1}
          >
            {v.dados.map((_, i) => (
              <Cell key={i} fill={CORES[i % CORES.length]} />
            ))}
          </Pie>
          <Tooltip {...dica} cursor={false} />
        </PieChart>
      </ResponsiveContainer>
      <Legenda v={v} />
    </>
  ),

  /**
   * Não é o número gigante com rótulo pequeno embaixo. É a tabela de campos
   * de uma página de manual: rótulo à esquerda, valor alinhado à direita em
   * tabular, um fio entre as linhas. Lê-se de cima pra baixo e os valores
   * ficam em coluna, que é o que permite comparar de relance.
   */
  kpi: (v) => (
    <dl className="px-4 py-1">
      {Object.entries(v.dados[0] ?? {}).map(([rotulo, valor]) => (
        <div
          key={rotulo}
          className="flex items-baseline justify-between gap-6 border-b border-fio py-2.5 last:border-b-0"
        >
          <dt className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">{rotulo}</dt>
          <dd className="font-mono text-[15px] tabular-nums text-tinta">{String(valor)}</dd>
        </div>
      ))}
    </dl>
  ),

  // Colunas saem das chaves da primeira linha — a ferramenta decide o shape.
  // max-h + scroll: 50 linhas empurrariam o campo de texto pra fora da tela.
  tabela: (v) => {
    const colunas = Object.keys(v.dados[0] ?? {})
    return (
      <div className="max-h-72 overflow-auto">
        <table className="w-full text-left text-[13px]">
          <thead className="sticky top-0 bg-chapa">
            <tr>
              {colunas.map((c) => (
                <th
                  key={c}
                  className="border-b border-fio px-4 py-2 font-hud text-[11px] font-normal tracking-[0.2em] text-tinta-3 uppercase"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {v.dados.map((linha, i) => (
              <tr key={i} className="border-b border-fio last:border-b-0 hover:bg-white/[0.02]">
                {colunas.map((c) => {
                  const valor = linha[c]
                  return (
                    <td
                      key={c}
                      className={`px-4 py-1.5 text-tinta-2 select-text ${
                        typeof valor === 'number' ? 'font-mono tabular-nums' : ''
                      }`}
                    >
                      {String(valor ?? '')}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
}

export default function Painel({ visual }: { visual: Visual }): JSX.Element {
  // Fallback pro caso do 'tipo' vir fora do union — o modelo não escolhe
  // esse campo (a ferramenta escolhe), mas um typo no executor renderizaria
  // em branco sem avisar. Melhor mostrar o dado cru.
  const desenhar = DESENHOS[visual.tipo]

  return (
    // colchetes + destravar: o painel de dado NASCE na tela, então é ele que
    // recebe a mecânica de "exploded keyhole" do filme. A moldura é de canto
    // e não caixa fechada — mira, não card.
    <figure className="colchetes destravar mt-1 mb-4 max-w-[72ch] bg-chapa/70 p-px">
      <figcaption className="border-b border-fio px-4 py-2 font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
        {visual.titulo}
      </figcaption>
      {desenhar ? (
        desenhar(visual)
      ) : (
        <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11px] text-tinta-3 select-text">
          {JSON.stringify(visual.dados, null, 2)}
        </pre>
      )}
    </figure>
  )
}

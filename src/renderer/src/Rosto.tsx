import { useEffect, useRef, useState, type JSX } from 'react'
import { tamanhoFonte, ultimasCaixas } from './presenca'
import type { EstadoRosto } from '../../reconhecimento'

/**
 * O ROSTO — a cara da Íris num display.
 *
 * Feito pra ser a tela de um dispositivo de porta: LCD com o rosto, câmera
 * em cima. Aqui é um componente do app, mas nasce pensado pro display —
 * proporção livre, contraste alto, nada que exija leitura de perto, e
 * nenhum texto essencial além do nome de quem chegou.
 *
 * Os OLHOS SEGUEM quem está na frente, e isso não é enfeite: é a única
 * forma honesta de a pessoa na porta saber que foi vista. Um rosto parado
 * num LCD é um pôster; um que acompanha diz "estou te olhando agora" sem
 * uma palavra — e é exatamente a informação que o visitante precisa antes
 * de decidir se toca a campainha de novo.
 *
 * Quatro estados, e a cor carrega o significado antes da forma:
 *
 *   repouso    — sem câmera ou sem ninguém. Respirando, âmbar fraco.
 *   vendo      — tem gente, ainda sem veredito. Atento, ciano.
 *   reconheceu — alguém do cadastro. Aberto, verde, com o nome.
 *   alerta     — alguém fora do cadastro. Estreito, vermelho, pulsando.
 */

export type { EstadoRosto }

const COR: Record<EstadoRosto, string> = {
  repouso: '#e8a33d',
  vendo: '#5bc8e8',
  reconheceu: '#6fd39a',
  alerta: '#ff5646'
}

/** ~12fps pro olhar. Acima disso o movimento fica nervoso, não atento. */
const INTERVALO = 80

export default function Rosto({
  estado,
  nome
}: {
  estado: EstadoRosto
  nome?: string
}): JSX.Element {
  /** -1 (esquerda) a 1 (direita): pra onde o olhar aponta. */
  const [olhar, setOlhar] = useState(0)
  const alvoRef = useRef(0)

  useEffect(() => {
    const relogio = window.setInterval(() => {
      const caixas = ultimasCaixas()
      const { w } = tamanhoFonte()

      if (caixas.length && w) {
        // O centro do rosto mais à esquerda — e não a média: com duas
        // pessoas, a média olha pro vazio entre elas, que é o único ponto
        // onde com certeza não tem ninguém.
        const c = caixas[0]
        const centro = (c.x + c.w / 2) / w
        // Espelhado: a câmera vê invertido em relação a quem olha a tela.
        alvoRef.current = Math.max(-1, Math.min(1, (0.5 - centro) * 2))
      } else {
        alvoRef.current = 0
      }

      // Aproximação suave em vez de salto: o olho que teleporta lê como
      // glitch, e o que desliza lê como atenção. 0,2 por tique dá ~0,4s
      // pra atravessar o rosto inteiro.
      setOlhar((atual) => atual + (alvoRef.current - atual) * 0.2)
    }, INTERVALO)

    return () => clearInterval(relogio)
  }, [])

  const cor = COR[estado]
  const desloc = olhar * 14

  // A pálpebra do alerta fecha por cima: olho estreito lê como desconfiança
  // em qualquer cultura, e é mais legível de longe que mudar a cor só.
  const alturaOlho = estado === 'alerta' ? 10 : estado === 'reconheceu' ? 26 : 20

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6 bg-fundo">
      <svg
        viewBox="0 0 300 160"
        className={`w-full max-w-[520px] ${estado === 'alerta' ? 'animate-pulse' : ''}`}
        style={{ filter: `drop-shadow(0 0 18px ${cor}55)` }}
      >
        <defs>
          {/* O brilho é o que faz parecer emissor de luz e não desenho —
              importante num LCD, onde o preto é o vidro apagado. */}
          <linearGradient id="olho" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={cor} stopOpacity="1" />
            <stop offset="100%" stopColor={cor} stopOpacity="0.55" />
          </linearGradient>
        </defs>

        {[95, 205].map((cx) => (
          <rect
            key={cx}
            x={cx - 34 + desloc}
            y={70 - alturaOlho / 2}
            width="68"
            height={alturaOlho}
            rx={alturaOlho / 2}
            fill="url(#olho)"
            className="olho"
          />
        ))}

        {/* A BOCA é uma barra, não um sorriso: o traço curvo empurra isto
            pra mascote, e a proposta é um instrumento que reage — cordial
            quando reconhece, seco quando não. A largura carrega o humor. */}
        <rect
          x={estado === 'reconheceu' ? 110 : estado === 'alerta' ? 138 : 125}
          y="118"
          width={estado === 'reconheceu' ? 80 : estado === 'alerta' ? 24 : 50}
          height="6"
          rx="3"
          fill={cor}
          opacity="0.85"
          style={{ transition: 'all 260ms ease-out' }}
        />
      </svg>

      <p
        className="font-hud text-[13px] tracking-[0.35em] uppercase"
        style={{ color: cor }}
        aria-live="polite"
      >
        {estado === 'reconheceu'
          ? (nome ?? 'reconhecido')
          : estado === 'alerta'
            ? 'não cadastrado'
            : estado === 'vendo'
              ? 'olhando'
              : 'em espera'}
      </p>

      {/* A piscada mora aqui e não no Tailwind porque é keyframe com escala
          em Y sobre um rx dependente do estado — classe utilitária não
          alcança, e um olho que não pisca lê como travado. */}
      <style>{`
        .olho { transform-origin: center; animation: piscar 5.5s infinite; transition: y 200ms ease-out, height 200ms ease-out; }
        @keyframes piscar {
          0%, 94%, 100% { transform: scaleY(1); }
          96%  { transform: scaleY(0.08); }
          98%  { transform: scaleY(1); }
        }
        @media (prefers-reduced-motion: reduce) { .olho { animation: none; } }
      `}</style>
    </div>
  )
}

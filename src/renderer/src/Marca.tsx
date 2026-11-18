import type { JSX, SVGProps } from 'react'

/**
 * A marca I.R.I.S (arquivos originais em docs/marca).
 *
 * Embutida como SVG e não como <img>: a CSP do renderer só aceita imagem
 * local ou data:, e o desenho precisa obedecer ao tema — o traço segue
 * --marca-traco e a íris segue o acento, então o símbolo nunca fica de
 * outra cor que o resto da interface.
 */
export function Simbolo(props: SVGProps<SVGSVGElement>): JSX.Element {
  return (
    <svg
      viewBox="16 28 168 126"
      width="28"
      height="21"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path
        d="M100 36 L24 100 Q62 146 100 146 Q138 146 176 100 Z"
        stroke="var(--marca-traco)"
        strokeWidth="11"
      />
      <circle
        cx="100"
        cy="99"
        r="27"
        stroke="var(--color-sinal)"
        strokeWidth="9"
        strokeDasharray="150 20"
        pathLength={170}
        transform="rotate(-38 100 99)"
      />
      <circle cx="100" cy="99" r="10" fill="var(--color-sinal)" />
      <circle cx="108" cy="91" r="3.6" fill="#fff" />
    </svg>
  )
}

/** O nome com os pontos no acento, como no logotipo. */
export function NomeMarca({ className = '' }: { className?: string }): JSX.Element {
  return (
    <span className={`marca-nome ${className}`} role="img" aria-label="I.R.I.S">
      I<i>.</i>R<i>.</i>I<i>.</i>S
    </span>
  )
}

export const SLOGAN = 'Sua casa, sempre sob os seus olhos.'

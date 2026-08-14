import type { JSX, SVGProps } from 'react'

/**
 * Ícones autorais, não emoji.
 *
 * Emoji muda de desenho por sistema, vem colorido de fábrica e não obedece
 * currentColor — três motivos pra ele nunca conseguir pertencer a um sistema
 * visual. Estes são todos do mesmo jeito: grade de 16, traço 1.5, ponta reta,
 * sem preenchimento. É a mesma mão que desenha o fio de cabelo da interface.
 */

type Props = SVGProps<SVGSVGElement>

function Base({ children, ...resto }: Props & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      {...resto}
    >
      {children}
    </svg>
  )
}

/** Alto-falante com duas ondas. */
export function Som(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M2.5 6h2L7.5 3.5v9L4.5 10h-2z" />
      <path d="M10 6.2a2.6 2.6 0 0 1 0 3.6" />
      <path d="M12 4.4a5.2 5.2 0 0 1 0 7.2" />
    </Base>
  )
}

/** O mesmo alto-falante, cortado. */
export function Mudo(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M2.5 6h2L7.5 3.5v9L4.5 10h-2z" />
      <path d="M10.5 6.5l3.5 3.5" />
      <path d="M14 6.5L10.5 10" />
    </Base>
  )
}

/** Triângulo de atenção. Só aparece no modal de aprovação. */
export function Atencao(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M8 2.2L14.5 13.5h-13z" />
      <path d="M8 6.5v3.2" />
      <path d="M8 11.6v.1" />
    </Base>
  )
}

/** Cursor de prompt. Marca de onde a fala do usuário começa. */
export function Prompt(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M3 3.5L7.5 8 3 12.5" />
      <path d="M8.5 12.5H14" />
    </Base>
  )
}

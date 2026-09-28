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

/**
 * Arco aberto. Gira só enquanto ela processa — é o anel do capacete, e é a
 * única peça circular do app justamente porque anel parado não mede nada.
 * Sem strokeLinecap="square" aqui: a ponta reta num arco fino vira degrau.
 */
export function Arco(props: Props): JSX.Element {
  return (
    <Base strokeLinecap="round" {...props}>
      <path d="M8 1.6a6.4 6.4 0 0 1 6.4 6.4" />
      <path d="M8 14.4A6.4 6.4 0 0 1 1.6 8" opacity="0.45" />
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

/**
 * Chevron sozinho. Marca cada linha do log de invocação — é a metade
 * esquerda do Prompt, então o log lê como continuação da mesma mão.
 */
export function Seta(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M5.5 3.5L10 8l-4.5 4.5" />
    </Base>
  )
}

/**
 * Transmissão — a fonte no centro e as ondas saindo pros DOIS lados.
 *
 * Marca o que ela falou sem ninguém ter perguntado. Simétrico de propósito:
 * o `Som` irradia só pra direita porque tem um alto-falante apontando, e o
 * gatilho não aponta pra lugar nenhum — ele parte do meio. É o que separa os
 * dois de relance, no tamanho de 11px em que os dois vivem.
 */
export function Pulso(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M7.25 7.25h1.5v1.5h-1.5z" />
      <path d="M5.1 5.7a3.3 3.3 0 0 0 0 4.6" />
      <path d="M10.9 5.7a3.3 3.3 0 0 1 0 4.6" />
      <path d="M2.9 3.5a6.4 6.4 0 0 0 0 9" opacity="0.5" />
      <path d="M13.1 3.5a6.4 6.4 0 0 1 0 9" opacity="0.5" />
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

export function Escudo(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M8 1.5 13.5 4v4c0 3-3 5.2-5.5 6.5C5.5 13.2 2.5 11 2.5 8V4z" />
      <path d="m5.5 7.8 1.7 1.7 3.4-3.4" />
    </Base>
  )
}

export function Camera(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M2 4.5h3l1-2h4l1 2h3v9H2z" />
      <circle cx="8" cy="8.5" r="2.5" />
    </Base>
  )
}

export function Ajustes(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M3 2v12M8 2v12M13 2v12" />
      <path d="M1 5h4M6 10h4M11 6h4" strokeWidth="3" />
    </Base>
  )
}

export function Grade(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="M2 2h4.5v4.5H2zM9.5 2H14v4.5H9.5zM2 9.5h4.5V14H2zM9.5 9.5H14V14H9.5z" />
    </Base>
  )
}

export function Enviar(props: Props): JSX.Element {
  return (
    <Base {...props}>
      <path d="m2 2 12 6-12 6 2-6zM4 8h10" />
    </Base>
  )
}

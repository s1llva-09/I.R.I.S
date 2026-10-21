/// <reference types="electron-vite/node" />

// Sem isso o tsc não sabe que MAIN_VITE_* existe e o `npm run build`
// quebra no typecheck (o `npm run dev` passa direto, por isso demora
// a aparecer). Só o prefixo MAIN_VITE_ chega no processo main.
interface ImportMetaEnv {
  readonly MAIN_VITE_LLM_KEY: string
  readonly MAIN_VITE_LLM_MODELO?: string
  /** Teto de chamadas de API por dia. Padrão 45 (free tier do OpenRouter). */
  readonly MAIN_VITE_TAVILY_KEY?: string
  /** Site de estoque (estoque-iris) e o token de IRIS_API_TOKEN de lá. */
  readonly MAIN_VITE_ESTOQUE_URL?: string
  readonly MAIN_VITE_ESTOQUE_TOKEN?: string
  readonly MAIN_VITE_TETO_DIARIO?: string
  /**
   * Chamadas do dia que ficam reservadas pro uso interativo — os gatilhos
   * param antes disso. Padrão 15. Zerar aqui deixa um gatilho ruidoso capaz
   * de consumir a cota inteira antes de você acordar.
   */
  readonly MAIN_VITE_RESERVA_GATILHO?: string
}

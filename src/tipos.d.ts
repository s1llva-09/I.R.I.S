/**
 * Tipos que o MAIN e o RENDERER precisam enxergar iguais.
 *
 * Mora fora de src/main e src/renderer de propósito: importar de
 * ferramentas.ts no renderer arrastaria child_process/electron pro
 * typecheck web e quebraria o build. Aqui é só tipo, some na compilação.
 *
 * Arquivo .d.ts sem import/export = script global: quem estiver no
 * 'include' do tsconfig enxerga sem precisar importar nada.
 * Está listado nos dois: tsconfig.node.json e tsconfig.web.json.
 */

/** O que uma ferramenta devolve pra ser DESENHADO, além do texto que o modelo lê. */
type Visual = {
  tipo: 'barra' | 'pizza' | 'linha' | 'tabela' | 'kpi'
  titulo: string
  dados: Record<string, unknown>[]
  eixoX?: string
  eixoY?: string
}

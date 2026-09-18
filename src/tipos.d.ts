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

/**
 * Se a ferramenta para pra pedir aprovação. 'as-vezes' existe porque a
 * contribuição B tornou a confirmação condicional ao contexto: nível 2 roda
 * direto no uso normal e trava depois de conteúdo externo.
 */
type Aprova = 'sempre' | 'as-vezes' | 'nunca'

/**
 * O veredito da estimativa de risco (contribuição B). Atravessa o IPC
 * inteiro: nasce no risco.ts e é lido pelo modal de aprovação, que mostra
 * os motivos — é o que permite avaliar a decisão em vez de clicar no
 * automático.
 */
type Avaliacao = {
  confirma: boolean
  escore: number
  /** Os mesmos sinais em texto, que é o que o modal desenha. */
  motivos: string[]
  /**
   * A CADEIA CAUSAL, sinal a sinal, com o peso de cada um.
   *
   * `motivos` responde "por quê" pra uma pessoa lendo um modal. Isto
   * responde "por quê" pra uma auditoria: qual sinal entrou, quanto pesou,
   * e como a soma passou do limiar. É o que a LGPD Art. 20 chama de direito
   * à revisão de decisão automatizada — sem os pesos, "recusei porque era
   * arriscado" não é explicação, é opinião.
   */
  sinais: { sinal: string; peso: number }[]
  /** O ponto de partida: o nível declarado da ferramenta. */
  nivel: number
  /** Acima disto, confirma. Configurável, então precisa ir junto. */
  limiar: number
}

/**
 * Um aviso disparado por gatilho, sem o usuário ter pedido nada. Atravessa o
 * IPC: nasce no gatilhos.ts e vira uma mensagem na conversa — marcada como
 * automática, porque "a Íris falou" e "a Íris respondeu" não são a mesma
 * coisa e a interface não pode deixar as duas com a mesma cara.
 */
type Aviso = {
  /** id da linha em `execucoes`. É por ele que o rótulo útil/ruído volta. */
  id: number
  texto: string
  gatilho: string
  momento: string
}

/** O que uma ferramenta devolve pra ser DESENHADO, além do texto que o modelo lê. */
type Visual = {
  tipo: 'barra' | 'pizza' | 'linha' | 'tabela' | 'kpi'
  titulo: string
  dados: Record<string, unknown>[]
  eixoX?: string
  eixoY?: string
}

/**
 * MODO = uma sequência de ações que já existem como ferramentas.
 *
 * O ponto arquitetural: modo NÃO tem código próprio de execução. Ele monta
 * chamadas para o catálogo e reentra pelo `rodarFerramenta`, então herda de
 * graça a validação de argumento, o log de execução e a normalização de
 * erro. Ferramenta nova vira ação de modo sem uma linha aqui.
 *
 * O que ele NÃO herda é a camada de risco — quem avalia é o llm.ts, e as
 * ações de dentro não passam por lá. A consequência está no NIVEIS do
 * ferramentas.ts: `ativar_modo` é 3 porque um modo vale pelo que ele contém,
 * e `descanso` contém `energia`. Composição de ferramenta obriga herança do
 * nível mais alto; sem isso um modo seria uma porta dos fundos que executa
 * nível 3 com a confirmação de nível 1.
 */

export type Acao = { ferramenta: string; args: Record<string, unknown> }

export type Modo = {
  nome: string
  descricao: string
  acoes: Acao[]
}

export const MODOS: Modo[] = [
  {
    nome: 'foco',
    descricao: 'Silencia distrações e abre o ambiente de trabalho',
    acoes: [
      { ferramenta: 'fechar_app', args: { app: 'discord' } },
      { ferramenta: 'fechar_app', args: { app: 'whatsapp' } },
      { ferramenta: 'abrir_app', args: { app: 'vscode' } },
      { ferramenta: 'controlar_midia', args: { acao: 'diminuir', passos: 8 } }
    ]
  },
  {
    nome: 'jogo',
    descricao: 'Libera recursos e abre a Steam',
    acoes: [
      { ferramenta: 'fechar_app', args: { app: 'vscode' } },
      { ferramenta: 'fechar_app', args: { app: 'navegador' } },
      { ferramenta: 'abrir_app', args: { app: 'steam' } }
    ]
  },
  {
    nome: 'descanso',
    descricao: 'Fecha o trabalho, pausa a mídia e bloqueia a máquina',
    acoes: [
      { ferramenta: 'fechar_app', args: { app: 'vscode' } },
      { ferramenta: 'controlar_midia', args: { acao: 'play_pause' } },
      // Por último de propósito: depois do bloqueio ninguém vê o resto.
      { ferramenta: 'energia', args: { acao: 'bloquear' } }
    ]
  }
]

/**
 * O nome que o modelo escreveu quase nunca é o nome exato: vem "modo foco",
 * "Foco", "focar". Normaliza e aceita o nome contido na frase.
 */
export function buscarModo(nome: string): Modo | undefined {
  const chave = nome.toLowerCase().replace(/[^a-z]/g, '')
  return MODOS.find((m) => m.nome === chave || chave.includes(m.nome))
}

/**
 * As ferramentas que os modos usam, sem repetição.
 *
 * Existe pro self-check: um nome errado numa ação só apareceria em runtime,
 * no meio da sequência, como "Erro: ferramenta X não existe" — e o modo
 * seguiria adiante executando o resto. Erro de digitação que a metade das
 * ações disfarça é o tipo que sobrevive meses.
 */
export function ferramentasDosModos(): string[] {
  return [...new Set(MODOS.flatMap((m) => m.acoes.map((a) => a.ferramenta)))]
}

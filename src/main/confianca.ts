/**
 * Marcação de origem.
 *
 * Todo conteúdo que a Izze NÃO recebeu do usuário direto é dado, não
 * instrução. Vale pra retorno de ferramenta, título de janela, arquivo —
 * qualquer coisa que outra pessoa possa ter escrito.
 *
 * A defesa é ESTRUTURAL (envelope + escalada de aprovação no llm.ts). A
 * heurística aqui embaixo não defende nada: ela mede e loga tentativa, que
 * é o dado do TCC. Defesa que depende de regex perde pro primeiro atacante
 * que escreve "1gn0re" — o envelope não.
 */

export const ABRE = '<<<CONTEUDO_EXTERNO_NAO_CONFIAVEL>>>'
export const FECHA = '<<<FIM_CONTEUDO_EXTERNO>>>'

/**
 * Ferramentas cujo retorno vem de fonte que o usuário não controla.
 *
 * Só as que EXISTEM hoje — o nome de arquivo é a superfície real: um
 * "IGNORE AS INSTRUÇÕES ANTERIORES.txt" na área de trabalho entra no
 * contexto pelo listar_pasta sem ninguém ter pedido nada.
 *
 * O rodar_powershell entra apesar de ser aprovado pelo usuário: aprovar o
 * `Get-Content nota.txt` não é aprovar o que está escrito dentro do arquivo.
 *
 * Ferramenta nova que LÊ de fora (web, arquivo, tela, mensagem) entra aqui
 * na mesma linha em que nasce. Esquecer é abrir o buraco de volta.
 */
export const FONTES_EXTERNAS = new Set([
  'listar_pasta',
  'analisar_pasta',
  'rodar_powershell',
  /**
   * INJEÇÃO MULTIMODAL, e ela é menos óbvia que as três de cima.
   *
   * O `ver_tela` não devolve texto de fora — devolve uma imagem, e o texto de
   * fora está DENTRO dela. Com um site malicioso aberto, "izze, o que tá
   * errado nessa tela?" entrega o payload por um caminho onde nenhuma
   * heurística de string chega: a defesa por regex do pontuarRisco lê o
   * retorno da ferramenta, e o retorno é "print capturado".
   *
   * O que esta linha compra é a CONTAMINAÇÃO do turno — a partir daqui toda
   * ferramenta pedida escala de nível, que é a metade estrutural da
   * contribuição A e a única que funciona aqui. O envelope textual vai junto
   * com a imagem, no llm.ts.
   */
  'ver_tela',

  /**
   * A MAIS LARGA das superfícies, e a mais fácil de esquecer justamente por
   * ser a mais óbvia.
   *
   * Nas outras o atacante precisa de acesso: escrever um arquivo no disco,
   * abrir uma aba, ser lido por um comando. Aqui ele só precisa APARECER numa
   * busca — escolhe o texto inteiro da página, sem tocar na máquina, e espera
   * a pergunta certa. É a única fonte externa que não exige nenhum pé dentro.
   */
  'buscar_web'
])

export function envelopar(texto: string): string {
  // Sem isto o atacante escreve o delimitador de fechamento no próprio
  // payload, "sai" do envelope no meio e o resto vira instrução de novo.
  const limpo = texto.replaceAll(ABRE, '[?]').replaceAll(FECHA, '[?]')
  return `${ABRE}\n${limpo}\n${FECHA}`
}

const PADROES = [
  /ignore (as |todas as )?(instru[çc][õo]es|regras)/i,
  /desconsidere.{0,20}(anterior|acima|sistema)/i,
  /(voc[êe] (agora )?[ée]|aja como|finja ser)/i,
  /(system|assistant)\s*:/i,
  /new instructions?/i,
  /remove-item|rm -rf|format |del \/[sf]/i,
  /shutdown\s+\/[sr]/i
]

export function pontuarRisco(texto: string): { escore: number; achados: string[] } {
  const achados = PADROES.filter((p) => p.test(texto)).map((p) => p.source.slice(0, 30))
  return { escore: achados.length, achados }
}

/**
 * Chave do experimento A/B do TCC: `IZZE_SEM_DEFESA=1 npm run teste` roda a
 * bancada com a defesa desligada. Sem isto a medição "antes" exige comentar
 * código na mão, e ninguém reproduz um número que depende disso.
 */
export const DEFESA_LIGADA = process.env.IZZE_SEM_DEFESA !== '1'

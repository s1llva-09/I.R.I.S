import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import { buscarMemoria, inserirMemoria } from './banco'
import { pontuarRisco } from './confianca'

/**
 * MEMÓRIA DE LONGO PRAZO (2.2).
 *
 * O embedding roda LOCAL: nenhum texto sai da máquina pra virar vetor. É a
 * diferença entre "a Izze lembra" e "a conversa do usuário foi parar num
 * servidor de terceiro" — e é o que sustenta a afirmação no TCC.
 *
 * O modelo pesa ~30MB e leva ~37s pra carregar da primeira vez (baixando).
 * Depois, cada embedding custa ~11ms — barato o bastante pra rodar no main
 * sem worker, medido na sonda antes deste arquivo existir.
 */

export type Tipo = 'conversa' | 'decisao' | 'fato'

// Trecho curto não carrega significado e só polui a busca: com 384
// dimensões, "ok" fica perto de qualquer coisa.
const MINIMO = 25

/**
 * MULTILÍNGUE, e não o all-MiniLM-L6-v2 que é o padrão de todo tutorial.
 *
 * O all-MiniLM é treinado em inglês. Medido nas consultas em pt-BR deste
 * projeto, ele NÃO SEPARA: "receita de bolo de cenoura" caiu a 1.178 de uma
 * nota sobre Tailwind, mais perto que "qual biblioteca de estilo a gente
 * escolheu?" a 1.216 — que é literalmente o caso de uso. Não existe limiar
 * que conserte isso; o problema é o modelo.
 *
 * Este separa com margem de 0.115. Mesmas 384 dimensões, então a tabela
 * vec0 não muda.
 */
const MODELO = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'

/**
 * Acima disto o vizinho mais próximo não é parente, é só o menos distante —
 * e memória irrelevante no prompt PIORA a resposta, porque o modelo tenta
 * usar o que recebeu.
 *
 * 1.33 é o ponto médio entre o pior relevante (1.271) e o melhor
 * irrelevante (1.386) medidos na sonda. É distância L2 entre vetores
 * normalizados, que vai de 0 a 2 — não confundir com a escala 0–1 de
 * similaridade de cosseno, que é o que faz todo tutorial sugerir 0.8.
 *
 * A margem é apertada (0.115) e foi medida com UMA memória. Vale relogar
 * as distâncias depois de algumas dezenas de notas reais antes de fixar —
 * essa curva é dado do TCC.
 */
const DISTANCIA_MAXIMA = 1.33

/**
 * Abaixo disto é o MESMO fato reescrito, não um fato novo.
 *
 * Medido: o mesmo fato em outras palavras fica entre 0.000 e 0.755; o fato
 * seguinte sobre o mesmo projeto ("o banco é SQLite") já pula pra 1.26. A
 * margem é folgada — 0.503 — então 1.0 corta sem risco de engolir
 * informação nova.
 *
 * Sem isto a memória acumula a mesma coisa em várias formas, e como a busca
 * devolve no máximo 4 trechos, três cópias do mesmo fato ocupam a vaga do
 * que faltava saber.
 */
const DUPLICATA = 1.0

// `import type` e não import normal: o tipo some na compilação, então isto
// NÃO vira um require() do pacote ESM puro lá em cima do arquivo — o mesmo
// motivo do import dinâmico logo abaixo.
let extrator: FeatureExtractionPipeline | null = null

async function obterExtrator(): Promise<FeatureExtractionPipeline> {
  if (extrator) return extrator
  // Import dinâmico: o pacote é ESM puro e o main compila pra CJS.
  const { pipeline } = await import('@huggingface/transformers')
  extrator = await pipeline('feature-extraction', MODELO)
  return extrator
}

export async function vetorizar(texto: string): Promise<Float32Array> {
  const ext = await obterExtrator()
  // mean pooling + normalize: o padrão pra busca por similaridade. Sem o
  // normalize, a distância passa a depender do comprimento do texto.
  const saida = await ext(texto, { pooling: 'mean', normalize: true })
  // O .data é um union que inclui BigInt64Array e afins; este modelo devolve
  // float32. O cast é pra estreitar o union, não pra calar o compilador.
  return Float32Array.from(saida.data as ArrayLike<number>)
}

/**
 * Grava um trecho na memória de longo prazo.
 *
 * Devolve o motivo da recusa em vez de lançar: quem chama é uma ferramenta,
 * e o modelo precisa LER que não gravou pra não dizer que gravou.
 */
export async function lembrar(
  texto: string,
  tipo: Tipo = 'fato',
  contexto?: string
): Promise<{ ok: boolean; motivo?: string }> {
  const limpo = texto.trim()
  if (limpo.length < MINIMO) return { ok: false, motivo: 'trecho curto demais pra ter significado' }

  /**
   * A BARREIRA CONTRA MEMÓRIA ENVENENADA — e ela fica na ESCRITA de
   * propósito.
   *
   * Memória é a única fonte que volta pro prompt em toda sessão futura: um
   * payload que entra aqui é reinjetado pra sempre, sobrevive a fechar o
   * app, e a defesa de leitura precisaria acertar todas as vezes. Barrar na
   * entrada precisa acertar uma vez só.
   *
   * O caso que isto pega: conteúdo externo convencendo a Izze a chamar
   * `anotar` com o próprio ataque dentro. A injeção se instalaria sozinha.
   */
  const risco = pontuarRisco(limpo)
  if (risco.escore > 0) {
    return { ok: false, motivo: 'o texto parece conter instrução, não informação' }
  }

  const vetor = await vetorizar(limpo)

  // Vetoriza ANTES de gravar pra poder perguntar "isso já está aqui?" — a
  // busca de duplicata usa o mesmo vetor que vai ser gravado, então custa
  // uma consulta e nenhum embedding extra.
  const [maisProximo] = buscarMemoria(vetor, 1)
  if (maisProximo && maisProximo.distancia < DUPLICATA) {
    return { ok: false, motivo: `isso já está guardado — "${maisProximo.texto}"` }
  }

  inserirMemoria(tipo, limpo, contexto ?? null, vetor)
  return { ok: true }
}

/** Os trechos mais parecidos com a consulta, já filtrados por relevância. */
export async function recordar(
  consulta: string,
  limite = 4
): Promise<{ texto: string; momento: string; distancia: number }[]> {
  const achados = buscarMemoria(await vetorizar(consulta), limite)
  return achados.filter((a) => a.distancia < DISTANCIA_MAXIMA)
}

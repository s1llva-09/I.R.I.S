import { NIVEIS } from './ferramentas'
import { RESERVA } from './gatilhos'
import { conversar } from './llm'
import {
  cancelarTarefa,
  concluirTarefa,
  enfileirarTarefa,
  listarTarefas,
  pegarTarefa,
  reabrirTarefasOrfas,
  registrar,
  usoHoje
} from './banco'

/**
 * FILA ASSÍNCRONA (2.4).
 *
 * O que separa assistente de agente: você manda uma tarefa longa, fecha a
 * janela, e ela te chama quando terminar.
 *
 * Três regras, e as três existem por um motivo que já apareceu em outro
 * lugar do projeto:
 *
 *   1. UMA POR VEZ. Paralelo estoura o rate limit do free tier e ainda põe
 *      duas tarefas disputando as mesmas ferramentas de sistema.
 *   2. NUNCA APROVA SOZINHA. Mesma trava dos gatilhos — não há ninguém
 *      olhando o modal. Nível 3 para e vira relatório.
 *   3. RESERVA DE COTA. A mesma dos gatilhos, e pelo mesmo motivo: a fila
 *      não pode ser a razão de a Íris não te responder quando você pergunta.
 */

/**
 * O que uma tarefa de fundo pode usar.
 *
 * Catálogo por subtração e não lista fechada como no gatilho: a fila existe
 * justamente pra trabalho aberto de muitas etapas, e uma lista fixa
 * envelheceria a cada ferramenta nova. As exclusões:
 *
 *   - `agendar_tarefa`: tarefa que enfileira tarefa é laço infinito, e ele
 *     seria descoberto pela cota zerada de manhã.
 *   - `minhas_tarefas`: falar da fila é conversa com você, não trabalho.
 *   - `ver_tela`: print sem ninguém na frente é a captura mais invasiva que
 *     existe — o que estiver aberto às 3h vai pro provedor sem você ver.
 *   - `rodar_powershell`: nível 3, morreria na aprovação de qualquer jeito.
 *     Fora do catálogo ele nem gasta a volta de API tentando.
 */
const FORA = new Set([
  'agendar_tarefa',
  'minhas_tarefas',
  'ver_tela',
  'rodar_powershell',

  /**
   * SEGURANÇA fora do catálogo da fila, e este é o item que mais importa.
   *
   * `cadastrar_rosto` escreve em quem o sistema deixa de considerar
   * estranho. Uma tarefa de fundo que leu a web e chama isso autoriza uma
   * pessoa — é a escalada de privilégio mais concreta do projeto, e a que
   * menos parece uma. A escalada de risco até barraria (contaminado +
   * sem-usuário passa do limiar), mas depender só disso é depender da conta
   * fechar; fora do catálogo ele nem tenta, e não gasta a volta de API.
   *
   * `seguranca` sai junto por outro motivo: abrir um painel numa janela que
   * ninguém está olhando não é trabalho, é uma tela piscando sozinha.
   */
  'cadastrar_rosto',
  'esquecer_rosto',
  'seguranca'
])
export const FERRAMENTAS_DA_TAREFA = new Set(Object.keys(NIVEIS).filter((n) => !FORA.has(n)))

/** Tarefa longa é o caso de uso — o teto do chat interativo é curto demais. */
const VOLTAS = 12

/** Respiro entre tarefas: evita 429 numa sequência longa. */
const RESPIRO = 3000

/** A fila é acordada por relógio em vez de por evento. Ver `iniciarFila`. */
const TIQUE = 5000

let relogio: NodeJS.Timeout | null = null
let processando = false
let avisar: ((aviso: Aviso) => void) | null = null

async function processar(): Promise<void> {
  // Reentrância: o tique de 5s cai em cima de uma tarefa que leva minutos.
  if (processando) return
  processando = true

  try {
    for (;;) {
      if (usoHoje().restantes <= RESERVA) break

      const t = pegarTarefa()
      if (!t) break

      const inicio = Date.now()
      // A instrução acima existe por uma falha observada: o system prompt
      // manda enfileirar pedido de muitas etapas, e a tarefa de fundo É um
      // pedido de muitas etapas — sem isto ela obedecia a regra, tentava
      // agendar a si mesma e voltava dizendo que precisava de confirmação.
      let saida = ''
      let erro = false

      try {
        saida = await conversar(
          [
            {
              role: 'user',
              content:
                `[TAREFA EM SEGUNDO PLANO] Você JÁ está na fila: execute todas as ` +
                `etapas agora, nesta mesma sessão, e responda com o resultado final. ` +
                `Não agende nada, não peça confirmação — não há ninguém pra confirmar. ` +
                `Se alguma etapa for impossível, faça as outras e diga qual faltou.

` +
                t.descricao
            }
          ],
          {
            origem: 'gatilho',
            ferramentas: FERRAMENTAS_DA_TAREFA,
            maxVoltas: VOLTAS,
            aoReceberTexto: () => {},
            aoUsarFerramenta: () => {},
            aoGerarVisual: () => {},
            // Injeção que chegou por um caminho automático é o dado mais
            // caro da contribuição A: aqui não há usuário pra desconfiar.
            aoDetectarInjecao: (ferramenta, achados) =>
              registrar({
                ferramenta: `tarefa:injecao`,
                argumentos: ferramenta,
                resultado: achados.join(' | '),
                erro: false,
                duracao: 0
              }),
            aoPedirAprovacao: async () => false
          }
        )
        saida = saida.trim()
        erro = !saida
      } catch (e) {
        saida = `Falhou: ${(e as Error).message}`
        erro = true
      }

      concluirTarefa(t.id, saida || '(sem resposta do modelo)', erro)

      /**
       * Vai pro MESMO caminho de aviso dos gatilhos, e isso não é preguiça:
       * o `entregarAviso` já resolve notificação, voz, mensagem no chat e
       * buffer pra janela fechada. Um segundo canal só pra tarefa seria
       * quatro coisas reimplementadas pra ficar igual.
       *
       * O `registrar` antes dele existe porque o Aviso precisa do id da
       * linha em `execucoes` — é por ele que o polegar útil/ruído volta, e a
       * pergunta "a tarefa de fundo valeu a interrupção?" é do capítulo.
       */
      const id = registrar({
        ferramenta: `tarefa:${t.id}`,
        argumentos: t.descricao,
        resultado: saida || '(sem resposta do modelo)',
        erro,
        duracao: Date.now() - inicio
      })

      avisar?.({
        id,
        texto: `Tarefa #${t.id} — ${t.descricao}\n\n${saida}`,
        gatilho: 'tarefa',
        momento: new Date().toISOString()
      })

      await new Promise((r) => setTimeout(r, RESPIRO))
    }
  } finally {
    processando = false
  }
}

/**
 * Relógio e não evento.
 *
 * O caminho óbvio seria a ferramenta `agendar_tarefa` chamar `processar()`
 * direto. Ela não pode: `ferramentas.ts` importaria daqui, isto importa do
 * `llm.ts`, e o `llm.ts` importa do `ferramentas.ts` — ciclo de import, que
 * em ESM não explode, só entrega `undefined` no meio do boot. Um SELECT por
 * índice a cada 5s custa menos que qualquer arranjo pra desfazer o ciclo.
 */
export function iniciarFila(aoConcluir: (aviso: Aviso) => void): void {
  avisar = aoConcluir
  const orfas = reabrirTarefasOrfas()
  if (orfas) console.log(`[fila] ${orfas} tarefa(s) voltaram pra fila`)
  relogio = setInterval(() => void processar(), TIQUE)
  void processar()
}

export function pararFila(): void {
  if (relogio) clearInterval(relogio)
  relogio = null
}

export { cancelarTarefa, enfileirarTarefa, listarTarefas }

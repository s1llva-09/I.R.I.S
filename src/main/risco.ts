import { NIVEIS } from './ferramentas'
import { historico } from './banco'
import { ler } from './config'
import type { Presenca } from './presenca'

/**
 * CONFIRMAÇÃO ADAPTATIVA (contribuição B).
 *
 * A regra fixa de nível vira estimativa: começa no nível declarado e sobe ou
 * desce conforme sinais. Comando conhecido e limpo desce; inédito,
 * destrutivo ou surgido depois de conteúdo externo sobe.
 *
 * Usa a conexão do banco.ts em vez de abrir a sua — duas conexões no mesmo
 * arquivo SQLite com WAL funcionam, mas a segunda não vê as migrações que a
 * primeira faz, e o statement preparado aqui quebraria na coluna nova.
 */

/**
 * Acima disto, para e pergunta. Chute inicial — ver o comentário do PISO.
 *
 * Configurável desde a I.1, e isso é dado do TCC antes de ser conveniência:
 * o limiar é o botão que move a curva inteira de "confirma demais" pra
 * "executa demais", e sem mexer nele sem rebuildar não existe a tabela que
 * compara os dois extremos.
 *
 * FUNÇÃO e não constante: quem move o slider espera valer no próximo
 * comando, não no próximo boot.
 */
function limiar(): number {
  const n = Number(ler('limiarRisco'))
  return Number.isFinite(n) ? n : 3
}

/**
 * Verbos destrutivos em comando livre. Regex e não lista de palavras porque
 * o modelo varia a forma do comando.
 *
 * `format` solto saiu daqui. Ele funcionava enquanto só comando PowerShell
 * passava por aqui; com a `anotar`, TEXTO LIVRE EM PORTUGUÊS passou a
 * passar, e "formato", "formatação" e "formatar" viravam verbo destrutivo —
 * um modal de confirmação em cima de uma anotação inofensiva. Atrito sem
 * motivo é o que ensina a clicar sem ler, então falso positivo aqui custa
 * segurança, não só paciência.
 *
 * No lugar, as duas formas que realmente apagam disco: o cmdlet
 * `Format-Volume` e o `format D:` do prompt.
 */
/**
 * LEITURA PURA: devolve texto e não muda nada — nem no PC, nem na memória,
 * nem no que a Íris vai acreditar amanhã.
 *
 * Estas não sobem por contaminação, e o motivo apareceu medindo a fila
 * (2.4): uma tarefa de pesquisa faz `buscar_web`, o retorno contamina o
 * contexto, e a SEGUNDA busca virava 1 + 2 (contaminado) + 2 (sem usuário) =
 * 5. Sem ninguém pra aprovar, toda tarefa de pesquisa morria na etapa 2 —
 * o pedido do usuário sendo negado por ter sido atendido uma vez.
 *
 * A escalada continua inteira pro que AGE: `abrir_app` é nível 1 e não está
 * aqui, então "vi um nome de arquivo suspeito e agora quero abrir um
 * programa" segue parando. Ler mais texto não faz nada; é só mais texto,
 * e ele já entra envelopado.
 *
 * `ver_tela` fica DE FORA de propósito: não age, mas captura o que estiver
 * na tela — o risco dele é privacidade, não efeito colateral.
 */
const SEM_EFEITO = new Set([
  'hora_atual',
  'buscar_web',
  'estoque_consultar',
  'listar_pasta',
  'analisar_pasta',
  'minhas_estatisticas',
  'meu_consumo',
  'lembrancas',
  'minhas_preferencias',
  'minhas_tarefas',
  'estado_do_pc',
  'processos_pesados'
])

const DESTRUTIVO =
  /remove-item|\bdel\s|\brm\s+-|format-volume|\bformat\s+[a-z]:|clear-|stop-computer|restart-|uninstall|drop\s+table|-force/i

type Contexto = {
  ferramenta: string
  args: string
  /** Houve conteúdo externo no contexto? Vem da contribuição A. */
  contaminado: boolean
  origem: 'local' | 'remoto' | 'gatilho'
  /** Quem está fisicamente na frente da máquina (2.6). */
  presenca?: Presenca
}

/**
 * O MESMO comando, escrito de dois jeitos, é o mesmo comando.
 *
 * A chave do histórico são os argumentos crus, e o modelo não garante ordem
 * de chave no JSON: {"pasta":"desktop","subcaminho":"x"} e o inverso são a
 * mesma chamada e viravam duas linhas diferentes no banco. Sem normalizar, o
 * histórico quase nunca casa e o desconto por comando conhecido nunca chega.
 */
export function normalizar(args: string): string {
  try {
    const o = JSON.parse(args)
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return args
    return JSON.stringify(o, Object.keys(o).sort())
  } catch {
    return args
  }
}

export function avaliar(ctx: Contexto): Avaliacao {
  const motivos: string[] = []
  const sinais: { sinal: string; peso: number }[] = []

  /**
   * Um lugar só pra somar, em vez de `escore += n` espalhado com um
   * `motivos.push` do lado.
   *
   * O motivo é a auditabilidade: enquanto o peso e o texto eram duas linhas
   * independentes, nada impedia que divergissem — e uma explicação que diz
   * "+2 por conteúdo externo" quando o código somou 3 é pior que explicação
   * nenhuma, porque parece verificada.
   */
  const pesar = (peso: number, sinal: string): void => {
    escore += peso
    motivos.push(sinal)
    sinais.push({ sinal, peso })
  }

  // Ausente = 3, a mesma regra do llm.ts e do catalogo(). Um padrão menor
  // aqui seria uma porta dos fundos: bastaria esquecer a linha no NIVEIS
  // pra ferramenta nova nascer sem confirmação.
  const nivel = NIVEIS[ctx.ferramenta] ?? 3
  let escore: number = nivel

  // --- o que SOBE o risco ---

  if (DESTRUTIVO.test(ctx.args)) {
    pesar(3, 'comando com verbo destrutivo')
  }

  // Herdado da contribuição A: conteúdo externo no contexto significa que a
  // AÇÃO pode ter sido sugerida por terceiro, não pelo usuário. Ler de novo
  // não é ação: ver SEM_EFEITO.
  if (ctx.contaminado && !SEM_EFEITO.has(ctx.ferramenta)) {
    pesar(2, 'surgiu após leitura de conteúdo externo')
  }

  /**
   * PRESENÇA (2.6) — o segundo sinal FÍSICO do modelo de risco.
   *
   * Até aqui o único era `origem`, que é lógico: diz de onde o comando
   * veio, não onde VOCÊ está. São coisas diferentes e a diferença importa,
   * porque a confirmação só protege quem está lá pra ler o modal. Um
   * comando local com a cadeira vazia tem exatamente a mesma proteção
   * nominal e proteção real nenhuma.
   *
   * 'desconhecida' não mexe em nada, e isso é decisão, não esquecimento:
   * quem não tem webcam, negou a permissão ou desligou a câmera continua com
   * o comportamento anterior à 2.6. Escalar por ausência de sensor puniria
   * quem não usa o sensor — e faria a feature ser desligada no primeiro dia,
   * que é como uma camada de segurança morre de verdade.
   */
  if (ctx.presenca === 'ausente') {
    pesar(2, 'ninguém na frente da máquina')
  } else if (ctx.presenca === 'nao_autorizado') {
    /**
     * Alguém em frente à câmera que não está no cadastro.
     *
     * +3 põe qualquer nível 2 acima do limiar sozinho, e é proposital: com
     * um desconhecido na sala, "executa direto porque você já rodou isso 10
     * vezes" deixa de valer — o histórico é sobre o COMANDO, e o que mudou
     * foi a sala.
     */
    pesar(3, 'pessoa não cadastrada em frente à câmera')
  } else if (ctx.presenca === 'acompanhado') {
    /**
     * Mais de um rosto. Não sabemos de quem — de propósito, é o que mantém
     * isto fora da biometria (ver `presenca.ts` no renderer).
     *
     * +1 e não +2 porque o caso comum é inofensivo (alguém passou atrás) e
     * o caso ruim é você aprovando algo sensível com plateia. Um degrau de
     * atrito serve; dois viram motivo pra desligar a câmera.
     */
    pesar(1, 'mais de uma pessoa em frente à câmera')
  }

  // Longe da máquina você não vê o que está aberto nem cancela a tempo.
  if (ctx.origem === 'remoto') {
    pesar(1, 'comando remoto')
  }

  /**
   * GATILHO: ninguém pediu, e ninguém está olhando.
   *
   * Todo o resto deste arquivo pressupõe um usuário na frente da tela — é ele
   * quem lê o modal e decide. Num disparo automático essa pessoa não existe:
   * o gatilho.ts recusa qualquer confirmação, porque a única alternativa
   * seria aprovar sozinho de madrugada.
   *
   * +2 e não +1 pelo que ele faz em COMBINAÇÃO com a contaminação. O gatilho
   * usa `listar_pasta`, que é FONTE_EXTERNA: uma pasta com nome de arquivo
   * malicioso contamina o contexto (+2) e, num turno interativo, isso vira um
   * modal que você lê. Sem este +2, o mesmo caminho num gatilho daria
   * 1 + 2 = 3, dentro do limiar, e executaria calado. Com ele dá 5, para, e
   * como não há ninguém pra aprovar, a ação morre — que é o comportamento
   * certo pra uma sugestão que veio de um nome de arquivo.
   */
  if (ctx.origem === 'gatilho') {
    pesar(2, 'disparado por gatilho, sem pedido do usuário')
  }

  // --- o que DESCE o risco ---

  const h = historico(ctx.ferramenta, normalizar(ctx.args))
  const sucessos = h.usos - h.falhas

  if (sucessos >= 10 && h.falhas === 0) {
    pesar(-2, `executado ${sucessos}x sem falha`)
  } else if (sucessos >= 3 && h.falhas === 0) {
    pesar(-1, `executado ${sucessos}x sem falha`)
  } else if (h.usos === 0) {
    // Inédito não sobe o risco por si só — só não ganha o desconto.
    pesar(0, 'comando inédito')
  }

  // Falha recente é sinal de que algo mudou no ambiente.
  if (h.falhas > 0 && h.falhas / h.usos > 0.3) {
    pesar(1, `falhou ${h.falhas} de ${h.usos} vezes`)
  }

  /**
   * O PISO. Nível 3 nunca desce abaixo do limiar por bom comportamento.
   *
   * Sem isto a contribuição B seria uma REGRESSÃO de segurança: rodar
   * `Get-Content nota.txt` dez vezes daria -2, levando o rodar_powershell de
   * 3 pra 1, e a décima primeira execução passaria sem aprovação. O nome da
   * ferramenta é o mesmo; o comando dentro dela é que muda — e é justamente
   * o comando que torna a ação irreversível.
   *
   * "Ação irreversível não fica reversível por repetição": o histórico pode
   * tirar atrito de coisa média, nunca de coisa grave.
   */
  const teto = limiar()
  if (nivel === 3 && escore <= teto) {
    // O peso aqui é o quanto o piso ERGUEU, não um número fixo: é isso que
    // a auditoria precisa ver pra saber que o histórico foi sobreposto.
    const erguido = teto + 1 - escore
    escore = teto + 1
    motivos.push('nível 3 — confirmação não é dispensável por histórico')
    sinais.push({ sinal: 'piso do nível 3', peso: erguido })
  }

  return { confirma: escore > teto, escore, motivos, sinais, nivel, limiar: teto }
}

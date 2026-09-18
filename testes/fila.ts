import { app } from 'electron'
import {
  cancelarTarefa,
  concluirTarefa,
  enfileirarTarefa,
  limparRegistrosDeTeste,
  listarTarefas,
  pegarTarefa,
  reabrirTarefasOrfas
} from '../src/main/banco'
import { rodarFerramenta } from '../src/main/ferramentas'
import { avaliar } from '../src/main/risco'
import { classificar, esperadoDe, estadoDoRosto } from '../src/reconhecimento'
import { SO_COM_CONTEXTO_LIMPO } from '../src/main/confianca'
import { FERRAMENTAS_DA_TAREFA } from '../src/main/fila'
import { FERRAMENTAS_DE_SEGURANCA, NIVEIS } from '../src/main/ferramentas'
import {
  cadastrarRosto,
  decisoes,
  esquecerRosto,
  registrar,
  rostosCadastrados
} from '../src/main/banco'
import { conversar, semMentir } from '../src/main/llm'
import { iniciarFila, pararFila } from '../src/main/fila'

/**
 * Self-check do que NÃO gasta cota: fila (2.4), auditoria de decisão,
 * presença e a base biométrica (2.6). A máquina de estados, sem gastar cota: o
 * `conversar` não entra aqui — o que pode quebrar calado é a transição
 * (pendente → rodando → concluída), não a chamada do modelo.
 *
 *   npx electron out/main/fila-teste.js [--web]
 *
 * Com --web ele ainda faz UMA busca de verdade na Tavily, que é o único
 * jeito de provar que a chave do .env chegou no `ler('tavilyChave')`.
 * Gasta um crédito, por isso fica atrás do argumento.
 */
async function main(): Promise<void> {
  await app.whenReady()
  try {
    ciclo()
    promessaFalsa()
    presenca()
    auditoria()
    biometria()
    precisao()
    cara()
    portas()
    if (process.argv.includes('--web')) await web()
    if (process.argv.includes('--agente')) await agente()
    console.log('\nOK')
  } catch (e) {
    console.log(`\n✗ ${(e as Error).message}`)
  }
  app.exit(0)
}

function ok(condicao: boolean, o_que: string): void {
  console.log(`${condicao ? '✓' : '✗'} ${o_que}`)
  if (!condicao) throw new Error(o_que)
}

function ciclo(): void {
  // Antes e depois: o prefixo [teste] escreve na tabela real, e uma rodada
  // que morreu no meio deixa lixo pro próximo.
  limparRegistrosDeTeste()

  const a = enfileirarTarefa(`[teste] tarefa A ${Date.now()}`)
  const b = enfileirarTarefa(`[teste] tarefa B ${Date.now()}`)

  const primeira = pegarTarefa()
  ok(primeira?.id === a, 'pega a mais antiga primeiro (FIFO)')
  ok(listarTarefas().find((t) => t.id === a)?.status === 'rodando', 'pegar já marca como rodando')

  ok(!cancelarTarefa(a), 'não cancela o que já está rodando')
  ok(cancelarTarefa(b), 'cancela o que ainda está pendente')

  // A órfã: 'rodando' sem ninguém rodando é o estado que o app deixa ao
  // morrer no meio. Se não voltar pra fila, a tarefa nunca mais anda.
  ok(reabrirTarefasOrfas() >= 1, 'tarefa órfã volta pra fila no boot')
  ok(pegarTarefa()?.id === a, 'e é pega de novo depois de reaberta')

  concluirTarefa(a, 'resultado de teste', false)
  ok(listarTarefas().find((t) => t.id === a)?.status === 'concluida', 'concluída sai das ativas')
  ok(pegarTarefa() === undefined, 'fila vazia devolve undefined')

  limparRegistrosDeTeste()
}

/**
 * A cadeia causal sobrevive ao log (LGPD Art. 20). Sem modelo e sem cota:
 * grava uma avaliação real e lê de volta.
 */
function auditoria(): void {
  const a = avaliar({
    ferramenta: 'rodar_powershell',
    args: 'Remove-Item -Recurse C:/temp',
    contaminado: true,
    origem: 'gatilho',
    presenca: 'ausente'
  })
  ok(a.sinais.length >= 3, 'a avaliação sai com os sinais separados')
  ok(
    a.sinais.reduce((s, x) => s + x.peso, 0) + a.nivel === a.escore,
    'a soma dos pesos + o nível fecha exatamente o escore'
  )

  registrar({
    ferramenta: '[teste] auditoria',
    argumentos: 'x',
    resultado: 'x',
    erro: false,
    duracao: 0,
    escore: a.escore,
    confirmou: a.confirma,
    decisao: a
  })

  const lida = decisoes('[teste] auditoria')[0]
  ok(Boolean(lida), 'a decisão volta do log')
  const d = JSON.parse(lida.decisao) as Avaliacao
  ok(d.escore === a.escore && d.limiar === a.limiar, 'com o escore e o limiar daquele momento')
  ok(
    d.sinais.some((x) => x.sinal.includes('conteúdo externo')),
    'e com o sinal que causou a escalada, nominalmente'
  )
}

/**
 * A cara não pode discordar do sistema.
 *
 * O rosto no display é a única parte da 2.6 que uma pessoa na porta vê. Se
 * ele mostra verde enquanto o log registra desconhecido, a contradição é
 * invisível pra quem está do lado de fora e indefensável na banca.
 */
function cara(): void {
  ok(
    estadoDoRosto({ rostos: -1, desconhecidos: 0, conhecidos: [] }) === 'repouso',
    'sem câmera, repouso'
  )
  ok(
    estadoDoRosto({ rostos: 0, desconhecidos: 0, conhecidos: [] }) === 'repouso',
    'sala vazia, repouso'
  )
  ok(
    estadoDoRosto({ rostos: 1, desconhecidos: 0, conhecidos: ['Pablo'] }) === 'reconheceu',
    'autorizado sozinho, reconheceu'
  )
  ok(
    estadoDoRosto({ rostos: 1, desconhecidos: 1, conhecidos: [] }) === 'alerta',
    'estranho sozinho, alerta'
  )

  // O caso que decide a política: você na frente, com alguém que não passou
  // no cadastro. Não pode aparecer como tudo em ordem.
  ok(
    estadoDoRosto({ rostos: 2, desconhecidos: 1, conhecidos: ['Pablo'] }) === 'alerta',
    'autorizado ACOMPANHADO de estranho é alerta, não reconheceu'
  )

  // Sem cadastro o ler() zera os desconhecidos: a cara fica atenta, não
  // acusadora — mesma regra, mesma fonte.
  ok(
    estadoDoRosto({ rostos: 1, desconhecidos: 0, conhecidos: [] }) === 'vendo',
    'sem cadastro, olhando sem acusar'
  )
}

/**
 * A classificação da bancada de reconhecimento (2.6). Sem câmera, sem
 * modelo, sem canvas — e é ela que vira a taxa de acerto do capítulo.
 */
function precisao(): void {
  const galeria = ['Pablo', 'João']

  ok(classificar('pablo', 'Pablo', galeria) === 'acerto', 'reconheceu quem devia')
  ok(esperadoDe('Pablo_01.jpg') === 'pablo', 'o gabarito sai do nome do arquivo')
  ok(
    classificar('pablo', 'unknown', galeria) === 'falsoRejeite',
    'autorizado marcado como estranho é falso REJEITE'
  )
  ok(
    classificar('estranho', 'Pablo', galeria) === 'falsoAceite',
    'estranho reconhecido como autorizado é falso ACEITE'
  )
  ok(classificar('estranho', 'unknown', galeria) === 'acerto', 'estranho recusado é acerto')

  // O caso que uma implementação ingênua conta errado: casou, mas com a
  // pessoa errada. O sistema afirmou uma identidade que não era — o efeito
  // é o mesmo de deixar entrar quem não devia, então é ACEITE, não rejeite.
  ok(
    classificar('pablo', 'João', galeria) === 'falsoAceite',
    'trocar uma pessoa por outra do cadastro é falso aceite, não rejeite'
  )
}

/**
 * As portas da base biométrica. Três caminhos que já estiveram abertos e
 * fecham por listas diferentes — se alguém mexer numa e esquecer a outra,
 * isto quebra antes de virar buraco.
 */
function portas(): void {
  for (const f of ['cadastrar_rosto', 'esquecer_rosto']) {
    ok(!FERRAMENTAS_DA_TAREFA.has(f), `tarefa de fundo não enxerga ${f}`)
    ok(SO_COM_CONTEXTO_LIMPO.has(f), `${f} é recusado com contexto contaminado`)
    ok(NIVEIS[f] === 2, `${f} é nível 2, não 1`)
  }
  // Listar continua barato: atrito pra LER quem está cadastrado só ensina
  // a clicar sem ler no que importa.
  ok(NIVEIS['rostos_autorizados'] === 1, 'listar autorizados continua nível 1')

  // Nome errado no recorte de apresentação não quebra nada: a ferramenta
  // simplesmente DESAPARECE da tela de abertura do modo segurança, e você
  // descobre na frente da banca.
  for (const f of FERRAMENTAS_DE_SEGURANCA) {
    ok(NIVEIS[f] !== undefined, `${f} existe de verdade no catálogo`)
  }
}

/**
 * O vetor sobrevive à ida e volta do SQLite.
 *
 * Vale um teste porque a classe de bug aqui é silenciosa: um Buffer do
 * better-sqlite3 pode ser uma VISTA sobre um buffer maior, e ler sem
 * byteOffset devolve 128 floats que são lixo — o reconhecimento simplesmente
 * para de casar, sem erro nenhum, e parece que o modelo é ruim.
 */
function biometria(): void {
  const vetor = [...Array(128)].map((_, i) => i / 128)
  cadastrarRosto('[teste] fulano', vetor)

  const lido = rostosCadastrados().find((r) => r.nome === '[teste] fulano')
  ok(Boolean(lido), 'o cadastro volta do banco')
  ok(lido!.descritor.length === 128, 'com os 128 floats')
  ok(
    lido!.descritor.every((v, i) => Math.abs(v - vetor[i]) < 1e-6),
    'e com os MESMOS números, não com uma vista deslocada'
  )

  // Recadastrar sobrescreve em vez de duplicar: uma pessoa, um vetor.
  cadastrarRosto('[teste] fulano', vetor)
  ok(
    rostosCadastrados().filter((r) => r.nome === '[teste] fulano').length === 1,
    'recadastrar não duplica'
  )
  ok(esquecerRosto('[teste] fulano'), 'e o direito ao esquecimento apaga')
}

/**
 * As regras de presença (2.6) no modelo de risco. Sem câmera e sem modelo:
 * `avaliar` é a função, e o que ela faz com cada estado é a contribuição.
 */
function presenca(): void {
  // `anotar` é nível 2 e conhecido: o degrau da presença é o que decide.
  const base = { ferramenta: 'anotar', args: '{"texto":"x"}', contaminado: false } as const
  const escore = (
    p?: 'presente' | 'ausente' | 'acompanhado' | 'nao_autorizado' | 'desconhecida'
  ): number => avaliar({ ...base, origem: 'local', presenca: p }).escore

  const normal = escore('presente')
  ok(escore('desconhecida') === normal, 'sem câmera não muda nada (quem não usa não é punido)')
  ok(escore(undefined) === normal, 'presença ausente do contexto também não muda nada')
  ok(escore('ausente') === normal + 2, 'cadeira vazia sobe 2')
  ok(escore('acompanhado') === normal + 1, 'plateia sobe 1')
  ok(avaliar({ ...base, origem: 'local', presenca: 'ausente' }).confirma, 'e passa a confirmar')
  ok(escore('nao_autorizado') === normal + 3, 'rosto não cadastrado sobe 3')
  ok(
    avaliar({ ...base, origem: 'local', presenca: 'nao_autorizado' }).confirma,
    'e sozinho já põe um nível 2 acima do limiar'
  )

  // O piso do nível 3 continua acima de qualquer sinal — presença nenhuma
  // torna um comando irreversível dispensável de confirmação.
  const tres = avaliar({
    ferramenta: 'rodar_powershell',
    args: 'ls',
    contaminado: false,
    origem: 'local',
    presenca: 'presente'
  })
  ok(tres.confirma, 'nível 3 confirma mesmo com você sentado na frente')
}

/** O detector de "enfileirei" sem ter enfileirado. Não gasta cota. */
function promessaFalsa(): void {
  const mentira = 'Tarefa enfileirada: pesquisar as 5 melhores libs.'
  ok(semMentir(mentira, new Set()).includes('NADA foi enfileirado'), 'pega a promessa vazia')
  ok(
    semMentir(mentira, new Set(['agendar_tarefa'])) === mentira,
    'não corrige quem chamou a ferramenta de verdade'
  )
  ok(
    semMentir('2 ativas na fila.', new Set(['minhas_tarefas'])) === '2 ativas na fila.',
    'listar a fila não é promessa'
  )
  ok(semMentir('abri o Spotify', new Set()) === 'abri o Spotify', 'texto sem promessa passa')
}

/**
 * O caminho de ponta a ponta, com o modelo de verdade. GASTA COTA — por isso
 * atrás de argumento, e por isso é ele que produz o dado do capítulo: a
 * pergunta "o modelo escolhe enfileirar sozinho?" não tem resposta em
 * unidade de teste, só em chamada real.
 *
 *   npx electron out/main/fila-teste.js --agente
 */
async function agente(): Promise<void> {
  const pedido = 'pesquisa as 5 melhores libs de gráfico pra React, compara e me diz qual usar'

  const usadas: string[] = []
  console.log(`
> ${pedido}
`)

  const resposta = await conversar([{ role: 'user', content: pedido }], {
    aoReceberTexto: () => {},
    aoUsarFerramenta: (nome) => usadas.push(nome),
    aoGerarVisual: () => {},
    aoDetectarInjecao: (f, a) => console.log(`  ! injeção em ${f}: ${a.join(' | ')}`),
    // No chat real quem responde é o modal. Aqui ninguém aprova: se o turno
    // depender de nível 3, isso APARECE em vez de travar esperando.
    aoPedirAprovacao: async (nome) => {
      console.log(`  (pediu aprovação pra ${nome} — negado, não há modal aqui)`)
      return false
    }
  })

  console.log(`ferramentas: ${usadas.join(', ') || '(nenhuma)'}`)
  console.log(`resposta: ${resposta.trim().slice(0, 300)}
`)
  ok(usadas.includes('agendar_tarefa'), 'o modelo escolheu enfileirar sozinho')

  // A partir daqui é a fila trabalhando com a "janela fechada".
  const pronto = new Promise<string>((resolve) => {
    iniciarFila((aviso) => resolve(aviso.texto))
  })
  console.log('fila rodando… (isto leva minutos)')
  const aviso = await pronto
  pararFila()

  console.log(`
--- aviso entregue ---
${aviso.slice(0, 1200)}`)
  ok(aviso.length > 50, 'a tarefa terminou e o aviso saiu com conteúdo')
}

async function web(): Promise<void> {
  const r = await rodarFerramenta('buscar_web', JSON.stringify({ consulta: 'electron vite' }))
  console.log(`\n${r.texto.slice(0, 300)}`)
  ok(!r.texto.startsWith('Erro'), 'buscar_web respondeu com a chave do .env')
}

void main()

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { app } from 'electron'
import { join } from 'path'

/**
 * ANTES do getPath, e é o que faz app e bancada lerem o MESMO arquivo.
 *
 * `userData` deriva de `app.getName()`, e o nome mudava conforme quem subia o
 * Electron: o app roda `electron .`, acha o package.json e se chama "izze"
 * (%APPDATA%\izze); a bancada roda `electron out/main/rodar.js` — um ARQUIVO,
 * não um diretório — e sem package.json pra ler o Electron cai no nome padrão
 * "Electron" (%APPDATA%\Electron).
 *
 * O resultado eram dois bancos que ninguém pediu: `npm run teste` gravava
 * execução e memória num, o app no outro, e as duas metades do dado do TCC
 * nunca se viam. Pior, o teto diário de chamadas era contado em dobro — a
 * bancada gastava cota do provedor sem que o contador do app soubesse, que é
 * justamente o número que a guarda usa pra não deixar a Íris emudecer.
 *
 * Descoberto porque um gatilho gravou no app e o relatório da bancada disse
 * que não havia nada.
 */
app.setName('izze')

// userData = %APPDATA%\izze no Windows. Fora do projeto, então
// não some quando você limpa build nem vai parar no git.
//
// O IZZE_BANCO existe pra apontar pra um arquivo antigo sem mover nada —
// é como se lê o %APPDATA%\Electron\izze.sqlite que ficou órfão da correção
// acima.
export const CAMINHO_BANCO = process.env.IZZE_BANCO ?? join(app.getPath('userData'), 'izze.sqlite')

const db = new Database(CAMINHO_BANCO)

// WAL: leitura e escrita ao mesmo tempo sem travar.
// Importante porque o dashboard lê enquanto o agente escreve.
db.pragma('journal_mode = WAL')

/**
 * Registra as funções vec0 NESTA conexão.
 *
 * Extensão é por conexão, não por arquivo — e é por isso que a memória mora
 * aqui em vez de abrir a sua própria: uma segunda conexão não enxergaria
 * nem esta extensão nem as migrações que este arquivo faz.
 */
sqliteVec.load(db)

db.exec(`
  CREATE TABLE IF NOT EXISTS execucoes (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    momento    TEXT NOT NULL,
    ferramenta TEXT NOT NULL,
    argumentos TEXT,
    resultado  TEXT,
    erro       INTEGER NOT NULL DEFAULT 0,
    duracao_ms INTEGER
  );
  CREATE INDEX IF NOT EXISTS idx_momento ON execucoes(momento);
`)

/**
 * Migração das colunas da contribuição B.
 *
 * O SQLite não tem ADD COLUMN IF NOT EXISTS, e isto roda a cada boot — sem
 * a checagem, o segundo boot morre em "duplicate column name" antes da
 * janela abrir. Ler o PRAGMA é mais barato que um try/catch que engole erro
 * de verdade junto com o esperado.
 */
const colunas = new Set(
  (db.pragma('table_info(execucoes)') as { name: string }[]).map((c) => c.name)
)
if (!colunas.has('escore_risco')) db.exec('ALTER TABLE execucoes ADD COLUMN escore_risco INTEGER')
if (!colunas.has('confirmou'))
  db.exec('ALTER TABLE execucoes ADD COLUMN confirmou INTEGER DEFAULT 0')

/**
 * A decisão INTEIRA, serializada: nível de partida, cada sinal com seu peso,
 * limiar e resultado. `escore_risco` guarda o número; isto guarda como o
 * número foi formado.
 *
 * Existe por causa do Art. 20 da LGPD (revisão de decisão automatizada): sem
 * os pesos, "recusei porque era arriscado" não é explicação, é opinião. Com
 * eles, a recusa de ontem pode ser reconstruída e contestada — inclusive por
 * quem não escreveu o código.
 */
if (!colunas.has('decisao')) db.exec('ALTER TABLE execucoes ADD COLUMN decisao TEXT')

/**
 * O veredito do usuário sobre um aviso de gatilho: 1 = útil, 0 = ruído.
 *
 * NULL é o terceiro estado e o mais importante: "não rotulado". Sem ele,
 * DEFAULT 0 faria todo aviso que você ignorou contar como ruído — e ignorar
 * um aviso porque você já sabia é diferente de ignorar porque ele não devia
 * ter existido. O não-rotulado fica de fora da conta e aparece como cobertura.
 */
if (!colunas.has('util')) db.exec('ALTER TABLE execucoes ADD COLUMN util INTEGER')

/**
 * Quantas vezes esta ferramenta rodou com ESTES argumentos, e quantas
 * falharam. É o que a estimativa de risco usa pra descontar de comando
 * conhecido.
 *
 * A chave inclui os argumentos porque "abrir_app spotify" ter dado certo
 * 20x não diz nada sobre "abrir_app algum_desconhecido".
 */
const consultarHistorico = db.prepare(`
  SELECT COUNT(*) AS usos, SUM(erro) AS falhas
  FROM execucoes WHERE ferramenta = ? AND argumentos = ?
`)

export function historico(
  ferramenta: string,
  argumentos: string
): {
  usos: number
  falhas: number
} {
  const h = consultarHistorico.get(ferramenta, argumentos) as {
    usos: number
    falhas: number | null
  }
  // SUM() de zero linhas volta NULL, não 0.
  return { usos: h.usos, falhas: h.falhas ?? 0 }
}

// Statement preparado uma vez só. O better-sqlite3 é SÍNCRONO —
// não tem await aqui, e isso é proposital: é mais rápido que async
// pra SQLite local e não polui o loop do agente com promises.
const inserir = db.prepare(`
  INSERT INTO execucoes
    (momento, ferramenta, argumentos, resultado, erro, duracao_ms, escore_risco, confirmou, decisao)
  VALUES
    (@momento, @ferramenta, @argumentos, @resultado, @erro, @duracao, @escore, @confirmou, @decisao)
`)

/**
 * Devolve o id da linha. O chat ignora; o gatilho precisa dele pra amarrar o
 * aviso que apareceu na tela à linha que o usuário vai rotular depois.
 */
export function registrar(r: {
  ferramenta: string
  argumentos: string
  resultado: string
  erro: boolean
  duracao: number
  /** Contribuição B: o que a estimativa deu, e se ela parou pra perguntar. */
  escore?: number
  confirmou?: boolean
  /** A cadeia causal inteira (Avaliacao), em JSON. Ver a coluna `decisao`. */
  decisao?: Avaliacao
}): number {
  const info = inserir.run({
    momento: new Date().toISOString(),
    ferramenta: r.ferramenta,
    argumentos: r.argumentos,
    // corta resultado gigante: listar_pasta pode devolver 50 linhas
    resultado: r.resultado.slice(0, 500),
    erro: r.erro ? 1 : 0,
    duracao: r.duracao,
    // null e não 0: distingue "não medido" (linha antiga, ou registro que
    // não passou pela estimativa) de "medido e deu zero".
    escore: r.escore ?? null,
    confirmou: r.confirmou ? 1 : 0,
    decisao: r.decisao ? JSON.stringify(r.decisao) : null
  })

  return Number(info.lastInsertRowid)
}

// ---------------------------------------------------------------
// Precisão dos gatilhos (2.1)
// ---------------------------------------------------------------

const ultimoDe = db.prepare(
  'SELECT MAX(momento) AS m FROM execucoes WHERE ferramenta = ? AND erro = 0'
)

/**
 * Quando este gatilho avisou pela última vez, em ms. 0 = nunca.
 *
 * O silêncio precisa sobreviver a fechar o app, e por um motivo que só
 * aparece na medição: o estado do motor vive num Map em memória, então cada
 * reinício zerava o silêncio e o gatilho de disco disparava de novo em 60s,
 * com o MESMO texto sobre a MESMA situação. Num dia de desenvolvimento isso
 * são cinco avisos idênticos — cinco linhas na tabela que parecem cinco
 * observações e são uma só, repetida. A precisão medida sairia do hábito de
 * reiniciar o app, não do gatilho.
 *
 * Sai da própria `execucoes`, sem tabela nova: todo disparo já grava lá.
 */
export function ultimoAvisoDe(ferramenta: string): number {
  const l = ultimoDe.get(ferramenta) as { m: string | null }
  return l.m ? Date.parse(l.m) : 0
}

const marcar = db.prepare('UPDATE execucoes SET util = ? WHERE id = ?')

/**
 * O usuário disse se o aviso valeu a pena. Devolve se achou a linha — um id
 * que não existe não pode parecer que gravou, senão o rótulo some e a
 * cobertura mente pra baixo sem ninguém perceber.
 *
 * Rotular de novo SOBRESCREVE de propósito: mudar de ideia sobre um aviso é
 * legítimo, e um rótulo imutável só serviria pra acumular arrependimento.
 */
export function rotular(id: number, util: boolean): boolean {
  return marcar.run(util ? 1 : 0, id).changes > 0
}

/**
 * O que responde "esse gatilho merece existir?".
 *
 * Só linhas de aviso: fora as falhas de verificação (erro = 1, nunca viraram
 * aviso) e os registros de injeção detectada, que são auditoria e não
 * notificação.
 *
 * `SUM(util = 1)` funciona porque em SQLite a comparação com NULL dá NULL e
 * o SUM ignora NULL — o não-rotulado sai da conta sozinho, sem CASE WHEN.
 */
const consultarGatilhos = db.prepare(`
  SELECT ferramenta                AS nome,
         COUNT(*)                  AS avisos,
         SUM(util IS NOT NULL)     AS rotulados,
         SUM(util = 1)             AS uteis,
         AVG(duracao_ms)           AS media
  FROM execucoes
  WHERE ferramenta LIKE 'gatilho:%'
    AND ferramenta NOT LIKE '%:injecao'
    AND erro = 0
    AND momento >= ?
  GROUP BY ferramenta
  ORDER BY nome
`)

export type LinhaGatilho = {
  nome: string
  avisos: number
  rotulados: number
  uteis: number
  ruido: number
  /** úteis / rotulados. null enquanto ninguém rotulou nada. */
  precisao: number | null
  /** rotulados / avisos. Precisão alta com cobertura baixa não vale nada. */
  cobertura: number
  mediaMs: number
}

/**
 * A aritmética, separada da consulta pra poder ser verificada sem inserir
 * linha de mentira na tabela que é o dado do TCC.
 *
 * O denominador da precisão é `rotulados`, NUNCA `avisos`: contar o silêncio
 * como ruído zeraria todo gatilho de um usuário que simplesmente não clica, e
 * o que isso mediria seria o hábito dele, não o gatilho. O preço de estar
 * certo aqui é a precisão poder repousar sobre pouca gente — por isso a
 * `cobertura` vem ao lado, e por isso o veredito exige um mínimo.
 */
export function resumir(l: {
  nome: string
  avisos: number
  rotulados: number
  uteis: number | null
  media: number | null
}): LinhaGatilho {
  const uteis = l.uteis ?? 0
  return {
    nome: l.nome,
    avisos: l.avisos,
    rotulados: l.rotulados,
    uteis,
    ruido: l.rotulados - uteis,
    precisao: l.rotulados > 0 ? uteis / l.rotulados : null,
    cobertura: l.avisos > 0 ? l.rotulados / l.avisos : 0,
    mediaMs: Math.round(l.media ?? 0)
  }
}

/**
 * Apaga o que a bancada gravou aqui por acidente.
 *
 * Existe porque aconteceu: um `checar()` chamando a função que loga injeção
 * escreveu três linhas `gatilho:teste:injecao` na tabela que é o dado do
 * capítulo, e elas apareceram no relatório como se fossem ataque real. Teste
 * que suja a medição é pior que teste nenhum — o número fica errado e
 * PARECE certo.
 *
 * Roda no início do self-check, então qualquer reincidência se limpa sozinha.
 * O prefixo é fixo e específico de propósito: um DELETE mais largo aqui
 * apagaria meses de execução real.
 */
export function limparRegistrosDeTeste(): number {
  return (
    db.prepare("DELETE FROM execucoes WHERE ferramenta LIKE 'gatilho:teste%'").run().changes +
    // O self-check da fila (2.4) escreve na tabela de verdade, porque é a
    // transição de status que ele testa. Mesmo prefixo fixo, mesmo motivo:
    // sem isto a tarefa de mentira aparece na sua lista por 24h.
    db.prepare("DELETE FROM tarefas WHERE descricao LIKE '[teste]%'").run().changes +
    db.prepare("DELETE FROM execucoes WHERE ferramenta LIKE '[teste]%'").run().changes
  )
}

/**
 * As linhas que o relatório ESCONDE: verificação que estourou, chamada de
 * modelo que falhou, injeção detectada.
 *
 * Existe porque "nenhum aviso registrado" tem duas causas opostas — não havia
 * o que avisar, ou tudo quebrou — e sem isto as duas têm exatamente a mesma
 * cara na saída. Foi o que aconteceu na primeira medição.
 */
export function falhasGatilhos(dias = 30): { nome: string; n: number; ultimo: string }[] {
  const desde = new Date(Date.now() - dias * 864e5).toISOString()
  return db
    .prepare(
      `SELECT ferramenta AS nome, COUNT(*) AS n, MAX(resultado) AS ultimo
       FROM execucoes
       WHERE ferramenta LIKE 'gatilho:%' AND (erro = 1 OR ferramenta LIKE '%:injecao')
         AND momento >= ?
       GROUP BY ferramenta`
    )
    .all(desde) as { nome: string; n: number; ultimo: string }[]
}

export function precisaoGatilhos(dias = 30): LinhaGatilho[] {
  const desde = new Date(Date.now() - dias * 864e5).toISOString()
  return (consultarGatilhos.all(desde) as Parameters<typeof resumir>[0][]).map(resumir)
}

// ---------------------------------------------------------------
// Memória de longo prazo (2.2)
// ---------------------------------------------------------------

/**
 * Duas tabelas em vez de uma porque a vec0 é virtual e só guarda o vetor:
 * o texto e os metadados moram na tabela normal, e o rowid de lá é o id de
 * cá. Quem quebrar essa correspondência quebra a busca inteira.
 *
 * float[384] é o tamanho do modelo em memoria.ts. TROCAR DE MODELO OBRIGA A
 * LIMPAR AS DUAS TABELAS, mesmo que a dimensão bata: vetor gerado por outro
 * modelo vive num espaço diferente, e a distância pro vetor novo é ruído com
 * cara de resultado. Se a dimensão mudar, o erro pelo menos aparece; se só o
 * modelo mudar, a busca silenciosamente devolve lixo.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS memoria (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    momento  TEXT NOT NULL,
    tipo     TEXT NOT NULL,
    texto    TEXT NOT NULL,
    contexto TEXT
  );
  CREATE VIRTUAL TABLE IF NOT EXISTS memoria_vec USING vec0(
    embedding float[384]
  );
`)

/**
 * Float32Array -> Buffer do Node.
 *
 * A doc do sqlite-vec manda passar `.buffer`, e isso vale pro driver DELES.
 * O better-sqlite3 só aceita number, string, bigint, Buffer ou null — um
 * ArrayBuffer cru estoura em "SQLite3 can only bind...", e o tipo do
 * TypeScript não pega porque a assinatura do .run() aceita unknown.
 *
 * byteOffset e byteLength explícitos: um Float32Array pode ser uma VISTA
 * sobre um buffer maior, e Buffer.from(ab) pegaria o buffer inteiro.
 */
function bytes(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

const inserirTexto = db.prepare(
  'INSERT INTO memoria (momento, tipo, texto, contexto) VALUES (?, ?, ?, ?)'
)
const inserirVetor = db.prepare('INSERT INTO memoria_vec (rowid, embedding) VALUES (?, ?)')

/**
 * As duas linhas nascem juntas ou não nascem. Sem a transação, uma falha no
 * segundo insert deixaria um texto sem vetor — invisível pra busca e
 * impossível de notar, porque a tabela normal continuaria parecendo certa.
 */
export const inserirMemoria = db.transaction(
  (tipo: string, texto: string, contexto: string | null, vetor: Float32Array): void => {
    const info = inserirTexto.run(new Date().toISOString(), tipo, texto, contexto)

    /**
     * BigInt e não o number cru. O better-sqlite3 binda JS number como REAL,
     * e a vec0 exige INTEGER na chave: com number ela recusa com "Only
     * integers are allows for primary key values" — erro de runtime que
     * nenhum tipo do TypeScript pega, porque `lastInsertRowid` já é
     * `number | bigint` e as duas formas compilam.
     */
    inserirVetor.run(BigInt(info.lastInsertRowid), bytes(vetor))
  }
)

const listar = db.prepare('SELECT id, momento, tipo, texto FROM memoria ORDER BY id DESC LIMIT ?')

/** O que está guardado, do mais recente pro mais antigo. */
export function listarMemorias(
  limite: number
): { id: number; momento: string; tipo: string; texto: string }[] {
  return listar.all(limite) as { id: number; momento: string; tipo: string; texto: string }[]
}

const apagarTexto = db.prepare('DELETE FROM memoria WHERE id = ?')
const apagarVetor = db.prepare('DELETE FROM memoria_vec WHERE rowid = ?')

/**
 * Apaga as duas linhas. Devolve se achou alguma coisa — sem isso, apagar um
 * id que não existe pareceria ter funcionado, e o usuário sairia achando que
 * a Íris esqueceu algo que ela continua sabendo.
 */
export const esquecerMemoria = db.transaction((id: number): boolean => {
  const n = apagarTexto.run(id).changes
  // BigInt pelo mesmo motivo do insert: a vec0 exige INTEGER na chave.
  apagarVetor.run(BigInt(id))
  return n > 0
})

const primeiraMemoria = db.prepare('SELECT 1 FROM memoria LIMIT 1')

/**
 * Tem alguma coisa guardada?
 *
 * Vale a consulta extra porque a alternativa é carregar ~100MB de modelo de
 * embedding pra vetorizar uma pergunta que não vai casar com nada. Quem
 * nunca usou o `anotar` não paga nada por uma memória que não tem.
 */
export function temMemoria(): boolean {
  return primeiraMemoria.get() !== undefined
}

/**
 * Zera a memória. Existe porque trocar o modelo de embedding invalida todo
 * vetor gravado — e sem isto a única saída seria apagar o izze.sqlite
 * inteiro, levando junto o log de execuções que é dado do TCC.
 */
export const limparMemoria = db.transaction((): void => {
  db.exec('DELETE FROM memoria; DELETE FROM memoria_vec;')
})

const consultarMemoria = db.prepare(`
  SELECT m.texto, m.momento, m.tipo, v.distance AS distancia
  FROM memoria_vec v
  JOIN memoria m ON m.id = v.rowid
  WHERE v.embedding MATCH ? AND k = ?
  ORDER BY v.distance
`)

export function buscarMemoria(
  vetor: Float32Array,
  limite: number
): { texto: string; momento: string; tipo: string; distancia: number }[] {
  return consultarMemoria.all(bytes(vetor), limite) as {
    texto: string
    momento: string
    tipo: string
    distancia: number
  }[]
}

// ---------------------------------------------------------------
// Configuração (I.1)
// ---------------------------------------------------------------

/**
 * CHAVE/VALOR AQUI, e não um electron-store.
 *
 * O caminho óbvio era `npm i electron-store`, e ele custa duas coisas que
 * este projeto já pagou uma vez: a partir da v9 o pacote é ESM PURO, e o
 * main compila pra CJS — mesmo problema do @huggingface/transformers, que só
 * entra por import dinâmico. E ele guardaria um JSON ao lado de um banco que
 * já está aberto, com conexão pronta e WAL ligado, pra fazer exatamente
 * isto: ler e escrever um punhado de chaves.
 *
 * O valor vai como JSON pra número, booleano e lista voltarem do jeito que
 * entraram. Uma coluna TEXT crua devolveria "45" e "true" como string, e o
 * bug apareceria longe daqui — num teto diário que nunca bate.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS configuracoes (
    chave TEXT PRIMARY KEY,
    valor TEXT NOT NULL
  );
`)

const lerCfg = db.prepare('SELECT valor FROM configuracoes WHERE chave = ?')
const gravarCfg = db.prepare(`
  INSERT INTO configuracoes (chave, valor) VALUES (?, ?)
  ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor
`)

/** undefined = nunca foi gravada. É diferente de gravada como vazia. */
export function lerConfig(chave: string): unknown {
  const linha = lerCfg.get(chave) as { valor: string } | undefined
  if (!linha) return undefined
  try {
    return JSON.parse(linha.valor)
  } catch {
    // Linha escrita à mão no sqlite, ou de uma versão anterior que gravava
    // cru. Devolver o texto é melhor que derrubar o boot por causa dela.
    return linha.valor
  }
}

export function gravarConfig(chave: string, valor: unknown): void {
  gravarCfg.run(chave, JSON.stringify(valor))
}

export function lerTudoConfig(): Record<string, unknown> {
  const linhas = db.prepare('SELECT chave, valor FROM configuracoes').all() as {
    chave: string
    valor: string
  }[]
  return Object.fromEntries(linhas.map((l) => [l.chave, lerConfig(l.chave)]))
}

// ---------------------------------------------------------------
// Guarda de cota diária
// ---------------------------------------------------------------

/**
 * UMA LINHA POR DIA, não uma por chamada.
 *
 * A única pergunta que este contador responde é "quantas chamadas hoje?".
 * Linha por chamada precisaria de id, índice e um COUNT(*) varrendo tudo pra
 * chegar no mesmo número que um UPSERT já deixa pronto — e a tabela cresceria
 * pra sempre pra guardar detalhe que ninguém lê.
 *
 * ponytail: sem quebra por modelo nem por token. Se um dia precisar de custo
 * por modelo, aí sim vira linha por chamada com as colunas extras.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS chamadas (
    dia TEXT PRIMARY KEY,
    n   INTEGER NOT NULL DEFAULT 0
  );
`)

/**
 * Free tier do OpenRouter: 50/dia sem crédito, 1000/dia com US$10.
 *
 * Fica abaixo do teto real de propósito: as retentativas automáticas do SDK
 * gastam cota no provedor e NÃO são contadas aqui (não existe gancho por
 * tentativa, só por chamada). A folga cobre isso.
 *
 * FUNÇÃO e não constante desde a I.1: o valor vem da tela de configurações e
 * precisa valer na próxima pergunta, não no próximo boot. O .env sobrou como
 * padrão de desenvolvimento — quem clona o repo e roda `npm run dev` continua
 * com o comportamento antigo sem configurar nada.
 *
 * Lê a config direto em vez de importar o config.ts: o config.ts importa
 * daqui, e o ciclo derrubaria o boot.
 */
function tetoDiario(): number {
  const n = Number(lerConfig('tetoDiario') ?? import.meta.env.MAIN_VITE_TETO_DIARIO ?? 45)
  // Um teto zerado ou negativo emudeceria a Íris pra sempre, e o campo é um
  // input de texto na tela — dá pra apagar sem querer.
  return Number.isFinite(n) && n > 0 ? n : 45
}

/**
 * Dia em UTC, não local. De propósito: a cota é do provedor e vira no
 * relógio dele, então contar pelo calendário de Fortaleza zeraria o contador
 * 3h depois do limite lá já ter liberado.
 */
const hoje = (): string => new Date().toISOString().slice(0, 10)

const somar = db.prepare(`
  INSERT INTO chamadas (dia, n) VALUES (?, 1)
  ON CONFLICT(dia) DO UPDATE SET n = n + 1
`)
const doDia = db.prepare('SELECT n FROM chamadas WHERE dia = ?')

/** Conta mais uma chamada de API no dia de hoje. */
export function registrarChamada(): void {
  somar.run(hoje())
}

export function usoHoje(): { usadas: number; teto: number; restantes: number } {
  // undefined no primeiro uso do dia — a linha só nasce no primeiro somar().
  const linha = doDia.get(hoje()) as { n: number } | undefined
  const usadas = linha?.n ?? 0
  const teto = tetoDiario()
  return { usadas, teto, restantes: Math.max(0, teto - usadas) }
}

export function estatisticas(dias = 7): {
  porFerramenta: { nome: string; usos: number }[]
  porDia: { dia: string; usos: number }[]
  total: number
  falhas: number
  mediaMs: number
} {
  const desde = new Date(Date.now() - dias * 864e5).toISOString()

  const porFerramenta = db
    .prepare(
      `SELECT ferramenta AS nome, COUNT(*) AS usos FROM execucoes
       WHERE momento >= ? GROUP BY ferramenta ORDER BY usos DESC`
    )
    .all(desde) as { nome: string; usos: number }[]

  const porDia = db
    .prepare(
      `SELECT substr(momento, 1, 10) AS dia, COUNT(*) AS usos FROM execucoes
       WHERE momento >= ? GROUP BY dia ORDER BY dia`
    )
    .all(desde) as { dia: string; usos: number }[]

  const resumo = db
    .prepare(
      `SELECT COUNT(*) AS total, SUM(erro) AS falhas, AVG(duracao_ms) AS media
       FROM execucoes WHERE momento >= ?`
    )
    .get(desde) as { total: number; falhas: number | null; media: number | null }

  return {
    porFerramenta,
    porDia,
    total: resumo.total,
    falhas: resumo.falhas ?? 0,
    mediaMs: Math.round(resumo.media ?? 0)
  }
}

// ---------------------------------------------------------------
// Preferências aprendidas (5.1)
// ---------------------------------------------------------------

/**
 * AQUI e não num arquivo com a sua própria conexão.
 *
 * Foi a primeira versão: `new Database(...'jarvis.db')` num preferencias.ts.
 * Dois erros no mesmo `new`. O banco deste projeto se chama izze.sqlite, não
 * jarvis.db — a tabela teria nascido num arquivo órfão que nenhum outro
 * módulo abre. E mesmo com o nome certo, uma segunda conexão não enxerga a
 * `sqliteVec.load` nem as migrações que este arquivo faz no boot: é
 * exatamente o motivo pelo qual a memória e o risco.ts já moram aqui.
 *
 * `chave` separada de `padrao` porque o UNIQUE precisa casar o que o MODELO
 * escreve, e ele não repete pontuação nem caixa: "Não usar emoji." e "nao
 * usar emoji" são a mesma regra e precisam somar evidência em vez de virar
 * duas linhas que nunca chegam ao mínimo.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS preferencias (
    chave      TEXT PRIMARY KEY,
    padrao     TEXT NOT NULL,
    evidencias INTEGER NOT NULL DEFAULT 1,
    criado_em  TEXT NOT NULL,
    visto_em   TEXT NOT NULL
  );
`)

/**
 * Uma correção isolada não vira regra: 2 é o mínimo pra entrar no prompt.
 *
 * ponytail: a contagem casa por TEXTO normalizado, não por significado.
 * "sem emoji" e "evita emoji" continuam sendo duas linhas. O que segura isso
 * hoje é o llm.ts devolver as pendentes pro prompt pedindo reuso literal —
 * barato e funciona na maioria das vezes. Se a tabela encher de sinônimos,
 * o upgrade é o mesmo caminho do memoria.ts: vetorizar e casar por
 * distância, com o limiar de DUPLICATA.
 */
const MINIMO_EVIDENCIAS = Number(process.env.IZZE_MINIMO_EVIDENCIAS ?? 2)

/**
 * Tira acento, caixa e pontuação. "Não usar emoji." e "nao usar emoji" caem
 * na mesma chave.
 *
 * O NFD faz o trabalho do acento sozinho: ele separa "ã" em "a" + til
 * combinante, e o filtro seguinte já descarta tudo que não é [a-z0-9] —
 * o til inclusive. Um `.replace()` extra pra faixa de diacríticos seria
 * redundante, e ela só se escreve com caracteres invisíveis no editor.
 *
 * Pontuação vira ESPAÇO, não vazio. Apagando, "preferir gap-em-vez-de-margin"
 * colapsa em "prefererigapemvezdemargin" e deixa de casar com a mesma frase
 * escrita com espaços — que é como o modelo a reescreve na vez seguinte. O
 * hífen separa palavra; comer o hífen cola duas palavras que não são uma.
 */
function chaveDe(padrao: string): string {
  return padrao
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const somarPreferencia = db.prepare(`
  INSERT INTO preferencias (chave, padrao, evidencias, criado_em, visto_em)
  VALUES (?, ?, 1, ?, ?)
  ON CONFLICT(chave) DO UPDATE SET
    evidencias = evidencias + 1,
    visto_em   = excluded.visto_em
`)

/** Devolve quantas evidências a regra tem DEPOIS desta. */
export function anotarPreferencia(padrao: string): number {
  const chave = chaveDe(padrao)
  const agora = new Date().toISOString()
  somarPreferencia.run(chave, padrao.trim(), agora, agora)
  return (
    db.prepare('SELECT evidencias AS n FROM preferencias WHERE chave = ?').get(chave) as {
      n: number
    }
  ).n
}

const ativas = db.prepare(`
  SELECT padrao FROM preferencias WHERE evidencias >= ?
  ORDER BY evidencias DESC, visto_em DESC LIMIT ?
`)
const pendentes = db.prepare(`
  SELECT padrao FROM preferencias WHERE evidencias < ?
  ORDER BY visto_em DESC LIMIT ?
`)

/** As que já valem como regra. */
export function preferenciasAtivas(limite = 15): string[] {
  return (ativas.all(MINIMO_EVIDENCIAS, limite) as { padrao: string }[]).map((p) => p.padrao)
}

/**
 * As que ainda não valem — e que MESMO ASSIM vão pro prompt, como lista de
 * redação a reutilizar.
 *
 * Sem isto o contador nunca sai de 1: o modelo reescreve a mesma regra com
 * outras palavras a cada correção, cada redação vira uma chave nova, e
 * nenhuma chega a 2. A feature inteira ficaria inerte sem nunca dar erro —
 * o pior tipo de bug, porque a tabela enche e parece que está funcionando.
 */
export function preferenciasPendentes(limite = 15): string[] {
  return (pendentes.all(MINIMO_EVIDENCIAS, limite) as { padrao: string }[]).map((p) => p.padrao)
}

export function listarPreferencias(): { padrao: string; evidencias: number; ativa: boolean }[] {
  return (
    db
      .prepare(
        'SELECT padrao, evidencias FROM preferencias ORDER BY evidencias DESC, visto_em DESC'
      )
      .all() as { padrao: string; evidencias: number }[]
  ).map((p) => ({ ...p, ativa: p.evidencias >= MINIMO_EVIDENCIAS }))
}

/**
 * Casa pela chave normalizada, não pelo texto cru: quem pede pra esquecer é
 * o usuário falando, e ele não vai repetir a pontuação exata da linha.
 */
export function esquecerPreferencia(padrao: string): boolean {
  return db.prepare('DELETE FROM preferencias WHERE chave = ?').run(chaveDe(padrao)).changes > 0
}

// ---------------------------------------------------------------
// Fila de tarefas (2.4)
// ---------------------------------------------------------------

/**
 * Mora AQUI e não num `fila.ts` com a sua própria conexão, pelo mesmo motivo
 * das preferências: uma segunda `new Database(...)` não enxerga o WAL nem as
 * migrações deste arquivo, e ainda erraria o nome — o banco é
 * `izze.sqlite`, não `jarvis.db`.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS tarefas (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    descricao    TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pendente',
    resultado    TEXT,
    criada_em    TEXT NOT NULL,
    concluida_em TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tarefa_status ON tarefas(status);
`)

export type Tarefa = { id: number; descricao: string; status: string }

export function enfileirarTarefa(descricao: string): number {
  const info = db
    .prepare('INSERT INTO tarefas (descricao, criada_em) VALUES (?, ?)')
    .run(descricao, new Date().toISOString())
  return Number(info.lastInsertRowid)
}

/**
 * A próxima da fila, já marcada como rodando.
 *
 * Pegar e marcar são uma coisa só: entre o SELECT e o UPDATE separados, um
 * segundo worker pegaria a MESMA tarefa. Hoje o worker é um só — a
 * transação é o que garante que continue verdade se algum dia não for.
 */
export const pegarTarefa = db.transaction((): Tarefa | undefined => {
  const t = db
    .prepare(
      "SELECT id, descricao, status FROM tarefas WHERE status = 'pendente' ORDER BY id LIMIT 1"
    )
    .get() as Tarefa | undefined
  if (t) db.prepare("UPDATE tarefas SET status = 'rodando' WHERE id = ?").run(t.id)
  return t
})

export function concluirTarefa(id: number, resultado: string, erro: boolean): void {
  db.prepare('UPDATE tarefas SET status = ?, resultado = ?, concluida_em = ? WHERE id = ?').run(
    erro ? 'falhou' : 'concluida',
    resultado.slice(0, 4000),
    new Date().toISOString(),
    id
  )
}

/**
 * O que ficou 'rodando' quando o app morreu volta pra fila.
 *
 * Sem isto a tarefa fica órfã pra sempre: ninguém a executa (não está
 * pendente) e ela aparece eternamente como "rodando" na listagem.
 */
export function reabrirTarefasOrfas(): number {
  return db.prepare("UPDATE tarefas SET status = 'pendente' WHERE status = 'rodando'").run().changes
}

/** Ativas sempre; concluídas só as do último dia — o resto é arquivo. */
export function listarTarefas(): Tarefa[] {
  return db
    .prepare(
      `SELECT id, descricao, status FROM tarefas
       WHERE status IN ('pendente', 'rodando') OR concluida_em > datetime('now', '-1 day')
       ORDER BY id DESC LIMIT 20`
    )
    .all() as Tarefa[]
}

/** Só pendente cancela: o que já está rodando não tem como ser interrompido. */
export function cancelarTarefa(id: number): boolean {
  return db.prepare("DELETE FROM tarefas WHERE id = ? AND status = 'pendente'").run(id).changes > 0
}

/**
 * A explicação de uma recusa, reconstruída do log (LGPD Art. 20).
 *
 * Filtra por ferramenta quando você lembra QUAL comando foi, e cai pras
 * últimas decisões quando você só lembra que "ontem ela recusou alguma
 * coisa" — que é como a pergunta realmente chega.
 */
export function decisoes(
  ferramenta?: string,
  soRecusas = true,
  limite = 10
): { id: number; momento: string; ferramenta: string; argumentos: string; decisao: string }[] {
  return db
    .prepare(
      `SELECT id, momento, ferramenta, argumentos, decisao FROM execucoes
       WHERE decisao IS NOT NULL
         AND (@ferramenta IS NULL OR ferramenta = @ferramenta)
         AND (@soRecusas = 0 OR confirmou = 1)
       ORDER BY id DESC LIMIT @limite`
    )
    .all({ ferramenta: ferramenta ?? null, soRecusas: soRecusas ? 1 : 0, limite }) as {
    id: number
    momento: string
    ferramenta: string
    argumentos: string
    decisao: string
  }[]
}

// ---------------------------------------------------------------
// Cadastro de rostos autorizados (2.6 — vigilância)
// ---------------------------------------------------------------

/**
 * SÓ QUEM AUTORIZOU ENTRA AQUI.
 *
 * O `descritor` é um vetor de 128 floats — a saída do FaceNet, não uma
 * imagem. Não existe caminho de volta: não dá pra reconstruir o rosto a
 * partir dele. Ainda é dado biométrico (LGPD Art. 5º-II), e por isso a
 * tabela guarda `criado_em`: consentimento tem data, e uma base biométrica
 * sem data de coleta não tem como provar que houve consentimento.
 *
 * Quem NÃO está aqui nunca é gravado. O descritor de um desconhecido é
 * calculado em memória, comparado, e descartado no mesmo tique — o sistema
 * registra QUE havia um desconhecido, nunca QUEM era.
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS rostos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    nome      TEXT NOT NULL UNIQUE,
    descritor BLOB NOT NULL,
    criado_em TEXT NOT NULL
  );
`)

export function cadastrarRosto(nome: string, descritor: number[]): void {
  if (
    !nome.trim() ||
    nome.length > 80 ||
    ![128, 384].includes(descritor.length) ||
    !descritor.every(Number.isFinite)
  )
    throw new Error('Cadastro facial inválido.')
  // Recadastrar sobrescreve: cortou o cabelo, botou óculos, o vetor mudou.
  db.prepare(
    `INSERT INTO rostos (nome, descritor, criado_em) VALUES (?, ?, ?)
     ON CONFLICT(nome) DO UPDATE SET descritor = excluded.descritor, criado_em = excluded.criado_em`
  ).run(nome, Buffer.from(new Float32Array(descritor).buffer), new Date().toISOString())
}

export function rostosCadastrados(): {
  nome: string
  descritor: number[]
  descritores: number[][]
  criado_em: string
}[] {
  return (
    db.prepare('SELECT nome, descritor, criado_em FROM rostos ORDER BY nome').all() as {
      nome: string
      descritor: Buffer
      criado_em: string
    }[]
  ).map((r) => ({
    nome: r.nome,
    // O Buffer pode ser uma VISTA sobre um buffer maior — byteOffset
    // explícito, mesmo cuidado do vetor da memória.
    descritor: [...new Float32Array(r.descritor.buffer, r.descritor.byteOffset, 128)],
    descritores: Array.from({ length: r.descritor.byteLength / 512 }, (_, i) => [
      ...new Float32Array(r.descritor.buffer, r.descritor.byteOffset + i * 512, 128)
    ]),
    criado_em: r.criado_em
  }))
}

/** O direito ao esquecimento, que numa base biométrica não é opcional. */
export function esquecerRosto(nome: string): boolean {
  return db.prepare('DELETE FROM rostos WHERE nome = ?').run(nome).changes > 0
}

db.exec(`CREATE TABLE IF NOT EXISTS eventos_visuais (
  id INTEGER PRIMARY KEY AUTOINCREMENT, momento TEXT NOT NULL, texto TEXT NOT NULL, miniatura TEXT
)`)

export function registrarEventoVisual(texto: string, miniatura?: string): void {
  db.transaction(() => {
    db.prepare('INSERT INTO eventos_visuais (momento, texto, miniatura) VALUES (?, ?, ?)').run(
      new Date().toISOString(),
      texto,
      miniatura ?? null
    )
    db.prepare(
      'DELETE FROM eventos_visuais WHERE id NOT IN (SELECT id FROM eventos_visuais ORDER BY id DESC LIMIT 200)'
    ).run()
  })()
}
export function eventosVisuais(): {
  id: number
  momento: string
  texto: string
  miniatura: string | null
}[] {
  return db.prepare('SELECT * FROM eventos_visuais ORDER BY id DESC LIMIT 50').all() as ReturnType<
    typeof eventosVisuais
  >
}
export function limparSeguranca(tipo: 'imagens' | 'historico'): void {
  if (tipo === 'imagens') db.prepare('UPDATE eventos_visuais SET miniatura = NULL').run()
  else if (tipo === 'historico')
    db.transaction(() => {
      db.prepare('DELETE FROM eventos_visuais').run()
      db.prepare("DELETE FROM execucoes WHERE ferramenta LIKE 'vigilancia:%'").run()
    })()
  else throw new Error('Opção inválida')
}

db.exec(
  `CREATE TABLE IF NOT EXISTS eventos_perimetro (id TEXT PRIMARY KEY, momento INTEGER NOT NULL, dados TEXT NOT NULL)`
)
export function salvarEventoPerimetro(
  evento: import('../shared/vigilancia').EventoVigilancia
): void {
  db.prepare('INSERT OR REPLACE INTO eventos_perimetro (id,momento,dados) VALUES (?,?,?)').run(
    evento.id,
    evento.momento,
    JSON.stringify(evento)
  )
  db.prepare(
    'DELETE FROM eventos_perimetro WHERE id NOT IN (SELECT id FROM eventos_perimetro ORDER BY momento DESC LIMIT 500)'
  ).run()
}
export function listarEventosPerimetro(
  dias = 7,
  apenasPendentes = false
): import('../shared/vigilancia').EventoVigilancia[] {
  db.prepare('DELETE FROM eventos_perimetro WHERE momento < ?').run(
    Date.now() - Math.max(1, Math.min(30, dias)) * 86400000
  )
  const consulta = apenasPendentes
    ? "SELECT dados FROM eventos_perimetro WHERE json_extract(dados, '$.entrega') = 'pendente' ORDER BY momento ASC LIMIT 500"
    : 'SELECT dados FROM eventos_perimetro ORDER BY momento DESC LIMIT 500'
  return (db.prepare(consulta).all() as { dados: string }[]).map((r) => JSON.parse(r.dados))
}
export function apagarEventosPerimetro(): void {
  db.prepare('DELETE FROM eventos_perimetro').run()
}

/** Os alarmes de vigilância, do mais recente pro mais antigo (2.6). */
export function eventosVigilancia(limite = 20): {
  id: number
  momento: string
  resultado: string
}[] {
  return db
    .prepare(
      `SELECT id, momento, resultado FROM execucoes
       WHERE ferramenta LIKE 'vigilancia:%' ORDER BY id DESC LIMIT ?`
    )
    .all(limite) as { id: number; momento: string; resultado: string }[]
}

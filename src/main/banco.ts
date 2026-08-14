import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

// userData = %APPDATA%\izze no Windows. Fora do projeto, então
// não some quando você limpa build nem vai parar no git.
const db = new Database(join(app.getPath('userData'), 'izze.sqlite'))

// WAL: leitura e escrita ao mesmo tempo sem travar.
// Importante porque o dashboard lê enquanto o agente escreve.
db.pragma('journal_mode = WAL')

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

// Statement preparado uma vez só. O better-sqlite3 é SÍNCRONO —
// não tem await aqui, e isso é proposital: é mais rápido que async
// pra SQLite local e não polui o loop do agente com promises.
const inserir = db.prepare(`
  INSERT INTO execucoes (momento, ferramenta, argumentos, resultado, erro, duracao_ms)
  VALUES (@momento, @ferramenta, @argumentos, @resultado, @erro, @duracao)
`)

export function registrar(r: {
  ferramenta: string
  argumentos: string
  resultado: string
  erro: boolean
  duracao: number
}): void {
  inserir.run({
    momento: new Date().toISOString(),
    ferramenta: r.ferramenta,
    argumentos: r.argumentos,
    // corta resultado gigante: listar_pasta pode devolver 50 linhas
    resultado: r.resultado.slice(0, 500),
    erro: r.erro ? 1 : 0,
    duracao: r.duracao
  })
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
 */
const TETO_DIARIO = Number(import.meta.env.MAIN_VITE_TETO_DIARIO ?? 45)

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
  return { usadas, teto: TETO_DIARIO, restantes: Math.max(0, TETO_DIARIO - usadas) }
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

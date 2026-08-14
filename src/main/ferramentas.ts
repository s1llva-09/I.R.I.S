import { exec, spawn, type ChildProcess } from 'child_process'
import { promisify } from 'util'
import { readdir, stat } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { app } from 'electron'
import { existsSync } from 'fs'
import type { ChatCompletionTool } from 'openai/resources/chat/completions'
import { estatisticas, usoHoje } from './banco'

const executar = promisify(exec)

/**
 * Roda um script PowerShell e devolve a saída em texto — com acento certo.
 *
 * Duas armadilhas resolvidas num lugar só, que é onde elas têm que ficar:
 *
 * 1. ESCAPE. -EncodedCommand em vez de escapar aspas na mão. O script pode
 *    ter ", ', $, crase, quebra de linha — qualquer escape manual quebra um
 *    comando legítimo mais cedo ou mais tarde. Base64 UTF-16LE é o que o
 *    PowerShell aceita cru: não sobra caractere pra escapar.
 *
 * 2. CODIFICAÇÃO. O PowerShell escreve o stdout na página de código do
 *    console (1252 no Windows pt-BR) e o Node lê como UTF-8. Sem a linha de
 *    preparo, "Música" volta "M?sica" — e quem lê isso é o MODELO, que passa
 *    a raciocinar em cima de nome de arquivo corrompido.
 */
function rodarPS(
  script: string,
  opts: { timeout: number; maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  const preparado = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n${script}`
  const b64 = Buffer.from(preparado, 'utf16le').toString('base64')
  return executar(`powershell -NoProfile -EncodedCommand ${b64}`, opts)
}

// ---------------------------------------------------------------
// 0. Percepção do ambiente — quem está na frente agora
// ---------------------------------------------------------------

/**
 * Por que PowerShell e não o pacote `active-win`: ele foi renomeado pra
 * `get-windows` (o nome antigo está deprecado) e os dois são ESM puro COM
 * binário nativo dentro. Em Electron isso custa três coisas: import dinâmico
 * no main que é CJS, `asarUnpack` no electron-builder pro binário sobreviver
 * ao empacotamento, e rebuild por versão do Electron. Funciona em dev e
 * quebra no instalador — o pior lugar pra descobrir.
 *
 * Aqui o PowerShell já é o caminho de todo o resto do arquivo, e user32.dll
 * responde a mesma coisa.
 *
 * Um processo PERSISTENTE pelos mesmos dois motivos do voz.ts: spawn custa
 * ~285ms e o Add-Type recompila o C# a cada processo novo (~400ms). Pagando
 * uma vez no boot, cada leitura seguinte custa zero — e é isso que permite
 * ficar VIGIANDO em vez de só perguntar quando alguém lembra.
 */
const SCRIPT_FOCO = `
# Sem isto o PowerShell escreve o stdout na página de código do console
# (1252 aqui), e o Node lê como UTF-8: "Verificar alteração" chega como
# "Verificar altera??o". Título de janela com acento é a regra, não a
# exceção, então isto conserta o caso comum e não o exótico.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class IzzeFoco {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  public static string Titulo(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@
while ($true) {
  $h = [IzzeFoco]::GetForegroundWindow()
  if ($h -ne [IntPtr]::Zero) {
    $procId = 0
    [void][IzzeFoco]::GetWindowThreadProcessId($h, [ref]$procId)
    $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if ($p) {
      [pscustomobject]@{ programa = $p.ProcessName; titulo = [IzzeFoco]::Titulo($h); caminho = $p.Path } | ConvertTo-Json -Compress
    }
  }
  Start-Sleep -Milliseconds 500
}
`

export type Foco = { programa: string; titulo: string; caminho: string | null }

/**
 * A última janela que NÃO era a própria Izze.
 *
 * Sem isso não há resposta no caso mais comum: quando o usuário digita
 * "o que eu tô fazendo?", quem está em foco é a Izze. Responder "você está
 * usando a Izze" é verdade e não serve pra nada. Guardar a anterior é o que
 * faz a pergunta ter resposta.
 */
let ultimoFoco: Foco | null = null
let vigia: ChildProcess | null = null
let avisarPrimeira: (() => void) | null = null

/**
 * Resolve quando o vigia entrega a PRIMEIRA leitura boa — ou depois de 2s,
 * se ele não entregar nenhuma.
 *
 * Existe por causa de um bug real: na primeira pergunta da sessão a Izze
 * respondia "não sei o que você está fazendo", e na segunda acertava. É uma
 * corrida — spawn + Add-Type levam ~700ms, e a janela da Izze às vezes
 * aparecia e roubava o foco antes disso. O vigia então lia a própria Izze,
 * descartava (certo), e não sobrava nada pra primeira pergunta.
 *
 * Quem espera por isto é o 'ready-to-show' do index.ts. O atraso só existe
 * no boot frio e some atrás do carregamento do React.
 *
 * O relógio dos 2s começa no import, junto com o spawn — é o mesmo instante,
 * e é por isso que o teto pode ser tão curto.
 */
export const primeiraLeitura = new Promise<void>((resolve) => {
  avisarPrimeira = resolve
  setTimeout(resolve, 2000)
})

/**
 * Sobe o vigia. Chamado no CARREGAMENTO do index.ts, antes do whenReady:
 * o spawn + Add-Type levam quase um segundo e precisam terminar antes da
 * janela da Izze roubar o foco, senão a primeira leitura é a própria Izze
 * e a primeira pergunta da sessão fica sem resposta.
 *
 * Amostra a cada 500ms em vez de reagir ao 'blur' da janela. O blur só
 * dispara quando a Izze PERDE o foco, então ele registra pra onde o usuário
 * foi ao sair daqui — e erra em todo caminho Chrome → VSCode → Ctrl+Space,
 * onde ele ainda acha que o usuário está no Chrome. Quanto mais tempo longe
 * da Izze, mais errado ficava.
 */
export function vigiarFoco(): void {
  if (vigia) return

  // -EncodedCommand pelo mesmo motivo do rodar_powershell: o script tem
  // aspas, cifrão e here-string de C#. Base64 não deixa nada pra escapar.
  const b64 = Buffer.from(SCRIPT_FOCO, 'utf16le').toString('base64')
  vigia = spawn('powershell', ['-NoProfile', '-EncodedCommand', b64])
  vigia.on('exit', () => (vigia = null))

  let resto = ''
  vigia.stdout?.on('data', (bloco: Buffer) => {
    // O stdout não respeita linha: um 'data' pode trazer meia linha ou duas
    // e meia. O pop() tira o pedaço incompleto do fim e guarda pro próximo.
    const linhas = (resto + bloco.toString()).split('\n')
    resto = linhas.pop() ?? ''

    for (const linha of linhas) {
      if (!linha.trim()) continue
      try {
        const foco = JSON.parse(linha) as Foco
        // process.execPath é electron.exe em dev e izze.exe empacotado — os
        // dois casos cobertos sem hardcode, e pega junto os processos filhos
        // do Electron, que rodam do mesmo binário. Minúsculas porque o
        // Windows não liga pra caixa e o Get-Process devolve a do disco.
        const nossa = foco.caminho?.toLowerCase() === process.execPath.toLowerCase()
        if (foco.programa && !nossa) {
          ultimoFoco = foco
          // Só a primeira leitura ÚTIL destrava a janela. Uma leitura que
          // caiu na própria Izze não conta: destravar ali seria destravar
          // com o contexto vazio, que é justamente o bug.
          avisarPrimeira?.()
          avisarPrimeira = null
        }
      } catch {
        // Tela de bloqueio, processo protegido, aviso do PowerShell no meio:
        // fica o que já se sabia. Contexto velho é melhor que nenhum.
      }
    }
  })
}

/** Sem isto o PowerShell fica de zumbi depois que o app fecha. */
export function pararVigiaFoco(): void {
  vigia?.kill()
  vigia = null
}

/** A janela em que o usuário estava. Só lê o que o vigia já deixou pronto. */
export function janelaEmFoco(): Foco | null {
  return ultimoFoco
}

/**
 * Duas metades que precisam andar juntas:
 *
 * 1. DECLARACOES  — o que o modelo vê. Ele nunca executa nada; ele só
 *    escolhe um nome e monta os argumentos. Quem executa é você.
 * 2. EXECUTORES   — o código de verdade, indexado pelo mesmo nome.
 *
 * Se os nomes saírem de sincronia, o modelo pede uma ferramenta que
 * não existe e o loop quebra. Por isso os dois ficam neste arquivo.
 *
 * A qualidade da 'description' é o que mais afeta o acerto do modelo.
 * Descrição vaga = ele chama a ferramenta errada. Trate como prompt.
 */

// ---------------------------------------------------------------
// 1. O que o modelo enxerga
// ---------------------------------------------------------------

// Os enums abaixo TÊM que bater com as chaves de APPS e MAPA_PASTAS
// lá embaixo. Enum é o que impede o modelo de inventar um nome —
// ele só pode escolher da lista, então nunca chega lixo no executor.

// Espelho exato das chaves de MAPA_PASTAS. Constante porque duas
// ferramentas usam a mesma lista — duplicar é como as duas saem de sincronia.
const PASTAS = ['desktop', 'documentos', 'downloads', 'musica', 'imagens', 'videos', 'usuario']

/**
 * Nível de risco por ferramenta.
 *   1 = lê ou faz coisa reversível — roda direto
 *   2 = escreve em lugar conhecido (nada usa ainda)
 *   3 = irreversível em potencial — para e pede aprovação
 *
 * Quem consulta isto é o llm.ts, e ele trata AUSENTE COMO 3. Ferramenta
 * nova sem nível declarado pede aprovação em vez de rodar solta: num
 * mapa de permissão, esquecer uma linha não pode virar permissão total.
 */
export const NIVEIS: Record<string, 1 | 2 | 3> = {
  hora_atual: 1,
  listar_pasta: 1,
  analisar_pasta: 1,
  minhas_estatisticas: 1,
  meu_consumo: 1,
  abrir_app: 1,
  rodar_powershell: 3
}

export const DECLARACOES: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'abrir_app',
      description:
        'Abre um programa no computador do usuário. Use quando pedirem para abrir, iniciar ou executar algum aplicativo.',
      parameters: {
        type: 'object',
        properties: {
          app: {
            type: 'string',
            // Espelho exato das chaves de APPS.
            enum: [
              'navegador',
              'vscode',
              'spotify',
              'discord',
              'whatsapp',
              'explorador',
              'calculadora',
              'terminal'
            ],
            description:
              'Qual programa abrir. Use "navegador" para qualquer pedido de browser/internet e "whatsapp" para zap.'
          }
        },
        required: ['app']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'listar_pasta',
      description:
        'Lista os arquivos e subpastas de uma pasta conhecida do usuário. Use quando perguntarem o que tem em alguma pasta.',
      parameters: {
        type: 'object',
        properties: {
          // Antes isso era um caminho livre em string. Virou enum porque
          // caminho livre é o modelo adivinhando onde as coisas ficam —
          // ele chutava "C:\Users\Pablo\Desktop" e errava o nome do usuário.
          // Com enum, quem resolve o caminho real é o Electron.
          pasta: {
            type: 'string',
            enum: PASTAS,
            description: 'Qual pasta base do usuário listar.'
          },
          subcaminho: {
            type: 'string',
            description:
              'Opcional. Subpasta dentro da pasta base, ex: "projetos/izze". Omita para listar a raiz da pasta base.'
          }
        },
        // Só 'pasta' é obrigatório — subcaminho é refinamento.
        required: ['pasta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'analisar_pasta',
      description:
        'Mede quanto espaço cada subpasta ocupa e mostra um gráfico. Use quando perguntarem o que está ocupando espaço.',
      parameters: {
        type: 'object',
        // 'usuario' fica de fora: varrer a home inteira passa do timeout
        // (AppData sozinho tem centenas de milhares de arquivos) e o
        // gráfico voltaria zerado.
        properties: { pasta: { type: 'string', enum: PASTAS.filter((p) => p !== 'usuario') } },
        required: ['pasta']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'minhas_estatisticas',
      description:
        'Mostra estatísticas de uso do próprio assistente: ferramentas mais usadas, atividade por dia, taxa de erro. Use quando perguntarem sobre o uso da Izze, o que ela mais faz, ou se ela está falhando.',
      parameters: {
        type: 'object',
        properties: {
          dias: { type: 'number', description: 'Período em dias. Padrão 7.' }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'meu_consumo',
      description:
        'Mostra quantas chamadas de API foram feitas hoje e quanto resta do limite diário. Use quando perguntarem sobre consumo, cota, limite, gasto, ou quantas chamadas ainda restam hoje.',
      parameters: { type: 'object', properties: {} }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rodar_powershell',
      description:
        'Executa um comando PowerShell no Windows do usuário. Use para qualquer tarefa que as outras ferramentas não cobrem: manipular arquivos, consultar sistema, gerenciar processos, rede. O comando é mostrado ao usuário para aprovação antes de rodar.',
      parameters: {
        type: 'object',
        properties: {
          comando: { type: 'string', description: 'O comando PowerShell completo.' },
          // A explicação é o que o usuário lê no modal pra decidir. Sem ela
          // ele aprovaria um comando cru sem saber o que faz.
          explicacao: {
            type: 'string',
            description: 'Uma frase curta em português explicando o que o comando faz.'
          }
        },
        required: ['comando', 'explicacao']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'hora_atual',
      description:
        'Retorna a data e a hora de agora. Use sempre que a pergunta depender do momento presente — o modelo não tem acesso ao relógio.',
      parameters: { type: 'object', properties: {} }
    }
  }
]

// ---------------------------------------------------------------
// 2. O que roda de verdade
// ---------------------------------------------------------------

// Whitelist em vez de comando livre. Ainda não existe camada de
// permissão (isso é o passo 7), então nada aqui pode ser destrutivo.

const env = process.env

/**
 * Um candidato é normalmente só o caminho/nome/protocolo. A forma com
 * objeto existe pros programas que não abrem sem argumento — hoje só o
 * Discord, mas launcher com argumento é padrão comum no Windows.
 */
type Candidato = string | { exe: string; args: string[] }

// Lista de candidatos por app, em ordem de preferência.
// Caminho absoluto primeiro (mais confiável), nome solto ou protocolo
// depois como rede de segurança. O tentarAbrir desce essa lista.
const APPS: Record<string, Candidato[]> = {
  navegador: [
    `${env.LOCALAPPDATA}\\Programs\\Opera GX\\launcher.exe`,
    `${env.LOCALAPPDATA}\\Programs\\Opera GX\\opera.exe`,
    'opera'
  ],
  vscode: [`${env.LOCALAPPDATA}\\Programs\\Microsoft VS Code\\Code.exe`, 'code'],
  spotify: [`${env.APPDATA}\\Spotify\\Spotify.exe`, 'spotify'],
  // O Discord fica em app-<versão>\Discord.exe e essa pasta muda a cada
  // update, então não dá pra escrever o caminho na mão. O Update.exe é o
  // launcher oficial: com --processStart ele acha a versão atual sozinho.
  // Sem esse argumento o Update.exe abre e fecha sem fazer nada.
  discord: [
    {
      exe: `${env.LOCALAPPDATA}\\Discord\\Update.exe`,
      args: ['--processStart', 'Discord.exe']
    },
    'discord:'
  ],
  // 'whatsapp:' é o protocolo que o app da Store registra — é o que funciona
  // quando não existe .exe nenhum no PATH (caso normal do WhatsApp).
  whatsapp: ['whatsapp:', 'whatsapp'],
  explorador: ['explorer'],
  calculadora: ['calc'],
  terminal: ['wt', 'powershell']
}

/**
 * Traduz o nome amigável que o modelo escolheu para a chave que o
 * Electron entende. O app.getPath resolve o caminho REAL da máquina —
 * funciona com OneDrive redirecionando o Desktop, nome de usuário
 * diferente, Windows em outro idioma. Nada disso a gente adivinharia.
 */
const MAPA_PASTAS: Record<string, Parameters<typeof app.getPath>[0]> = {
  desktop: 'desktop',
  documentos: 'documents',
  downloads: 'downloads',
  musica: 'music',
  imagens: 'pictures',
  videos: 'videos',
  usuario: 'home'
}

/**
 * Tenta abrir cada candidato até um funcionar. Devolve o que abriu,
 * ou null se todos falharam.
 *
 * Por que PowerShell e não 'start' direto: o 'start' do cmd retorna
 * sucesso mesmo quando não acha o programa, então não dá pra saber se
 * abriu. O Start-Process com -ErrorAction Stop lança erro de verdade,
 * e é esse erro que faz o loop pular pro próximo candidato.
 *
 * O timeout existe porque um app travando na abertura seguraria o loop
 * do agente inteiro esperando.
 */
async function tentarAbrir(candidatos: Candidato[]): Promise<string | null> {
  for (const candidato of candidatos) {
    // Normaliza as duas formas num par (exe, args) pro resto do laço
    // não precisar saber qual delas veio.
    const exe = typeof candidato === 'string' ? candidato : candidato.exe
    const args = typeof candidato === 'string' ? [] : candidato.args

    // Caminho absoluto que não existe: nem tenta, economiza um processo.
    // (Nome solto e protocolo não têm '\\', então passam direto.)
    if (exe.includes('\\') && !existsSync(exe)) continue

    // -ArgumentList só entra quando há argumento: o Start-Process recusa
    // uma lista vazia, e aí todo app sem argumento falharia.
    const lista = args.length ? ` -ArgumentList ${args.map((a) => `'${a}'`).join(',')}` : ''

    try {
      await executar(
        `powershell -NoProfile -Command "Start-Process '${exe}'${lista} -ErrorAction Stop"`,
        { timeout: 8000 }
      )
      return exe
    } catch {
      /* não abriu — próximo candidato */
    }
  }
  return null
}

/**
 * Uma ferramenta pode devolver:
 *   - string          → só texto, o modelo lê e responde (caso comum e erros)
 *   - { texto, visual } → texto pro modelo + dados pro renderer desenhar
 *
 * O visual NUNCA volta pro modelo: ele já recebeu o resumo em 'texto'.
 * Mandar a tabela inteira de novo só queimaria contexto.
 * O tipo Visual é global — está em src/preload/index.d.ts.
 */
type Saida = string | { texto: string; visual: Visual }

// O 'any' aqui é proposital: cada executor recebe um shape diferente de
// argumentos, vindo de JSON.parse. Tipar isso exigiria um union + narrowing
// em cada função, e o enum das DECLARACOES já é a validação de verdade.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const EXECUTORES: Record<string, (args: any) => Promise<Saida>> = {
  // Renomeio o parâmetro pra 'nome' porque 'app' já é o import do Electron —
  // sem isso o destructuring sombreia o módulo e o getPath some.
  async abrir_app({ app: nome }) {
    const candidatos = APPS[nome]
    if (!candidatos) return `Erro: "${nome}" não está na lista de apps permitidos.`

    const aberto = await tentarAbrir(candidatos)
    return aberto ? `${nome} aberto.` : `Erro: não encontrei ${nome} instalado neste computador.`
  },

  async listar_pasta({ pasta, subcaminho }) {
    const chave = MAPA_PASTAS[pasta]
    if (!chave) return `Erro: pasta "${pasta}" desconhecida.`

    const base = app.getPath(chave)
    const alvo = resolve(join(base, subcaminho ?? ''))

    // Trava de segurança: impede que "../../.." escape da pasta base.
    // Comparo com 'base + sep' em vez de só 'base' porque startsWith puro
    // deixaria passar uma pasta irmã de nome parecido (Desktop vs DesktopVelho).
    if (alvo !== base && !alvo.startsWith(base + sep)) {
      return 'Erro: caminho fora da pasta permitida.'
    }
    if (!existsSync(alvo)) return `Erro: ${alvo} não existe.`

    const itens = await readdir(alvo, { withFileTypes: true })
    if (itens.length === 0) return 'Pasta vazia.'

    // Corta em 50 pra não estourar o contexto do modelo com node_modules.
    const visiveis = itens.slice(0, 50)
    const lista = visiveis.map((i) => (i.isDirectory() ? `[pasta] ${i.name}` : i.name)).join('\n')

    return {
      // Avisa que cortou — senão o modelo afirma que a pasta só tem 50 itens.
      texto: itens.length > 50 ? `${lista}\n… e mais ${itens.length - 50} itens.` : lista,
      visual: {
        tipo: 'tabela',
        titulo: alvo,
        dados: visiveis.map((i) => ({ nome: i.name, tipo: i.isDirectory() ? 'pasta' : 'arquivo' }))
      }
    }
  },

  async analisar_pasta({ pasta }) {
    const chave = MAPA_PASTAS[pasta]
    if (!chave) return `Erro: pasta "${pasta}" desconhecida.`

    const base = app.getPath(chave)
    const itens = await readdir(base, { withFileTypes: true })

    // Arquivo solto e pasta se medem diferente, e o custo é MUITO diferente:
    // stat é uma syscall, o du recursivo é um PowerShell inteiro. Por isso o
    // teto de 15 vale só pras pastas — cortar arquivo aqui seria economizar nada.
    //
    // O corte é por CONTAGEM, não por tamanho (só dá pra ordenar depois de
    // medir). Ou seja: pasta 16+ em ordem alfabética não entra. É o teto
    // real desta ferramenta.
    // ponytail: se isso incomodar, ordene por mtime antes de cortar.
    const arquivos = itens.filter((i) => i.isFile())
    const pastas = itens.filter((i) => i.isDirectory()).slice(0, 15)

    const medidas = await Promise.all([
      ...arquivos.map(async (i) => {
        try {
          const { size } = await stat(join(base, i.name))
          return { nome: i.name, mb: Math.round(size / 1048576) }
        } catch {
          return { nome: i.name, mb: 0 }
        }
      }),
      // O timeout existe porque pasta grande demora e seguraria o loop do
      // agente inteiro — se estourar, a pasta entra como 0 e some do gráfico.
      ...pastas.map(async (i) => {
        // Aspas simples DOBRADAS: é assim que se escapa apóstrofo no
        // PowerShell. Sem isso, uma pasta chamada "Don't Starve" fecha a
        // string e o resto do nome vira comando.
        const caminho = join(base, i.name).replace(/'/g, "''")
        try {
          const { stdout } = await executar(
            `powershell -NoProfile -Command "(Get-ChildItem -LiteralPath '${caminho}' -Recurse -File -EA SilentlyContinue | Measure-Object Length -Sum).Sum"`,
            { timeout: 20000 }
          )
          return { nome: i.name, mb: Math.round(Number(stdout.trim() || 0) / 1048576) }
        } catch {
          return { nome: i.name, mb: 0 }
        }
      })
    ])

    // Top 10 acima de 1 MB. O resto é ruído que só achata a escala do gráfico.
    const dados = medidas
      .filter((m) => m.mb >= 1)
      .sort((a, b) => b.mb - a.mb)
      .slice(0, 10)
    if (dados.length === 0) return 'Nada acima de 1 MB nessa pasta.'

    return {
      // Resumo curto: o modelo NÃO recebe a lista toda, ela já está no gráfico.
      texto: `${dados.length} itens no gráfico. Maior: ${dados[0].nome} com ${dados[0].mb} MB.`,
      visual: {
        tipo: 'barra' as const,
        titulo: `Espaço em ${pasta}`,
        dados,
        eixoX: 'nome',
        eixoY: 'mb'
      }
    }
  },

  async minhas_estatisticas({ dias }) {
    const periodo = dias ?? 7
    const e = estatisticas(periodo)
    if (e.total === 0) return 'Nenhuma execução registrada ainda.'

    return {
      texto: `${e.total} execuções, ${e.falhas} com erro, média de ${e.mediaMs}ms. Mais usada: ${e.porFerramenta[0].nome}.`,
      visual: {
        tipo: 'pizza' as const,
        titulo: `Ferramentas nos últimos ${periodo} dias`,
        dados: e.porFerramenta,
        eixoX: 'nome',
        eixoY: 'usos'
      }
    }
  },

  async meu_consumo() {
    const u = usoHoje()
    return {
      texto: `${u.usadas} de ${u.teto} chamadas usadas hoje. Restam ${u.restantes}.`,
      visual: {
        tipo: 'kpi' as const,
        titulo: 'Consumo de hoje',
        // UM objeto só, e os rótulos são as CHAVES dele. O kpi do Painel.tsx
        // desenha Object.entries(dados[0]) — a lista de {nome, valor} que os
        // gráficos usam sairia aqui como dois quadrados escritos "nome" e
        // "valor", em vez de três com os números.
        dados: [{ usadas: u.usadas, restantes: u.restantes, teto: u.teto }]
      }
    }
  },

  async rodar_powershell({ comando }) {
    try {
      // O comando vem do modelo: escape e codificação são os dois jeitos de
      // isto dar errado, e o rodarPS já resolve os dois.
      const { stdout, stderr } = await rodarPS(comando, {
        timeout: 30000,
        maxBuffer: 1024 * 1024
      })

      const saida = (stdout || stderr).trim()
      if (!saida) return 'Comando executado, sem saída.'
      // Corta pra não estourar contexto com saída gigante.
      return saida.length > 3000 ? saida.slice(0, 3000) + '\n… (saída cortada)' : saida
    } catch (erro) {
      return `Erro: ${(erro as Error).message}`
    }
  },

  async hora_atual() {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })
  }
}

/**
 * Ponte entre o nome que o modelo escolheu e o código.
 * Nunca deixa o erro subir: um throw aqui mataria o loop do agente.
 * Em vez disso, devolve o erro como texto — o modelo lê, entende que
 * falhou e normalmente tenta outro caminho sozinho.
 */
export async function rodarFerramenta(
  nome: string,
  argumentosJson: string
): Promise<{ texto: string; visual?: Visual }> {
  const executor = EXECUTORES[nome]
  if (!executor) return { texto: `Erro: ferramenta "${nome}" não existe.` }

  try {
    // O modelo devolve os argumentos como STRING de JSON, não como objeto.
    // E às vezes devolve string vazia quando a ferramenta não tem parâmetro.
    const args = argumentosJson ? JSON.parse(argumentosJson) : {}
    const saida = await executor(args)
    // Normaliza aqui, uma vez só: quem chama nunca precisa saber que a
    // ferramenta podia ter devolvido string pelada.
    return typeof saida === 'string' ? { texto: saida } : saida
  } catch (erro) {
    return { texto: `Erro ao executar ${nome}: ${(erro as Error).message}` }
  }
}

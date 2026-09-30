import {
  app,
  shell,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  ipcMain,
  Notification
} from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import icon from '../../resources/icon.png?asset'
import { conversar } from './llm'
import { vigiarFoco, pararVigiaFoco, janelaEmFoco, primeiraLeitura, catalogo } from './ferramentas'
import { rotular, usoHoje } from './banco'
import { ajustarRitmo, aquecerVoz, falar, pararFala } from './voz'
import { GATILHOS, iniciarGatilhos, pararGatilhos } from './gatilhos'
import {
  cadastrarRosto,
  decisoes,
  esquecerRosto,
  eventosVigilancia,
  registrar,
  rostosCadastrados
} from './banco'
import { iniciarFila, pararFila } from './fila'
import { conectar, desconectarCamera, erroCamera, procurarCameras, testarEndereco } from './camera'
import { abrirServidor, fecharServidor } from './servidor'
import {
  abrirPainelSeguranca,
  leituraAtual,
  registrarTransporte,
  reportarPresenca,
  type Leitura
} from './presenca'
import { gravar, ler, lerTudo, primeiraExecucao } from './config'

let janela: BrowserWindow | null = null
let tray: Tray | null = null // module-scope de propósito: se for local, o GC come o ícone
let saindoDeVerdade = false

/**
 * Um turno de chat está no ar? É o que impede o gatilho de disparar uma
 * segunda chamada ao provedor por cima da sua.
 */
let conversando = false

/**
 * O botão de mudo mora no renderer, mas quem fala num gatilho é o main — e
 * com a janela escondida não existe renderer nenhum pra consultar. Sem este
 * espelho, silenciar a Íris silenciaria tudo MENOS a única fala que você não
 * pediu, que é o pior jeito possível de um mudo funcionar.
 */
let vozMuda = false

// ---------- instância única ----------
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => mostrarJanela())

  // O vigia sobe AQUI, antes do whenReady, e não lá embaixo: spawn +
  // Add-Type levam quase um segundo e precisam terminar antes da janela da
  // Íris roubar o foco, senão a primeira leitura é a própria Íris e a
  // PRIMEIRA pergunta da sessão fica sem resposta. Disparando no
  // carregamento do módulo, sobra a janela inteira de boot.
  vigiarFoco()
}

// ---------- janela ----------
function criarJanela(): void {
  janela = new BrowserWindow({
    width: 1380,
    height: 900,
    minWidth: 700,
    minHeight: 560,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#070b14', // evita o flash branco antes do React montar

    /**
     * A barra de título nativa do Windows é clara e não pertence ao mundo
     * fosco do app — era a única peça na tela que denunciava "isto é um
     * Electron". 'hidden' + overlay mantém os botões NATIVOS de minimizar,
     * maximizar e fechar (que é o que o usuário do Windows espera e o que
     * um titlebar desenhado na mão sempre erra), só que pintados na chapa.
     *
     * A altura casa com a barra de status do renderer, então os três botões
     * caem DENTRO dela em vez de criar uma segunda faixa. Mexer numa exige
     * mexer na outra.
     */
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#090e19', symbolColor: '#a5b2c8', height: 40 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  /**
   * Espera o vigia ler a janela ANTES de aparecer.
   *
   * Sem isto, a Íris aparecia, roubava o foco, e a leitura que chegava
   * logo depois era ela mesma — descartada, com razão. Resultado: a
   * PRIMEIRA pergunta da sessão respondia "não sei o que você está
   * fazendo" e só a segunda acertava.
   *
   * Custa até 2s no boot frio (o teto do primeiraLeitura), e some atrás do
   * carregamento do React, que demora mais que isso.
   */
  janela.on('ready-to-show', async () => {
    await primeiraLeitura
    janela?.show()
  })

  // o X esconde, não mata
  janela.on('close', (e) => {
    if (!saindoDeVerdade) {
      e.preventDefault()
      janela?.hide()
    }
  })

  janela.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    janela.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    janela.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function mostrarJanela(): void {
  if (!janela) return criarJanela()
  janela.show()
  janela.focus()
}

function alternarJanela(): void {
  if (janela?.isVisible() && janela.isFocused()) janela.hide()
  else mostrarJanela()
}

/**
 * Registra o atalho global, devolvendo se pegou.
 *
 * O try/catch não é decoração: o acelerador vem de um campo de TEXTO na tela
 * de configurações, e o `register` do Electron LANÇA em string inválida —
 * "Ctrl Space" sem o '+', por exemplo. Sem isto, um erro de digitação numa
 * caixinha derruba o processo main inteiro e o app some da bandeja.
 *
 * Falhou? Volta pro Control+Space. Ficar sem atalho nenhum é pior que ficar
 * com o antigo: a Íris vive escondida, e o atalho é como se chega nela.
 */
function registrarAtalho(acelerador: string): boolean {
  globalShortcut.unregisterAll()
  try {
    if (globalShortcut.register(acelerador, alternarJanela)) return true
    console.warn(`${acelerador} já está em uso por outro programa`)
  } catch {
    console.warn(`${acelerador} não é um atalho válido`)
  }

  if (acelerador !== 'Control+Space') return registrarAtalho('Control+Space')
  return false
}

// ---------- bandeja ----------
function criarTray(): void {
  const img = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Íris')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir  (${ler('atalho')})`, click: mostrarJanela },
      // A bandeja é o caminho de quem está com a janela fechada — e é
      // exatamente quem precisa olhar a câmera sem ter que abrir o chat.
      { label: 'Segurança', click: () => abrirPainelSeguranca() },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { type: 'separator' },
      {
        label: 'Desligar Íris',
        click: () => {
          saindoDeVerdade = true
          app.quit()
        }
      }
    ])
  )
  tray.on('click', alternarJanela)
}

// ---------- avisos dos gatilhos ----------

/**
 * Avisos que aconteceram com a janela fechada.
 *
 * A Íris vive na bandeja: a maior parte dos disparos acontece sem renderer
 * pra receber o evento. Sem esta fila o aviso existiria só como notificação
 * do Windows — some em 5 segundos e nunca entra na conversa, então abrir a
 * janela depois mostraria um histórico que mente por omissão.
 *
 * Teto de 20 porque isto é um buffer, não um segundo banco: quem quiser o
 * registro completo lê a tabela `execucoes`, onde todo disparo é gravado.
 */
const avisosPendentes: Aviso[] = []

function entregarAviso(aviso: Aviso): void {
  const visivel = janela && !janela.isDestroyed() && janela.isVisible()

  if (visivel) janela!.webContents.send('gatilho:aviso', aviso)
  else {
    avisosPendentes.push(aviso)
    if (avisosPendentes.length > 20) avisosPendentes.shift()
  }

  if (!vozMuda) falar(aviso.texto)

  /**
   * A notificação é o caminho principal, não um extra: com a janela na
   * bandeja ela é a única coisa que aparece. O clique abre a Íris, que é
   * onde o texto inteiro está — o body é cortado porque o Windows trunca
   * sem avisar de qualquer jeito.
   */
  if (Notification.isSupported()) {
    const n = new Notification({ title: 'Íris', body: aviso.texto.slice(0, 200) })
    n.on('click', mostrarJanela)
    n.show()
  }
}

// ---------- pedidos do main pra janela ----------

/**
 * Capturas de rosto em aberto: id → resolve. Mesmo desenho das aprovações —
 * a resposta chega num IPC separado, depois que o handler já retornou.
 */
const capturas = new Map<string, (v: number[] | string) => void>()

/** Sem isto uma janela fechada no meio deixa a ferramenta pendurada pra sempre. */
const TIMEOUT_CAPTURA = 8000

function ligarTransporte(): void {
  registrarTransporte({
    capturarRosto: () =>
      new Promise((resolve) => {
        const viva = janela && !janela.isDestroyed()
        if (!viva) return resolve('a janela da Íris está fechada — a câmera não está rodando')

        const id = randomUUID()
        capturas.set(id, resolve)
        janela!.webContents.send('rosto:capturar', id)

        setTimeout(() => {
          if (capturas.delete(id)) resolve('a câmera não respondeu a tempo')
        }, TIMEOUT_CAPTURA)
      }),

    cameraMudou: (ligada: boolean) => janela?.webContents.send('camera:mudou', ligada),

    galeriaMudou: () => janela?.webContents.send('galeria:mudou'),

    abrirSeguranca: () => {
      // Aparecer ANTES de mandar o evento: com a janela na bandeja o painel
      // abriria numa janela invisível, e a ferramenta responderia que abriu.
      mostrarJanela()

      const wc = janela?.webContents
      if (!wc) return

      /**
       * Se a janela ACABOU de nascer, o renderer ainda não existe e um
       * `send` agora cai no vazio — a janela abre no chat e o painel nunca
       * aparece. É o caminho da bandeja com o app fechado, que é justamente
       * o de quem quer só olhar a câmera.
       */
      if (wc.isLoading()) wc.once('did-finish-load', () => wc.send('abrir:seguranca'))
      else wc.send('abrir:seguranca')
    },

    abrirPorta: () => {
      mostrarJanela()
      const wc = janela?.webContents
      if (!wc) return
      if (wc.isLoading()) wc.once('did-finish-load', () => wc.send('abrir:porta'))
      else wc.send('abrir:porta')
    }
  })
}

// ---------- vigilância (2.6) ----------

/**
 * Avisa quando aparece alguém que não está no cadastro.
 *
 * Duas travas contra o alarme que ninguém lê:
 *
 *   - CONFIRMAÇÃO: precisa aparecer em 2 leituras seguidas (3s). Um frame
 *     borrado, alguém passando de costas ou o vizinho atravessando o
 *     enquadramento não viram evento.
 *   - SILÊNCIO: 5 min entre avisos. Sem isto, um desconhecido parado em
 *     frente à câmera gera um aviso a cada 1,5s — 200 notificações por
 *     meia hora, e a próxima de verdade chega num app que você já silenciou.
 *
 * O que vai pro log é a CONTAGEM, nunca a identidade: "1 pessoa não
 * cadastrada". O sistema não sabe quem era, e é isso que o mantém do lado
 * legal de filmar terceiro que não consentiu.
 */
const SILENCIO_VIGIA = 300_000
const CONFIRMACOES = 2

let seguidas = 0
let ultimoAlarme = 0

function vigiar(l: Leitura): void {
  if (l.desconhecidos <= 0) {
    seguidas = 0
    return
  }

  seguidas++
  if (seguidas < CONFIRMACOES) return
  if (Date.now() - ultimoAlarme < SILENCIO_VIGIA) return
  ultimoAlarme = Date.now()

  const quem = l.conhecidos.length ? ` (com ${l.conhecidos.join(', ')})` : ''
  const texto = `Vigilância: ${l.desconhecidos} pessoa(s) não cadastrada(s) em frente à câmera${quem}.`

  const id = registrar({
    ferramenta: 'vigilancia:desconhecido',
    argumentos: `desconhecidos=${l.desconhecidos} conhecidos=${l.conhecidos.length}`,
    resultado: texto,
    erro: false,
    duracao: 0
  })

  entregarAviso({ id, texto, gatilho: 'vigilância', momento: new Date().toISOString() })
}

// ---------- ponte com o renderer ----------

// Aprovações em aberto: id → resolve da Promise. Fica no escopo do módulo
// porque a resposta chega num evento IPC separado, depois que o handler
// que criou a Promise já retornou.
const pendentes = new Map<string, (ok: boolean) => void>()

function registrarIPC(): void {
  /**
   * O que a barra de status desenha. Os dois já estão prontos na memória do
   * main (o vigia mantém o foco, o SQLite responde em microssegundos), então
   * não há custo em o renderer perguntar de tempos em tempos.
   *
   * O 'caminho' do foco fica de fora de propósito: a UI não desenha caminho
   * de executável, e ele é a única parte que exporia estrutura de disco.
   */
  ipcMain.handle('estado:ler', () => {
    const foco = janelaEmFoco()
    return {
      foco: foco && { programa: foco.programa, titulo: foco.titulo },
      uso: usoHoje(),
      // Sai do catálogo e não de uma lista escrita na tela: a SINOPSE do
      // estado vazio ANUNCIA o que a Íris sabe fazer, e lista digitada à
      // mão vira mentira na primeira ferramenta nova.
      ferramentas: catalogo()
    }
  })

  ipcMain.handle('config:ler', () => lerTudo())
  ipcMain.handle('config:primeira', () => primeiraExecucao())

  // A tela de ajustes desenha um interruptor por gatilho, e a lista sai daqui
  // pelo mesmo motivo do `catalogo()`: lista escrita à mão no renderer vira
  // mentira no primeiro gatilho novo.
  ipcMain.handle('gatilhos:lista', () => GATILHOS.map((g) => g.nome))

  ipcMain.handle('config:gravar', (_e, chave: string, valor: unknown) => {
    // O cast é a fronteira: o renderer manda string de um <input>, e o
    // `gravar` é quem sabe o tipo de cada chave. Validar de novo aqui seria
    // duplicar o esquema do config.ts em outro arquivo.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    gravar(chave as any, valor as any)

    // Os dois que precisam VALER AGORA e não no próximo boot. O resto é lido
    // por função a cada uso, então já vale sozinho.
    if (chave === 'atalho') return registrarAtalho(String(valor))
    if (chave === 'vozAtiva') {
      vozMuda = !valor
      if (vozMuda) pararFala()
    }
    // O processo da voz já está no ar e lê comandos do stdin: dá pra mudar a
    // velocidade sem matá-lo, então o slider vale na frase seguinte.
    if (chave === 'vozRitmo') ajustarRitmo()
    return true
  })

  ipcMain.on('aprovacao:resposta', (_e, id: string, ok: boolean) => {
    pendentes.get(id)?.(ok)
    pendentes.delete(id)
  })

  // splice esvazia e devolve na mesma operação: se o renderer recarregar no
  // meio (F5 em dev), o pior caso é perder um aviso da tela — ele continua
  // na tabela `execucoes`.
  ipcMain.handle('gatilhos:drenar', () => avisosPendentes.splice(0))

  // O único julgamento que a Íris não consegue fazer sozinha: se o aviso
  // valeu a interrupção.
  ipcMain.on('gatilhos:rotular', (_e, id: number, util: boolean) => rotular(id, util))

  /**
   * ipcMain.handle = o renderer chama e espera uma Promise.
   * O texto e os avisos de ferramenta chegam ANTES disso, por eventos
   * separados — o handle só resolve quando o loop inteiro termina.
   *
   * conversar() recebe um OBJETO com os dois callbacks, não uma função só.
   * (Era isso que causava "eventos.aoReceberTexto is not a function".)
   */
  ipcMain.handle('chat:enviar', async (evento, historico: ChatCompletionMessageParam[]) => {
    conversando = true
    try {
      const completo = await conversar(historico, {
        // evento.sender = a janela que chamou. Usar isso em vez de
        // janela.webContents evita erro se a janela sumir no meio do stream.
        aoReceberTexto: (pedaco) => evento.sender.send('chat:delta', pedaco),
        aoUsarFerramenta: (nome, args) => evento.sender.send('chat:ferramenta', nome, args),
        aoGerarVisual: (visual) => evento.sender.send('chat:visual', visual),

        // Único ponto do projeto onde o fluxo inverte: o main pergunta ao
        // renderer e fica esperando. A Promise só resolve quando chega o
        // 'aprovacao:resposta' com o mesmo id.
        aoDetectarInjecao: (ferramenta, achados) =>
          evento.sender.send('chat:injecao', ferramenta, achados),

        aoPedirAprovacao: (nome, args, risco) =>
          new Promise<boolean>((resolve) => {
            const id = randomUUID()
            pendentes.set(id, resolve)
            evento.sender.send('aprovacao:pedido', id, nome, args, risco)

            // Sem timeout, uma janela fechada no meio trava o loop pra
            // sempre. O delete devolve false só se ninguém respondeu antes.
            setTimeout(() => {
              if (pendentes.delete(id)) resolve(false)
            }, 120000)
          })
      })
      return { ok: true, texto: completo }
    } catch (erro) {
      // Rede, chave inválida, timeout do provedor... tudo cai aqui.
      // Devolve como valor em vez de throw pro renderer exibir bonito.
      return { ok: false, erro: (erro as Error).message }
    } finally {
      // finally e não depois do return: uma exceção deixaria o flag ligado
      // pra sempre e os gatilhos nunca mais rodariam nesta sessão.
      conversando = false
    }
  })

  // .on e não .handle: o renderer dispara e segue, não espera a fala acabar.
  ipcMain.on('voz:falar', (_e, texto: string) => falar(texto))
  ipcMain.on('voz:parar', () => pararFala())
  ipcMain.on('voz:mudo', (_e, mudo: boolean) => (vozMuda = mudo))
  ipcMain.on('presenca:leitura', (_e, l: Leitura) => {
    reportarPresenca(l)
    vigiar(l)
  })

  ipcMain.handle('rostos:lista', () =>
    rostosCadastrados().map((r) => ({ nome: r.nome, criado_em: r.criado_em }))
  )
  ipcMain.handle('rostos:galeria', () => rostosCadastrados())
  ipcMain.handle('rostos:cadastrar', (_e, nome: string, descritor: number[]) =>
    cadastrarRosto(nome, descritor)
  )
  ipcMain.handle('rostos:esquecer', (_e, nome: string) => esquecerRosto(nome))

  /**
   * A câmera da porta. O main lê o MJPEG e empurra cada quadro como JPEG
   * base64 — a CSP do renderer já aceita `data:`, e sendo mesma origem o
   * canvas não fica *tainted*, que é o que impedia o face-api de ler os
   * pixels quando a imagem vinha direto da rede.
   */
  ipcMain.handle('camera:conectar', (e, url: string) => {
    conectar(url, (jpeg) => {
      if (!e.sender.isDestroyed()) e.sender.send('camera:frame', jpeg)
    })
    return true
  })

  ipcMain.handle('camera:desconectar', () => {
    desconectarCamera()
    fecharServidor()
  })
  ipcMain.handle('camera:erro', () => erroCamera())

  // A varredura demora segundos e é o main que tem socket cru: o renderer
  // só espera. Sem handler próprio, a UI teria que sondar.
  ipcMain.handle('camera:procurar', () => procurarCameras())
  ipcMain.handle('camera:testar', (_e, alvo: string) => testarEndereco(alvo))

  /**
   * O QR que o celular lê pra virar a câmera da porta.
   *
   * Os quadros que chegam pelo servidor entram no MESMO caminho dos do
   * MJPEG — `camera:frame`. Fotos avulsas levam uma marca para permanecer
   * no visor, sem expirar como vídeo nem serem apresentadas como ao vivo.
   */
  ipcMain.handle('camera:qr', (e) =>
    abrirServidor(
      (jpeg, foto) => {
        if (!e.sender.isDestroyed()) e.sender.send('camera:frame', jpeg, foto === true)
      },
      () => leituraAtual()
    )
  )

  /**
   * O resultado da bancada de reconhecimento vai pro MESMO lugar dos outros
   * números do trabalho. Um resultado que vive só na tela não vira tabela
   * de capítulo — e refazer a medição pra reler o número gasta o tempo de
   * quem está escrevendo, não o meu.
   */
  ipcMain.handle('seguranca:salvarMedicao', async (_e, dados: unknown) => {
    const dir = join(app.getAppPath(), 'testes', 'resultados')
    await mkdir(dir, { recursive: true })
    const arquivo = join(dir, `facial_${Date.now()}.json`)
    await writeFile(arquivo, JSON.stringify(dados, null, 2))
    return arquivo
  })

  // A resposta da captura pedida pelo `cadastrar_rosto`.
  ipcMain.on('rosto:capturado', (_e, id: string, valor: number[] | string) => {
    const resolver = capturas.get(id)
    capturas.delete(id)
    resolver?.(valor)
  })

  /**
   * Tudo que o painel de segurança desenha, numa chamada só.
   *
   * Junto e não em três handlers porque a tela abre com os três ao mesmo
   * tempo — e três round-trips de IPC pra pintar uma tela é latência que
   * aparece justamente quando você abriu com pressa.
   */
  ipcMain.handle('seguranca:painel', () => ({
    rostos: rostosCadastrados().map((r) => ({ nome: r.nome, criado_em: r.criado_em })),
    alarmes: eventosVigilancia(10),
    decisoes: decisoes(undefined, true, 8)
  }))
}

// ---------- ciclo de vida ----------
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.izze.app')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  registrarIPC()
  criarJanela()
  criarTray()
  aquecerVoz()
  iniciarGatilhos(GATILHOS, entregarAviso, () => conversando)

  // A fila usa o MESMO entregarAviso: uma tarefa que termina com a janela na
  // bandeja precisa de notificação, voz e da mensagem esperando no chat —
  // que é tudo o que o caminho do gatilho já faz.
  iniciarFila(entregarAviso)
  ligarTransporte()

  // O mudo persiste entre sessões: desligar a voz e reencontrá-la falando
  // no boot seguinte é a definição de configuração que não configura nada.
  vozMuda = !ler('vozAtiva')

  registrarAtalho(ler('atalho'))

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) criarJanela()
  })
})

// marca a saída real ANTES do close disparar
app.on('before-quit', () => {
  saindoDeVerdade = true
})

// Sem isso o app morre quando a última janela fecha. O listener VAZIO já
// basta: o Electron só faz o quit automático quando ninguém escuta este
// evento. Não existe 'e' aqui — o preventDefault antigo não tipava.
app.on('window-all-closed', () => {})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  pararGatilhos()
  pararFila()
  desconectarCamera()
  fecharServidor()
  // Sem isso os PowerShell da voz e do vigia de foco ficam de zumbi
  // depois que o app fecha.
  pararFala()
  pararVigiaFoco()
})

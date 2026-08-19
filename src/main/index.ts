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
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import icon from '../../resources/icon.png?asset'
import { conversar } from './llm'
import { vigiarFoco, pararVigiaFoco, janelaEmFoco, primeiraLeitura, catalogo } from './ferramentas'
import { rotular, usoHoje } from './banco'
import { ajustarRitmo, aquecerVoz, falar, pararFala } from './voz'
import { GATILHOS, iniciarGatilhos, pararGatilhos } from './gatilhos'
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
 * espelho, silenciar a Izze silenciaria tudo MENOS a única fala que você não
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
  // Izze roubar o foco, senão a primeira leitura é a própria Izze e a
  // PRIMEIRA pergunta da sessão fica sem resposta. Disparando no
  // carregamento do módulo, sobra a janela inteira de boot.
  vigiarFoco()
}

// ---------- janela ----------
function criarJanela(): void {
  janela = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#05090E', // evita o flash branco antes do React montar

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
    titleBarOverlay: { color: '#0b1219', symbolColor: '#93a6b3', height: 40 },
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  /**
   * Espera o vigia ler a janela ANTES de aparecer.
   *
   * Sem isto, a Izze aparecia, roubava o foco, e a leitura que chegava
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
 * com o antigo: a Izze vive escondida, e o atalho é como se chega nela.
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
  tray.setToolTip('Izze')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Abrir  (${ler('atalho')})`, click: mostrarJanela },
      { type: 'separator' },
      {
        label: 'Iniciar com o Windows',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked })
      },
      { type: 'separator' },
      {
        label: 'Desligar Izze',
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
 * A Izze vive na bandeja: a maior parte dos disparos acontece sem renderer
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
   * bandeja ela é a única coisa que aparece. O clique abre a Izze, que é
   * onde o texto inteiro está — o body é cortado porque o Windows trunca
   * sem avisar de qualquer jeito.
   */
  if (Notification.isSupported()) {
    const n = new Notification({ title: 'Izze', body: aviso.texto.slice(0, 200) })
    n.on('click', mostrarJanela)
    n.show()
  }
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
      // estado vazio ANUNCIA o que a Izze sabe fazer, e lista digitada à
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

  // O único julgamento que a Izze não consegue fazer sozinha: se o aviso
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
  // Sem isso os PowerShell da voz e do vigia de foco ficam de zumbi
  // depois que o app fecha.
  pararFala()
  pararVigiaFoco()
})

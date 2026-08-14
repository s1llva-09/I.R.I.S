import {
  app,
  shell,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  ipcMain
} from 'electron'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions'
import icon from '../../resources/icon.png?asset'
import { conversar } from './llm'
import { vigiarFoco, pararVigiaFoco, janelaEmFoco, primeiraLeitura } from './ferramentas'
import { usoHoje } from './banco'
import { aquecerVoz, falar, pararFala } from './voz'

let janela: BrowserWindow | null = null
let tray: Tray | null = null // module-scope de propósito: se for local, o GC come o ícone
let saindoDeVerdade = false

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
    backgroundColor: '#0E1116', // evita o flash branco antes do React montar

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
    titleBarOverlay: { color: '#161a21', symbolColor: '#9aa1ac', height: 40 },
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

// ---------- bandeja ----------
function criarTray(): void {
  const img = nativeImage.createFromPath(icon).resize({ width: 16, height: 16 })
  tray = new Tray(img)
  tray.setToolTip('Izze')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Abrir  (Ctrl+Space)', click: mostrarJanela },
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
      uso: usoHoje()
    }
  })

  ipcMain.on('aprovacao:resposta', (_e, id: string, ok: boolean) => {
    pendentes.get(id)?.(ok)
    pendentes.delete(id)
  })

  /**
   * ipcMain.handle = o renderer chama e espera uma Promise.
   * O texto e os avisos de ferramenta chegam ANTES disso, por eventos
   * separados — o handle só resolve quando o loop inteiro termina.
   *
   * conversar() recebe um OBJETO com os dois callbacks, não uma função só.
   * (Era isso que causava "eventos.aoReceberTexto is not a function".)
   */
  ipcMain.handle('chat:enviar', async (evento, historico: ChatCompletionMessageParam[]) => {
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
        aoPedirAprovacao: (nome, args) =>
          new Promise<boolean>((resolve) => {
            const id = randomUUID()
            pendentes.set(id, resolve)
            evento.sender.send('aprovacao:pedido', id, nome, args)

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
    }
  })

  // .on e não .handle: o renderer dispara e segue, não espera a fala acabar.
  ipcMain.on('voz:falar', (_e, texto: string) => falar(texto))
  ipcMain.on('voz:parar', () => pararFala())
}

// ---------- ciclo de vida ----------
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.izze.app')
  app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))

  registrarIPC()
  criarJanela()
  criarTray()
  aquecerVoz()

  const ok = globalShortcut.register('Control+Space', alternarJanela)
  if (!ok) console.warn('Ctrl+Space já está em uso por outro programa')

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
  // Sem isso os PowerShell da voz e do vigia de foco ficam de zumbi
  // depois que o app fecha.
  pararFala()
  pararVigiaFoco()
})

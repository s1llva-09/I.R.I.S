// Build first, then: node testes/interface.cjs
// A hidden offscreen Electron window renders only the built renderer with a mock bridge.
// Screenshots and a JSON report are written to ignored out/ui-checks/.
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Executable CommonJS UI verification harness. */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

if (!process.versions.electron) {
  const { spawnSync } = require('node:child_process')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(require('electron'), [__filename], {
    env,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
} else {
  const { app, BrowserWindow, session, ipcMain } = require('electron')
  const output = path.join(__dirname, '../out/ui-checks')
  const renderer = path.join(__dirname, '../out/renderer/index.html')
  fs.mkdirSync(output, { recursive: true })
  app.setPath('userData', path.join(output, 'profile'))
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
  const failures = []
  const results = []
  let win
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const evaluate = (code) => win.webContents.executeJavaScript(code, true)
  const waitFor = async (code, label) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(code)) return
      await delay(100)
    }
    throw new Error(`Timed out: ${label}`)
  }
  const click = async (selector) => {
    assert(
      await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`),
      `Missing ${selector}`
    )
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
    await delay(200)
  }
  const layout = () =>
    evaluate(`(() => {
    const visible = (el) => el.getClientRects().length > 0;
    const containers = [...document.querySelectorAll('html, body, .app-shell, .app-body, .workspace, .workspace-content, .security-dashboard, .settings-page, .conversation, main')].filter(visible);
    return {
      viewport: [innerWidth, innerHeight],
      headings: [...document.querySelectorAll('h1, h2')].filter(visible).map(el => el.textContent.trim()),
      selected: [...document.querySelectorAll('[aria-current="page"]')].filter(visible).map(el => el.title || el.textContent.trim()),
      overflow: containers.filter(el => el.scrollWidth > el.clientWidth + 2).map(el => ({ tag: el.tagName, className: el.className, width: el.clientWidth, scrollWidth: el.scrollWidth })),
      text: document.body.innerText
    };
  })()`)
  const check = async (name, width, height, expectation, screenshot = true) => {
    const state = await layout()
    assert.deepEqual(state.viewport, [width, height], `${name}: viewport`)
    assert.deepEqual(
      state.overflow,
      [],
      `${name}: horizontal overflow ${JSON.stringify(state.overflow)}`
    )
    assert(
      expectation(state),
      `${name}: missing expected navigation/content ${JSON.stringify(state.headings)}`
    )
    if (screenshot) {
      await delay(150)
      const capture = await win.webContents.capturePage()
      assert(!capture.isEmpty(), `${name}: empty screenshot`)
      fs.writeFileSync(path.join(output, `${name}-${width}x${height}.png`), capture.toPNG())
    }
    results.push({
      name,
      width,
      height,
      headings: state.headings,
      selected: state.selected,
      overflow: state.overflow
    })
    console.log(`PASS ${name} ${width}x${height}`)
  }

  const run = async () => {
    assert(fs.existsSync(renderer), 'Run npm run build before this UI check.')
    await app.whenReady()
    const isolatedSession = session.fromPartition('ui-smoke')
    isolatedSession.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false)
    )
    isolatedSession.setPermissionCheckHandler(() => false)
    isolatedSession.webRequest.onBeforeRequest(
      { urls: ['http://*/*', 'https://*/*'] },
      (_details, callback) => callback({ cancel: true })
    )
    ipcMain.on('ui-test:error', (_event, message) => failures.push(message))
    win = new BrowserWindow({
      width: 1380,
      height: 900,
      useContentSize: true,
      frame: false,
      show: false,
      backgroundColor: '#070b14',
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        preload: path.join(__dirname, 'interface-preload.cjs'),
        session: isolatedSession
      }
    })
    win.webContents.on('render-process-gone', (_event, details) =>
      failures.push(`Renderer stopped: ${details.reason}`)
    )
    await win.loadFile(renderer)
    // Offscreen windows are hidden; exercise the same polling used when users see the app.
    await evaluate(
      `Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange'));`
    )
    await waitFor(`Boolean(document.querySelector('.app-shell'))`, 'application shell')
    for (const [width, height] of [
      [1380, 900],
      [1100, 720],
      [700, 650]
    ]) {
      win.setContentSize(width, height)
      await delay(250)
      await click('.sidebar button[title="Segurança"]')
      await waitFor(
        `Boolean([...document.querySelectorAll('h1,h2')].find(el => /segurança/i.test(el.textContent)))`,
        'security heading'
      )
      await check(
        'seguranca',
        width,
        height,
        (s) => s.selected.includes('Segurança') && /câmera/i.test(s.text)
      )
      await click('.sidebar button[title="Assistente"]')
      await check(
        'assistente',
        width,
        height,
        (s) => s.selected.includes('Assistente') && s.headings.some((h) => /Vamos além/.test(h))
      )
      await click('.sidebar button[title="Configurações"]')
      await check(
        'configuracoes',
        width,
        height,
        (s) => s.selected.includes('Configurações') && s.headings.includes('Configurações')
      )
      await click('.settings-security-link')
      await check('atalho-seguranca', width, height, (s) => s.selected.includes('Segurança'), false)
      await click('.sidebar button[title="Modo porta"]')
      await check(
        'porta',
        width,
        height,
        (s) => s.selected.includes('Modo porta') && /Íris · porta/i.test(s.text)
      )
      await evaluate(
        `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`
      )
      await delay(100)
      assert.equal(await evaluate('window.location.hash'), '', 'Escape clears the door-mode hash')
    }
    win.setContentSize(1380, 900)
    await evaluate('window.__uiTest.populate()')
    await click('.sidebar button[title="Segurança"]')
    await waitFor(`document.body.innerText.includes('Evento simulado')`, 'populated event fixture')
    await check('seguranca-dados-simulados', 1380, 900, (s) => s.text.includes('Evento simulado'))
    await click('.security-tabs button:last-child')
    await waitFor(
      `document.body.innerText.includes('confirmação necessária')`,
      'risk decision details'
    )
    await click('.security-decision summary')
    assert(await evaluate(`document.body.innerText.includes('Contexto externo simulado')`))
    await evaluate(`window.__uiTest.failNextSave()`)
    await click('.security-heading-actions .security-button-primary')
    await waitFor(
      `document.body.innerText.includes('A configuração não foi salva')`,
      'failed camera save'
    )
    assert.equal(
      await evaluate(`window.__uiTest.config().cameraAtiva`),
      false,
      'Rejected camera save stays off'
    )
    await click('.security-camera-footer button')
    await waitFor(
      `Boolean(document.querySelector('.security-management[open]'))`,
      'camera management'
    )
    await check('conexoes', 1380, 900, (s) => s.text.includes('Calibração do reconhecimento'))
    await click('.security-roster-actions button')
    assert(
      await evaluate(
        `document.querySelector('.security-registration button[type=submit]').disabled`
      ),
      'Registration needs consent'
    )
    await evaluate(
      `window.__uiTest.emit('aprovacao', 'ui-approval', 'acao_de_teste', '{}', { confirma:true, escore:5, limiar:3, motivos:['Ação de teste'], sinais:[] })`
    )
    await waitFor(
      `Boolean(document.querySelector('[role=dialog]'))`,
      'approval stays above security'
    )
    assert(
      await evaluate(`getComputedStyle(document.querySelector('[role=dialog]')).zIndex === '80'`)
    )
    await click('[role=dialog] button')
    assert.equal(
      await evaluate(`Boolean(document.querySelector('[role=dialog]'))`),
      false,
      'Refuse dismisses the approval'
    )
    // A generated blank local image verifies blob CSP, source loading and the packaged models.
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1a3348'; ctx.fillRect(0,0,160,90);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      const files = new DataTransfer(); files.items.add(new File([blob], 'teste_01.png', {type:'image/png'}));
      const input = document.querySelector('.security-file-button input:not([multiple])');
      input.files = files.files; input.dispatchEvent(new Event('change', {bubbles:true}));
    })()`)
    await waitFor(
      `document.querySelector('.camera-badge')?.textContent.includes('IMAGEM DE TESTE')`,
      'test photo preview'
    )
    await waitFor(
      `document.body.innerText.includes('Nenhum rosto no enquadramento.')`,
      'local facial model analyzes blank photo'
    )
    await evaluate(`document.querySelector('.security-dashboard').scrollTop = 0`)
    await check(
      'foto-local',
      1380,
      900,
      (s) => s.text.includes('IMAGEM DE TESTE') && !s.text.includes('AO VIVO')
    )
    await click('.security-heading-actions button:last-child')
    await waitFor(
      `document.querySelector('.camera-badge')?.textContent.includes('SEM TRANSMISSÃO')`,
      'paused camera has no stale picture'
    )
    assert.equal(await evaluate(`window.__uiTest.config().cameraAtiva`), false)
    assert.deepEqual(failures, [], `Runtime errors: ${failures.join('; ')}`)
    const report = {
      passed: results.length,
      failures,
      results,
      limitations:
        'UI exercised with a simulated preload, no real camera, network, LLM or system actions.'
    }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
    console.log(`UI checks passed: ${results.length}. Screenshots: ${output}`)
    win.destroy()
    app.exit(0)
  }
  run().catch(async (error) => {
    console.error(error)
    if (win && !win.isDestroyed()) {
      const state = await layout().catch(() => null)
      fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(state, null, 2))
      const capture = await win.webContents.capturePage().catch(() => null)
      if (capture) fs.writeFileSync(path.join(output, 'failure.png'), capture.toPNG())
      console.error(state?.text?.slice(-4000))
    }
    fs.writeFileSync(
      path.join(output, 'report.json'),
      JSON.stringify(
        { passed: results.length, failures: [...failures, error.message], results },
        null,
        2
      )
    )
    if (win && !win.isDestroyed()) win.destroy()
    app.exit(1)
  })
}

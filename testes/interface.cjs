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
  app.commandLine.appendSwitch('use-fake-device-for-media-stream')
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
    // Intercept the native file picker and exercise the visible button through a real click.
    const imagemLocal = await evaluate(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#1a3348'; ctx.fillRect(0,0,160,90);
      return { png: canvas.toDataURL('image/png').split(',')[1], jpeg: canvas.toDataURL('image/jpeg').split(',')[1] };
    })()`)
    const arquivoLocal = path.join(output, 'teste_01.png')
    fs.writeFileSync(arquivoLocal, Buffer.from(imagemLocal.png, 'base64'))
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Page.enable')
    await win.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', {
      enabled: true
    })
    let seletor
    const aoAbrirSeletor = (_event, method, params) => {
      if (method === 'Page.fileChooserOpened') seletor = params
    }
    win.webContents.debugger.on('message', aoAbrirSeletor)
    await evaluate(
      `document.querySelector('.security-source-actions button').scrollIntoView({block:'center'})`
    )
    await delay(200)
    const ponto = await evaluate(
      `(() => { const r = document.querySelector('.security-source-actions button').getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`
    )
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...ponto })
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...ponto })
    for (let i = 0; i < 30 && !seletor; i++) await delay(100)
    assert(seletor?.backendNodeId, 'Visible Add Photo button opens the file picker')
    await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', {
      files: [arquivoLocal],
      backendNodeId: seletor.backendNodeId
    })
    win.webContents.debugger.removeListener('message', aoAbrirSeletor)
    await win.webContents.debugger.sendCommand('Page.setInterceptFileChooserDialog', {
      enabled: false
    })
    win.webContents.debugger.detach()
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
    await evaluate(`(() => {
      const files = new DataTransfer(); files.items.add(new File(['invalid'], 'iphone.heic', { type:'image/heic' }));
      document.querySelector('.security-camera-panel').dispatchEvent(new DragEvent('drop', { bubbles:true, dataTransfer:files }));
    })()`)
    await waitFor(
      `document.querySelector('.security-source-error')?.textContent.includes('HEIC')`,
      'clear HEIC error'
    )
    assert(
      await evaluate(
        `document.querySelector('.camera-badge').textContent.includes('IMAGEM DE TESTE')`
      ),
      'Invalid file keeps previous image'
    )
    assert(
      await evaluate(
        `document.querySelector('.security-camera-panel').textContent.includes('teste_01.png')`
      )
    )
    await evaluate(`(async () => {
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#38545d'; ctx.fillRect(0,0,320,240);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/jpeg'));
      const files = new DataTransfer(); files.items.add(new File([blob], 'foto-arrastada.jpg', {type:'image/jpeg'}));
      document.querySelector('.security-camera-panel').dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:files}));
    })()`)
    await waitFor(
      `document.querySelector('.security-camera-panel').textContent.includes('foto-arrastada.jpg')`,
      'drag drop updates preview'
    )
    await click('.security-phone-guide .security-text-button')
    await waitFor(`Boolean(document.querySelector('.security-qr'))`, 'phone photo session')
    await delay(500)
    await evaluate(`window.__uiTest.emit('frame', ${JSON.stringify(imagemLocal.jpeg)}, true)`)
    await waitFor(
      `document.querySelector('.security-camera-panel').textContent.includes('Foto do celular')`,
      'phone photo appears'
    )
    await waitFor(
      `document.querySelector('.camera-badge').textContent.includes('IMAGEM DE TESTE')`,
      'phone photo is a still image'
    )
    await delay(6500)
    assert(
      await evaluate(
        `document.querySelector('.camera-badge').textContent.includes('IMAGEM DE TESTE')`
      ),
      'Phone photo persists past the video timeout'
    )
    await check(
      'foto-celular',
      1380,
      900,
      (s) => s.text.includes('Foto do celular') && !s.text.includes('AO VIVO')
    )
    await evaluate(`document.querySelector('.security-extras').scrollIntoView()`)
    await waitFor(
      `document.querySelector('.security-extras').textContent.includes('Presença simulada')`,
      'visual history'
    )
    await check('diagnostico', 1380, 900, (s) => s.text.includes('Luminosidade média'))
    await click('.security-extras input[type="checkbox"]')
    await waitFor(
      `window.__uiTest.config().miniaturasSeguranca === true`,
      'thumbnail preference saved'
    )
    await evaluate(
      `[...document.querySelectorAll('.security-extras button')].find(b=>b.textContent.includes('Apagar histórico')).click()`
    )
    await evaluate(
      `[...document.querySelectorAll('.security-extras button')].find(b=>b.textContent.includes('Cancelar')).click()`
    )
    assert.equal(
      await evaluate(
        `document.querySelector('.security-extras').textContent.includes('Presença simulada')`
      ),
      true
    )
    await evaluate(
      `[...document.querySelectorAll('.security-extras button')].find(b=>b.textContent.includes('Apagar histórico')).click()`
    )
    await evaluate(
      `[...document.querySelectorAll('.security-extras button')].find(b=>b.textContent.includes('Confirmar exclusão')).click()`
    )
    await waitFor(
      `document.querySelector('.security-extras').textContent.includes('Nenhuma mudança')`,
      'history deleted'
    )
    await evaluate(
      `[...document.querySelectorAll('.security-extras button')].find(b=>b.textContent.includes('Ativar privacidade')).click()`
    )
    await waitFor(
      `document.querySelector('.camera-badge')?.textContent.includes('SEM TRANSMISSÃO')`,
      'paused camera has no stale picture'
    )
    assert.equal(await evaluate(`window.__uiTest.config().cameraAtiva`), false)
    await evaluate(
      `[...document.querySelectorAll('button')].find(b => b.textContent.includes('Celular ao vivo')).click()`
    )
    await waitFor(`!!document.querySelector('.security-tls-guide')`, 'HTTPS pairing instructions')
    win.setContentSize(700, 650)
    await waitFor('window.innerWidth === 700', 'narrow viewport')
    await evaluate(`document.querySelector('.security-management').open = true`)
    await evaluate(`document.querySelector('.security-tls-guide').scrollIntoView()`)
    await check('pareamento-https', 700, 650, (s) => s.text.includes('Certificados Confiáveis'))
    win.setContentSize(1380, 900)
    await delay(200)
    const preencherCamera = async (valores) => {
      for (const [indice, valor] of valores.entries()) {
        await evaluate(`(() => {
          const input = document.querySelectorAll('.camera-edit-form input')[${indice}];
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(valor)});
          input.dispatchEvent(new Event('input', { bubbles:true }));
        })()`)
      }
      await evaluate(`document.querySelector('.camera-edit-form').requestSubmit()`)
      await waitFor(`!document.querySelector('.camera-edit-form')`, 'camera saved')
    }
    for (const ambiente of ['Sala', 'Quarto']) {
      await click('.camera-control-heading button')
      await preencherCamera([`Câmera ${ambiente}`, ambiente, 'http://127.0.0.1:9000/video'])
    }
    assert.equal(await evaluate(`document.querySelectorAll('.camera-card').length`), 2)
    await evaluate(
      `[...document.querySelectorAll('.camera-toolbar button')].find(b=>b.textContent.includes('Conectar todas')).click()`
    )
    await waitFor(
      `[...document.querySelectorAll('.camera-card footer button:first-child')].every(b=>b.textContent === 'Pausar')`,
      'two cameras connected'
    )
    await evaluate(`(() => {
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 400;
      const ctx = canvas.getContext('2d');
      ['1','2'].forEach((id, i) => { ctx.fillStyle = i ? '#234b3e' : '#19364b'; ctx.fillRect(0,0,640,400); ctx.fillStyle='#bdf0ff'; ctx.font='32px sans-serif'; ctx.fillText(i ? 'Quarto • imagem simulada' : 'Sala • imagem simulada',40,200);
        window.__uiTest.emit('centralFrame', { id, jpeg:canvas.toDataURL('image/jpeg').split(',')[1], foto:true, momento:Date.now() });
      });
    })()`)
    await waitFor(`document.querySelectorAll('.camera-online').length === 2`, 'two decoded feeds')
    await evaluate(`document.querySelector('.camera-control').scrollIntoView()`)
    await check(
      'multicameras',
      1380,
      900,
      (s) => s.text.includes('Câmera Sala') && s.text.includes('Câmera Quarto')
    )
    await evaluate(
      `(() => { const s=document.querySelector('[aria-label="Filtrar ambiente"]'); s.value='Quarto'; s.dispatchEvent(new Event('change',{bubbles:true})) })()`
    )
    assert.equal(
      await evaluate(`document.querySelectorAll('.camera-mosaic > div:not([hidden])').length`),
      1
    )
    await evaluate(
      `(() => { const s=document.querySelector('[aria-label="Filtrar ambiente"]'); s.value=''; s.dispatchEvent(new Event('change',{bubbles:true})) })()`
    )
    await evaluate(
      `[...document.querySelector('[data-camera-id="1"]').querySelectorAll('button')].find(b=>b.textContent==='Editar').click()`
    )
    await preencherCamera(['Sala principal', 'Sala', 'http://127.0.0.1:9000/video'])
    assert.equal(
      await evaluate(`document.querySelector('[data-camera-id="1"] h3').textContent`),
      'Sala principal'
    )
    await evaluate(
      `[...document.querySelector('[data-camera-id="1"]').querySelectorAll('button')].find(b=>b.textContent==='Pausar').click()`
    )
    await waitFor(
      `document.querySelector('[data-camera-id="1"] header').textContent.includes('Pausada')`,
      'isolated pause'
    )
    assert.equal(
      await evaluate(
        `document.querySelector('[data-camera-id="2"] header').textContent.includes('Foto')`
      ),
      true
    )
    win.setContentSize(700, 650)
    await delay(200)
    await evaluate(`document.querySelector('.camera-control').scrollIntoView()`)
    await check('multicameras-compacto', 700, 650, (s) => s.text.includes('Sala principal'))
    await evaluate(
      `[...document.querySelector('[data-camera-id="2"]').querySelectorAll('button')].find(b=>b.textContent==='Remover').click()`
    )
    await evaluate(
      `[...document.querySelectorAll('.camera-control button')].find(b=>b.textContent==='Confirmar remoção').click()`
    )
    await waitFor(`document.querySelectorAll('.camera-card').length === 1`, 'camera removed')
    await click('.sidebar button[title="Assistente"]')
    await click('.sidebar button[title="Segurança"]')
    await waitFor(
      `document.querySelector('.camera-card h3')?.textContent === 'Sala principal'`,
      'camera saved across navigation'
    )
    await evaluate(`document.querySelector('.vigia-panel details').open=true`)
    await evaluate(
      `(() => {const s=document.querySelector('.vigia-panel select');s.value='1';s.dispatchEvent(new Event('change',{bubbles:true}))})()`
    )
    await waitFor(
      `!!document.querySelector('.vigia-zone-editor img')`,
      'zone preview from cached frame'
    )
    await evaluate(`document.querySelector('.vigia-zone-editor').scrollIntoView()`)
    await evaluate(
      `(() => { const el=document.querySelector('.vigia-zone-editor');const r=el.getBoundingClientRect();[[.2,.2],[.8,.2],[.8,.8],[.2,.8]].forEach(([x,y])=>el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:r.left+x*r.width,clientY:r.top+y*r.height}))) })()`
    )
    await delay(200)
    assert.equal(await evaluate(`document.querySelectorAll('.vigia-zone-editor circle').length`), 4)
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel button')].find(b=>b.textContent==='Adicionar área').click()`
    )
    await waitFor(`!!document.querySelector('.vigia-zone-saved')`, 'zone added')
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel button')].find(b=>b.textContent==='Salvar proteção').click()`
    )
    await waitFor(`window.__uiTest.monitor().ajustes.cameras.length===1`, 'zone persisted')
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel button')].find(b=>b.textContent==='Ativar Fora de casa').click()`
    )
    await waitFor(
      `document.querySelector('.vigia-mode').textContent.includes('ativo')`,
      'armed state'
    )
    assert.equal(await evaluate(`document.querySelector('.vigia-fieldset').disabled`), true)
    await click('.sidebar button[title="Assistente"]')
    assert.equal(await evaluate(`window.__uiTest.monitor().modo`), 'armado')
    await click('.sidebar button[title="Segurança"]')
    await waitFor(
      `document.querySelector('.vigia-mode')?.textContent.includes('ativo')`,
      'monitor remains armed across navigation'
    )
    await evaluate(`document.querySelector('.vigia-panel').scrollIntoView()`)
    await check('vigilancia-compacto', 700, 650, (s) => s.text.includes('Fora de casa'))
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel details')].find(d=>d.querySelector('summary').textContent.includes('Íris no celular')).open=true`
    )
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel button')].find(b=>b.textContent==='Parear Íris no celular').click()`
    )
    await waitFor(`!!document.querySelector('.vigia-pairing')`, 'phone companion pairing')
    await evaluate(`document.querySelector('.vigia-pairing').scrollIntoView()`)
    await check('iris-celular-pareamento', 700, 650, (s) =>
      s.text.includes('Adicionar à Tela de Início')
    )
    await evaluate(
      `[...document.querySelectorAll('.vigia-panel button')].find(b=>b.textContent==='Desarmar proteção').click()`
    )
    await waitFor(`window.__uiTest.monitor().modo==='desarmado'`, 'disarmed state')
    isolatedSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
    isolatedSession.setPermissionCheckHandler((_wc, permission) => permission === 'media')
    await evaluate(`(async()=>{
      const stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});stream.getTracks().forEach(t=>t.stop());
      const d=(await navigator.mediaDevices.enumerateDevices()).find(d=>d.kind==='videoinput');
      const c=await window.api.central.salvar({id:'',nome:'Webcam simulada',ambiente:'Teste',tipo:'webcam',endereco:d.deviceId});
      const m=window.__uiTest.monitor();m.ajustes.cameras.push({cameraId:c.id,zonas:[{id:'webcam',nome:'Teste',pontos:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}]});
      await window.api.vigilancia.salvar(m.ajustes);await window.api.vigilancia.armar();await window.api.central.conectar(c.id);
    })()`)
    await waitFor(`window.__uiTest.quadros()>2`, 'background webcam captures frames')
    await click('.sidebar button[title="Assistente"]')
    const antes = await evaluate(`window.__uiTest.quadros()`)
    await waitFor(`window.__uiTest.quadros()>${antes}+3`, 'webcam continues outside security view')
    await evaluate(`window.api.central.pararTudo()`)
    await delay(1500)
    const parados = await evaluate(`window.__uiTest.quadros()`)
    await delay(600)
    assert.equal(await evaluate(`window.__uiTest.quadros()`), parados, 'Pause stops webcam capture')
    await check(
      'webcam-em-segundo-plano',
      700,
      650,
      (s) => s.selected.includes('Assistente'),
      false
    )
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

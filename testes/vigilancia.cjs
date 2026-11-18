/* eslint-disable @typescript-eslint/no-require-imports */
// Banco e certificados isolados dentro de out/testes. Nenhum alerta externo é enviado.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
fs.mkdirSync('out/testes', { recursive: true })
const dir = fs.mkdtempSync(path.resolve('out/testes/vigilancia-'))
const env = { ...process.env, IRIS_BANCO: path.join(dir, 'teste.sqlite'), IRIS_TESTE_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE
const r = spawnSync(require('electron'), ['out/main/teste-vigilancia.js'], {
  env,
  stdio: 'inherit',
  windowsHide: true
})
if (r.error) throw r.error
process.exit(r.status ?? 1)

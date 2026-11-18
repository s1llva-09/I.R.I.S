import { app } from 'electron'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import Database from 'better-sqlite3'

/**
 * A troca de nome izze -> iris não pode perder dado.
 *
 * Roda num appData temporário: monta uma pasta "izze" de mentira, com banco
 * SQLite de verdade e o certificado do celular, e confere que o banco do
 * nome novo abre com o conteúdo antigo e que a pasta antiga fica intacta.
 *
 *   npm run teste:migracao
 */

const raiz = mkdtempSync(join(tmpdir(), 'iris-migracao-'))
// O nome antes do appData: o Electron fixa o userData no setPath com o nome do
// momento. No app de verdade o nome já chega "iris" pelo package.json.
app.setName('iris')
app.setPath('appData', raiz)
delete process.env.IRIS_BANCO
delete process.env.IZZE_BANCO

const antiga = join(raiz, 'izze')
mkdirSync(join(antiga, 'camera-tls'), { recursive: true })
writeFileSync(join(antiga, 'camera-tls', 'autoridade.json'), '{"cert":"ca-do-celular"}')
const velho = new Database(join(antiga, 'izze.sqlite'))
velho.exec("CREATE TABLE marca (v TEXT); INSERT INTO marca VALUES ('dados antigos')")
velho.close()

void app.whenReady().then(async () => {
  let codigo = 0
  try {
    // Import dinâmico: o banco.ts migra ao ser carregado, e o appData precisa
    // estar apontado para a pasta temporária antes disso.
    const { CAMINHO_BANCO } = await import('../src/main/banco')
    const nova = join(raiz, 'iris')
    assert.equal(CAMINHO_BANCO, join(nova, 'iris.sqlite'), 'o banco novo mora em %APPDATA%\\iris')
    const db = new Database(CAMINHO_BANCO, { readonly: true })
    assert.equal(
      (db.prepare('SELECT v FROM marca').get() as { v: string }).v,
      'dados antigos',
      'o conteúdo do banco antigo chegou'
    )
    db.close()
    assert.equal(
      readFileSync(join(nova, 'camera-tls', 'autoridade.json'), 'utf8'),
      '{"cert":"ca-do-celular"}',
      'o certificado que o celular confia veio junto'
    )
    assert.ok(
      !existsSync(join(nova, 'izze.sqlite')),
      'o banco não fica com o nome velho na pasta nova'
    )
    assert.ok(
      existsSync(join(antiga, 'izze.sqlite')),
      'a pasta antiga fica como cópia de segurança'
    )
    console.log('PASS migração izze -> iris: banco, certificado e cópia de segurança preservados')
  } catch (e) {
    console.error(e)
    codigo = 1
  } finally {
    app.exit(codigo)
  }
})

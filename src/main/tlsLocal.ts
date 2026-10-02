import { app, safeStorage } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { X509Certificate } from 'crypto'
import { generate } from 'selfsigned'

let fila: Promise<unknown> = Promise.resolve()
export function certificadoLocal(ip: string): ReturnType<typeof gerarCertificadoLocal> {
  const tarefa = fila.then(() => gerarCertificadoLocal(ip))
  fila = tarefa.catch(() => undefined)
  return tarefa
}

async function gerarCertificadoLocal(
  ip: string
): Promise<{ key: string; cert: string; raiz: string; impressao: string }> {
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('O sistema não oferece armazenamento seguro para a chave HTTPS.')
  const dir = join(app.getPath('userData'), 'camera-tls')
  await mkdir(dir, { recursive: true })
  const arquivo = join(dir, 'autoridade.json')
  let raiz: { cert: string; private: string }
  try {
    const salvo = JSON.parse(await readFile(arquivo, 'utf8'))
    raiz = {
      cert: salvo.cert,
      private: safeStorage.decryptString(Buffer.from(salvo.key, 'base64'))
    }
    if (Date.parse(new X509Certificate(raiz.cert).validTo) < Date.now() + 86400_000 * 100)
      throw new Error('Certificado vencendo')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    raiz = await generate([{ name: 'commonName', value: 'Iris Camera Local' }], {
      algorithm: 'sha256',
      keySize: 2048,
      notAfterDate: new Date(Date.now() + 86400_000 * 1825),
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true, pathLenConstraint: 0 },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }
      ]
    })
    await writeFile(
      arquivo,
      JSON.stringify({
        cert: raiz.cert,
        key: safeStorage.encryptString(raiz.private).toString('base64')
      }),
      { mode: 0o600 }
    )
  }
  const folha = await generate([{ name: 'commonName', value: ip }], {
    algorithm: 'sha256',
    keySize: 2048,
    notBeforeDate: new Date(Date.now() - 300_000),
    notAfterDate: new Date(Date.now() + 86400_000 * 90),
    ca: { cert: raiz.cert, key: raiz.private },
    extensions: [
      { name: 'basicConstraints', cA: false, critical: true },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames: [{ type: 7, ip }] }
    ]
  })
  return {
    key: folha.private,
    cert: folha.cert,
    raiz: raiz.cert,
    impressao: new X509Certificate(raiz.cert).fingerprint256
  }
}

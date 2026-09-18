import { app } from 'electron'
import { get } from 'http'
import { abrirServidor, fecharServidor } from '../src/main/servidor'

/**
 * Self-check do servidor da câmera do celular (2.6). Sem celular: o que
 * precisa ser verdade é o TOKEN barrando e a página subindo.
 *
 *   npm run teste:servidor
 */
function ok(c: boolean, o: string): void {
  console.log(`${c ? '✓' : '✗'} ${o}`)
  if (!c) throw new Error(o)
}

function buscar(url: string): Promise<{ status: number; corpo: string }> {
  return new Promise((resolve) => {
    get(url, (res) => {
      let corpo = ''
      res.on('data', (d) => (corpo += d))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, corpo }))
    }).on('error', () => resolve({ status: 0, corpo: '' }))
  })
}

async function main(): Promise<void> {
  await app.whenReady()
  try {
    const r = await abrirServidor(
      () => {},
      () => ({ rostos: 1, desconhecidos: 0, conhecidos: ['teste'] })
    )
    if ('erro' in r) throw new Error(r.erro)

    ok(r.qr.includes('<svg'), 'o QR sai em SVG')
    ok(r.url.includes('?t='), 'e a URL carrega o token')

    const semToken = await buscar(r.url.split('?')[0])
    ok(semToken.status === 403, 'sem token, a página é recusada')

    const tokenErrado = await buscar(`${r.url.split('?')[0]}?t=naoehotoken`)
    ok(tokenErrado.status === 403, 'com token errado também')

    const certo = await buscar(r.url)
    ok(certo.status === 200, 'com o token certo, a página vem')
    ok(certo.corpo.includes('getUserMedia'), 'e ela pede a câmera do navegador')

    // A degradação em http:// é o conserto do "undefined is not an object":
    // a página tem que DIZER que o navegador não libera câmera fora de
    // https, e oferecer a foto, em vez de estourar num objeto inexistente.
    ok(
      certo.corpo.includes('aoVivoPossivel'),
      'e checa se o navegador expõe a câmera antes de tentar'
    )
    ok(certo.corpo.includes('capture="environment"'), 'com foto como caminho que sempre funciona')

    const estado = await buscar(`${r.url.split('?')[0]}estado?t=${r.url.split('?t=')[1]}`)
    ok(JSON.parse(estado.corpo).conhecidos[0] === 'teste', 'o /estado devolve a leitura atual')

    const denovo = await abrirServidor(
      () => {},
      () => ({ rostos: 0, desconhecidos: 0, conhecidos: [] })
    )
    ok(!('erro' in denovo) && denovo.url === r.url, 'chamar de novo não sobe um segundo servidor')

    console.log('\nOK')
  } catch (e) {
    console.log(`\n✗ ${(e as Error).message}`)
  }
  fecharServidor()
  app.exit(0)
}

void main()

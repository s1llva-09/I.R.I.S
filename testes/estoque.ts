import { app } from 'electron'
import assert from 'node:assert/strict'
import { createServer } from 'http'
import { mkdirSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { gravar } from '../src/main/config'
import { FONTES_EXTERNAS } from '../src/main/confianca'
import { NIVEIS, rodarFerramenta } from '../src/main/ferramentas'

/**
 * A Íris falando com o site de estoque (estoque-iris) pela API.
 *
 * Sem ESTOQUE_URL, sobe um site FALSO que imita o contrato da API com os
 * dados do `dados_exemplo.py` (CAM-002 = ESP32-CAM, saldo 17). Com
 * ESTOQUE_URL e ESTOQUE_TOKEN, roda contra o site de verdade — que precisa
 * estar com o banco recém-populado pelo `dados_exemplo.py`:
 *
 *   npm run teste:estoque
 *   ESTOQUE_URL=http://127.0.0.1:5000 ESTOQUE_TOKEN=... npm run teste:estoque
 */

mkdirSync('out/testes', { recursive: true })
app.setPath('userData', mkdtempSync(join(process.cwd(), 'out/testes/estoque-')))

const TOKEN = 'token-falso'

function siteFalso(): ReturnType<typeof createServer> {
  let saldo = 17
  const json = (res: import('http').ServerResponse, status: number, corpo: unknown): void => {
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(corpo))
  }
  return createServer((req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`)
      return json(res, 401, { erro: 'Token inválido.' })
    const url = new URL(req.url ?? '/', 'http://x')
    if (req.method === 'GET' && url.pathname === '/api/produtos')
      return json(res, 200, {
        produtos: [
          { codigo: 'CAM-002', nome: 'Câmera ESP32-CAM', tipo: 'camera', preco: 89.9, estoque: saldo }
        ].filter((p) => p.nome.toLowerCase().includes(url.searchParams.get('busca') ?? ''))
      })
    if (req.method === 'GET' && url.pathname === '/api/resumo')
      return json(res, 200, {
        resumo: { produtos: 6, unidades: 42, valor: 9000, vendas: 2000, zerados: 1 },
        por_tipo: [
          { tipo: 'camera', unidades: 24, vendido: 1768.9 },
          { tipo: 'sensor', unidades: 18, vendido: 718.8 },
          { tipo: 'fechadura', unidades: 4, vendido: 799 }
        ]
      })
    if (req.method === 'POST' && url.pathname === '/api/movimentacoes') {
      let corpo = ''
      req.on('data', (p) => (corpo += p))
      req.on('end', () => {
        const { quantidade, codigo } = JSON.parse(corpo)
        if (quantidade > saldo)
          return json(res, 400, {
            erro: `Estoque insuficiente: disponível ${saldo}, pedido ${quantidade}.`
          })
        saldo -= quantidade
        json(res, 200, { operacao: 'venda', codigo: String(codigo).toUpperCase(), estoque: saldo })
      })
      return
    }
    json(res, 404, { erro: 'não encontrado' })
  })
}

void app.whenReady().then(async () => {
  let codigo = 0
  const falso = process.env.ESTOQUE_URL ? null : siteFalso()
  try {
    // Desligado: a ferramenta diz ONDE configurar, sem tentar rede nenhuma.
    gravar('estoqueUrl', '')
    gravar('estoqueToken', '')
    let r = await rodarFerramenta('estoque_consultar', '{"o_que":"resumo"}')
    assert.match(r.texto, /não está configurado.*Ajustes/)

    let base = process.env.ESTOQUE_URL ?? ''
    if (falso) {
      await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok))
      base = `http://127.0.0.1:${(falso.address() as { port: number }).port}`
    }
    gravar('estoqueUrl', base + '/')
    gravar('estoqueToken', 'errado')
    r = await rodarFerramenta('estoque_consultar', '{"o_que":"resumo"}')
    assert.match(r.texto, /token do estoque não confere/)

    gravar('estoqueToken', process.env.ESTOQUE_TOKEN ?? TOKEN)
    r = await rodarFerramenta('estoque_consultar', '{"o_que":"produtos","busca":"esp32"}')
    assert.match(r.texto, /CAM-002 · Câmera ESP32-CAM · camera · R\$\s?89,90 · 17 un\./)
    assert.equal(r.visual?.tipo, 'tabela')

    r = await rodarFerramenta('estoque_consultar', '{"o_que":"resumo"}')
    assert.match(r.texto, /unidades em estoque/)
    assert.deepEqual(
      r.visual?.dados.map((d) => d.tipo),
      ['camera', 'sensor', 'fechadura']
    )

    r = await rodarFerramenta(
      'estoque_movimentar',
      '{"operacao":"venda","codigo":"cam-002","quantidade":2}'
    )
    assert.equal(r.texto, 'Venda registrada no estoque: 2 × CAM-002. Saldo agora: 15.')

    // A regra de negócio é do site; a Íris só repassa a frase dele.
    r = await rodarFerramenta(
      'estoque_movimentar',
      '{"operacao":"venda","codigo":"CAM-002","quantidade":999}'
    )
    assert.match(r.texto, /Estoque insuficiente: disponível 15, pedido 999/)

    r = await rodarFerramenta(
      'estoque_movimentar',
      '{"operacao":"compra","codigo":"CAM-002","quantidade":1}'
    )
    assert.match(r.texto, /precisa do custo unitário/)

    // A segurança da conexão: ler é livre, mas o que se lê é de terceiros, e escrever sempre para.
    assert.equal(NIVEIS.estoque_consultar, 1)
    assert.equal(NIVEIS.estoque_movimentar, 3)
    assert.ok(FONTES_EXTERNAS.has('estoque_consultar'))
    console.log(
      `PASS estoque (${falso ? 'site falso' : base}): desligado, token errado, consulta, resumo, venda, saldo insuficiente e níveis`
    )
  } catch (e) {
    console.error(e)
    codigo = 1
  } finally {
    falso?.close()
    app.exit(codigo)
  }
})

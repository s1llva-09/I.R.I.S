import { ler } from './config'

/**
 * O SITE DE ESTOQUE (estoque-iris), visto de fora.
 *
 * O estoque é um sistema próprio, com login, usuários e histórico — a Íris
 * não carrega nada disso. Ela fala com a API JSON dele (`/api/...`, token no
 * cabeçalho), igual a qualquer outro cliente. Trocar o site de máquina, ou
 * subir pra nuvem, é mudar a URL em Ajustes.
 *
 * Sem dependência nova: `fetch` global, mesmo motivo do web.ts.
 *
 * ATENÇÃO DE SEGURANÇA: nome de produto é texto que OUTRAS pessoas digitaram
 * no site. Por isso `estoque_consultar` está em FONTES_EXTERNAS — o retorno
 * entra envelopado, e o que a Íris pedir depois de ler escala de nível.
 */

export type Produto = {
  codigo: string
  nome: string
  tipo: 'camera' | 'sensor' | 'fechadura'
  preco: number
  estoque: number
}

/** O site roda na rede local ou na nuvem; 8s cobre os dois sem pendurar o turno. */
const ESPERA = 8000

export async function chamarEstoque<T>(
  caminho: string,
  corpo?: Record<string, unknown>
): Promise<T> {
  const base = ler('estoqueUrl').trim().replace(/\/+$/, '')
  const token = ler('estoqueToken').trim()
  if (!base || !token) {
    // Mensagem e não exceção genérica: quem lê é o modelo, e ele precisa
    // dizer ao usuário ONDE resolver.
    throw new Error('o site do estoque não está configurado — preencha URL e token em Ajustes')
  }

  let resposta: Response
  try {
    resposta = await fetch(base + caminho, {
      method: corpo ? 'POST' : 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(corpo ? { 'Content-Type': 'application/json' } : {})
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(ESPERA)
    })
  } catch (erro) {
    const e = erro as Error
    throw new Error(
      e.name === 'TimeoutError'
        ? `o site do estoque não respondeu em ${ESPERA / 1000}s`
        : `não consegui falar com o site do estoque em ${base} — ele está rodando?`
    )
  }

  // O site devolve { erro } em 400/401/503 com a frase pronta pro usuário.
  const dados = (await resposta.json().catch(() => ({}))) as T & { erro?: string }
  if (!resposta.ok) {
    if (resposta.status === 401) throw new Error('o token do estoque não confere com o do site')
    throw new Error(dados.erro ?? `o site do estoque respondeu ${resposta.status}`)
  }
  return dados
}

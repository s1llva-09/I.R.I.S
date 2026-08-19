import { ler } from './config'

/**
 * BUSCA NA WEB.
 *
 * Tavily e não a API de um buscador: o que o modelo precisa é do TRECHO
 * relevante, e o Google/Bing devolvem uma lista de links que ainda exigiria
 * baixar e limpar cada página. O Tavily já entrega o extrato — o passo caro
 * (buscar, abrir, extrair, resumir) acontece do lado deles.
 *
 * Sem dependência nova: o `fetch` é global no Node do Electron desde a v18.
 * Um SDK aqui seria um pacote pra manter em troca de um POST com JSON.
 *
 * ATENÇÃO DE SEGURANÇA, e é o ponto do arquivo: tudo que sai daqui foi
 * ESCRITO POR ESTRANHOS. É a superfície de injeção mais larga do projeto —
 * mais que o nome de arquivo, mais que o título da janela — porque o atacante
 * escolhe o texto inteiro e só precisa aparecer numa busca. Por isso
 * `buscar_web` está em FONTES_EXTERNAS; sem essa linha, o retorno entra no
 * contexto como se o usuário tivesse dito.
 */

export type Achado = { titulo: string; url: string; trecho: string }

/**
 * O trecho de cada resultado vem cortado.
 *
 * O Tavily devolve algumas centenas de caracteres por achado; 5 resultados
 * inteiros já são uns 3KB entrando no contexto TODA volta seguinte do laço,
 * porque o retorno de ferramenta fica no histórico até o turno acabar.
 */
const MAX_TRECHO = 600

/**
 * Sem `raw_content`. Ele traz a página inteira — dezenas de KB por resultado,
 * o suficiente pra estourar o contexto num pedido de três buscas.
 *
 * ponytail: se um dia faltar profundidade, o caminho é uma ferramenta
 * `ler_pagina` separada, que busca UMA url por escolha do modelo, e não
 * inchar todo resultado desta.
 */
export async function buscar(
  consulta: string,
  maximo = 5
): Promise<{
  resposta: string | null
  achados: Achado[]
}> {
  const chave = ler('tavilyChave')
  if (!chave) {
    // Mensagem e não exceção genérica: quem lê isto é o modelo, e ele precisa
    // conseguir dizer ao usuário ONDE resolver em vez de "a busca falhou".
    throw new Error('não há chave da Tavily configurada — cole uma em Ajustes (tavily.com)')
  }

  const resposta = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${chave}`
    },
    body: JSON.stringify({
      query: consulta,
      max_results: Math.min(Math.max(maximo, 1), 8),
      // 'basic' custa 1 crédito, 'advanced' custa 2 e busca mais fundo. O
      // básico resolve pergunta de fato, que é o caso comum aqui.
      search_depth: 'basic',
      // O resumo que o Tavily monta a partir dos achados. Sai barato e
      // costuma responder sozinho — o modelo lê ele antes dos trechos.
      include_answer: true
    }),
    // Sem isto uma busca pendurada trava o laço do agente até o teto de
    // voltas, gastando o tempo que o usuário está olhando pra tela.
    signal: AbortSignal.timeout(15000)
  })

  if (!resposta.ok) {
    // O corpo do erro do Tavily diz se foi chave inválida ou crédito acabado,
    // e essas duas exigem ações opostas do usuário.
    const detalhe = await resposta.text().catch(() => '')
    throw new Error(`Tavily respondeu ${resposta.status}. ${detalhe.slice(0, 200)}`)
  }

  const dados = (await resposta.json()) as {
    answer?: string | null
    results?: { title?: string; url?: string; content?: string }[]
  }

  return {
    resposta: dados.answer?.trim() || null,
    achados: (dados.results ?? []).map((r) => ({
      titulo: r.title ?? '(sem título)',
      url: r.url ?? '',
      trecho: (r.content ?? '').slice(0, MAX_TRECHO)
    }))
  }
}

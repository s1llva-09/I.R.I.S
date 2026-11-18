import type { EventoVigilancia } from '../shared/vigilancia'

/**
 * RELATÓRIO DE EVENTOS (CSV).
 *
 * Junta as duas trilhas que já existem — os alertas do Fora de casa e o
 * histórico do reconhecimento facial — numa tabela só, em ordem de tempo.
 * É o que se entrega a quem pergunta "o que aconteceu ontem à noite?", e o
 * que vira tabela de capítulo sem ninguém copiar da tela.
 *
 * Formato do Excel em português: separador `;` e BOM UTF-8, senão os
 * acentos e as colunas chegam quebrados.
 */

const TIPOS: Record<EventoVigilancia['tipo'], string> = {
  pessoa: 'Pessoa na área protegida',
  offline: 'Câmera sem sinal',
  recuperada: 'Câmera recuperada',
  sistema: 'Sistema'
}
const ENTREGA: Record<EventoVigilancia['entrega'], string> = {
  pendente: 'Pendente',
  enviado: 'Enviado',
  falhou: 'Falhou',
  desativado: 'Desativado'
}

/**
 * Uma célula: entre aspas, e nunca uma fórmula.
 *
 * O nome da câmera e o texto do evento passam por mão de usuário. Uma célula
 * que começa com =, +, - ou @ o Excel EXECUTA ao abrir (injeção de CSV); o
 * apóstrofo na frente faz ele mostrar o texto em vez de calcular.
 */
export function celula(valor: string): string {
  const seguro = /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor
  return `"${seguro.replace(/"/g, '""')}"`
}

export function relatorioCsv(
  perimetro: EventoVigilancia[],
  visuais: { momento: string; texto: string }[]
): string {
  const linhas: { quando: number; campos: string[] }[] = [
    ...perimetro.map((e) => ({
      quando: e.momento,
      campos: [
        'Fora de casa',
        e.camera,
        TIPOS[e.tipo] ?? e.tipo,
        e.texto,
        ENTREGA[e.entrega] ?? e.entrega
      ]
    })),
    ...visuais.map((v) => ({
      quando: Date.parse(v.momento),
      campos: ['Reconhecimento facial', 'Visor', 'Leitura do reconhecimento', v.texto, '—']
    }))
  ].sort((a, b) => b.quando - a.quando)

  const cabecalho = ['Data e hora', 'Origem', 'Câmera', 'Tipo', 'Descrição', 'Aviso no celular']
  const corpo = linhas.map((l) => [new Date(l.quando).toLocaleString('pt-BR'), ...l.campos])
  return '﻿' + [cabecalho, ...corpo].map((l) => l.map(celula).join(';')).join('\r\n') + '\r\n'
}

/**
 * Fila de fala.
 *
 * Por que fila e não falar() direto: o texto chega em streaming.
 * Se você esperar a resposta inteira pra falar, dá 4s de silêncio e
 * morre a ilusão. Aqui cada frase completa é enviada e toca
 * enquanto o resto ainda está chegando.
 *
 * Quem fala de verdade é o processo MAIN, pelo SAPI do Windows. O
 * speechSynthesis do Chromium existe dentro do Electron mas volta ZERO
 * vozes — speak() é no-op silencioso. Aqui sobra só o buffer, que é
 * lógica de UI mesmo.
 */

let ligada = true

export function alternarVoz(estado: boolean): void {
  ligada = estado
  // O main precisa saber: quem fala num aviso de gatilho é ele, muitas vezes
  // com esta janela escondida. O `ligada` daqui não alcançaria essa fala.
  window.api.mudo(!estado)
  if (!estado) parar()
}

export function falar(texto: string): void {
  if (!ligada || !texto.trim()) return
  window.api.falar(texto)
}

export function parar(): void {
  window.api.pararFala()
}

/**
 * Acumula os pedaços do stream e libera só frases completas.
 * Sem isso você ouviria "o que", "está ocu", "pando" — o TTS não
 * entoa direito em fragmento.
 */

export function criarLeitor(): { alimentar: (p: string) => void; finalizar: () => void } {
  let buffer = ''

  return {
    alimentar(pedaco: string) {
      buffer += pedaco

      // Corta em . ! ? : ; ou quebra de linha
      let corte: number
      while ((corte = buffer.search(/[.!?;:\n]/)) > -1) {
        const frase = buffer.slice(0, corte + 1).trim()
        buffer = buffer.slice(corte + 1)
        // Frase de 1-2 caracteres costuma ser resto de pontuação
        if (frase.length > 2) falar(frase)
      }

      // Escape pra frase longa sem pontuação: "Agora são quatro da manhã e
      // o seu desktop está vazio" não tem um único ponto até o fim, e a voz
      // ficaria muda a resposta inteira. Acima de 90 caracteres corta no
      // último espaço — perde um pouco de entonação, ganha a fala saindo junto.
      if (buffer.length > 90) {
        const espaco = buffer.lastIndexOf(' ')
        if (espaco > 40) {
          falar(buffer.slice(0, espaco))
          buffer = buffer.slice(espaco + 1)
        }
      }
    },

    // O que sobrou sem pontuação no fim
    finalizar() {
      if (buffer.trim().length > 2) falar(buffer)
      buffer = ''
    }
  }
}

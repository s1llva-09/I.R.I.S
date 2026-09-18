import { useEffect, useRef, type JSX } from 'react'
import { fonteAtual, tamanhoFonte, ultimasCaixas } from './presenca'

/**
 * O VISOR — quem está na porta, agora.
 *
 * Até aqui a 2.6 só dizia em texto: "1 NÃO CADASTRADO". Para a camada de
 * risco isso basta, para um porteiro não: "tem um desconhecido" e "tem um
 * desconhecido, e é o entregador" levam a ações opostas, e a segunda só
 * existe se alguém puder OLHAR.
 *
 * Um canvas só, redesenhando a fonte viva a cada frame. Não é `<video>` +
 * overlay por dois motivos:
 *
 *   1. A foto de teste e a câmera entram pelo mesmo caminho — o preview não
 *      precisa saber de qual das duas está lendo.
 *   2. Deixa VISÍVEL que nada é gravado: não existe buffer, nem arquivo, nem
 *      frame retido. Existe a última pintura na tela, e ela é substituída
 *      pela próxima. Fechar o painel apaga o que havia.
 *
 * As caixas vêm da MESMA leitura que alimenta o alarme (`ultimasCaixas`), e
 * não de uma segunda detecção: um retângulo verde sobre alguém que o sistema
 * classificou como desconhecido seria pior que retângulo nenhum.
 */

/** ~12fps. Acima disso é gasto de GPU pra um vídeo que chega a 5fps. */
const INTERVALO = 80

export default function Visor({
  ativo,
  alerta
}: {
  ativo: boolean
  /** Tem desconhecido no enquadramento? Acende os cantos. */
  alerta?: boolean
}): JSX.Element | null {
  const tela = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!ativo) return

    const relogio = window.setInterval(() => {
      const canvas = tela.current
      const fonte = fonteAtual()
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const { w, h } = tamanhoFonte()
      if (!fonte || !w || !h) {
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        return
      }

      // O canvas segue a proporção da FONTE, não o contrário: fixar 4:3 num
      // celular em retrato esticaria o rosto, e rosto esticado é falso
      // "desconhecido" na cabeça de quem está olhando.
      const largura = canvas.clientWidth
      const altura = Math.round((largura * h) / w)
      if (canvas.width !== largura || canvas.height !== altura) {
        canvas.width = largura
        canvas.height = altura
      }

      ctx.drawImage(fonte, 0, 0, largura, altura)

      const escala = largura / w
      ctx.lineWidth = 2
      ctx.font = '600 11px ui-monospace, monospace'

      for (const c of ultimasCaixas()) {
        const x = c.x * escala
        const y = c.y * escala
        const cw = c.w * escala
        const ch = c.h * escala

        // Vermelho é reservado pra desconhecido COM cadastro existente. Sem
        // cadastro, `nome` é null pra todos e a caixa sai neutra — a mesma
        // regra do `ler()`: sem lista pra comparar, ninguém é acusado.
        ctx.strokeStyle = c.nome ? '#6fd39a' : '#ff5646'
        ctx.strokeRect(x, y, cw, ch)

        const rotulo = c.nome ?? 'NÃO CADASTRADO'
        const largRotulo = ctx.measureText(rotulo).width + 8
        ctx.fillStyle = c.nome ? '#6fd39a' : '#ff5646'
        ctx.fillRect(x, Math.max(y - 15, 0), largRotulo, 15)
        ctx.fillStyle = '#0b1219'
        ctx.fillText(rotulo, x + 4, Math.max(y - 4, 11))
      }
    }, INTERVALO)

    return () => clearInterval(relogio)
  }, [ativo])

  if (!ativo) return null

  return (
    <div
      className={`reticula destravar bg-sulco p-px ${
        alerta ? 'colchetes colchetes-alerta' : 'colchetes'
      }`}
    >
      <canvas ref={tela} className="block w-full" />
      {/* O ponto vermelho é requisito, não enfeite: câmera ativa sem sinal
          visível é o que faz alguém desinstalar o app — e a LGPD trata
          transparência como obrigação, não cortesia. */}
      <span className="absolute top-2 right-2 flex items-center gap-1.5 bg-fundo/80 px-1.5 py-0.5 font-hud text-[10px] tracking-[0.2em] text-perigo">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-perigo" />
        AO VIVO
      </span>
    </div>
  )
}

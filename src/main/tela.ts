import { desktopCapturer, screen } from 'electron'

/**
 * VISÃO DE TELA (2.3) — sem dependência nova.
 *
 * O caminho de tutorial é `screenshot-desktop` + `sharp`. O sharp é binário
 * NATIVO: entra com rebuild por versão do Electron, `asarUnpack` no
 * electron-builder pro .node sobreviver ao empacotamento, e ~30MB no
 * instalador. Funciona em dev e quebra no instalador — que é o pior lugar pra
 * descobrir, e é exatamente o motivo pelo qual o `active-win` não entrou
 * neste projeto (ver o comentário do vigia de foco).
 *
 * O `desktopCapturer` do próprio Electron faz as duas coisas: captura E
 * redimensiona, porque o `thumbnailSize` é aplicado na captura, não depois. O
 * `NativeImage` que ele devolve já sabe virar JPEG. Zero dependências, zero
 * rebuild.
 */

/**
 * A largura não é estética. Um print 4K em base64 passa de 3MB, o que estoura
 * o contexto e conta como entrada cara em todo turno seguinte enquanto a
 * imagem estiver no histórico. 1280 mantém texto de interface legível pro
 * modelo e corta o payload em ~10x.
 */
const LARGURA = 1280

export async function capturar(): Promise<{ base64: string; mime: string }> {
  // A proporção sai do monitor real: pedir 1280x800 num ultrawide devolveria
  // a tela esmagada, e o modelo lê texto distorcido pior que texto pequeno.
  const { width, height } = screen.getPrimaryDisplay().size
  const altura = Math.max(1, Math.round((height / width) * LARGURA))

  const fontes = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: LARGURA, height: altura }
  })

  // ponytail: com dois monitores, pega o primeiro. Escolher pelo monitor da
  // janela em foco exigiria casar display_id com screen.getDisplayNearestPoint,
  // e o caso comum aqui é um monitor só.
  const tela = fontes[0]
  if (!tela || tela.thumbnail.isEmpty()) {
    throw new Error('nenhuma tela disponível para captura')
  }

  /**
   * JPEG e não PNG. Print de interface em PNG fica 4-5x maior que o mesmo
   * conteúdo em JPEG 75, e o que se perde é ruído de compressão que o modelo
   * não usa. O que ele precisa — texto de menu, mensagem de erro, código — sai
   * legível.
   *
   * Nada disso toca o disco: o Buffer vira base64 em memória, é consumido uma
   * vez pelo turno e some. Print é o dado mais sensível que a Izze manipula, e
   * um arquivo temporário seria uma cópia que ninguém apaga.
   */
  return { base64: tela.thumbnail.toJPEG(75).toString('base64'), mime: 'image/jpeg' }
}

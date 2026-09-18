/**
 * A classificação de um resultado de reconhecimento (2.6).
 *
 * Mora fora do `presenca.ts` por um motivo só: aquele arquivo importa o
 * face-api, e o face-api precisa de DOM. Esta função é aritmética de
 * strings — e é ela que produz o número que vai pro capítulo, então
 * precisa de um teste que rode sem câmera, sem canvas e sem modelo.
 *
 * Um erro aqui não quebra nada: ele entrega uma taxa de acerto ERRADA que
 * parece certa, e vira parágrafo de TCC.
 */
export type Classe = 'acerto' | 'falsoAceite' | 'falsoRejeite'

/**
 * @param esperado  quem está na foto, segundo o nome do arquivo
 * @param achou     o rótulo que o matcher devolveu, ou 'unknown'
 * @param cadastrados os rótulos que existem na galeria
 *
 * Os dois erros não são simétricos, e a assimetria é o argumento:
 *
 *   FALSO ACEITE  — estranho reconhecido como autorizado. Numa portaria é a
 *                   porta abrindo pra quem não podia entrar.
 *   FALSO REJEITE — autorizado tratado como estranho. Gera alarme à toa, e
 *                   alarme à toa é como um sistema de segurança morre:
 *                   alguém desliga.
 *
 * Reconhecer a pessoa ERRADA (casou, mas com outro nome do cadastro) conta
 * como falso aceite, não como rejeite: o sistema afirmou uma identidade que
 * não era, e o efeito é o mesmo de deixar entrar quem não devia.
 */
export function classificar(esperado: string, achou: string, cadastrados: string[]): Classe {
  const e = esperado.trim().toLowerCase()
  const a = achou.trim().toLowerCase()
  const estaNoCadastro = cadastrados.some((c) => c.trim().toLowerCase() === e)

  if (estaNoCadastro) return a === e ? 'acerto' : a === 'unknown' ? 'falsoRejeite' : 'falsoAceite'
  return a === 'unknown' ? 'acerto' : 'falsoAceite'
}

/** O nome antes do primeiro `_`: `pablo_01.jpg` → `pablo`. */
export function esperadoDe(arquivo: string): string {
  return arquivo.split('_')[0].toLowerCase()
}

/**
 * O estado da cara, derivado da leitura — nunca guardado à parte.
 *
 * Uma máquina de estados própria no componente divergiria da que decide o
 * alarme, e o rosto ficaria verde enquanto o log registra desconhecido. A
 * cara do sistema não pode discordar do sistema, e a única forma de garantir
 * isso é não haver segunda fonte: uma função, uma entrada.
 *
 * A ordem das perguntas É a política: desconhecido vence "reconheceu",
 * mesmo com um autorizado no enquadramento. Um morador acompanhado de
 * alguém que não passou no cadastro é justamente o caso que não pode
 * aparecer como tudo em ordem.
 */
export type EstadoRosto = 'repouso' | 'vendo' | 'reconheceu' | 'alerta'

export function estadoDoRosto(l: {
  rostos: number
  desconhecidos: number
  conhecidos: string[]
}): EstadoRosto {
  if (l.rostos <= 0) return 'repouso'
  if (l.desconhecidos > 0) return 'alerta'
  return l.conhecidos.length ? 'reconheceu' : 'vendo'
}

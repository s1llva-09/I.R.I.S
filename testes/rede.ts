import { app } from 'electron'
import { diagnosticarRede } from '../src/main/camera'

/**
 * Varre a rede procurando câmera e imprime o que achou (2.6).
 *
 * Existe separado da bancada porque o resultado depende do que está LIGADO
 * na sua rede neste momento — não é um número reproduzível, é um
 * diagnóstico. Serve pra responder "a Íris não acha a câmera" sem abrir a
 * interface: se aqui aparece, o problema é UI; se não aparece, é rede.
 *
 *   npm run rede
 */
async function main(): Promise<void> {
  await app.whenReady()
  console.log('varrendo… (alguns segundos por sub-rede)\n')

  const inicio = Date.now()
  const { achados: achadas, vivos, redes } = await diagnosticarRede()

  console.log(`redes varridas: ${redes.map((r) => `${r}.0/24`).join(', ')}`)
  console.log(`${vivos.length} dispositivo(s) na rede: ${vivos.join(', ') || '(nenhum)'}\n`)

  /**
   * A pergunta é 'achou CÂMERA?', não 'achou algo?'.
   *
   * As pistas de tipo desconhecido (a página do roteador) enchiam a
   * lista e faziam o conselho desaparecer justamente na situação em que
   * ele é necessário: dispositivos vivos, nenhum servindo imagem.
   */
  const camera = achadas.some((a) => a.tipo !== 'desconhecido')

  if (!camera) {
    console.log('nenhum deles está servindo imagem.\n')
    console.log('→ o celular está na lista de dispositivos acima?')
    console.log('  SIM  — alcançável: falta LIGAR a transmissão dentro do app da câmera')
    console.log('  NÃO  — está em outra rede (4G? Wi-Fi de visitante?)')
  }

  for (const a of achadas) {
    const extra = a.tipo === 'desconhecido' ? `  respondeu ${a.conteudo}` : ''
    console.log(`${a.tipo.padEnd(12)} ${a.url}${a.servidor ? `  [${a.servidor}]` : ''}${extra}`)
  }

  /**
   * O .1 é o roteador em praticamente toda rede doméstica, e a página de
   * configuração dele responde text/html nas mesmas portas que uma câmera
   * usa. Sem esta distinção o diagnóstico mandava abrir a URL do roteador
   * procurando caminho de vídeo — conselho errado com cara de pista.
   */
  const soRoteador = achadas.length > 0 && achadas.every((a) => /\.1:\d+\//.test(a.url))

  if (soRoteador) {
    console.log('\n→ o que respondeu foi só a página do seu roteador, não uma câmera')
  } else if (achadas.length && achadas.every((a) => a.tipo === 'desconhecido')) {
    console.log('\n→ endereço certo, caminho errado: abra a URL acima no navegador')
    console.log('  e veja no app do celular qual é o caminho do vídeo')
  }

  console.log(`\n${Math.round((Date.now() - inicio) / 1000)}s`)
  app.exit(0)
}

void main()

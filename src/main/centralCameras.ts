import { randomUUID } from 'crypto'
import { criarConexaoCamera } from './camera'
import { criarServidorCelular } from './servidor'
import type { CameraSalva, CameraPainel, QuadroCamera, PareamentoCamera } from '../shared/cameras'

type Sessao = {
  id: string
  rede: ReturnType<typeof criarConexaoCamera>
  celular: ReturnType<typeof criarServidorCelular>
  ultimoQuadro: number | null
  ultimoEnvio: number
  foto: boolean
  pareamento?: PareamentoCamera
  erro: string
  porta: number
}

// Armazenamento injetado também permite testar sem acessar o banco do usuário.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function criarCentralCameras(
  ler: () => CameraSalva[],
  gravar: (cameras: CameraSalva[]) => void,
  enviar: (quadro: QuadroCamera) => void
) {
  const sessoes = new Map<string, Sessao>()
  const quadros = new Map<string, QuadroCamera>()
  function publicar(id: string, jpeg: string, foto = false): void {
    const s = sessoes.get(id)
    if (!s) return
    s.ultimoQuadro = Date.now()
    s.foto = foto
    s.erro = ''
    if (!foto && Date.now() - s.ultimoEnvio < 200) return
    s.ultimoEnvio = Date.now()
    const q = { id, jpeg, foto, momento: s.ultimoQuadro }
    quadros.set(id, q)
    enviar(q)
  }
  function receberWebcam(id: string, sessao: string, jpeg: string): void {
    const s = sessoes.get(id)
    if (!s || s.id !== sessao || !ler().some((c) => c.id === id && c.tipo === 'webcam')) return
    if (
      typeof jpeg !== 'string' ||
      jpeg.length > 1_000_000 ||
      !/^\/9j\/[A-Za-z0-9+/=]+$/.test(jpeg)
    )
      return
    publicar(id, jpeg)
  }
  function falhaWebcam(id: string, sessao: string, permissao: boolean): void {
    const s = sessoes.get(id)
    if (
      !s ||
      s.id !== sessao ||
      typeof permissao !== 'boolean' ||
      !ler().some((c) => c.id === id && c.tipo === 'webcam')
    )
      return
    s.erro = permissao
      ? 'Permita o acesso à webcam nas configurações do sistema e conecte novamente.'
      : 'Não foi possível abrir a webcam. Tentando reconectar.'
  }
  function parar(id: string): void {
    const s = sessoes.get(id)
    sessoes.delete(id)
    quadros.delete(id)
    s?.rede.desconectarCamera()
    s?.celular.fecharServidor()
  }
  function pararTudo(): void {
    for (const id of sessoes.keys()) parar(id)
  }
  function listar(): CameraPainel[] {
    return ler().map((c) => {
      const s = sessoes.get(c.id)
      return {
        ...c,
        ligada: !!s,
        sessao: s?.id ?? null,
        ultimoQuadro: s?.ultimoQuadro ?? null,
        foto: s?.foto ?? false,
        erro: s?.erro || s?.rede.erroCamera() || '',
        pareamento: s?.pareamento
      }
    })
  }
  function salvar(entrada: CameraSalva): CameraSalva {
    if (!entrada || !['rede', 'webcam', 'celular'].includes(entrada.tipo))
      throw new Error('Tipo de câmera inválido.')
    const nome = String(entrada.nome ?? '').trim(),
      ambiente = String(entrada.ambiente ?? '').trim()
    const endereco = String(entrada.endereco ?? '').trim()
    if (!nome || nome.length > 60 || !ambiente || ambiente.length > 60)
      throw new Error('Informe nome e ambiente, com até 60 caracteres.')
    if (endereco.length > 2048) throw new Error('Endereço muito longo.')
    if (entrada.tipo === 'rede') {
      let url: URL
      try {
        url = new URL(endereco)
      } catch {
        throw new Error('Informe uma URL HTTP de vídeo MJPEG.')
      }
      if (url.protocol !== 'http:')
        throw new Error('Use uma transmissão MJPEG HTTP. RTSP e HLS precisam de conversor.')
    }
    if (entrada.tipo === 'webcam' && !endereco) throw new Error('Escolha uma webcam.')
    const lista = ler(),
      antiga = lista.find((c) => c.id === entrada.id)
    if (entrada.id && !antiga) throw new Error('Câmera não encontrada. Atualize o painel.')
    if (!antiga && lista.length >= 12) throw new Error('O painel aceita até 12 câmeras.')
    if (
      entrada.tipo === 'webcam' &&
      lista.some((c) => c.id !== entrada.id && c.tipo === 'webcam' && c.endereco === endereco)
    )
      throw new Error('Esta webcam já está cadastrada.')
    const nova: CameraSalva = {
      id: antiga?.id ?? randomUUID(),
      nome,
      ambiente,
      tipo: entrada.tipo,
      endereco: entrada.tipo === 'celular' ? '' : endereco
    }
    gravar(antiga ? lista.map((c) => (c.id === nova.id ? nova : c)) : [...lista, nova])
    if (antiga && (antiga.tipo !== nova.tipo || antiga.endereco !== nova.endereco)) parar(nova.id)
    return nova
  }
  function remover(id: string): void {
    gravar(ler().filter((c) => c.id !== id))
    parar(id)
  }
  async function conectar(id: string): Promise<void> {
    const c = ler().find((c) => c.id === id)
    if (!c) throw new Error('Câmera não encontrada.')
    if (sessoes.has(id)) return
    let porta = 8800
    while ([...sessoes.values()].some((s) => s.porta === porta)) porta += 2
    const s: Sessao = {
      id: randomUUID(),
      rede: criarConexaoCamera(),
      celular: criarServidorCelular(porta, porta + 1),
      ultimoQuadro: null,
      ultimoEnvio: 0,
      foto: false,
      erro: '',
      porta
    }
    sessoes.set(id, s)
    if (c.tipo === 'webcam') return
    const quadro = (jpeg: string, foto = false): void => {
      if (sessoes.get(id) !== s) return
      publicar(id, jpeg, foto)
    }
    if (c.tipo === 'rede') s.rede.conectar(c.endereco, quadro)
    else {
      const resultado = await s.celular.abrirServidorSeguro(quadro, () => ({
        rostos: -1,
        desconhecidos: 0,
        conhecidos: []
      }))
      if (sessoes.get(id) !== s) return
      if ('erro' in resultado) {
        parar(id)
        throw new Error(resultado.erro)
      }
      s.pareamento = resultado
    }
  }
  return {
    listar,
    salvar,
    remover,
    conectar,
    parar,
    pararTudo,
    receberWebcam,
    falhaWebcam,
    quadro: (id: string): QuadroCamera | null => quadros.get(id) ?? null
  }
}

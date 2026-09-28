import { useEffect, useState, type JSX } from 'react'
import Rosto from './Rosto'
import { estadoDoRosto } from '../../reconhecimento'
import Visor from './Visor'
import { estadoSensor, type Leitura } from './presenca'

/**
 * MODO PORTA — a tela do dispositivo.
 *
 * O rosto grande em cima, o que a câmera vê embaixo. É a composição do
 * hardware: LCD com a cara, câmera acima dela.
 *
 * Abre por `#porta` na URL, e é por isso que ela existe separada do painel:
 * assim você pode largar esta tela numa SEGUNDA janela — ou num monitor
 * pequeno, ou num Raspberry apontando o navegador pro app — enquanto usa a
 * Íris normalmente na primeira. Um kiosk que precisa do chat aberto do lado
 * não é um kiosk.
 *
 * O visor fica pequeno e embaixo de propósito: quem está NA porta precisa
 * ver o rosto reagindo (é o retorno de que foi visto); quem está olhando a
 * tela de longe precisa ver a cor. O vídeo é pra conferência, não é o
 * assunto — e reduzido ele também revela menos de quem passa atrás.
 */
export default function Porta({
  visao,
  aoFechar
}: {
  visao: Leitura
  aoFechar?: () => void
}): JSX.Element {
  /**
   * O estado do rosto SAI da leitura, sem estado próprio.
   *
   * Uma máquina de estados paralela aqui divergiria da que decide o alarme,
   * e aí o rosto ficaria verde enquanto o log registra desconhecido. A cara
   * do sistema não pode discordar do sistema.
   */
  const estado = estadoDoRosto(visao)
  const alerta = estado === 'alerta'

  /**
   * O RELÓGIO.
   *
   * Um display de porta sem hora é um display que ninguém consulta: a
   * primeira pergunta de quem olha uma gravação ou um alarme é "quando".
   * Aqui ele também faz um segundo trabalho — é a prova viva de que a tela
   * está ATUALIZANDO. Rosto parado e hora parada é tela travada; rosto
   * parado com hora correndo é ninguém na porta.
   */
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className={`absolute inset-0 z-50 flex flex-col bg-fundo ${alerta ? 'alarme' : ''}`}>
      {/* A FAIXA DE ESTADO. Versalete pequeno e espaçado, no alto: é a linha
          que um porteiro lê de esguelha sem parar o que está fazendo. */}
      <div className="flex shrink-0 items-baseline gap-4 px-5 pt-4">
        <span className="font-mono text-[12px] font-semibold tracking-[0.3em] text-tinta-3 uppercase">
          Íris · porta
        </span>

        <span className="regua flex-1 font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase">
          {visao.rostos < 0 ? 'sensor desligado' : `${visao.rostos} em quadro`}
        </span>

        <span className="font-mono text-[13px] tabular-nums text-tinta-2">
          {agora.toLocaleTimeString('pt-BR')}
        </span>

        {aoFechar && (
          <button
            onClick={aoFechar}
            className="font-hud text-[11px] tracking-[0.2em] text-tinta-3 uppercase hover:text-tinta"
          >
            fechar
          </button>
        )}
      </div>

      <div className="flex min-h-0 flex-[3] items-center justify-center">
        <Rosto estado={estado} nome={visao.conhecidos.join(', ')} />
      </div>

      <div className="flex min-h-0 flex-[2] items-start justify-center px-6 pb-6">
        <div className="w-full max-w-sm">
          <Visor ativo={estadoSensor().ativo} alerta={alerta} />
        </div>
      </div>
    </div>
  )
}

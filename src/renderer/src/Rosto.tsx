import type { JSX } from 'react'
import type { EstadoRosto } from '../../reconhecimento'
import { Camera, Escudo, Atencao } from './icones'

export type { EstadoRosto }

const ESTADOS = {
  repouso: {
    titulo: 'Nenhuma pessoa detectada',
    descricao: 'Aguardando uma nova leitura da câmera.'
  },
  vendo: {
    titulo: 'Análise em andamento',
    descricao: 'Comparando os rostos com os cadastros deste computador.'
  },
  reconheceu: {
    titulo: 'Pessoa cadastrada',
    descricao: 'Correspondência encontrada no cadastro local.'
  },
  alerta: { titulo: 'Pessoa sem cadastro', descricao: 'Confira a imagem e os eventos de presença.' }
}

/** Estado do reconhecimento no monitor dedicado. */
export default function Rosto({
  estado,
  nome,
  disponivel = true
}: {
  estado: EstadoRosto
  nome?: string
  disponivel?: boolean
}): JSX.Element {
  const leitura = ESTADOS[estado]
  const Icone = !disponivel ? Camera : estado === 'alerta' ? Atencao : Escudo
  return (
    <section
      className={'presence-card presence-' + (disponivel ? estado : 'offline')}
      aria-live="polite"
    >
      <div className="presence-icon">
        <Icone width={24} height={24} />
      </div>
      <p className="presence-caption">Reconhecimento facial</p>
      <h2>{disponivel ? leitura.titulo : 'Câmera indisponível'}</h2>
      <p>{disponivel ? leitura.descricao : 'Ative uma fonte de imagem na central de segurança.'}</p>
      {disponivel && estado === 'reconheceu' && nome && (
        <strong className="presence-name">{nome}</strong>
      )}
      <div className="presence-status">
        <span
          className={`status-dot ${disponivel ? (estado === 'alerta' ? 'is-alert' : 'is-on') : ''}`}
        />
        {disponivel ? 'Leitura local' : 'Sem análise disponível'}
      </div>
    </section>
  )
}

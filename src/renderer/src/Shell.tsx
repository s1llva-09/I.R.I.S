import { useEffect, useState, type JSX, type ReactNode } from 'react'
import {
  Ajustes,
  Arco,
  Camera,
  Casa,
  Escudo,
  Grade,
  Mudo,
  Prompt,
  Pulso,
  Seta,
  Som
} from './icones'

export type Destino = 'assistente' | 'seguranca' | 'porta' | 'ajustes'

export default function Shell({
  children,
  destino,
  navegar,
  voz,
  alternarVoz,
  pensando,
  estado,
  rostos,
  desconhecidos,
  capturando
}: {
  children: ReactNode
  destino: Destino
  navegar: (destino: Destino) => void
  voz: boolean
  alternarVoz: () => void
  pensando: boolean
  estado: Awaited<ReturnType<typeof window.api.estado>> | null
  rostos: number
  desconhecidos: number
  capturando: boolean
}): JSX.Element {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  const destinos = [
    {
      id: 'seguranca' as const,
      nome: 'Segurança',
      detalhe: 'Visão e monitoramento',
      icone: Escudo
    },
    {
      id: 'assistente' as const,
      nome: 'Assistente',
      detalhe: 'Consultas e comandos',
      icone: Prompt
    },
    { id: 'porta' as const, nome: 'Modo porta', detalhe: 'Monitor dedicado', icone: Camera }
  ]
  const uso = estado?.uso
  const percentual =
    uso && uso.teto > 0 ? Math.min(100, Math.max(0, (uso.usadas / uso.teto) * 100)) : 0

  return (
    <div className="app-shell">
      <header className="window-bar">
        <span className="window-brand">
          <Casa width={14} height={14} /> Íris <span>/</span> Controle do ambiente
        </span>
        <span className="window-time">
          {agora.toLocaleDateString('pt-BR')} <span>·</span> {agora.toLocaleTimeString('pt-BR')}
        </span>
      </header>
      <div className="app-body">
        <aside className="sidebar">
          <div className="brand-lockup">
            <div className="brand-emblem">
              <Casa width={22} height={22} />
            </div>
            <div>
              <strong>Íris</strong>
              <small>Controle do ambiente</small>
            </div>
          </div>
          <span className="nav-caption">Navegação</span>
          <nav aria-label="Navegação principal">
            {destinos.map(({ id, nome, detalhe, icone: Icone }) => (
              <button
                key={id}
                className={`nav-item ${destino === id ? 'is-active' : ''}`}
                onClick={() => navegar(id)}
                aria-current={destino === id ? 'page' : undefined}
                title={nome}
              >
                <Icone width={19} height={19} />
                <span>
                  <strong>{nome}</strong>
                  <small>{detalhe}</small>
                </span>
                {destino === id && <i />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="local-status">
              <span className={`status-dot ${rostos >= 0 ? 'is-on' : ''}`} />
              <span>{rostos >= 0 ? 'Sensor conectado' : 'Sensor desconectado'}</span>
              <small>Processamento local</small>
            </div>
            {uso && (
              <div className="quota-card">
                <div>
                  <span>Solicitações hoje</span>
                  <strong>
                    {uso.usadas}
                    <small> / {uso.teto}</small>
                  </strong>
                </div>
                <div
                  className={`quota-track ${percentual >= 80 ? 'is-warning' : ''}`}
                  role="meter"
                  aria-label="Chamadas de IA utilizadas hoje"
                  aria-valuemin={0}
                  aria-valuemax={uso.teto}
                  aria-valuenow={uso.usadas}
                >
                  <i style={{ width: `${percentual}%` }} />
                </div>
                <small>{uso.restantes} disponíveis hoje</small>
              </div>
            )}
            <button
              className={`nav-item nav-settings ${destino === 'ajustes' ? 'is-active' : ''}`}
              onClick={() => navegar('ajustes')}
              aria-current={destino === 'ajustes' ? 'page' : undefined}
              title="Configurações"
            >
              <Ajustes width={19} height={19} />
              <span>
                <strong>Configurações</strong>
              </span>
            </button>
            <div className="sidebar-signature">
              <span className="profile-mark">EU</span>
              <span>
                Meu ambiente<small>Neste dispositivo</small>
              </span>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <div className="workspace-bar">
            <div className="workspace-breadcrumb">
              <Grade width={15} height={15} />
              <span>Íris</span>
              <Seta width={12} height={12} />
              <strong>
                {destino === 'ajustes'
                  ? 'Configurações'
                  : destinos.find((d) => d.id === destino)?.nome}
              </strong>
            </div>
            <div className="workspace-tools">
              {capturando && <span className="capture-label">Capturando tela</span>}
              <span className={`engine-state ${pensando ? 'is-thinking' : ''}`}>
                {pensando ? (
                  <Arco width={12} height={12} className="arco" />
                ) : (
                  <span className="status-dot" />
                )}
                {pensando ? 'Processando' : 'Em espera'}
              </span>
              <button
                className="icon-button"
                onClick={alternarVoz}
                title={voz ? 'Silenciar voz' : 'Ativar voz'}
                aria-label={voz ? 'Silenciar voz' : 'Ativar voz'}
                aria-pressed={voz}
              >
                {voz ? <Som /> : <Mudo />}
              </button>
            </div>
          </div>
          <div className="workspace-content">{children}</div>
          <footer className="system-footer">
            <span>
              <span
                className={`status-dot ${desconhecidos > 0 ? 'is-alert' : rostos >= 0 ? 'is-on' : ''}`}
              />
              {desconhecidos > 0
                ? 'Presença não reconhecida'
                : rostos >= 0
                  ? 'Sensor de presença ativo'
                  : 'Sensor de presença inativo'}
            </span>
            <span className="focus-label" title={estado?.foco?.titulo}>
              {estado?.foco ? `Em foco: ${estado.foco.programa}` : 'Aguardando contexto'}
            </span>
            <span>CTRL + SPACE</span>
          </footer>
        </div>
      </div>
    </div>
  )
}

export function BoasVindas({
  aoComando,
  aoSeguranca
}: {
  aoComando: (texto: string) => void
  aoSeguranca: () => void
}): JSX.Element {
  return (
    <div className="welcome">
      <span className="eyebrow">Consultas e comandos</span>
      <h1>Assistente</h1>
      <p>Consulte o computador, execute comandos e acompanhe suas câmeras.</p>
      <div className="welcome-shortcuts-title">
        <h2>Acesso rápido</h2>
        <span>Selecione uma ação</span>
      </div>
      <div className="welcome-actions">
        <button onClick={aoSeguranca}>
          <Escudo width={23} height={23} />
          <strong>Monitorar câmeras</strong>
          <span>Ver imagens e eventos</span>
          <Seta />
        </button>
        <button onClick={() => aoComando('Como está o meu computador agora?')}>
          <Pulso width={23} height={23} />
          <strong>Estado do computador</strong>
          <span>Consultar uso e desempenho</span>
          <Seta />
        </button>
        <button onClick={() => aoComando('O que você pode fazer por mim?')}>
          <Prompt width={23} height={23} />
          <strong>Recursos disponíveis</strong>
          <span>Consultar funções e comandos</span>
          <Seta />
        </button>
      </div>
      <div className="welcome-note">
        <span className="status-dot" /> Ações sensíveis passam pela avaliação de risco.
      </div>
    </div>
  )
}

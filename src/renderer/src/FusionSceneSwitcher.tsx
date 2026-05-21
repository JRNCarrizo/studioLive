import { PROGRAM_LAYOUTS, type LayoutId } from './programScenes'

type Props = {
  programLayoutId: LayoutId
  onOpenConfig: () => void
  onSelectLayout: (layoutId: LayoutId) => void
  showOrientationDot?: boolean
  programRecording?: boolean
  mixMode?: 'manual' | 'auto'
}

export function FusionSceneSwitcher({
  programLayoutId,
  onOpenConfig,
  onSelectLayout,
  showOrientationDot = false,
  programRecording = false,
  mixMode = 'manual'
}: Props) {
  return (
    <div
      className="fusion-scene-switcher"
      onMouseDown={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <button
        type="button"
        className="fusion-scene-switcher-config"
        onClick={onOpenConfig}
        title="Configurar cámaras y orientación por formato"
        aria-label="Abrir configuración por formato"
      >
        <span aria-hidden>⚙</span>
        {showOrientationDot ? (
          <span
            aria-hidden
            title="Hay una sugerencia de orientación pendiente"
            style={{
              position: 'absolute',
              top: 1,
              right: 3,
              width: 6,
              height: 6,
              borderRadius: 999,
              background: '#38bdf8',
              boxShadow: '0 0 4px #38bdf8'
            }}
          />
        ) : null}
      </button>
      <p className="fusion-scene-switcher-label">Escena</p>
      {PROGRAM_LAYOUTS.map((p) => {
        const active = p.id === programLayoutId
        return (
          <button
            key={p.id}
            type="button"
            className={`fusion-scene-switcher-btn${active ? ' fusion-scene-switcher-btn--active' : ''}`}
            onClick={() => onSelectLayout(p.id)}
            title={`Aplicar al programa: ${p.label}${
              programRecording ? ' (también durante la grabación)' : ''
            }${mixMode === 'auto' && p.id !== 'single' ? ' · pasa el modo a Manual' : ''}`}
          >
            <span>{p.short}</span>
            <span className="fusion-scene-switcher-btn-sub">
              {p.id === 'single' ? '1 cám.' : `${p.slotsCount} sl`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

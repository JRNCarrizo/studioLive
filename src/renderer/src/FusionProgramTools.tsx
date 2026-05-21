import { cropIsFull, type CamCrop } from './programCrop'
import type { CamFraming } from './programFraming'

type Props = {
  cropEditOpen: boolean
  programCrop: CamCrop
  programFramingTarget: CamFraming
  framingNeutral: CamFraming
  onToggleCropEdit: () => void
  onResetCrop: () => void
  onResetFraming: () => void
}

export function FusionProgramTools({
  cropEditOpen,
  programCrop,
  programFramingTarget,
  framingNeutral,
  onToggleCropEdit,
  onResetCrop,
  onResetFraming
}: Props) {
  const zoomActive = programFramingTarget.zoom > 1.001
  const framingDefault =
    zoomActive === false &&
    Math.abs(programFramingTarget.offsetX - framingNeutral.offsetX) < 1e-3 &&
    Math.abs(programFramingTarget.offsetY - framingNeutral.offsetY) < 1e-3

  return (
    <div
      className="fusion-program-tools"
      onMouseDown={(ev) => ev.stopPropagation()}
      onDoubleClick={(ev) => ev.stopPropagation()}
    >
      <div
        className={`fusion-program-tool-block${cropEditOpen ? ' fusion-program-tool-block--crop-active' : ''}`}
      >
        <span className="fusion-program-tool-label" title="Arrastrá el marco o las esquinas en el programa.">
          Recorte
        </span>
        <div className="fusion-program-tool-actions">
          <button type="button" onClick={onToggleCropEdit}>
            {cropEditOpen ? 'Listo' : 'Editar'}
          </button>
          <button type="button" onClick={onResetCrop} disabled={cropIsFull(programCrop)} title="Frame completo">
            Reset
          </button>
        </div>
      </div>
      <div className="fusion-program-tool-block">
        <span
          className="fusion-program-tool-label"
          title="Pellizco y mover a la vez; clic y arrastrar en el programa."
        >
          Zoom
        </span>
        <span
          className={`fusion-program-tool-zoom-value${zoomActive ? ' fusion-program-tool-zoom-value--active' : ''}`}
        >
          {programFramingTarget.zoom.toFixed(2)}×
        </span>
        <div className="fusion-program-tool-actions">
          <button
            type="button"
            onClick={onResetFraming}
            disabled={framingDefault}
            title="Reset zoom (doble clic en el programa)"
          >
            Reset
          </button>
        </div>
      </div>
    </div>
  )
}

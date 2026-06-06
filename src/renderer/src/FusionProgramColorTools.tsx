import {
  COLOR_ADJUST_NEUTRAL,
  COLOR_ADJUST_SLIDERS,
  colorAdjustIsNeutral,
  type CamColorAdjust
} from './programColorAdjust'

type Props = {
  cameraLabel: string
  adjust: CamColorAdjust
  disabled?: boolean
  onChange: (next: CamColorAdjust) => void
  onReset: () => void
}

export function FusionProgramColorTools({
  cameraLabel,
  adjust,
  disabled,
  onChange,
  onReset
}: Props) {
  const isNeutral = colorAdjustIsNeutral(adjust)

  return (
    <div className="fusion-program-color-tools">
      <p className="fusion-program-color-tools__hint">
        Ajustes de <strong>{cameraLabel}</strong>. Se aplican al programa y a la grabación.
      </p>
      {COLOR_ADJUST_SLIDERS.map(({ key, label, title }) => (
        <label key={key} className="fusion-program-color-tools__row" title={title}>
           <span className="fusion-program-color-tools__label">{label}</span>
          <input
            type="range"
            min={-100}
            max={100}
            step={1}
            disabled={disabled}
            value={adjust[key]}
            onChange={(e) => onChange({ ...adjust, [key]: Number(e.target.value) })}
          />
          <span className="fusion-program-color-tools__value">
            {adjust[key] > 0 ? `+${adjust[key]}` : adjust[key]}
          </span>
        </label>
      ))}
      <div className="fusion-program-color-tools__actions">
        <button type="button" disabled={disabled || isNeutral} onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  )
}

export { COLOR_ADJUST_NEUTRAL }

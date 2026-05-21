import { useMemo, useState } from 'react'

import {
  deleteScenePreset,
  listScenePresets,
  saveScenePresetFromCurrent,
  type ScenePreset
} from './programScenePresets'
import type { ProgramBackground } from './programBackground'
import type { LayoutAssignments, LayoutId, ProgramOrientation } from './programScenes'
import { btnNeutral } from './workspaceChrome'

type Snapshot = {
  programLayoutId: LayoutId
  layoutAssignments: LayoutAssignments
  programOrientation: ProgramOrientation
  programCrossfadeMs: number
  background: ProgramBackground
}

type Props = {
  disabled?: boolean
  getSnapshot: () => Snapshot
  onApplyPreset: (preset: ScenePreset) => void
  onStatus: (msg: string) => void
}

export function FusionScenePresetsPanel({ disabled, getSnapshot, onApplyPreset, onStatus }: Props) {
  const [tick, setTick] = useState(0)
  const presets = useMemo(() => listScenePresets(), [tick])

  const refresh = () => setTick((t) => t + 1)

  const onSave = () => {
    const name = window.prompt('Nombre del preset de escena', 'Mi escena')
    if (name == null) return
    const snap = getSnapshot()
    const p = saveScenePresetFromCurrent(name, snap)
    refresh()
    onStatus(`Preset guardado: «${p.name}».`)
  }

  const onDelete = (id: string, name: string) => {
    if (id.startsWith('builtin-')) return
    if (!window.confirm(`¿Borrar el preset «${name}»?`)) return
    deleteScenePreset(id)
    refresh()
    onStatus(`Preset «${name}» eliminado.`)
  }

  return (
    <div
      className="fusion-scene-presets"
      style={{ marginBottom: 10 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: '#64748b',
          marginBottom: 6,
          letterSpacing: 0.04
        }}
      >
        Presets de escena
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        {presets.map((p) => (
          <div key={p.id} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onApplyPreset(p)}
              title={`Aplicar: ${p.name}`}
              style={{
                ...btnNeutral,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600
              }}
            >
              {p.name}
            </button>
            {!p.id.startsWith('builtin-') ? (
              <button
                type="button"
                disabled={disabled}
                onClick={() => onDelete(p.id, p.name)}
                title="Borrar preset"
                style={{
                  padding: '2px 6px',
                  borderRadius: 4,
                  border: '1px solid #475569',
                  background: '#0f172a',
                  color: '#94a3b8',
                  fontSize: 10,
                  cursor: disabled ? 'not-allowed' : 'pointer'
                }}
              >
                ×
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          disabled={disabled}
          onClick={onSave}
          style={{
            ...btnNeutral,
            padding: '4px 10px',
            fontSize: 11,
            fontWeight: 600
          }}
        >
          + Guardar actual
        </button>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'

import {
  deleteScenePreset,
  listScenePresets,
  saveScenePresetFromCurrent,
  type ScenePreset
} from './programScenePresets'
import type { ProgramBackground } from './programBackground'
import type { LayoutAssignments, LayoutId, ProgramOrientation } from './programScenes'
import { StudioConfirmForm, StudioPromptForm } from './StudioInlineDialog'
import { btnNeutral } from './workspaceChrome'

type Snapshot = {
  programLayoutId: LayoutId
  layoutAssignments: LayoutAssignments
  programOrientation: ProgramOrientation
  programCrossfadeMs: number
  background: ProgramBackground
}

type DialogState =
  | { kind: 'save'; draft: string }
  | { kind: 'delete'; id: string; name: string }
  | null

type Props = {
  disabled?: boolean
  getSnapshot: () => Snapshot
  onApplyPreset: (preset: ScenePreset) => void
  onStatus: (msg: string) => void
}

export function FusionScenePresetsPanel({ disabled, getSnapshot, onApplyPreset, onStatus }: Props) {
  const [tick, setTick] = useState(0)
  const [dialog, setDialog] = useState<DialogState>(null)
  const presets = useMemo(() => listScenePresets(), [tick])

  const refresh = () => setTick((t) => t + 1)

  const submitSave = () => {
    if (dialog?.kind !== 'save') return
    const snap = getSnapshot()
    const p = saveScenePresetFromCurrent(dialog.draft, snap)
    refresh()
    onStatus(`Preset guardado: «${p.name}».`)
    setDialog(null)
  }

  const submitDelete = () => {
    if (dialog?.kind !== 'delete') return
    deleteScenePreset(dialog.id)
    refresh()
    onStatus(`Preset «${dialog.name}» eliminado.`)
    setDialog(null)
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

      {dialog?.kind === 'save' ? (
        <StudioPromptForm
          label="Nombre del preset de escena"
          value={dialog.draft}
          disabled={disabled}
          onChange={(draft) => setDialog({ kind: 'save', draft })}
          onSubmit={submitSave}
          onCancel={() => setDialog(null)}
        />
      ) : null}

      {dialog?.kind === 'delete' ? (
        <StudioConfirmForm
          message={<>¿Borrar el preset «{dialog.name}»?</>}
          submitLabel="Borrar"
          danger
          disabled={disabled}
          onConfirm={submitDelete}
          onCancel={() => setDialog(null)}
        />
      ) : null}

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
                disabled={disabled || dialog != null}
                onClick={() => setDialog({ kind: 'delete', id: p.id, name: p.name })}
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
          disabled={disabled || dialog?.kind === 'save'}
          onClick={() => setDialog({ kind: 'save', draft: 'Mi escena' })}
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

import { isDisplayCaptureId } from './displayCapture'
import { type SourceHealthInfo } from './sourceHealth'

type Props = {
  cameraIds: string[]
  health: Record<string, SourceHealthInfo>
  resolveAlias: (id: string) => string
  /** Si true, trata "esperando" como aviso al grabar. */
  forRecording?: boolean
}

export function buildProgramReadiness(params: Props): {
  ready: boolean
  summary: string
  issues: string[]
} {
  const { cameraIds, health, resolveAlias, forRecording } = params
  const issues: string[] = []
  let okCount = 0

  if (cameraIds.length === 0) {
    return {
      ready: false,
      summary: 'Sin fuentes conectadas.',
      issues: ['Agregá al menos una cámara (QR) o una captura de pantalla.']
    }
  }

  for (const id of cameraIds) {
    const h = health[id]
    if (!h) continue
    if (h.state === 'ok') {
      okCount += 1
      continue
    }
    const name = resolveAlias(id)
    if (h.state === 'frozen') {
      issues.push(
        `«${name}»: ${h.label}. ${isDisplayCaptureId(id) ? 'Usá pantalla completa (monitor), no la ventana del navegador.' : h.detail ?? ''}`
      )
    } else if (h.state === 'no_signal') {
      issues.push(`«${name}»: ${h.label}.`)
    } else if (forRecording && h.state === 'waiting') {
      issues.push(`«${name}»: ${h.label} — esperá unos segundos antes de grabar.`)
    }
  }

  const frozen = issues.some((i) => i.includes('congelada') || i.includes('no se mueve'))
  const ready = okCount > 0 && !frozen && (!forRecording || issues.length === 0)

  if (ready) {
    return {
      ready: true,
      summary: `Listo para grabar: ${okCount} fuente${okCount !== 1 ? 's' : ''} OK.`,
      issues: []
    }
  }

  if (frozen) {
    return {
      ready: false,
      summary: 'No conviene grabar: hay una captura que no se mueve.',
      issues
    }
  }

  if (issues.length) {
    return {
      ready: false,
      summary: 'Revisá las fuentes antes de grabar.',
      issues
    }
  }

  return {
    ready: okCount > 0,
    summary: okCount ? `Fuentes: ${okCount} OK.` : 'Comprobando fuentes…',
    issues
  }
}

export function ProgramReadinessBanner(props: Props) {
  const { ready, summary, issues } = buildProgramReadiness({ ...props, forRecording: true })
  const border = ready ? '#065f46' : issues.some((i) => i.includes('congelada') || i.includes('mueve')) ? '#991b1b' : '#854d0e'
  const bg = ready ? 'rgba(6, 78, 59, 0.35)' : 'rgba(127, 29, 29, 0.25)'
  const color = ready ? '#6ee7b7' : '#fecaca'

  return (
    <div
      style={{
        marginBottom: 10,
        padding: '10px 12px',
        borderRadius: 8,
        border: `1px solid ${border}`,
        background: bg,
        fontSize: 12,
        lineHeight: 1.45,
        color
      }}
    >
      <div style={{ fontWeight: 700, marginBottom: issues.length ? 6 : 0 }}>{summary}</div>
      {issues.length ? (
        <ul style={{ margin: 0, paddingLeft: 18, color: '#fca5a5' }}>
          {issues.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

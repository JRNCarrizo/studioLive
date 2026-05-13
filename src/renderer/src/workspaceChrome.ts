import type { CSSProperties } from 'react'

/** Borde izquierdo por modo (pestaña activa). */
const ACCENT = {
  sky: '#38bdf8',
  teal: '#14b8a6',
  violet: '#a78bfa'
} as const

export type WorkspaceAccent = keyof typeof ACCENT

/**
 * Tarjeta superior de cada modo: mismo padding, fondo y borde base;
 * acento solo en el borde izquierdo (como “ribbon” del paso).
 */
export function workspaceToolbar(accent: WorkspaceAccent): CSSProperties {
  return {
    marginBottom: 16,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #334155',
    borderLeft: `3px solid ${ACCENT[accent]}`,
    background: '#0a1628',
    display: 'flex',
    flexDirection: 'column',
    gap: 10
  }
}

/** Misma tarjeta sin acento (contenido anidado, p. ej. panel de fusión por archivos). */
export const workspaceInnerCard: CSSProperties = {
  marginBottom: 16,
  padding: '14px 14px',
  borderRadius: 12,
  border: '1px solid #334155',
  background: '#0a1628',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  position: 'relative'
}

export const workspaceEyebrow: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: 0.08,
  textTransform: 'uppercase'
}

/** Etiqueta de fila de acciones (“Carpeta y controles”, “Carpeta y conexión”, etc.). */
export const workspaceActionRowLabel: CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: '#64748b',
  letterSpacing: 0.08,
  textTransform: 'uppercase'
}

export const btnNeutral: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#0f172a',
  color: '#e2e8f0',
  fontSize: 12,
  cursor: 'pointer'
}

export const btnQr: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #0e7490',
  background: '#0e2a3a',
  color: '#7dd3fc',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8
}

export const btnAudio: CSSProperties = {
  padding: '8px 14px',
  borderRadius: 8,
  border: '1px solid #166534',
  background: '#0f2a1a',
  color: '#bbf7d0',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8
}

export const pathLineMuted: CSSProperties = {
  fontSize: 11,
  color: '#64748b',
  wordBreak: 'break-all',
  lineHeight: 1.45
}

export const pathTextBright: CSSProperties = {
  color: '#cbd5e1'
}

export const warnLineNoFolder: CSSProperties = {
  fontSize: 12,
  color: '#fcd34d',
  lineHeight: 1.45
}

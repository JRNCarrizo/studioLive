import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  titleId?: string
  wide?: boolean
  zIndex?: number
}

export function StudioModalOverlay({
  title,
  subtitle,
  children,
  titleId = 'studio-modal-title',
  wide = false,
  zIndex = 100
}: Props) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  return createPortal(
    <div
      className="studio-modal-overlay"
      style={{ zIndex }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className={
          'studio-modal-panel' + (wide ? ' studio-modal-panel--wide' : '')
        }
      >
        <div className="studio-modal-panel__header">
          <div id={titleId} className="studio-modal-panel__title">
            {title}
          </div>
          {subtitle ? <p className="studio-modal-panel__subtitle">{subtitle}</p> : null}
        </div>
        <div className="studio-modal-panel__body">{children}</div>
      </div>
    </div>,
    document.body
  )
}

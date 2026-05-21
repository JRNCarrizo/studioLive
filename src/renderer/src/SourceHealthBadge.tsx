import { healthStateColor, type SourceHealthInfo } from './sourceHealth'

type Props = {
  health: SourceHealthInfo
  compact?: boolean
}

export function SourceHealthBadge({ health, compact }: Props) {
  const color = healthStateColor(health.state)
  return (
    <span
      title={health.detail ?? health.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 4 : 6,
        fontSize: compact ? 9 : 10,
        fontWeight: 600,
        color,
        lineHeight: 1.2
      }}
    >
      <span
        aria-hidden
        style={{
          width: compact ? 6 : 7,
          height: compact ? 6 : 7,
          borderRadius: '50%',
          background: color,
          boxShadow: health.state === 'ok' ? `0 0 6px ${color}` : undefined,
          flexShrink: 0
        }}
      />
      {health.label}
    </span>
  )
}

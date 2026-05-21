import fs from 'fs'

const p = 'src/renderer/src/FusionPanel.tsx'
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/)

for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim()
  if (t.length > 0 && t.length < 12 && !t.startsWith('<') && !t.startsWith('{') && !t.startsWith('//')) {
    const prev = lines.slice(Math.max(0, i - 8), i).join('\n')
    if (prev.includes('fusion-thumb-rotate')) lines[i] = '                        {GLYPH.rotate}'
    if (prev.includes('fusion-thumb-close')) lines[i] = '                        {GLYPH.close}'
  }
  if (lines[i].includes('Inicio del export en ms')) {
    lines[i] =
      '  /** Inicio del export en ms — para mostrar tiempo transcurrido mientras dura la operación. */'
  }
}

fs.writeFileSync(p, lines.join('\n'), 'utf8')
console.log('ok')

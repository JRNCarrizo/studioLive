import fs from 'fs'

const files = [
  'src/renderer/src/FusionStudioTransport.tsx',
  'src/renderer/src/FusionPanel.tsx'
]

for (const p of files) {
  let s = fs.readFileSync(p, 'utf8')

  if (p.includes('FusionStudioTransport')) {
    if (!s.includes("import { GLYPH }")) {
      s = s.replace(
        "import { fmtPlanTime } from './fusionCameraPlan'",
        "import { fmtPlanTime } from './fusionCameraPlan'\nimport { GLYPH } from './uiGlyphs'"
      )
    }
    s = s.replace(/\{floating \? '.{1,12}' : '.{1,12}'\}/, '{floating ? GLYPH.floatOn : GLYPH.floatOff}')
    s = s.replace(
      /\{playing \? '.{1,16}' : '.{1,16}'\}/,
      '{playing ? GLYPH.pause : GLYPH.play}'
    )
    s = s.replace(
      /\n\s+[^\n{]*<span className="fusion-dock-btn__label">Grabar/,
      '\n              {GLYPH.record}\n              <span className="fusion-dock-btn__label">Grabar'
    )
    s = s.replace(
      /\n\s+[^\n{]*<span className="fusion-dock-btn__label">Seguir/g,
      '\n                    {GLYPH.play}\n                    <span className="fusion-dock-btn__label">Seguir'
    )
    s = s.replace(
      /\n\s+[^\n{]*<span className="fusion-dock-btn__label">Pausa/g,
      '\n                    {GLYPH.pause}\n                    <span className="fusion-dock-btn__label">Pausa'
    )
    s = s.replace(
      /\n\s+[^\n{]*<span className="fusion-dock-btn__label">Fin/,
      '\n                {GLYPH.stop}\n                <span className="fusion-dock-btn__label">Fin'
    )
  }

  if (p.includes('FusionPanel')) {
    if (!s.includes("import { GLYPH }")) {
      s = s.replace(
        "import { FusionStudioTransport } from './FusionStudioTransport'",
        "import { FusionStudioTransport } from './FusionStudioTransport'\nimport { GLYPH } from './uiGlyphs'"
      )
    }
    s = s.replace(
      /\n\s+[^\n{]*\n\s+<\/button>\n\s+<button\n\s+type="button"\n\s+className="fusion-thumb-overlay-btn fusion-thumb-close"/,
      `\n                        {GLYPH.rotate}\n                      </button>\n                      <button\n                        type="button"\n                        className="fusion-thumb-overlay-btn fusion-thumb-close"`
    )
    // Fix rotate button content (between rotate class and close button)
    s = s.replace(
      /(className="fusion-thumb-overlay-btn fusion-thumb-rotate"[\s\S]*?>\n)\s*[^\n{]+\n(\s*<\/button>)/,
      `$1                        {GLYPH.rotate}\n$2`
    )
    s = s.replace(
      /(className="fusion-thumb-overlay-btn fusion-thumb-close"[\s\S]*?>\n)\s*[^\n{]+\n(\s*<\/button>)/,
      `$1                        {GLYPH.close}\n$2`
    )
    s = s.replace(/WebM⬦/g, `WebM${'{GLYPH.ellipsis}'}`)
    s = s.replace(/MP4⬦/g, `MP4${'{GLYPH.ellipsis}'}`)
    s = s.replace(/duración\)⬦/g, `duración){GLYPH.ellipsis}`)
    s = s.replace(/⬦/g, '{GLYPH.ellipsis}')
  }

  fs.writeFileSync(p, s, 'utf8')
  console.log('fixed', p)
}

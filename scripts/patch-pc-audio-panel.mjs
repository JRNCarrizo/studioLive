import fs from 'node:fs'

const p = new URL('../src/renderer/src/FloatingPcAudioPanel.tsx', import.meta.url)
const s = fs.readFileSync(p, 'utf8')

const needle =
  "            {hasLiveTrack ? 'Reactivar audio' : 'Activar audio'}\r\n          </button>\r\n        </div>"

const insert = `            {hasLiveTrack ? 'Reactivar audio' : 'Activar audio'}\r\n          </button>\r\n          {hasLiveTrack && onDeactivate ? (\r\n            <button\r\n              type="button"\r\n              disabled={disabled}\r\n              onClick={onDeactivate}\r\n              style={{\r\n                padding: '8px 12px',\r\n                borderRadius: 8,\r\n                border: '1px solid #7f1d1d',\r\n                background: '#450a0a',\r\n                color: '#fecaca',\r\n                cursor: disabled ? 'not-allowed' : 'pointer',\r\n                fontWeight: 600\r\n              }}\r\n              title="Libera la interfaz para YouTube, Spotify, etc."\r\n            >\r\n              Soltar mic\r\n            </button>\r\n          ) : null}\r\n        </div>`

if (!s.includes(needle)) {
  console.error('needle not found')
  process.exit(1)
}

fs.writeFileSync(p, s.replace(needle, insert))
console.log('patched')

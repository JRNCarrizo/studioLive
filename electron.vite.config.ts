import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/** En build empaquetado: sin unsafe-eval → desaparece warnAboutInsecureCSP del sandbox. */
function cspForPackagedApp(): import('vite').Plugin {
  const devCsp =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; media-src 'self' blob: studio-webm:; img-src 'self' data: blob:; font-src 'self' data:;"
  const prodCsp =
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' http: https: ws: wss:; media-src 'self' blob: studio-webm:; img-src 'self' data: blob:; font-src 'self' data:;"

  return {
    name: 'studio-csp-packaged',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        const csp = ctx.server ? devCsp : prodCsp
        return html.replace(
          /content="default-src[^"]*"/,
          `content="${csp}"`
        )
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      /** Electron no ejecuta el preload como módulo ES; «Cannot use import statement outside a module». */
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'electron/preload/index.ts')
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src')
      }
    },
    plugins: [react(), cspForPackagedApp()],
    root: resolve(__dirname, 'src/renderer'),
    server: {
      port: 5173,
      strictPort: false
    },
    build: {
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})

import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import type { WebSocket } from 'ws'
import { WebSocketServer } from 'ws'

export type IceCandidatePayload = Record<string, unknown> | null

export type SignalingMsg =
  | { type: 'register'; role: 'host' | 'camera'; name?: string }
  | { type: 'registered'; cameraId: string }
  | { type: 'camera-joined'; cameraId: string; name?: string }
  | { type: 'camera-left'; cameraId: string }
  | { type: 'offer'; cameraId: string; sdp: string }
  | { type: 'answer'; cameraId: string; sdp: string }
  | { type: 'ice'; cameraId: string; candidate: IceCandidatePayload }
  | { type: 'host-ready' }

/** Puerto HTTPS público + este offset = HTTP solo loopback para el panel (fetch sin IPC). */
export const HOST_PANEL_HTTP_OFFSET = 3777

export type SignalingRuntime = {
  port: number
  /** HTTP en 127.0.0.1 — el renderer usa fetch aquí (pull/push) para no depender de ipcRenderer. */
  hostPanelHttpPort: number
  httpsServer: https.Server
  loopHttpServer: http.Server
  drainHostOutbound: (max?: number) => string[]
  injectHostMessage: (msg: SignalingMsg) => void
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10)
}

export function getLanIPv4s(): string[] {
  const nets = os.networkInterfaces()
  const out: string[] = []
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address)
    }
  }
  return [...new Set(out)]
}

function listenHttps(server: https.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '0.0.0.0', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

function listenLoopHttp(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

const HOST_QUEUE_CAP = 500

export async function createSignalingServer(opts: {
  port: number
  cameraStaticDir: string
  tls: { key: string; cert: string }
}): Promise<SignalingRuntime> {
  const app = express()
  app.get('/__studio/ping', (_req, res) => {
    res.type('text/plain').send('studio-live-ok')
  })
  app.use(express.static(opts.cameraStaticDir))

  const httpsServer = https.createServer(
    {
      key: opts.tls.key,
      cert: opts.tls.cert,
      minVersion: 'TLSv1.2'
    },
    app
  )

  const outboundToHost: string[] = []
  let hostPrimedFromPanel = false

  const cameras = new Map<string, WebSocket>()
  const cameraNames = new Map<string, string>()

  function send(ws: WebSocket, msg: SignalingMsg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  function enqueueToHost(msg: SignalingMsg) {
    outboundToHost.push(JSON.stringify(msg))
    while (outboundToHost.length > HOST_QUEUE_CAP) outboundToHost.shift()
  }

  function injectHostMessage(msg: SignalingMsg) {
    if (msg.type === 'answer') {
      const camWs = cameras.get(msg.cameraId)
      if (camWs) send(camWs, msg)
      return
    }
    if (msg.type === 'ice') {
      const camWs = cameras.get(msg.cameraId)
      if (camWs) send(camWs, msg)
    }
  }

  function drainHostOutbound(max = 80): string[] {
    if (!hostPrimedFromPanel) {
      hostPrimedFromPanel = true
      for (const camWs of cameras.values()) {
        send(camWs, { type: 'host-ready' })
      }
    }
    const n = Math.max(1, Math.min(max, 200))
    return outboundToHost.splice(0, n)
  }

  const onLoopRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
    const cors = () => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    }
    cors()

    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url?.startsWith('/__studio/host-pull')) {
      try {
        const u = new URL(req.url, 'http://127.0.0.1')
        const maxParam = Number(u.searchParams.get('max'))
        const max = Number.isFinite(maxParam)
          ? Math.min(200, Math.max(1, maxParam))
          : 80
        const batch = drainHostOutbound(max)
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify(batch))
      } catch {
        res.writeHead(500)
        res.end()
      }
      return
    }

    if (req.method === 'POST' && req.url?.startsWith('/__studio/host-push')) {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8')
          const msg = JSON.parse(raw) as SignalingMsg
          if (msg.type === 'answer' || msg.type === 'ice') injectHostMessage(msg)
          res.writeHead(204)
          res.end()
        } catch {
          res.writeHead(400)
          res.end()
        }
      })
      return
    }

    res.writeHead(404)
    res.end()
  }

  function onSignalingConnection(ws: WebSocket) {
    ws.on('message', (raw) => {
      let msg: SignalingMsg
      try {
        msg = JSON.parse(raw.toString()) as SignalingMsg
      } catch {
        return
      }

      if (msg.type === 'register') {
        if (msg.role === 'host') return

        const cameraId = randomId()
        cameras.set(cameraId, ws)
        cameraNames.set(cameraId, msg.name ?? '')
        send(ws, { type: 'registered', cameraId })
        enqueueToHost({ type: 'camera-joined', cameraId, name: msg.name })
        ws.on('close', () => {
          cameras.delete(cameraId)
          cameraNames.delete(cameraId)
          enqueueToHost({ type: 'camera-left', cameraId })
        })
        return
      }

      if (msg.type === 'offer') {
        enqueueToHost(msg)
        return
      }

      if (msg.type === 'answer') {
        const camWs = cameras.get(msg.cameraId)
        if (camWs) send(camWs, msg)
        return
      }

      if (msg.type === 'ice') {
        enqueueToHost(msg)
      }
    })
  }

  const wssHttps = new WebSocketServer({ server: httpsServer })
  wssHttps.on('connection', onSignalingConnection)

  try {
    await listenHttps(httpsServer, opts.port)
  } catch (e) {
    httpsServer.close()
    throw e
  }

  const baseLoop = opts.port + HOST_PANEL_HTTP_OFFSET
  let loopHttpServer: http.Server | null = null
  let hostPanelHttpPort = baseLoop

  for (let tryPort = baseLoop; tryPort < baseLoop + 24; tryPort++) {
    const s = http.createServer(onLoopRequest)
    try {
      await listenLoopHttp(s, tryPort)
      loopHttpServer = s
      hostPanelHttpPort = tryPort
      break
    } catch {
      s.close()
    }
  }

  if (!loopHttpServer) {
    httpsServer.close()
    throw new Error('No se pudo abrir puerto HTTP loopback para el panel')
  }

  return {
    port: opts.port,
    hostPanelHttpPort,
    httpsServer,
    loopHttpServer,
    drainHostOutbound,
    injectHostMessage
  }
}

export function cameraClientDir(): string {
  return path.join(process.cwd(), 'camera-client')
}

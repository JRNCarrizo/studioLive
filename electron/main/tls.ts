import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { generate } from 'selfsigned'

const MANIFEST = 'san-manifest.json'

function sortedLanFingerprint(ips: string[]): string {
  const uniq = [...new Set(ips.filter(Boolean))].sort()
  return uniq.join(',')
}

function isLikelyIPv4(ip: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(ip)
}

/**
 * Certificado autofirmado persistente; se regenera si cambian las IPv4 LAN
 * (así los celulares pueden validar HTTPS por IP sin nombre DNS).
 */
export async function ensureStudioCerts(
  certDir: string,
  lanIPv4s: string[]
): Promise<{ key: string; cert: string }> {
  await mkdir(certDir, { recursive: true })
  const manifestPath = path.join(certDir, MANIFEST)
  const keyPath = path.join(certDir, 'studio-live-key.pem')
  const certPath = path.join(certDir, 'studio-live-cert.pem')

  const fingerprint = sortedLanFingerprint(lanIPv4s)
  let needNew = !existsSync(keyPath) || !existsSync(certPath)

  if (!needNew) {
    try {
      const prev = (await readFile(manifestPath, 'utf8')).trim()
      if (prev !== fingerprint) needNew = true
    } catch {
      needNew = true
    }
  }

  if (!needNew) {
    const key = await readFile(keyPath, 'utf8')
    const cert = await readFile(certPath, 'utf8')
    return { key, cert }
  }

  const altNames: Array<
    { type: 2; value: string } | { type: 7; ip: string }
  > = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' }
  ]
  for (const ip of lanIPv4s) {
    if (isLikelyIPv4(ip)) altNames.push({ type: 7, ip })
  }

  const attrs = [{ name: 'commonName', value: 'Studio Live LAN' }]
  const pems = await generate(attrs, {
    algorithm: 'sha256',
    keySize: 2048,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      { name: 'subjectAltName', altNames }
    ]
  })

  await writeFile(keyPath, pems.private)
  await writeFile(certPath, pems.cert)
  await writeFile(manifestPath, fingerprint, 'utf8')

  return { key: pems.private, cert: pems.cert }
}

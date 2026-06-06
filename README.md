# Studio Live

Estudio multicámara local: celulares como cámaras por WebRTC, grabación ISO por pista y mezcla en **programa** (archivos o en vivo).

## Inicio rápido (desarrollo)

```bash
npm install
npm run dev
```

## Instalador Windows + landing local de descarga

```bash
npm install
npm run dist:win
npm run website
```

Abrí **http://127.0.0.1:3080/** en el navegador: landing promocional de prueba con botón para descargar el `.exe` generado en `release/`.

El instalador NSIS permite elegir carpeta. La primera vez Windows puede mostrar SmartScreen («editor desconocido») hasta firmar el ejecutable con un certificado de código.

## Actualizaciones automáticas (GitHub Releases)

La app instalada busca updates en **GitHub Releases** del repo `JRNCarrizo/studioLive` (~8 s después de abrir). Si hay versión nueva, descarga en segundo plano y muestra **Reiniciar e instalar** en la barra superior.

### Publicar una versión nueva

1. Subí la versión en `package.json` (ej. `0.1.0` → `0.1.1`).
2. Commit y tag:
   ```bash
   git tag v0.1.1
   git push origin v0.1.1
   ```
3. GitHub Actions (`.github/workflows/release.yml`) genera el instalador y sube el Release con `latest.yml` + `.exe`.
4. Quienes tengan la versión anterior recibirán la actualización al abrir Studio Live.

**Manual (sin Actions):** creá un Release en GitHub y ejecutá `npm run dist:publish` con un token `GH_TOKEN` con permiso `repo`.

## Documentación

| Documento | Descripción |
|-----------|-------------|
| **[docs/ESTUDIO_LIVE_GUIA.md](docs/ESTUDIO_LIVE_GUIA.md)** | **Estado actual del programa:** para qué sirve, los 3 modos, herramientas y flujos |
| [docs/PLAN.md](docs/PLAN.md) | Visión del producto y decisiones técnicas |
| [docs/HISTORIAL_IMPLEMENTACION.md](docs/HISTORIAL_IMPLEMENTACION.md) | Historial de implementación (desarrollo) |

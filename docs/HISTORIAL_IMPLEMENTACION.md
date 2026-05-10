# Historial de implementación y contexto para retomar

**Uso:** al volver a trabajar en el proyecto, pedir al asistente que lea **`docs/PLAN.md`** (visión y stack) y **este archivo** (qué se implementó y cómo está cableado).

**Repo remoto:** [github.com/JRNCarrizo/studioLive](https://github.com/JRNCarrizo/studioLive) · rama `main`.

---

## Resumen en una frase

App **Electron + Vite + React**: multicámara por WebRTC, grabación ISO (`cam-*.webm`, `audio-*.webm`), **fusión en tiempo real** en panel dedicado con vista previa WebM y **export opcional a MP4 (H.264/AAC)** para mejor compatibilidad en Windows.

---

## Paso 2 — Fusión (`FusionPanel.tsx`)

### Carga de material

- Diálogo multi-archivo: solo convención **`cam-<id>-<sesión>.webm`** y **`audio-<sesión>.webm`** (misma sesión).
- Los **`fusion-*.webm`** exportados **no** se cargan aquí (mensaje de error orientativo).

### Vista previa del export vs mezcla ISO

- El WebM de fusión y la reproducción de las pistas ISO **no debían acoplarse**.
- Estado **`fusionPreviewPlaying`** separado de **`playing`**; **`transportPlaying`** decide la barra de transporte cuando hay URL de vista previa.
- Eliminado el **`timeupdate`** del `<video>` de vista previa que **seek-eaba todas las pistas ISO** y movía el programa — era la causa de que “al reproducir la vista previa también se movía la mescla”.
- Controles del `<video>` de vista previa con **`onPlay` / `onPause`** → `setFusionPreviewPlaying`.

### Pantalla completa (vista previa export)

- Intento de Fullscreen API primero en **`<video>`**, luego contenedor; fallback **pseudo-fullscreen** con clase CSS (`.fusion-export-preview-wrap--pseudo-fs`).
- `controlsList="nofullscreen"` en el preview para no duplicar UI.

### Nombre antes de guardar

- Campo **nombre de archivo** antes de guardar; sanitización de caracteres Windows y extensión `.webm`.
- Helper **`sanitizeFusionMp4FileName`** deriva `.mp4` coherente para export MP4.

### Grabación WebM en navegador (`MediaRecorder`)

- Preferencia de códec **VP8** antes que VP9 para mejor comportamiento en algunos reproductores (`pickFusionRecorderMime`).
- Canvas **1280×720**; programa dibujado con **`requestAnimationFrame`** (`drawImage` desde el `<video>` del programa).
- Flujo actual orientado a menos tirones en tiempo real / mux:
  - **`canvas.captureStream(30)`** — muestreo ~30 fps desde el motor del navegador (tras experimentos con `captureStream(0)` + `requestFrame`).
  - **`rec.start()` sin timeslice** — un único chunk al **parar** (evita trabajo periódico de `ondataavailable` cada ~100 ms que podía causar microcortes).
  - Bitrate vídeo moderado (**~5 Mbps**) en `createFusionMediaRecorder`.

**Nota:** el **Reproductor multimedia clásico de Windows** suele ir mal con WebM (barra de tiempo, tirones); por eso se añadió MP4.

### Export MP4 (post-proceso con FFmpeg)

- Dependencia **`ffmpeg-static`** (binario embebido; licencia **GPL** — tenerlo en cuenta si se distribuye la app).
- **`electron/main/ffmpegConvert.ts`**: WebM → MP4 **libx264**, **AAC**, **yuv420p**, **+faststart**; si no hay audio en el WebM, reintento solo vídeo (`-map 0:v:0`).
- IPC **`studio:save-fusion-mp4`**: escribe WebM temporal en `%TEMP%`, convierte, borra temporal.
- Preload: **`window.studio.saveFusionMp4(outputPath, arrayBuffer)`**.
- UI: botones **Guardar WebM** y **Guardar MP4 (recomendado Windows)**; estado **`fusionExportBusy`** durante la conversión.

**Empaquetado futuro:** si se usa **asar**, puede hacer falta **asarUnpack** para el ejecutable de `ffmpeg-static`.

### Selector “Miniaturas” / “Solo nombres”

- En modo **Solo nombres**, los botones de **cámara** están **arriba** del bloque **Selector:** (Miniaturas / Solo nombres), pegados a la zona de vista fusión/timeline.

---

## Electron — proceso principal (`electron/main/index.ts`)

### DevTools en desarrollo

- Por defecto en **`npm run dev`** se abre DevTools al cargar.
- **`STUDIO_DEVTOOLS=0`** o **`false`** evita abrirla automáticamente (sigue disponible **Ctrl+Shift+I**).

### Consola / terminal

- Mensajes tipo **`language-mismatch`**, **`Autofill.enable`**, JSON parse error en DevTools: vienen del **front interno de DevTools**, no de la app; se pueden ignorar.

---

## Archivos tocados con más frecuencia

| Área | Archivos |
|------|-----------|
| Fusión UI y grabación | `src/renderer/src/FusionPanel.tsx`, `src/renderer/src/index.css` |
| Convenciones de nombres ISO/fusion | `src/renderer/src/recordingFileNames.ts` |
| IPC / FFmpeg | `electron/main/index.ts`, `electron/main/ffmpegConvert.ts` |
| Preload API | `electron/preload/index.ts`, `src/renderer/src/global.d.ts` |
| Cliente cámara (móvil) | `camera-client/index.html` |
| App principal / grabación ISO | `src/renderer/src/App.tsx` |

---

## Comandos útiles

```bash
npm install
npm run dev      # desarrollo
npm run build    # producción (renderer + main + preload)
```

### Git (recordatorio)

```bash
git add -A
git status
git commit -m "mensaje"
git push
```

---

## Pendientes / ideas ya mencionadas (no cerradas en código)

- Si las fusiones son **muy largas**, valorar **`rec.start(timeslice)`** más grande solo para no mantener todo el blob en RAM hasta parar.
- **Empaquetado** con firma / **asarUnpack** para FFmpeg.
- Opcional: mitigar carga durante fusión (throttle de `setCurrentTime` / menos trabajo en miniaturas mientras grabás) si reaparecen tirones solo en grabación WebM.

---

*Documento generado para handoff entre sesiones; mantener actualizado cuando haya cambios grandes.*

# Studio Live — plan del producto (multicámara local)

**Para retomar el trabajo:** pedir al asistente que lea **`docs/PLAN.md`** (visión y stack) y **`docs/HISTORIAL_IMPLEMENTACION.md`** (qué está hecho en código: fusión, MP4, GitHub, etc.).

## Visión

Estudio de grabación **orientado a video** (streamers, videoclips, etc.), **uso principalmente local**. Lo diferencial inicial (“boom”): **grabación multicámara usando varios celulares como cámaras**, con **audio profesional entrando por interfaz de audio en PC** (ej. micrófono condenser), sin depender del micrófono del teléfono.

En fases posteriores: herramientas de edición y **IA** (automatización de cambios de cámara, zoom, etc.). Empezar por un MVP estable de ingest y grabación.

## Usuario y entorno objetivo (acordado)

| Tema | Decisión actual |
|------|------------------|
| SO del estudio | **Windows** (por ahora) |
| Cantidad de cámaras | Objetivo **4–6** celulares simultáneos |
| Red | Mismo **Wi‑Fi** para celulares y PC |
| Cable | Celulares **sin cable**. PC **preferible con Ethernet al router** cuando sea posible (mejor recepción de muchos streams); fuera de casa puede ser solo Wi‑Fi con presets más conservadores |
| Audio | **Todo el audio por interfaz en PC**; **no** usar mic del celular en el MVP |

## Conceptos de grabación

- **Pistas separadas (prioridad):** un **archivo de video por cámara** + audio desde la interfaz (idealmente pistas de audio limpias). Permite mezcla y multicámara en post.
- **Programa mezclado (opcional / más adelante):** un **único archivo** que ya refleja cortes/composición en vivo (lo que “vería la audiencia”). Menos flexible para re-editar ángulos. Se puede convivir con pistas aisladas si hace falta.

## MVP — alcance sugerido

1. **Panel en PC:** visualización de todas las fuentes (layout tipo multiview).
2. **Conexión desde celular:** envío de video hacia la PC por LAN con **WebRTC**.
3. **Grabación:** **N videos** (uno por cámara) + **un archivo de audio de PC** (`audio-<sesión>.webm`) al iniciar la grabación con entrada activa; mismo timestamp de sesión que `cam-*` para alinear en post.
4. Perfiles de red: en la app se elige **preset de video** (alta/media/baja) que se envía en la URL (`?preset=`) al cliente móvil para ajustar resolución y fps ideales.

## Decisiones técnicas (MVP en curso)

- **Escritorio:** aplicación propia **Electron + Vite + React + TypeScript** en este repo.
- **Transporte celular → PC:** **WebRTC** en LAN, con **signaling** por **WebSocket** + página estática servida por **Express** (`camera-client/`).
- **Cliente en celular (hoy):** **página web** en **`https://<IP-PC>:<puerto>/`** (TLS autofirmado en LAN; el navegador pide confiar la primera vez). Señalización **WSS** en el mismo puerto.
- **Puerto:** intenta **8788** y reintenta hasta **8797** si está ocupado.
- **Audio en PC:** **getUserMedia** (entrada predeterminada de Windows o dispositivo elegido en la app). Chromium **no expone ASIO**; suele ser **WASAPI**. Eco-cancelación / AGC / reducción de ruido desactivados en código para favorecer señal “limpia” desde interfaz.

## Pendientes próximos

- **Mejoras de audio:** sync más fino (timecode / claqueta digital), o pipeline nativo si hace falta latencia ASIO exclusiva. *(Medidor de nivel de entrada en panel: implementado.)*
- **APK** o app nativa leve si el navegador en móvil resulta limitado.
- **OBS** como alternativa de validación sigue siendo opcional para comparar estabilidad/red.

## Riesgos / constraints

- **4–6 streams simultáneos por Wi‑Fi** presionan router y espectro; preferir **5 GHz** y bitrate por cámara acorde.
- Sincronización entre pistas: definir estrategia temprano (grabación centralizada en PC vs grabación en dispositivos).
- **Certificados:** se generan en el perfil de la app (`userData/certs/`) con **SAN** para `localhost`, `127.0.0.1` y las **IPv4 LAN** detectadas al arrancar. Si cambiás de red Wi‑Fi, **reiniciá** Studio Live para regenerar si hace falta. En el celular, la primera visita suele mostrar advertencia de certificado autofirmado (esperado).

### HTTPS que “no toma” en el celular

- Probar `https://<IP>:<puerto>/__studio/ping` (texto `studio-live-ok`). Si falla: firewall / Wi-Fi / IP.
- Exportar el `.crt` desde la app e instalarlo en Android/iPhone (ver panel desplegable en Studio Live).
- Probar en la misma PC `https://127.0.0.1:<puerto>/...` para aislar si el fallo es solo el teléfono.

## Cómo ejecutar el MVP local

En la carpeta del proyecto: `npm install` y `npm run dev`. En la ventana aparecen las **URLs HTTPS** para los celulares; aceptá el certificado en el teléfono la primera vez. En **Audio en esta PC** activá la entrada; elegí carpeta y **Grabar** para obtener `.webm` por cámara + audio si está activo.

---

*Última actualización: ver también `docs/HISTORIAL_IMPLEMENTACION.md` para el estado detallado del código.*

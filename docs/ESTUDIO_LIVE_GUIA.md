# Studio Live — Guía del estado actual

**Versión del documento:** mayo 2026 · **App:** `studio-live` v0.1.0  

Documento orientado a operadores y desarrolladores: **para qué sirve**, **cómo funciona** y **qué herramientas tiene** hoy la aplicación.

Documentos relacionados:

| Archivo | Contenido |
|---------|-----------|
| [PLAN.md](./PLAN.md) | Visión del producto, stack, decisiones técnicas del MVP |
| [HISTORIAL_IMPLEMENTACION.md](./HISTORIAL_IMPLEMENTACION.md) | Detalle de implementación en código (para retomar desarrollo) |

---

## 1. ¿Qué es Studio Live?

**Studio Live** es una aplicación de escritorio (**Windows**, Electron) para **producción de video en vivo** en red local (LAN). Permite usar **varios celulares como cámaras** vía navegador + WebRTC, grabar **una pista de video por cámara** (modo ISO), mezclar en un **programa** (vista “al aire”) y exportar el resultado.

### Para quién / para qué

- Streamers, clips, entrevistas, clases, ensayos de multicámara.
- Flujo pensado para **audio profesional en la PC** (interfaz de audio / micrófono), no depender del mic del celular.
- Uso **local** (misma Wi‑Fi; HTTPS en LAN con certificado autofirmado).

### Qué NO es (todavía)

- No es un editor no lineal completo (cortes, timelines largos, efectos).
- No reemplaza OBS para todos los casos (aunque puede convivir como referencia).
- La IA para cambios automáticos de cámara está en la visión a futuro, no en esta versión.

---

## 2. Cómo arrancar

```bash
npm install
npm run dev
```

En la ventana aparecen las **URLs HTTPS** para conectar celulares. La primera vez en el teléfono hay que **aceptar el certificado** autofirmado. Probar conectividad: `https://<IP-PC>:<puerto>/__studio/ping` → debe responder `studio-live-ok`.

**Puerto:** intenta 8788–8797. **Preset de video** en la URL del QR (`alta` / `media` / `baja`) limita bitrate y resolución en el celular.

---

## 3. Los tres modos de trabajo

La barra superior de la app tiene **tres pestañas**. Cada una usa un **QR distinto**: un celular registrado en “Sesión en vivo” **no** aparece en “Fusión en vivo” y viceversa.

```
┌─────────────────────────────────────────────────────────────┐
│  1 · Sesión en vivo  │  2 · Fusión (archivos)  │  3 · Fusión en vivo │
└─────────────────────────────────────────────────────────────┘
```

### 3.1 Sesión en vivo (ISO) — Paso 1

**Objetivo:** grabar **material crudo por cámara** para editar o mezclar después.

| Qué hace | Detalle |
|----------|---------|
| Conexión | Celulares por QR → WebRTC |
| Vista | Mosaico de todas las fuentes + alias por cámara |
| Grabación | Un `.webm` por cámara (`cam-<id>-<sesión>.webm`) + opcional `audio-<sesión>.webm` (PC) |
| Al terminar | Revisión por toma → elegir carpeta → **Guardar en disco** o **Descartar** |

**Herramientas principales:**

- **Carpeta de grabación** (barra superior, común a las 3 pestañas; se recuerda al reabrir la app), preset de calidad, QR de conexión.
- Audio de PC (entrada, ganancia, panel flotante).
- Transporte ISO flotante (grabar / pausar / fin).
- Salud de fuente en miniaturas (congelada, etc.).
- Captura de **pantalla/ventana**; en el modal de captura, **«Ocultar Studio Live en la captura»** (Windows/macOS) para controlar la app sin que salga en la grabación del monitor.
- Rotación 90° por cámara, cerrar fuente.

**Flujo típico:** conectar cámaras → elegir carpeta → Grabar → Fin → revisar tomas → Guardar en disco.

---

### 3.2 Fusión con archivos — Paso 2

**Objetivo:** cargar los WebM del paso 1 (y audio de sesión), armar el **programa** en el PC, grabar o exportar **una mezcla**.

| Qué hace | Detalle |
|----------|---------|
| Entrada | `cam-*.webm` + `audio-*.webm` de la misma sesión |
| Programa | Canvas con layouts, crossfade, fondo, recorte, zoom/pan |
| Salida | Grabación WebM de fusión, vista previa, export **WebM** o **MP4** (FFmpeg, H.264) |

**Herramientas principales:**

- Carga de pistas, timeline / plan de cámara bajo el programa.
- Selector de fuentes (miniaturas): tocar = mandar al programa.
- Layouts de programa (single, 2 lado a lado, PIP, 2×2, 1 grande + 2 chicos).
- Orientación de salida (horizontal / vertical) según cámaras.
- **Recorte** y **Zoom** en riel derecho del programa.
- **Color** — panel flotante: brillo, contraste, saturación y temperatura **por cámara** (layout single).
- **Mov.** — panel flotante de movimientos de cámara (ver §4).
- **Fondo** del programa (color o imagen).
- **Presets de escena** (guardar/aplicar layout + fondo + crossfade).
- Ecualizador flotante del audio de fusión.
- Transporte de fusión (play, grabar mezcla, pausa si aplica).
- **Atajos de teclado** (con pistas/cámaras cargadas): `1`–`9` cámara al aire, `←` `→` anterior/siguiente, `Espacio` play (archivos), `R` grabar.
- Cerrar sesión cargada (sin borrar archivos del disco).

**Flujo típico:** ISO guardado → pestaña Fusión → cargar WebM → armar programa → grabar o exportar MP4.

---

### 3.3 Fusión en vivo — Alternativa al paso 2

**Objetivo:** mismo concepto de **programa al aire**, pero las fuentes son **streams en vivo** (no archivos precargados).

| Igual que fusión archivos | Específico de en vivo |
|-------------------------|------------------------|
| Layouts, fondo, recorte, zoom, movimiento | QR propio “Fusión en vivo” |
| Plan de cámara bajo el programa | Director **manual** o **automático** (rotación de tomas) |
| Transporte programa | Grabación directa del canvas del programa |
| Atajos teclado | `1`–`9` y `←` `→` cámara (solo en **manual**); `R` grabar |

**Director automático:** en layout **single**, rota la cámara al aire cada N segundos (round-robin o ponderado). En layouts multi-cámara el automático se desactiva (no aplica).

**Grabación ISO en curso:** no se puede grabar el programa encima hasta guardar o descartar la ISO pendiente.

---

## 4. El programa (corazón de Fusión)

El **programa** es lo que vería la audiencia: un canvas con una o más celdas de video, fondo configurable y transiciones.

### 4.1 Layouts disponibles

| Layout | Uso |
|--------|-----|
| **Single** | Una cámara a pantalla completa (modo más habitual) |
| **Side by side 2** | Dos cámaras mitad y mitad |
| **PIP** | Una grande + una chica (picture-in-picture) |
| **Grid 2×2** | Cuatro celdas |
| **1 grande + 2 chicos** | Tres fuentes con jerarquía visual |

En **single** están disponibles recorte, zoom, pan y **consola de movimiento**. En multi-slot solo asignación de cámara por celda (sin movimiento automático por preset).

### 4.2 Zoom y pan (encuadre manual)

Sobre el canvas del programa (layout single, recorte **cerrado**):

| Gesto | Acción |
|-------|--------|
| Rueda / pellizco (Ctrl en algunos trackpads) | Zoom anclado al cursor |
| Arrastrar con botón izquierdo | Mover imagen (**agarre**: la imagen sigue el cursor) |
| Doble clic | Reset de zoom al neutro de la pestaña |
| Pellizco dos dedos | Zoom + pan (trackpad) |

El encuadre se **interpola** en el dibujo para que el zoom no “salte”. El valor de zoom aparece en el riel **Zoom**.

**Importante:** el encuadre se guarda **por cámara**, no global. Si en la cámara 1 hacés Pan → y pasás a la cámara 2, la 2 entra con **su** encuadre (neutro si nunca la ajustaste), **no** hereda el pan de la 1. Al volver a la 1, recuperás el encuadre que tenía.

### 4.3 Recorte

**Recorte → Editar** muestra el marco en el programa. Ajustás esquinas/bordes; **Listo** confirma. El recorte es **por cámara**. Con recorte abierto, los movimientos automáticos están deshabilitados.

### 4.3.1 Ajustes de color (botón ☼ Color)

Panel **flotante** en el riel derecho (layout **single**, una cámara al aire). Cuatro controles deslizantes, **por cámara**:

| Control | Efecto |
|---------|--------|
| **Brillo** | Aclara u oscurece la imagen |
| **Contraste** | Más o menos separación entre luces y sombras |
| **Saturación** | Intensidad del color (a la izquierda → casi gris) |
| **Temperatura** | Frío (azul) ↔ cálido (ámbar) |

Los ajustes se ven en el programa y **entran en la grabación/export**. **Reset** vuelve al neutro de esa cámara. Si cambiás de cámara al aire, el panel muestra los valores de la nueva fuente.

### 4.4 Consola de movimiento (botón 🎮 Mov.)

Panel **flotante** (arrastrable, minimizable). Solo con **una cámara al programa**.

**Presets integrados:**

| Botón | Efecto resumido |
|-------|-----------------|
| Acercar | Zoom suave al centro (~2,2 s) |
| Alejar | Vuelta al plano general (~2,4 s) |
| Pan → / ← / ↑ / ↓ | Acercar y desplazar lateral o vertical |
| Abrir | Plano muy cerrado → plano general (revelar contexto) |
| Detalle | Plano medio cerrado (~1,8 s) |
| Sostener | Detalle → pausa en detalle → neutro |
| Neutro | Vuelta a tu encuadre base de la pestaña |

**Secuencias** (bloque aparte en el panel; varios pasos encadenados):

| Botón | Efecto resumido |
|-------|-----------------|
| Barrido → | Zoom al costado **izquierdo**, recorre hasta la **derecha** (mismo zoom) y vuelve al **neutro** (~7,2 s) |
| Barrido ← | Igual, empezando por la derecha |
| Recorrido | Acercar al centro → izquierda → derecha → neutro (~9,5 s) |
| Barrido ↕ | Zoom arriba, recorre hacia abajo y neutro (~7 s) |
| Impulso | Detalle rápido al centro y neutro (~2,8 s) |
| Onda | Detalle con pausa, barrido suave y neutro (~8,5 s) |

**Controles del panel:**

- **Velocidad** — más alto = movimiento más lento.
- **Intensidad** — cuánto zoom/desplazamiento aplica el preset.
- **+ Guardar encuadre** — guarda el zoom/pan **actual** como preset propio (sección **Tuyos**).
- **Detener** — corta una secuencia en curso.
- **Probar / Programar** — en *Probar*, un clic en un preset lo ejecuta en la cámara al aire; en *Programar*, lo añade al programa de entrada de la cámara objetivo (debajo del título del panel). Doble clic en un preset siempre asigna.
- **Chips en miniaturas** — cada fuente puede llevar hasta **4** movimientos. El chip muestra la **letra inicial** del preset (mismo color que el botón: gesto, secuencia o tuyo); al pasar el cursor se lee el nombre completo. Clic en el chip lo quita; doble clic lo prueba en esa cámara. El botón **+** abre un menú rápido para añadir.
- **Al entrar** — cuando una cámara pasa al programa en layout *single* (manual), primero vuelve al neutro y luego ejecuta sus movimientos en orden. En director **automático** no se dispara (evita pelear con el cambio de toma).

Los presets propios, el programa por cámara y los ajustes de velocidad/intensidad se guardan en **localStorage** del equipo (no se sincronizan entre PCs).

### 4.5 Fondo del programa

Color sólido o imagen (archivo local). Las bandas del letterbox del video muestran ese fondo.

### 4.6 Presets de escena

Guardan: layout, asignación de cámaras por layout, orientación, crossfade y fondo. Incluyen presets de fábrica (solo cámara, PIP, 2×2). Los propios se guardan con **+ Guardar actual** y se pueden borrar.

### 4.7 Crossfade

Duración del fundido entre cambios de escena/cámara (0 = corte seco). Afecta cambios de layout o de toma en single.

### 4.8 Plan de cámara (barra bajo el programa)

Durante la grabación del programa, muestra **qué cámara está al aire** en el tiempo (segmentos de color). En fusión con archivos permite **scrub** en la línea de tiempo cargada.

---

## 5. Audio

| Contexto | Herramienta |
|----------|-------------|
| Sesión ISO | Entrada de PC opcional en el mismo archivo de sesión |
| Fusión archivos | Reproduce `audio-*.webm` de la sesión; ecualizador flotante (5 bandas, bypass, presets) aplicado al audio de la mezcla al grabar |
| Fusión en vivo | Audio según configuración de fuentes / PC (panel de audio de PC) |

Chromium usa **WASAPI** (no ASIO directo). Se desactivan procesos agresivos de “mejora” de voz en la captura para señal más limpia desde interfaz.

---

## 6. Transportes flotantes

Barra de control que puede **anclarse abajo** o **flotar** (arrastrar desde la barra superior).

| Modo | Controles |
|------|-----------|
| ISO | Grabar, pausa (si el navegador lo soporta), fin, estado STBY/REC |
| Fusión archivos | Play/pausa de timeline, grabar mezcla, pausa de grabación, fin, cerrar sesión |
| Fusión en vivo | Grabar programa, fin, cancelar (descartar toma o preview) |

---

## 7. Conexión de cámaras

1. Misma red Wi‑Fi (5 GHz recomendado con varias cámaras).
2. Escanear QR de la pestaña correcta.
3. En PC: alias opcional, rotación, quitar fuente.
4. **Captura de pantalla** (sesión en vivo y fusión en vivo): monitor o ventana; en el modal, **«Ocultar Studio Live en la captura»** si querés dejar la app abierta mientras grabás el monitor.

**Salud de fuente:** aviso si el video parece congelado (relevante en captura de pantalla).

### YouTube u otro streaming en el navegador (vídeo congelado)

No es un fallo de «Ocultar en captura»: Chrome/Edge dibujan el vídeo con la **GPU** y Windows a menudo **no actualiza** esa zona en la captura (queda un frame fijo o una ventanita).

**Qué hacer (en orden):**

1. Picker **«Solo pantallas»** → elegí el **monitor**, no la ventana del navegador.
2. En Chrome: **Configuración → Sistema → desactivar «Usar aceleración por hardware»** → cerrá Chrome por completo y volvé a abrir YouTube.
3. YouTube en **ventana normal** (no pantalla completa dentro del navegador).
4. Antes de grabar, comprobá que la miniatura diga **«Se mueve»** (no «Parece congelada»).
5. Si sigue igual: cerrá Studio Live y arrancá con **`npm run dev:no-gpu`** (desactiva GPU en la app).
6. Alternativa fiable: **archivo .mp4 local** en el reproductor de Windows, o celulares por QR.

---

## 8. Grabación y archivos

### 8.1 Recorte al exportar (inicio y final)

Después de grabar la **mezcla** (Fusión por archivos o Fusión en vivo), en el modal **Grabación terminada** podés ajustar **Inicio** y **Final** con las barras antes de **Guardar WebM** o **Guardar MP4**. Solo se exporta ese tramo (FFmpeg); el archivo en memoria no se modifica hasta guardar. Si dejás inicio en 0 y final al final del video, se guarda todo sin recortar.

Por ahora **no** se puede quitar un pedazo del medio; solo acortar principio y/o final.


### Convención de nombres (ISO)

```
carpeta-elegida/
  subcarpeta-sesion/
    cam-<cameraId>-<timestamp>.webm
    audio-<timestamp>.webm    (si hubo audio de PC)
```

### Fusión

- Grabación en vivo del canvas → WebM (VP8 preferido).
- Export recomendado en Windows: **MP4** (H.264 + AAC) vía FFmpeg embebido.
- Los `fusion-*.webm` exportados **no** se reimportan en “cargar pistas” (solo material ISO).

---

## 9. Confirmaciones y formularios

La app **no usa** `window.alert` / `prompt` / `confirm` del sistema (Electron no los soporta bien). Las confirmaciones (descartar grabación, cerrar sesión, borrar preset) y los nombres al guardar son **formularios dentro de la interfaz** (bloques grises con Guardar / Cancelar).

---

## 10. Persistencia local (esta PC)

| Dato | Dónde |
|------|--------|
| Presets de escena propios | `localStorage` |
| Presets de movimiento propios | `localStorage` |
| Programa de movimiento por cámara (hasta 4) | `localStorage` |
| Velocidad / intensidad de movimiento | `localStorage` |
| Posición de paneles flotantes (EQ, Mov., transporte) | `localStorage` |
| Alias de cámaras | `localStorage` |
| Fondo del programa | `localStorage` |
| Certificados TLS | Perfil de usuario de Electron |

---

## 11. Limitaciones conocidas

- **4–6 celulares** en Wi‑Fi exigen buen router y preset acorde.
- **Movimiento automático** solo en layout single, una cámara al aire.
- **Encuadre por cámara:** cambiar de fuente no copia el pan de la anterior.
- **Guardar encuadre** crea un preset nuevo; no hay “actualizar” uno existente todavía.
- **Reproductor clásico de Windows** puede ir mal con WebM; preferir MP4 exportado.
- Mensajes en consola de **DevTools** (`HTTP/1.1 4...`, Autofill): ruido de Chromium, no errores de la app.
- En **desarrollo**, CSP puede avisar `unsafe-eval` (Vite); el build empaquetado lo mitiga.

---

## 12. Estado del desarrollo (resumen)

| Área | Estado |
|------|--------|
| WebRTC + QR + ISO | Operativo |
| Fusión archivos + MP4 | Operativo |
| Fusión en vivo + programa | Operativo |
| Layouts multi-cámara | Operativo |
| Zoom/pan fluido + agarre | Operativo (may 2026) |
| Movimiento + panel flotante + presets guardados | Operativo |
| Diálogos inline (sin prompt/confirm) | Operativo |
| IA / director inteligente | No implementado |
| Reset encuadre al cambiar cámara (opción) | Pendiente |
| Actualizar preset de movimiento guardado | Pendiente |
| Encuadre ligado a preset de escena | Pendiente |
| Sensibilidad de zoom en UI | Pendiente |

---

## 13. Próximos pasos sugeridos (producto)

1. Opción **“neutro al cambiar de cámara”** vs recordar encuadre por fuente.
2. **Reemplazar** preset de movimiento guardado (no solo crear otro).
3. Guardar **encuadre** (o movimiento) dentro del **preset de escena**.
4. Slider de **sensibilidad de zoom** en el panel Mov. o ajustes.
5. Documentación de usuario en PDF o tutorial corto embebido.

---

## 14. Estructura técnica breve

```
studioLive/
  electron/          Proceso principal (HTTPS, WebSocket, FFmpeg, guardar archivos)
  camera-client/     Página del celular
  src/renderer/      Interfaz React (App, FusionPanel, LiveFusionPanel, …)
  docs/              Plan, historial y esta guía
```

Stack: **Electron 33**, **Vite**, **React 18**, **TypeScript**, **WebRTC**, **MediaRecorder**, **ffmpeg-static**.

---

*Última actualización: mayo 2026. Si el comportamiento en código cambia, actualizar este archivo junto con `HISTORIAL_IMPLEMENTACION.md`.*

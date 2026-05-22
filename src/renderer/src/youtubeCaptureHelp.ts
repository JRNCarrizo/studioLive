/** Texto de ayuda cuando YouTube u otro streaming queda congelado en captura de pantalla. */

export const YOUTUBE_CAPTURE_CHECKLIST = [
  'En el picker: «Solo pantallas» → tu monitor (no la ventana del navegador).',
  'En Chrome/Edge: Configuración → Sistema → desactivá «Aceleración por hardware» → reiniciá el navegador.',
  'YouTube en ventana normal (no pantalla completa dentro del navegador).',
  'En la miniatura debe decir «Se mueve» antes de grabar (Fusión en vivo o Sesión en vivo).',
  'Si sigue congelado: cerrá Studio Live y ejecutá npm run dev:no-gpu (desactiva GPU en la app).',
  'Alternativa: descargá el vídeo o usá un .mp4 local en el reproductor de Windows.'
] as const

export function youtubeCaptureHelpParagraph(): string {
  return YOUTUBE_CAPTURE_CHECKLIST.join(' ')
}

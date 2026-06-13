/**
 * Canal de salida hacia el panel.
 *
 * El webview registra su función de impresión con {@link setEmisor}; cualquier
 * módulo (comandos, listeners de Realtime) emite texto con {@link emitir} sin
 * depender directamente del panel.
 */

type Emisor = (texto: string) => void;

let emisor: Emisor | null = null;

/** Registra la función que imprime en el panel. */
export function setEmisor(fn: Emisor | null): void {
  emisor = fn;
}

/** Emite texto al panel (no-op si aún no hay panel visible). */
export function emitir(texto: string): void {
  emisor?.(texto);
}

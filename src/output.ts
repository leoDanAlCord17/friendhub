import * as vscode from 'vscode';

/**
 * Canal de salida hacia el panel.
 *
 * El webview registra su función de impresión con {@link setEmisor}; cualquier
 * módulo (comandos, listeners de Realtime) emite texto con {@link emitir} sin
 * depender directamente del panel.
 */

type Emisor = (texto: string) => void;
type ConsultaVisible = () => boolean;

let emisor: Emisor | null = null;
let consultaVisible: ConsultaVisible | null = null;

/** Registra la función que imprime en el panel. */
export function setEmisor(fn: Emisor | null): void {
  emisor = fn;
}

/** Emite texto al panel (no-op si aún no hay panel visible). */
export function emitir(texto: string): void {
  emisor?.(texto);
}

/** Registra la función que consulta si el panel está visible. */
export function setConsultaVisible(fn: ConsultaVisible | null): void {
  consultaVisible = fn;
}

/** Devuelve true si el panel está visible (asume visible si no hay consulta registrada). */
export function panelEstaVisible(): boolean {
  return consultaVisible ? consultaVisible() : true;
}

/** Muestra una notificación del SO solo cuando el panel no está visible. */
export function notificarSiNoVisible(mensaje: string, _silenciosa = false): void {
  if (panelEstaVisible()) { return; }
  void vscode.window.showInformationMessage(mensaje);
}

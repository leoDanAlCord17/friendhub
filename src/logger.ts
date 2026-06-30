const PREFIJO = '[TermPals]';

export function logError(contexto: string, error: unknown): void {
  const mensaje = error instanceof Error ? error.message : String(error);
  console.error(`${PREFIJO} [${contexto}]`, mensaje);
}

export function logWarn(contexto: string, mensaje: string): void {
  console.warn(`${PREFIJO} [${contexto}]`, mensaje);
}

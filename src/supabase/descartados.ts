import { getSupabase } from "./client";
import { Descartado } from "../types";

const TABLA = "descartados";

/**
 * Descartes de la sesión actual (en memoria). Evita que un usuario reaparezca
 * en la búsqueda sin necesidad de consultar la base en cada match.
 */
const descartesSesion = new Map<string, Set<string>>();

/** Descarta a un usuario: lo persiste y lo registra en la sesión. */
export async function descartarUsuario(
  usuario_id: string,
  descartado_id: string,
): Promise<Descartado> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert({ usuario_id, descartado_id })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  recordarEnSesion(usuario_id, descartado_id);
  return data as Descartado;
}

/** Indica si un usuario fue descartado durante la sesión actual. */
export function estaDescartadoEnSesion(
  usuario_id: string,
  descartado_id: string,
): boolean {
  return descartesSesion.get(usuario_id)?.has(descartado_id) ?? false;
}

/** Devuelve los IDs descartados por un usuario en la sesión actual. */
export function obtenerDescartadosEnSesionIds(usuario_id: string): string[] {
  return [...(descartesSesion.get(usuario_id) ?? [])];
}

/** Carga en sesión los descartes ya persistidos de un usuario. */
export async function precargarDescartes(usuario_id: string): Promise<void> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("descartado_id")
    .eq("usuario_id", usuario_id)
    .eq("estatus", true);
  if (error) {
    throw error;
  }
  for (const fila of data ?? []) {
    recordarEnSesion(usuario_id, (fila as { descartado_id: string }).descartado_id);
  }
}

function recordarEnSesion(usuario_id: string, descartado_id: string): void {
  let set = descartesSesion.get(usuario_id);
  if (!set) {
    set = new Set<string>();
    descartesSesion.set(usuario_id, set);
  }
  set.add(descartado_id);
}

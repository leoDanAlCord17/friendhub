import { getSupabase } from "./client";
import { Usuario } from "../types";

const TABLA = "usuarios";

/** Busca un usuario por su id de GitHub. */
export async function obtenerUsuarioPorGithubId(
  github_id: string,
): Promise<Usuario | null> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("github_id", github_id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Usuario | null;
}

/** Obtiene un usuario por su id. */
export async function obtenerUsuario(id: string): Promise<Usuario | null> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Usuario | null;
}

/** Crea un usuario. */
export async function crearUsuario(
  datos: Partial<Usuario>,
): Promise<Usuario> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert(datos)
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Usuario;
}

/** Actualiza la conversación activa de un usuario (o la limpia con null). */
export async function actualizarConversacionActiva(
  id: string,
  conversacion_id: string | null,
): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLA)
    .update({
      conversacion_activa_id: conversacion_id,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    throw error;
  }
}

/**
 * Busca un match disponible para el usuario.
 *
 * Filtra usuarios activos, libres (sin conversación activa), con la misma
 * intención `busca` ("amigos" | "algo_mas") y que no hayan sido descartados
 * por este usuario. Devuelve uno al azar, o null si no hay candidatos.
 */
export async function buscarMatch(
  usuario_id: string,
  busca: string,
): Promise<Usuario | null> {
  const supabase = getSupabase();

  const { data: desc, error: errDesc } = await supabase
    .from("descartados")
    .select("descartado_id")
    .eq("usuario_id", usuario_id)
    .eq("estatus", "activo");
  if (errDesc) {
    throw errDesc;
  }
  const excluidos = (desc ?? []).map(
    (d) => (d as { descartado_id: string }).descartado_id,
  );

  let query = supabase
    .from(TABLA)
    .select("*")
    .eq("estatus", "activo")
    .eq("busca", busca)
    .is("conversacion_activa_id", null)
    .neq("id", usuario_id);

  if (excluidos.length > 0) {
    query = query.not("id", "in", `(${excluidos.join(",")})`);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }
  const candidatos = (data ?? []) as Usuario[];
  if (candidatos.length === 0) {
    return null;
  }
  return candidatos[Math.floor(Math.random() * candidatos.length)];
}

/** Actualiza la preferencia de búsqueda del usuario. */
export async function actualizarBusca(
  id: string,
  busca: "amigos" | "algo_mas",
): Promise<Usuario> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .update({ busca, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Usuario;
}

/** Lista los usuarios disponibles para conectar. */
export async function listarDisponibles(): Promise<Usuario[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("disponible", true)
    .eq("estatus", "activo");
  if (error) {
    throw error;
  }
  return (data ?? []) as Usuario[];
}

import { getSupabase } from "./client";
import { Amigo, Usuario } from "../types";
import { obtenerUsuario } from "./usuarios";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function esUuidValido(id: string): boolean {
  return UUID_RE.test(id);
}

const TABLA = "amigos";

/**
 * Propone amistad: registra la relación (sin confirmar todavía) ligada a la
 * conversación en la que surgió.
 */
export async function proponerAmistad(
  usuario_a_id: string,
  usuario_b_id: string,
): Promise<Amigo> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert({
      usuario_id: usuario_a_id,
      amigo_id: usuario_b_id,
      estado: 'pendiente',
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Amigo;
}

/**
 * Confirma una amistad propuesta. Marca ambos sentidos como confirmados e
 * inserta el sentido recíproco si no existía.
 */
export async function confirmarAmistad(
  usuario_a_id: string,
  usuario_b_id: string,
): Promise<void> {
  const supabase = getSupabase();
  const ahora = new Date().toISOString();

  if (!esUuidValido(usuario_a_id) || !esUuidValido(usuario_b_id)) {
    throw new Error('ID de usuario inválido');
  }
  const { error: errUpdate } = await supabase
    .from(TABLA)
    .update({ estado: 'confirmado', actualizado_en: ahora })
    .or(
      `and(usuario_id.eq.${usuario_a_id},amigo_id.eq.${usuario_b_id}),and(usuario_id.eq.${usuario_b_id},amigo_id.eq.${usuario_a_id})`,
    );
  if (errUpdate) {
    throw errUpdate;
  }

  // Verificar que existe la fila en la dirección del confirmador (usuario_a_id → usuario_b_id).
  const { data: reciproco } = await supabase
    .from(TABLA)
    .select("id")
    .eq("usuario_id", usuario_a_id)
    .eq("amigo_id", usuario_b_id)
    .maybeSingle();

  if (!reciproco) {
    const { error: errInsert } = await supabase.from(TABLA).insert({
      usuario_id: usuario_a_id,
      amigo_id: usuario_b_id,
      estado: 'confirmado',
    });
    if (errInsert) {
      throw errInsert;
    }
  }
}

/** Verifica si existe una solicitud pendiente de usuario_a hacia usuario_b. */
export async function existeSolicitudPendiente(
  de_usuario_id: string,
  para_usuario_id: string,
): Promise<boolean> {
  const { data } = await getSupabase()
    .from(TABLA)
    .select("id")
    .eq("usuario_id", de_usuario_id)
    .eq("amigo_id", para_usuario_id)
    .eq("estado", "pendiente")
    .maybeSingle();
  return data !== null;
}

/** Lista los amigos confirmados de un usuario. */
export async function obtenerAmigos(usuario_id: string): Promise<Amigo[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("usuario_id", usuario_id)
    .eq("estado", 'confirmado')
    .eq("estatus", true);
  if (error) {
    throw error;
  }
  return (data ?? []) as Amigo[];
}

/** Lista los amigos confirmados de un usuario con su perfil completo. */
export async function obtenerAmigosConPerfil(
  usuario_id: string,
): Promise<Usuario[]> {
  const amigos = await obtenerAmigos(usuario_id);
  const perfiles = await Promise.all(amigos.map((a) => obtenerUsuario(a.amigo_id)));
  return perfiles.filter((u): u is Usuario => u !== null);
}

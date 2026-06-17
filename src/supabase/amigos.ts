import { getSupabase } from "./client";
import { Amigo } from "../types";

const TABLA = "amigos";

/**
 * Propone amistad: registra la relación (sin confirmar todavía) ligada a la
 * conversación en la que surgió.
 */
export async function proponerAmistad(
  usuario_a_id: string,
  usuario_b_id: string,
  conversacion_id: string,
): Promise<Amigo> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert({
      usuario_id: usuario_a_id,
      amigo_id: usuario_b_id,
      conversacion_id,
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

  const { error: errUpdate } = await supabase
    .from(TABLA)
    .update({ estado: 'confirmada', actualizado_en: ahora })
    .or(
      `and(usuario_id.eq.${usuario_a_id},amigo_id.eq.${usuario_b_id}),and(usuario_id.eq.${usuario_b_id},amigo_id.eq.${usuario_a_id})`,
    );
  if (errUpdate) {
    throw errUpdate;
  }

  const { data: reciproco } = await supabase
    .from(TABLA)
    .select("id")
    .eq("usuario_id", usuario_b_id)
    .eq("amigo_id", usuario_a_id)
    .maybeSingle();

  if (!reciproco) {
    const { error: errInsert } = await supabase.from(TABLA).insert({
      usuario_id: usuario_b_id,
      amigo_id: usuario_a_id,
      estado: 'confirmada',
    });
    if (errInsert) {
      throw errInsert;
    }
  }
}

/** Lista los amigos confirmados de un usuario. */
export async function obtenerAmigos(usuario_id: string): Promise<Amigo[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("usuario_id", usuario_id)
    .eq("estado", 'confirmada')
    .eq("estatus", true);
  if (error) {
    throw error;
  }
  return (data ?? []) as Amigo[];
}

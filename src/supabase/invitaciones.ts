import { getSupabase } from "./client";
import { Invitacion } from "../types";

const TABLA = "invitaciones";

/** Crea una invitación con el README y el puntaje de compatibilidad. */
export async function crearInvitacion(
  de: string,
  para: string,
  readme: string,
  puntaje: number,
): Promise<Invitacion> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert({
      de_usuario: de,
      para_usuario: para,
      readme,
      puntaje,
      estado: "pendiente",
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Invitacion;
}

/** Responde a una invitación (aceptar / rechazar). */
export async function responderInvitacion(
  id: string,
  respuesta: "aceptada" | "rechazada",
): Promise<Invitacion> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .update({ estado: respuesta, actualizado_en: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Invitacion;
}

/** Lista las invitaciones pendientes recibidas por un usuario. */
export async function obtenerInvitacionesPendientes(
  usuario_id: string,
): Promise<Invitacion[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("para_usuario", usuario_id)
    .eq("estado", "pendiente")
    .eq("estatus", "activo")
    .order("creado_en", { ascending: false });
  if (error) {
    throw error;
  }
  return (data ?? []) as Invitacion[];
}

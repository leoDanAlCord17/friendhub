import { getSupabase } from "./client";
import { Conversacion } from "../types";
import { logError } from "../logger";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function esUuidValido(id: string): boolean {
  return UUID_RE.test(id);
}

const TABLA = "conversaciones";

/** Crea una conversación abierta entre dos usuarios con su puntaje. */
export async function crearConversacion(
  usuario_a_id: string,
  usuario_b_id: string,
  puntaje: number,
): Promise<Conversacion> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .insert({
      usuario_a: usuario_a_id,
      usuario_b: usuario_b_id,
      puntaje,
      abierta: true,
    })
    .select("*")
    .single();
  if (error) {
    throw error;
  }
  return data as Conversacion;
}

/** Cierra una conversación registrando el motivo. */
export async function cerrarConversacion(
  id: string,
  motivo: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLA)
    .update({
      abierta: false,
      motivo_cierre: motivo,
      actualizado_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    throw error;
  }
}

/** Obtiene la conversación abierta en la que participa un usuario. */
export async function obtenerConversacionActiva(
  usuario_id: string,
): Promise<Conversacion | null> {
  if (!esUuidValido(usuario_id)) {
    throw new Error('ID de usuario inválido');
  }
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .or(`usuario_a.eq.${usuario_id},usuario_b.eq.${usuario_id}`)
    .eq("abierta", true)
    .order("creado_en", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    throw error;
  }
  return data as Conversacion | null;
}

/** Marca la marca de tiempo del último mensaje de la conversación. */
export async function tocarUltimoMensaje(
  id: string,
  contenido: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLA)
    .update({
      ultimo_mensaje: contenido,
      ultimo_mensaje_en: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    throw error;
  }
}

/**
 * Llama a la RPC transaccional `conectar_usuarios` que en una sola
 * sentencia crea la invitación (aceptada), la conversación, las vincula
 * y actualiza `conversacion_activa_id` de ambos usuarios.
 */
export async function conectarUsuarios(
  deUsuario: string,
  paraUsuario: string,
  readme: string,
  puntaje: number,
): Promise<{ conversacionId: string; invitacionId: string }> {
  const { data, error } = await getSupabase().rpc("conectar_usuarios", {
    p_de_usuario: deUsuario,
    p_para_usuario: paraUsuario,
    p_readme: readme,
    p_puntaje: puntaje,
  });
  if (error) {
    logError('rpc-conectar-usuarios', error);
    throw error;
  }
  const fila = (data as { conversacion_id: string; invitacion_id: string }[])[0];
  return { conversacionId: fila.conversacion_id, invitacionId: fila.invitacion_id };
}

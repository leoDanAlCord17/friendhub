import { getSupabase } from "./client";

export async function crearFeedback(
  usuario_id: string,
  tipo: 'bug' | 'sugerencia',
  mensaje: string,
  creado_por: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from("feedback")
    .insert({ usuario_id, tipo, mensaje, creado_por, actualizado_por: creado_por });
  if (error) {
    throw error;
  }
}

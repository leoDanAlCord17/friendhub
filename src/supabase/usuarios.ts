import { getSupabase } from "./client";
import { Usuario } from "../types";
import { obtenerDescartadosEnSesionIds } from "./descartados";

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
 * Busca un match en cascada de 3 niveles:
 *   1. Coincidencia exacta de `busca`
 *   2. Candidatos con `busca='ambas'` (o todos si el usuario mismo busca 'ambas')
 *   3. Cualquier usuario disponible sin filtrar por `busca`
 *
 * Devuelve el usuario elegido y el nivel de coincidencia, o null si no hay nadie.
 */
export async function buscarMatch(
  usuario_id: string,
  busca: string,
): Promise<{ usuario: Usuario; nivelMatch: 'exacto' | 'ambas' | 'cualquiera' } | null> {
  const supabase = getSupabase();

  // Descartados de la sesión en memoria (cargados por precargarDescartes al login)
  const excluidos = new Set(obtenerDescartadosEnSesionIds(usuario_id));

  const filtrar = (rows: unknown[]): Usuario[] =>
    (rows as Usuario[]).filter((u) => !excluidos.has(u.id));

  const elegir = (candidatos: Usuario[]): Usuario =>
    candidatos[Math.floor(Math.random() * candidatos.length)];

  const base = () =>
    supabase
      .from(TABLA)
      .select("*")
      .eq("estatus", true)
      .is("conversacion_activa_id", null)
      .neq("id", usuario_id);

  // ── Nivel 1: coincidencia exacta ──────────────────────────────────────────
  const { data: d1, error: e1 } = await base().eq("busca", busca);
  if (e1) { throw e1; }
  const nivel1 = filtrar(d1 ?? []);
  if (nivel1.length > 0) {
    return { usuario: elegir(nivel1), nivelMatch: 'exacto' };
  }

  // ── Nivel 2: candidatos con busca='ambas' (o cualquier busca si yo soy 'ambas') ──
  const { data: d2, error: e2 } =
    busca === 'ambas'
      ? await base().in("busca", ["colaborar", "networking", "ambas"])
      : await base().eq("busca", "ambas");
  if (e2) { throw e2; }
  const nivel2 = filtrar(d2 ?? []);
  if (nivel2.length > 0) {
    return { usuario: elegir(nivel2), nivelMatch: 'ambas' };
  }

  // ── Nivel 3: cualquier usuario disponible ─────────────────────────────────
  const { data: d3, error: e3 } = await base();
  if (e3) { throw e3; }
  const nivel3 = filtrar(d3 ?? []);
  if (nivel3.length > 0) {
    return { usuario: elegir(nivel3), nivelMatch: 'cualquiera' };
  }

  return null;
}

/**
 * Actualiza la preferencia de búsqueda del usuario.
 * El CHECK (válido solo a nivel de tipos) acepta: colaborar | networking | ambas.
 */
export async function actualizarBusca(
  id: string,
  busca: "colaborar" | "networking" | "ambas",
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

/** Actualiza la bio (carta de presentación) del usuario. */
export async function actualizarBio(id: string, bio: string): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLA)
    .update({ bio, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  if (error) {
    throw error;
  }
}

/** Lista los usuarios activos disponibles para conectar. */
export async function listarDisponibles(): Promise<Usuario[]> {
  const { data, error } = await getSupabase()
    .from(TABLA)
    .select("*")
    .eq("estatus", true);
  if (error) {
    throw error;
  }
  return (data ?? []) as Usuario[];
}

/**
 * Llama a la RPC `consumir_busqueda` que ejecuta el conteo de forma atómica
 * (SELECT … FOR UPDATE), eliminando la race condition de read-modify-write.
 */
export async function verificarYConsumirBusqueda(
  usuario_id: string,
): Promise<{ permitido: boolean; restantes: number }> {
  const { data, error } = await getSupabase().rpc("consumir_busqueda", {
    p_usuario_id: usuario_id,
  });
  if (error) {
    throw error;
  }
  const fila = (data as { permitido: boolean; restantes: number }[])[0];
  return { permitido: fila.permitido, restantes: fila.restantes };
}

/** Registra o actualiza el interés del usuario en TermPals Pro. */
export async function guardarInteresPro(
  usuario_id: string,
  interesado: boolean,
): Promise<void> {
  const { error } = await getSupabase()
    .from("interes_pro")
    .upsert(
      { usuario_id, interesado, actualizado_por: null },
      { onConflict: "usuario_id" },
    );
  if (error) {
    throw error;
  }
}

/** Actualiza la zona horaria detectada del cliente. */
export async function actualizarZonaHoraria(
  id: string,
  zona_horaria: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from(TABLA)
    .update({ zona_horaria, actualizado_en: new Date().toISOString() })
    .eq("id", id);
  if (error) { throw error; }
}

/**
 * Elimina todos los datos del usuario en orden correcto de FK.
 * Incluye la limpieza de conversacion_activa_id para desbloquear la FK
 * de conversaciones antes de eliminar esas filas.
 */
export async function eliminarCuenta(usuario_id: string): Promise<void> {
  const db = getSupabase();

  // 0. Romper FKs circulares desde usuarios antes de eliminar tablas referenciadas
  await db
    .from("usuarios")
    .update({ conversacion_activa_id: null, consentimiento_id: null })
    .eq("id", usuario_id);

  // 1. descartados (ambas direcciones)
  await db.from("descartados").delete().eq("usuario_id", usuario_id);
  await db.from("descartados").delete().eq("descartado_id", usuario_id);

  // 2. amigos (ambas direcciones)
  await db.from("amigos").delete().eq("usuario_id", usuario_id);
  await db.from("amigos").delete().eq("amigo_id", usuario_id);

  // 3. interes_pro
  await db.from("interes_pro").delete().eq("usuario_id", usuario_id);

  // 4. feedback
  await db.from("feedback").delete().eq("usuario_id", usuario_id);

  // 5. invitaciones (ambas direcciones)
  await db.from("invitaciones").delete().eq("de_usuario", usuario_id);
  await db.from("invitaciones").delete().eq("para_usuario", usuario_id);

  // 6. conversaciones (ambas posiciones)
  await db.from("conversaciones").delete().eq("usuario_a", usuario_id);
  await db.from("conversaciones").delete().eq("usuario_b", usuario_id);

  // 7. proyectos
  await db.from("proyectos").delete().eq("usuario_id", usuario_id);

  // 8. consentimientos
  await db.from("consentimientos").delete().eq("usuario_id", usuario_id);

  // 9. usuario
  const { error } = await db.from("usuarios").delete().eq("id", usuario_id);
  if (error) { throw error; }
}

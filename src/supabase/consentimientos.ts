import { getSupabase } from "./client";
import { TerminosVersion, Consentimiento } from "../types";

/** Granularidad del consentimiento del usuario. */
export interface GranularConsentimiento {
  acepta_perfil: boolean;
  acepta_stack: boolean;
  acepta_readme: boolean;
  acepta_matching: boolean;
}

/** Devuelve la versión activa de los términos, o null si no existe ninguna. */
export async function obtenerVersionActiva(): Promise<TerminosVersion | null> {
  const { data, error } = await getSupabase()
    .from("terminos_versiones")
    .select("*")
    .eq("activa", true)
    .limit(1)
    .maybeSingle();
  if (error) { throw error; }
  return data as TerminosVersion | null;
}

/**
 * Inserta un registro de consentimiento en la tabla `consentimientos` y
 * actualiza el campo `consentimiento_activo` / `consentimiento_id` en `usuarios`.
 */
export async function registrarConsentimiento(
  usuario_id: string,
  version_id: string,
  accion: "aceptado" | "rechazado" | "retirado" | "actualizado_aceptado",
  granular: GranularConsentimiento,
  extension_version: string,
): Promise<Consentimiento> {
  const { data, error: e1 } = await getSupabase()
    .from("consentimientos")
    .insert({
      usuario_id,
      version_id,
      accion,
      acepta_perfil: granular.acepta_perfil,
      acepta_stack: granular.acepta_stack,
      acepta_readme: granular.acepta_readme,
      acepta_matching: granular.acepta_matching,
      extension_version,
      creado_por: usuario_id,
    })
    .select("*")
    .single();
  if (e1) { throw e1; }

  const consentimiento = data as Consentimiento;

  if (accion === "aceptado" || accion === "actualizado_aceptado") {
    await getSupabase()
      .from("usuarios")
      .update({
        consentimiento_activo: true,
        consentimiento_id: consentimiento.id,
        consentimiento_fecha: new Date().toISOString(),
      })
      .eq("id", usuario_id);
  } else {
    await getSupabase()
      .from("usuarios")
      .update({ consentimiento_activo: false })
      .eq("id", usuario_id);
  }

  return consentimiento;
}

/** Verifica si el usuario tiene consentimiento activo en Supabase. */
export async function tieneConsentimientoActivo(
  usuario_id: string,
): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("usuarios")
    .select("consentimiento_activo")
    .eq("id", usuario_id)
    .maybeSingle();
  if (error) { throw error; }
  return (data as { consentimiento_activo: boolean } | null)?.consentimiento_activo ?? false;
}

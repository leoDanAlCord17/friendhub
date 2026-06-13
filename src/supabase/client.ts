import * as vscode from "vscode";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Cliente Supabase singleton de FriendHub.
 *
 * Las credenciales se leen de la configuración de VS Code
 * (`friendhub.supabaseUrl` / `friendhub.supabaseAnonKey`) para que el usuario
 * las defina en Settings sin quemarlas en el bundle de la extensión.
 */

let cliente: SupabaseClient | null = null;

function leerCredenciales(): { url: string; anonKey: string } {
  const config = vscode.workspace.getConfiguration("friendhub");
  const url = config.get<string>("supabaseUrl", "").trim();
  const anonKey = config.get<string>("supabaseAnonKey", "").trim();
  return { url, anonKey };
}

/** Devuelve el cliente Supabase, creándolo la primera vez. */
export function getSupabase(): SupabaseClient {
  if (!cliente) {
    const { url, anonKey } = leerCredenciales();
    if (!url || !anonKey) {
      throw new Error(
        "Faltan credenciales de Supabase. Configúralas en Settings: " +
          "friendhub.supabaseUrl y friendhub.supabaseAnonKey.",
      );
    }
    cliente = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return cliente;
}

/** Indica si las credenciales están configuradas. */
export function hayCredenciales(): boolean {
  const { url, anonKey } = leerCredenciales();
  return Boolean(url && anonKey);
}

/** Reinicia el cliente (p. ej. al cambiar credenciales en Settings). */
export function reiniciarSupabase(): void {
  cliente = null;
}

/** Permite inyectar un cliente ya configurado (tests / OAuth). */
export function setSupabase(instancia: SupabaseClient): void {
  cliente = instancia;
}

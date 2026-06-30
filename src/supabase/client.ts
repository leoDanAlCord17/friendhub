import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = 'https://xjbqfkcjhzedzuphaewx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqYnFma2NqaHplZHp1cGhhZXd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEzNTM4NTEsImV4cCI6MjA5NjkyOTg1MX0.pLYKDrBpxgyATH6mQQMviFPIxbN2CgMvPykSescEpmQ';

let cliente: SupabaseClient | null = null;

/** Devuelve el cliente Supabase, creándolo la primera vez. */
export function getSupabase(): SupabaseClient {
  if (!cliente) {
    cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return cliente;
}

/** Siempre true — las credenciales están hardcodeadas en el bundle. */
export function hayCredenciales(): boolean {
  return true;
}

/** Reinicia el cliente (usado en tests). */
export function reiniciarSupabase(): void {
  cliente = null;
}

/** Permite inyectar un cliente ya configurado (tests / OAuth). */
export function setSupabase(instancia: SupabaseClient): void {
  cliente = instancia;
}

import { Invitacion, Proyecto, Usuario } from "./types";
import { obtenerProyectoActivo } from "./supabase/proyectos";
import { obtenerAmigos } from "./supabase/amigos";
import { obtenerUsuario } from "./supabase/usuarios";

/** Match propuesto al usuario (resultado de /tp search). */
export interface MatchActual {
  usuario: Usuario;
  proyecto: Proyecto | null;
  compatibilidad: number;
  nivelMatch: 'exacto' | 'ambas' | 'cualquiera';
}

/** Invitación entrante a la espera de respuesta del usuario actual. */
export interface InvitacionPendiente {
  invitacion: Invitacion;
  username: string;
}

/**
 * Estado de sesión en memoria de TermPals. Lo puebla la extensión tras el
 * login de GitHub y lo consultan los comandos `/tp`.
 */
interface EstadoSesion {
  usuario: Usuario | null;
  match: MatchActual | null;
  puntaje: number;
  invitacionPendiente: InvitacionPendiente | null;
  proyectoActual: Proyecto | null;
  amigosCache: Usuario[];
  onboardingPaso: 'busca' | 'bio' | 'readme' | null;
  onboardingDatos: { busca?: string; bio?: string };
  esperandoRespuestaPro: boolean;
}

const estado: EstadoSesion = {
  usuario: null,
  match: null,
  puntaje: 0,
  invitacionPendiente: null,
  proyectoActual: null,
  amigosCache: [],
  onboardingPaso: null,
  onboardingDatos: {},
  esperandoRespuestaPro: false,
};

/** Define el usuario autenticado de la sesión. */
export function setUsuarioActual(usuario: Usuario | null): void {
  estado.usuario = usuario;
}

/** Devuelve el usuario autenticado (o null si no hay sesión). */
export function getUsuarioActual(): Usuario | null {
  return estado.usuario;
}

/** Guarda el match propuesto actualmente y su puntaje. */
export function setMatchActual(match: MatchActual | null): void {
  estado.match = match;
  estado.puntaje = match?.compatibilidad ?? 0;
}

/** Devuelve el match propuesto actualmente. */
export function getMatchActual(): MatchActual | null {
  return estado.match;
}

/** Puntaje de compatibilidad del match actual. */
export function getPuntajeActual(): number {
  return estado.puntaje;
}

/** Guarda la invitación entrante pendiente de respuesta. */
export function setInvitacionPendiente(
  pendiente: InvitacionPendiente | null,
): void {
  estado.invitacionPendiente = pendiente;
}

/** Devuelve la invitación entrante pendiente (o null). */
export function getInvitacionPendiente(): InvitacionPendiente | null {
  return estado.invitacionPendiente;
}

/** Proyecto activo del usuario (cacheado al login). */
export function setProyectoActual(proyecto: Proyecto | null): void {
  estado.proyectoActual = proyecto;
}

export function getProyectoActual(): Proyecto | null {
  return estado.proyectoActual;
}

/** Amigos del usuario (cacheados al login). */
export function setAmigosCache(amigos: Usuario[]): void {
  estado.amigosCache = amigos;
}

export function getAmigosCache(): Usuario[] {
  return estado.amigosCache;
}

/** Paso activo del onboarding ('busca' | 'bio' | 'readme' | null). */
export function setOnboardingPaso(paso: 'busca' | 'bio' | 'readme' | null): void {
  estado.onboardingPaso = paso;
}

export function getOnboardingPaso(): 'busca' | 'bio' | 'readme' | null {
  return estado.onboardingPaso;
}

/** Datos temporales acumulados durante el onboarding. */
export function setOnboardingDatos(datos: { busca?: string; bio?: string }): void {
  estado.onboardingDatos = datos;
}

export function getOnboardingDatos(): { busca?: string; bio?: string } {
  return estado.onboardingDatos;
}

/** Indica si el usuario está esperando responder la encuesta de interés en Pro. */
export function setEsperandoRespuestaPro(valor: boolean): void {
  estado.esperandoRespuestaPro = valor;
}

export function getEsperandoRespuestaPro(): boolean {
  return estado.esperandoRespuestaPro;
}

/**
 * Carga en una sola pasada todo el estado de sesión necesario tras el login:
 * proyecto activo y amigos (resueltos a sus usuarios).
 */
export async function cargarSesion(usuario: Usuario): Promise<void> {
  const [proyecto, amigos] = await Promise.all([
    obtenerProyectoActivo(usuario.id),
    obtenerAmigos(usuario.id),
  ]);
  setProyectoActual(proyecto);

  const usuarios = await Promise.all(
    amigos.map((a) => obtenerUsuario(a.amigo_id)),
  );
  setAmigosCache(usuarios.filter((u): u is Usuario => u !== null));
}

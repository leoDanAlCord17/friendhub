import { Invitacion, Proyecto, Usuario } from "./types";

/** Match propuesto al usuario (resultado de /fh search). */
export interface MatchActual {
  usuario: Usuario;
  proyecto: Proyecto | null;
  compatibilidad: number;
}

/** Invitación entrante a la espera de respuesta del usuario actual. */
export interface InvitacionPendiente {
  invitacion: Invitacion;
  username: string;
}

/**
 * Estado de sesión en memoria de FriendHub. Lo puebla la extensión tras el
 * login de GitHub y lo consultan los comandos `/fh`.
 */
interface EstadoSesion {
  usuario: Usuario | null;
  match: MatchActual | null;
  puntaje: number;
  invitacionPendiente: InvitacionPendiente | null;
}

const estado: EstadoSesion = {
  usuario: null,
  match: null,
  puntaje: 0,
  invitacionPendiente: null,
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

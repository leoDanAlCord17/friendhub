/**
 * Tipos compartidos de FriendHub.
 *
 * Las interfaces de tablas reflejan exactamente el esquema de Supabase.
 * Todas incluyen los campos de control estándar (ver {@link CamposControl}).
 */

/** Estado lógico de cualquier registro. */
export type Estatus = "activo" | "inactivo" | "eliminado";

/** Campos de control presentes en todas las tablas. */
export interface CamposControl {
  id: string;
  estatus: Estatus;
  creado_en: string;
  creado_por: string | null;
  actualizado_en: string;
  actualizado_por: string | null;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

/** Tabla `usuarios`. */
export interface Usuario extends CamposControl {
  github_id: string;
  github_login: string;
  nombre: string | null;
  avatar_url: string | null;
  email: string | null;
  bio: string | null;
  location: string | null;
  zona_horaria: string | null;
  disponible: boolean;
  busca: "amigos" | "algo_mas" | null;
  conversacion_activa_id: string | null;
}

/** Tabla `proyectos`. */
export interface Proyecto extends CamposControl {
  usuario_id: string;
  nombre: string;
  descripcion: string | null;
  lenguaje_principal: string | null;
  lenguajes: string[];
  dominio: string | null;
  tiene_tests: boolean;
  zona_horaria: string | null;
  repo_url: string | null;
  stack: string[];
  readme: string | null;
}

/** Tabla `conversaciones`. */
export interface Conversacion extends CamposControl {
  usuario_a: string;
  usuario_b: string;
  puntaje: number;
  abierta: boolean;
  motivo_cierre: string | null;
  ultimo_mensaje: string | null;
  ultimo_mensaje_en: string | null;
}

/** Tabla `invitaciones`. */
export interface Invitacion extends CamposControl {
  de_usuario: string;
  para_usuario: string;
  proyecto_id: string | null;
  mensaje: string | null;
  readme: string | null;
  puntaje: number;
  estado: "pendiente" | "aceptada" | "rechazada";
}

/** Tabla `amigos`. */
export interface Amigo extends CamposControl {
  usuario_id: string;
  amigo_id: string;
  conversacion_id: string | null;
  confirmada: boolean;
}

/** Tabla `descartados`. */
export interface Descartado extends CamposControl {
  usuario_id: string;
  descartado_id: string;
  motivo: string | null;
}

// ---------------------------------------------------------------------------
// Tipos auxiliares
// ---------------------------------------------------------------------------

/** Un mensaje de chat dentro de una conversación. */
export interface Mensaje extends CamposControl {
  conversacion_id: string;
  remitente_id: string;
  contenido: string;
}

/** Resultado del cálculo de compatibilidad entre dos proyectos. */
export interface ResultadoCompatibilidad {
  puntaje: number;
  desglose: {
    lenguaje: number;
    dominio: number;
    tests: number;
    zonaHoraria: number;
  };
}

/** Comandos `/fh` disponibles en el chat. */
export type ComandoFh =
  | "login"
  | "search"
  | "friends"
  | "invite"
  | "help"
  | "status"
  | "add"
  | "leave"
  | "timer"
  | "readme"
  | "stack"
  | "connect"
  | "accept"
  | "reject";

/** Firma de un handler de comando del chat. */
export type ComandoHandler = (args: string[]) => Promise<string> | string;

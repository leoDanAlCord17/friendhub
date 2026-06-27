/**
 * Tipos compartidos de TermPals.
 *
 * Las interfaces de tablas reflejan exactamente el esquema de Supabase.
 * Todas incluyen los campos de control estándar (ver {@link CamposControl}).
 */

/** Campos de control presentes en todas las tablas. */
export interface CamposControl {
  id: string;
  estatus: boolean;
  creado_en: string;
  creado_por: string | null;
  actualizado_en: string;
  actualizado_por: string | null;
}

// ---------------------------------------------------------------------------
// Tablas
// ---------------------------------------------------------------------------

/** Tabla `terminos_versiones`. */
export interface TerminosVersion {
  id: string;
  version: string;
  descripcion: string;
  contenido: string;
  activa: boolean;
  publicada_en: string;
}

/** Tabla `consentimientos`. Registro inmutable de cada acción de consentimiento. */
export interface Consentimiento {
  id: string;
  usuario_id: string;
  version_id: string;
  accion: "aceptado" | "rechazado" | "retirado" | "actualizado_aceptado";
  acepta_perfil: boolean;
  acepta_stack: boolean;
  acepta_readme: boolean;
  acepta_matching: boolean;
  extension_version: string | null;
  creado_en: string;
  creado_por: string;
}

/** Tabla `usuarios`. */
export interface Usuario extends CamposControl {
  github_id: string;
  github_login: string;
  nombre_usuario: string | null;
  nombre: string | null;
  avatar_url: string | null;
  email: string | null;
  bio: string | null;
  zona_horaria: string | null;
  busca: "colaborar" | "networking" | "ambas" | null;
  locacion: string | null;
  conversacion_activa_id: string | null;
  searches_hoy: number;
  ultima_busqueda_en: string | null;
  consentimiento_activo: boolean;
  consentimiento_id: string | null;
  consentimiento_fecha: string | null;
}

/** Tabla `proyectos`. */
export interface Proyecto extends CamposControl {
  usuario_id: string;
  nombre: string;
  descripcion: string | null;
  lenguajes: string[];
  dominio: string | null;
  tiene_tests: boolean;
  repo_url: string | null;
  stack: string[];
  readme: string | null;
  comparte_readme: boolean;
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
  conversacion_id: string | null;
  mensaje: string | null;
  readme: string | null;
  puntaje: number;
  estado: "pendiente" | "aceptada" | "rechazada";
}

/** Tabla `amigos`. */
export interface Amigo extends CamposControl {
  usuario_id: string;
  amigo_id: string;
  estado: "pendiente" | "confirmado";
}

/** Tabla `descartados`. */
export interface Descartado extends CamposControl {
  usuario_id: string;
  descartado_id: string;
  motivo: string | null;
}

/** Tabla `feedback`. */
export interface Feedback extends CamposControl {
  usuario_id: string;
  tipo: 'bug' | 'sugerencia' | 'interes_pro';
  mensaje: string;
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

/** Comandos `/tp` disponibles en el chat. */
export type ComandoTp =
  | "login"
  | "search"
  | "friends"
  | "invite"
  | "help"
  | "status"
  | "add"
  | "leave"
  | "readme"
  | "stack"
  | "profile"
  | "clear"
  | "connect"
  | "accept"
  | "reject"
  | "read"
  | "bug"
  | "sugerencia"
  | "logout"
  | "delete";

/** Objeto de control que un comando puede devolver al panel. */
export interface RespuestaModo {
  modo: "edicion_bio";
}

/** Acción especial que el panel debe ejecutar (p. ej. limpiar la pantalla). */
export interface RespuestaAccion {
  accion: "clear";
}

/** Resultado de un comando: texto a imprimir o una señal de modo/acción. */
export type ResultadoComando = string | RespuestaModo | RespuestaAccion;

/** Firma de un handler de comando del chat. */
export type ComandoHandler = (
  args: string[],
) => Promise<ResultadoComando> | ResultadoComando;

/** Interfaz mínima del panel para evitar importación circular desde commands. */
export interface IPanel {
  iniciarSpinner(texto: string): void;
  actualizarSpinner(texto: string): void;
  detenerSpinner(): void;
  mostrarConsentimientoSiNecesario(): void;
}

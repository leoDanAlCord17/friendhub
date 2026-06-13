import * as vscode from "vscode";
import { ComandoFh, ComandoHandler, Proyecto, Usuario } from "../types";
import {
  getUsuarioActual,
  setUsuarioActual,
  setMatchActual,
  getMatchActual,
  getPuntajeActual,
  getInvitacionPendiente,
  setInvitacionPendiente,
} from "../state";
import { detectarWorkspace, obtenerProyectoActivo } from "../supabase/proyectos";
import {
  buscarMatch,
  actualizarConversacionActiva,
  obtenerUsuario,
  obtenerUsuarioPorGithubId,
} from "../supabase/usuarios";
import { obtenerAmigos, proponerAmistad } from "../supabase/amigos";
import {
  obtenerConversacionActiva,
  cerrarConversacion,
  crearConversacion,
} from "../supabase/conversaciones";
import {
  crearInvitacion,
  responderInvitacion,
} from "../supabase/invitaciones";
import { calcularCompatibilidad } from "../compatibility/score";
import {
  INTERVALO_MENSAJE_MS,
  escucharInvitaciones,
  iniciarChat,
} from "../websocket/chat";

/**
 * Registro de los comandos `/fh` del chat de FriendHub. Cada handler recibe
 * los argumentos (sin el `/fh <comando>`) y devuelve el texto a renderizar.
 */

const handlers: Record<ComandoFh, ComandoHandler> = {
  /** /fh login — inicia el flujo de GitHub OAuth. */
  login: async () => {
    if (getUsuarioActual()) {
      return `  ya tienes sesión como @${getUsuarioActual()?.github_login}.`;
    }
    await vscode.commands.executeCommand("fh.login");
    return "  abriendo el navegador para conectar tu GitHub...";
  },

  /** /fh search — busca un desarrollador compatible disponible. */
  search: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const yo = await refrescarUsuario(base);
    const activa = await obtenerConversacionActiva(yo.id);
    if (activa) {
      return "Ya tienes una conversación activa. Usa /fh leave para salir.";
    }

    const miStack = await detectarWorkspace();
    const match = await buscarMatch(yo.id, yo.busca ?? "amigos");
    if (!match) {
      return "No hay desarrolladores disponibles ahora mismo. Intenta más tarde.";
    }

    const proyectoMatch = await obtenerProyectoActivo(match.id);
    const { puntaje } = calcularCompatibilidad(
      miStack as Proyecto,
      (proyectoMatch ?? {}) as Proyecto,
    );

    setMatchActual({
      usuario: match,
      proyecto: proyectoMatch,
      compatibilidad: puntaje,
    });

    return formatoMatch(match, proyectoMatch, puntaje);
  },

  /** /fh friends — lista tus amigos confirmados con su stack. */
  friends: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const amigos = await obtenerAmigos(yo.id);
    if (amigos.length === 0) {
      return "  aún no tienes amigos. usa /fh search para conocer devs.";
    }

    const filas = await Promise.all(
      amigos.map(async (a) => {
        const [usuario, proyecto] = await Promise.all([
          obtenerUsuario(a.amigo_id),
          obtenerProyectoActivo(a.amigo_id),
        ]);
        const username = `@${usuario?.github_login ?? a.amigo_id}`;
        const stack = (proyecto?.stack ?? []).slice(0, 2).join(" · ") || "—";
        return { username, stack };
      }),
    );

    const ancho = Math.max(...filas.map((f) => f.username.length)) + 2;
    const cuerpo = filas
      .map((f) => `  ${f.username.padEnd(ancho)}${f.stack}`)
      .join("\n");

    return [
      "  ── tus amigos ────────────────────────",
      "",
      cuerpo,
      "",
      `  total: ${filas.length} amigo${filas.length === 1 ? "" : "s"}`,
      "  usa /fh invite @username para iniciar chat",
      "  ──────────────────────────────────────",
    ].join("\n");
  },

  /** /fh invite @username — invita a un amigo guardado a chatear. */
  invite: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const username = (args[0] ?? "").replace(/^@/, "");
    if (!username) {
      return "Uso: /fh invite @username";
    }

    const amigos = await obtenerAmigos(yo.id);
    const usuarios = await Promise.all(
      amigos.map((a) => obtenerUsuario(a.amigo_id)),
    );
    const amigo = usuarios.find((u) => u?.github_login === username) ?? null;
    if (!amigo) {
      return `  @${username} no está en tu lista de amigos.`;
    }

    const activa = await obtenerConversacionActiva(yo.id);
    if (activa) {
      return "  ya tienes una conversación activa. usa /fh leave para salir primero.";
    }

    const [miProyecto, proyectoAmigo] = await Promise.all([
      obtenerProyectoActivo(yo.id),
      obtenerProyectoActivo(amigo.id),
    ]);
    const puntaje =
      miProyecto && proyectoAmigo
        ? calcularCompatibilidad(miProyecto, proyectoAmigo).puntaje
        : 0;

    const invit = await crearInvitacion(
      yo.id,
      amigo.id,
      miProyecto?.readme ?? "",
      puntaje,
    );

    escucharInvitaciones(invit.id, yo.id, amigo.id, username, puntaje);

    return [
      `  invitación enviada a @${username}.`,
      "  esperando respuesta...",
    ].join("\n");
  },

  /** /fh help — muestra los comandos disponibles. */
  help: async () => textoAyuda(),

  /** /fh status — resumen de sesión, workspace y conexiones. */
  status: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const yo = await refrescarUsuario(base);
    const [info, amigos] = await Promise.all([
      detectarWorkspace(),
      obtenerAmigos(yo.id),
    ]);
    const stack = (info.stack ?? []).slice(0, 3).join(" · ") || "—";

    return [
      "  ── estado actual ─────────────────────",
      "",
      `  usuario:   @${yo.github_login}`,
      `  busca:     ${yo.busca ?? "—"}`,
      "  sesión:    activa",
      "",
      "  workspace detectado:",
      `    lenguaje:  ${info.lenguaje_principal ?? "no detectado"}`,
      `    dominio:   ${info.dominio ?? "no detectado"}`,
      `    tests:     ${info.tiene_tests ? "sí" : "no"}`,
      `    stack:     ${stack}`,
      "",
      `  conversación activa:  ${yo.conversacion_activa_id ? "sí" : "no"}`,
      `  amigos:               ${amigos.length}`,
      "  ──────────────────────────────────────",
    ].join("\n");
  },

  /** /fh add <usuario> — propone amistad en la conversación activa. */
  add: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const destino = args[0];
    if (!destino) {
      return "Uso: /fh add <usuario>";
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa para proponer amistad.";
    }
    await proponerAmistad(yo.id, destino, conv.id);
    return `Propuesta de amistad enviada a ${destino}.`;
  },

  /** /fh leave — cierra la conversación activa. */
  leave: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa.";
    }
    await cerrarConversacion(conv.id, "abandonada por el usuario");
    return "Has salido de la conversación.";
  },

  /** /fh timer — tiempo restante para poder enviar el siguiente mensaje. */
  timer: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa.";
    }
    if (!conv.ultimo_mensaje_en) {
      return "Puedes enviar un mensaje ahora.";
    }
    const transcurrido = Date.now() - new Date(conv.ultimo_mensaje_en).getTime();
    const restante = INTERVALO_MENSAJE_MS - transcurrido;
    if (restante <= 0) {
      return "Puedes enviar un mensaje ahora.";
    }
    const min = Math.floor(restante / 60000);
    const seg = Math.floor((restante % 60000) / 1000);
    return `Próximo mensaje disponible en ${min}m ${seg}s.`;
  },

  /** /fh readme — muestra el README completo del proyecto del match. */
  readme: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa.";
    }
    const otroId = conv.usuario_a === yo.id ? conv.usuario_b : conv.usuario_a;
    const proyecto = await obtenerProyectoActivo(otroId);
    if (!proyecto?.readme) {
      return "El match no tiene README disponible.";
    }
    return proyecto.readme;
  },

  /** /fh stack — barra de compatibilidad con el match de la conversación. */
  stack: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa.";
    }
    const otroId = conv.usuario_a === yo.id ? conv.usuario_b : conv.usuario_a;
    const [mio, suyo] = await Promise.all([
      obtenerProyectoActivo(yo.id),
      obtenerProyectoActivo(otroId),
    ]);
    if (!mio || !suyo) {
      return "Falta información de proyecto para comparar el stack.";
    }
    return tablaCompatibilidad(mio, suyo);
  },

  /** /fh connect — envía la invitación al match actual. */
  connect: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const match = getMatchActual();
    if (!match) {
      return "  no hay match activo. usa /fh search primero.";
    }
    const yo = await refrescarUsuario(base);
    if (yo.conversacion_activa_id) {
      return "  ya tienes una conversación activa. usa /fh leave para salir primero.";
    }

    const miProyecto = await obtenerProyectoActivo(yo.id);
    const invit = await crearInvitacion(
      yo.id,
      match.usuario.id,
      miProyecto?.readme ?? "",
      getPuntajeActual(),
    );

    escucharInvitaciones(
      invit.id,
      yo.id,
      match.usuario.id,
      match.usuario.github_login,
      getPuntajeActual(),
    );

    return [
      `  invitación enviada a @${match.usuario.github_login}.`,
      "  esperando respuesta...",
    ].join("\n");
  },

  /** /fh accept — acepta la invitación pendiente. */
  accept: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const pend = getInvitacionPendiente();
    if (!pend) {
      return "  no tienes invitaciones pendientes.";
    }
    await responderInvitacion(pend.invitacion.id, "aceptada");
    const conv = await crearConversacion(
      pend.invitacion.de_usuario,
      yo.id,
      pend.invitacion.puntaje,
    );
    await actualizarConversacionActiva(pend.invitacion.de_usuario, conv.id);
    await actualizarConversacionActiva(yo.id, conv.id);
    iniciarChat(conv.id, yo.id, pend.username);
    setInvitacionPendiente(null);
    return [
      `  ✓ aceptaste la invitación de @${pend.username}.`,
      "  conversación iniciada. recuerda: 1 mensaje cada 5 minutos.",
      "  escribe /fh stack para ver la compatibilidad.",
    ].join("\n");
  },

  /** /fh reject — rechaza la invitación pendiente. */
  reject: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const pend = getInvitacionPendiente();
    if (!pend) {
      return "  no tienes invitaciones pendientes.";
    }
    await responderInvitacion(pend.invitacion.id, "rechazada");
    setInvitacionPendiente(null);
    return "  invitación rechazada.";
  },
};

/** Lista de comandos válidos. */
export const COMANDOS: ComandoFh[] = Object.keys(handlers) as ComandoFh[];

/**
 * Parsea y ejecuta una línea de chat (p. ej. `"/fh invite alice"`).
 * Devuelve `null` si la línea no empieza con `/fh`.
 */
export async function ejecutarComando(linea: string): Promise<string | null> {
  const partes = linea.trim().split(/\s+/);
  if (partes[0] !== "/fh") {
    return null;
  }
  const nombre = partes[1] as ComandoFh | undefined;
  if (!nombre || !(nombre in handlers)) {
    return "Comando desconocido. Escribe /fh help.";
  }
  try {
    return await handlers[nombre](partes.slice(2));
  } catch (err) {
    return `Error: ${(err as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// Helpers de presentación
// ---------------------------------------------------------------------------

function requiereUsuario(): Usuario | string {
  const yo = getUsuarioActual();
  if (!yo) {
    return "Inicia sesión con GitHub para usar este comando.";
  }
  return yo;
}

/** Recarga el usuario desde Supabase y sincroniza el state si cambió. */
async function refrescarUsuario(yo: Usuario): Promise<Usuario> {
  const fresco = await obtenerUsuarioPorGithubId(yo.github_id);
  if (fresco && fresco !== yo) {
    setUsuarioActual(fresco);
    return fresco;
  }
  return fresco ?? yo;
}

function textoAyuda(): string {
  return [
    "Comandos de FriendHub:",
    "  /fh search           Busca desarrolladores compatibles",
    "  /fh connect          Envía invitación al match actual",
    "  /fh accept           Acepta la invitación pendiente",
    "  /fh reject           Rechaza la invitación pendiente",
    "  /fh friends          Lista tus amigos",
    "  /fh invite <usuario> Invita a colaborar",
    "  /fh add <usuario>    Propone amistad en la conversación actual",
    "  /fh status           Muestra el stack detectado de tu workspace",
    "  /fh stack            Compara tu stack con el de tu match",
    "  /fh leave            Cierra la conversación actual",
    "  /fh timer            Tiempo restante para el próximo mensaje",
    "  /fh readme           Muestra el README del proyecto",
    "  /fh help             Muestra esta ayuda",
  ].join("\n");
}

/** Barra de 10 segmentos a partir de un puntaje 0-100. */
function barraCompat(puntaje: number): string {
  const llenas = Math.max(0, Math.min(10, Math.round(puntaje / 10)));
  return "█".repeat(llenas) + "░".repeat(10 - llenas);
}

/** Línea "lenguaje · stack · dominio" de un proyecto. */
function lineaStack(proyecto: Proyecto | null): string {
  if (!proyecto) {
    return "—";
  }
  return [proyecto.lenguaje_principal, proyecto.stack[0], proyecto.dominio]
    .filter(Boolean)
    .join(" · ") || "—";
}

function tablaCompatibilidad(mio: Proyecto, suyo: Proyecto): string {
  const { puntaje } = calcularCompatibilidad(mio, suyo);
  const filas: Array<[string, string]> = [
    [mio.lenguaje_principal ?? "—", suyo.lenguaje_principal ?? "—"],
    [mio.stack[0] ?? "—", suyo.stack[0] ?? "—"],
    [mio.dominio ?? "—", suyo.dominio ?? "—"],
  ];
  const ancho = 15;
  const cabecera = `${"tú".padEnd(ancho)}match`;
  const separador = "─".repeat(ancho + 6);
  const cuerpo = filas
    .map(([a, b]) => `${a.padEnd(ancho)}${b}`)
    .join("\n");
  return [
    cabecera,
    separador,
    cuerpo,
    "",
    `compatibilidad: ${barraCompat(puntaje)} ${puntaje}%`,
  ].join("\n");
}

/** Tarjeta de resultado de /fh search. */
function formatoMatch(
  match: Usuario,
  proyecto: Proyecto | null,
  puntaje: number,
): string {
  const lugar = match.location ? ` · ${match.location}` : "";
  const readme = (proyecto?.readme ?? "Sin README disponible.").slice(0, 300);
  const tests = proyecto?.tiene_tests ? "sí" : "no";
  return [
    "── match encontrado ──────────────────",
    "",
    `@${match.github_login}${lugar}`,
    "",
    "README:",
    readme,
    "",
    `stack:     ${lineaStack(proyecto)}`,
    `tests:     ${tests}`,
    "",
    `compatibilidad: ${barraCompat(puntaje)} ${puntaje}%`,
    "",
    "/fh connect   → enviar invitación",
    "/fh search    → buscar otro",
    "──────────────────────────────────────",
  ].join("\n");
}

export { handlers };

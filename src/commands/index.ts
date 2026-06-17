import * as vscode from "vscode";
import {
  ComandoMh,
  ComandoHandler,
  ResultadoComando,
  Proyecto,
  Usuario,
} from "../types";
import {
  getUsuarioActual,
  setUsuarioActual,
  setMatchActual,
  getMatchActual,
  getPuntajeActual,
  getInvitacionPendiente,
  setInvitacionPendiente,
  getProyectoActual,
  getAmigosCache,
  setAmigosCache,
} from "../state";
import { detectarWorkspace, obtenerProyectoActivo } from "../supabase/proyectos";
import {
  buscarMatch,
  actualizarConversacionActiva,
  actualizarBio,
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
import { escucharInvitaciones, iniciarChat, enviarMensaje } from "../websocket/chat";

/**
 * Registro de los comandos `/mh` del chat de MeetHub. Cada handler recibe
 * los argumentos (sin el `/mh <comando>`) y devuelve el texto a renderizar.
 */

const handlers: Record<ComandoMh, ComandoHandler> = {
  /** /mh login — inicia el flujo de GitHub OAuth. */
  login: async () => {
    if (getUsuarioActual()) {
      return `  ya tienes sesión como @${getUsuarioActual()?.github_login}.`;
    }
    await vscode.commands.executeCommand("mh.login");
    return "  abriendo el navegador para conectar tu GitHub...";
  },

  /** /mh search — busca un desarrollador compatible disponible. */
  search: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const yo = await refrescarUsuario(base);
    const activa = await obtenerConversacionActiva(yo.id);
    if (activa) {
      return "Ya tienes una conversación activa. Usa /mh leave para salir.";
    }

    const miStack = await detectarWorkspace();
    const match = await buscarMatch(yo.id, yo.busca ?? "colaborar");
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

    const postal =
      renderPostal(
        match.github_login,
        match.location,
        match.bio,
        proyectoMatch,
      ) + "\n\n";

    return postal + formatoMatch(match, proyectoMatch, puntaje);
  },

  /** /mh friends — lista tus amigos confirmados con su stack. */
  friends: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }

    // Usa el caché de amigos; solo refetch si está vacío.
    let amigos = getAmigosCache();
    if (amigos.length === 0) {
      const relaciones = await obtenerAmigos(yo.id);
      const usuarios = await Promise.all(
        relaciones.map((a) => obtenerUsuario(a.amigo_id)),
      );
      amigos = usuarios.filter((u): u is Usuario => u !== null);
      setAmigosCache(amigos);
    }
    if (amigos.length === 0) {
      return "  aún no tienes amigos. usa /mh search para conocer devs.";
    }

    const filas = await Promise.all(
      amigos.map(async (usuario) => {
        const proyecto = await obtenerProyectoActivo(usuario.id);
        const username = `@${usuario.github_login}`;
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
      "  usa /mh invite @username para iniciar chat",
      "  ──────────────────────────────────────",
    ].join("\n");
  },

  /** /mh invite @username — invita a un amigo guardado a chatear. */
  invite: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const username = (args[0] ?? "").replace(/^@/, "");
    if (!username) {
      return "Uso: /mh invite @username";
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
      return "  ya tienes una conversación activa. usa /mh leave para salir primero.";
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

  /** /mh help — muestra los comandos disponibles. */
  help: async () => textoAyuda(),

  /** /mh status — resumen de sesión, workspace y conexiones. */
  status: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const yo = await refrescarUsuario(base);
    // Workspace en vivo; el stack guardado viene del proyecto cacheado.
    const info = await detectarWorkspace();
    const proyecto = getProyectoActual();
    const stackFuente = proyecto?.stack ?? info.stack ?? [];
    const stack = stackFuente.slice(0, 3).join(" · ") || "—";

    return [
      "  ── estado actual ─────────────────────",
      "",
      `  usuario:   @${yo.github_login}`,
      `  busca:     ${yo.busca ?? "—"}`,
      "  sesión:    activa",
      "",
      "  workspace detectado:",
      `    lenguaje:  ${info.lenguajes?.[0] ?? "no detectado"}`,
      `    dominio:   ${info.dominio ?? "no detectado"}`,
      `    tests:     ${info.tiene_tests ? "sí" : "no"}`,
      `    stack:     ${stack}`,
      "",
      `  conversación activa:  ${yo.conversacion_activa_id ? "sí" : "no"}`,
      `  amigos:               ${getAmigosCache().length}`,
      "  ──────────────────────────────────────",
    ].join("\n");
  },

  /** /mh add <usuario> — propone amistad en la conversación activa. */
  add: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const destino = args[0];
    if (!destino) {
      return "Uso: /mh add <usuario>";
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return "No tienes una conversación activa para proponer amistad.";
    }
    await proponerAmistad(yo.id, destino, conv.id);
    setAmigosCache([]); // invalida el caché → refetch en el próximo /mh friends
    return `Propuesta de amistad enviada a ${destino}.`;
  },

  /** /mh leave — cierra la conversación activa. */
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

  /** /mh readme — muestra el README completo del proyecto del match. */
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

  /** /mh stack — barra de compatibilidad con el match de la conversación. */
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

  /** /mh profile [edit] — muestra tu postal o activa la edición de la bio. */
  profile: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    if (args[0] === "edit") {
      return { modo: "edicion_bio" };
    }

    const proyecto = getProyectoActual();
    const postal = renderPostal(yo.github_login, yo.location, yo.bio, proyecto);
    return `${postal}\n\n  /mh profile edit → escribir tu bio`;
  },

  /** /mh clear — limpia la pantalla del panel. */
  clear: async () => {
    return { accion: "clear" };
  },

  /** /mh connect — envía la invitación al match actual. */
  connect: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const match = getMatchActual();
    if (!match) {
      return "  no hay match activo. usa /mh search primero.";
    }
    const yo = await refrescarUsuario(base);
    if (yo.conversacion_activa_id) {
      return "  ya tienes una conversación activa. usa /mh leave para salir primero.";
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

  /** /mh accept — acepta la invitación pendiente. */
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
      "  conversación iniciada.",
      "  escribe /mh stack para ver la compatibilidad.",
    ].join("\n");
  },

  /** /mh reject — rechaza la invitación pendiente. */
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
export const COMANDOS: ComandoMh[] = Object.keys(handlers) as ComandoMh[];

/** Prefijo con el que el panel envía el texto de la bio en modo edición. */
const PREFIJO_BIO = "__BIO__:";

/**
 * Parsea y ejecuta una línea de chat (p. ej. `"/mh invite alice"`).
 * Devuelve `null` si la línea no es un comando ni una entrada de bio.
 */
export async function ejecutarComando(
  linea: string,
): Promise<ResultadoComando | null> {
  // Texto de bio enviado desde el panel en modo edición.
  if (linea.startsWith(PREFIJO_BIO)) {
    const bio = linea.slice(PREFIJO_BIO.length).trim();
    const yo = getUsuarioActual();
    if (!yo) {
      return "Inicia sesión con GitHub para editar tu bio.";
    }
    if (bio.length > 280) {
      return `la bio excede 280 caracteres (tienes ${bio.length}).`;
    }
    try {
      await actualizarBio(yo.id, bio);
    } catch (err) {
      return `Error: ${(err as Error).message}`;
    }
    yo.bio = bio;
    setUsuarioActual(yo);
    const postal = renderPostal(
      yo.github_login,
      yo.location,
      bio,
      getProyectoActual(),
    );
    return `✓ bio guardada.\n\n${postal}`;
  }

  const partes = linea.trim().split(/\s+/);
  if (partes[0] !== "/mh") {
    const yo = getUsuarioActual();
    if (yo?.conversacion_activa_id) {
      try {
        await enviarMensaje(yo.conversacion_activa_id, linea, yo.id);
      } catch (err) {
        return `Error al enviar mensaje: ${(err as Error).message}`;
      }
      return null;
    }
    return "comando no reconocido. escribe /mh help para ver los comandos.";
  }
  const nombre = partes[1] as ComandoMh | undefined;
  if (!nombre || !(nombre in handlers)) {
    return "Comando desconocido. Escribe /mh help.";
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
    "Comandos de MeetHub:",
    "  /mh search           Busca desarrolladores compatibles",
    "  /mh connect          Envía invitación al match actual",
    "  /mh accept           Acepta la invitación pendiente",
    "  /mh reject           Rechaza la invitación pendiente",
    "  /mh friends          Lista tus amigos",
    "  /mh invite <usuario> Invita a colaborar",
    "  /mh add <usuario>    Propone amistad en la conversación actual",
    "  /mh status           Muestra el stack detectado de tu workspace",
    "  /mh stack            Compara tu stack con el de tu match",
    "  /mh leave            Cierra la conversación actual",
    "  /mh readme           Muestra el README del proyecto",
    "  /mh profile          Muestra tu postal de presentación",
    "  /mh clear            Limpia la pantalla",
    "  /mh help             Muestra esta ayuda",
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
  return [proyecto.lenguajes[0], proyecto.stack[0], proyecto.dominio]
    .filter(Boolean)
    .join(" · ") || "—";
}

// ---------------------------------------------------------------------------
// Postal de perfil (ASCII)
// ---------------------------------------------------------------------------

/** Ancho total de la postal (incluyendo bordes │ │). */
const POSTAL_ANCHO = 41;

/** Ancho de envoltura de la bio (deja sitio a comillas, sangría y bordes). */
const BIO_WRAP = 33;

/**
 * Envuelve un texto en líneas de como máximo `maxChars` caracteres, sin partir
 * nunca una palabra. Devuelve TODAS las líneas necesarias (sin límite ni
 * truncado).
 */
function envolverTexto(texto: string, maxChars: number): string[] {
  const palabras = texto.split(" ");
  const lineas: string[] = [];
  let actual = "";

  for (const palabra of palabras) {
    const tentativa = actual ? `${actual} ${palabra}` : palabra;
    if (tentativa.length <= maxChars || !actual) {
      actual = tentativa;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) {
    lineas.push(actual);
  }
  return lineas;
}

/**
 * Renderiza la postal ASCII de un usuario: @usuario, ubicación, bio completa
 * (envuelta por palabras, sin recorte) y el stack. Ancho fijo.
 */
function renderPostal(
  username: string,
  location: string | null,
  bio: string | null,
  proyecto: Proyecto | null,
): string {
  const inner = POSTAL_ANCHO - 2;
  const linea = (c: string): string =>
    `│${`  ${c}`.padEnd(inner).slice(0, inner)}│`;

  const cuerpo: string[] = [];
  cuerpo.push(linea(`@${username}`));
  cuerpo.push(linea(location ?? ""));
  cuerpo.push(linea(""));

  if (bio) {
    const lineas = envolverTexto(bio, BIO_WRAP);
    if (lineas.length === 1) {
      cuerpo.push(linea(`"${lineas[0]}"`));
    } else {
      lineas.forEach((l, i) => {
        if (i === 0) {
          cuerpo.push(linea(`"${l}`));
        } else if (i === lineas.length - 1) {
          cuerpo.push(linea(` ${l}"`));
        } else {
          cuerpo.push(linea(` ${l}`));
        }
      });
    }
    cuerpo.push(linea(""));
  }

  cuerpo.push(linea(`stack: ${lineaStack(proyecto)}`));

  const borde = "─".repeat(inner);
  return [`┌${borde}┐`, ...cuerpo, `└${borde}┘`].join("\n");
}

function tablaCompatibilidad(mio: Proyecto, suyo: Proyecto): string {
  const { puntaje } = calcularCompatibilidad(mio, suyo);
  const filas: Array<[string, string]> = [
    [mio.lenguajes[0] ?? "—", suyo.lenguajes[0] ?? "—"],
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

/** Tarjeta de resultado de /mh search. */
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
    "/mh connect   → enviar invitación",
    "/mh search    → buscar otro",
    "──────────────────────────────────────",
  ].join("\n");
}

export { handlers };

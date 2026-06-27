import * as vscode from "vscode";
import {
  ComandoTp,
  ComandoHandler,
  ResultadoComando,
  Proyecto,
  Usuario,
  IPanel,
} from "../types";
import { t } from "../i18n";
import {
  getUsuarioActual,
  setUsuarioActual,
  setMatchActual,
  getMatchActual,
  getPuntajeActual,
  getInvitacionPendiente,
  setInvitacionPendiente,
  getProyectoActual,
  setProyectoActual,
  getAmigosCache,
  setAmigosCache,
  getOnboardingPaso,
  setOnboardingPaso,
  getOnboardingDatos,
  setOnboardingDatos,
  getEsperandoRespuestaPro,
  setEsperandoRespuestaPro,
  getEsperandoConfirmacionDelete,
  setEsperandoConfirmacionDelete,
} from "../state";
import { detectarWorkspace, obtenerProyectoActivo, crearOActualizarProyecto } from "../supabase/proyectos";
import {
  buscarMatch,
  actualizarConversacionActiva,
  actualizarBio,
  actualizarBusca,
  obtenerUsuario,
  obtenerUsuarioPorGithubId,
  verificarYConsumirBusqueda,
} from "../supabase/usuarios";
import { obtenerAmigos, proponerAmistad, confirmarAmistad, existeSolicitudPendiente } from "../supabase/amigos";
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
import { escucharInvitaciones, iniciarChat, enviarMensaje, enviarMensajeSistema } from "../websocket/chat";
import { crearFeedback } from "../supabase/feedback";
import { eliminarToken } from "../auth/github";
import { eliminarCuenta } from "../supabase/usuarios";

/**
 * Contexto de extensión inyectado al activar (necesario para logout/delete).
 * Se inicializa en extension.ts mediante configurarContextComandos().
 */
let _ctx: vscode.ExtensionContext | undefined;

export function configurarContextComandos(ctx: vscode.ExtensionContext): void {
  _ctx = ctx;
}

let _panel: IPanel | null = null;
export function setProveedorPanel(p: IPanel): void {
  _panel = p;
}

function traducirDominio(d: string | null | undefined): string {
  if (!d) { return "—"; }
  const mapa: Record<string, string> = {
    web:     t('status.domain_web'),
    mobile:  t('status.domain_mobile'),
    backend: t('status.domain_backend'),
    data:    t('status.domain_data'),
    otro:    t('status.domain_other'),
  };
  return mapa[d] ?? d;
}

function conSpinner<T>(texto: string, operacion: Promise<T>, delayMs = 0): Promise<T> {
  let spinnerActivo = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  if (delayMs > 0) {
    timer = setTimeout(() => {
      spinnerActivo = true;
      _panel?.iniciarSpinner(texto);
    }, delayMs);
  } else {
    spinnerActivo = true;
    _panel?.iniciarSpinner(texto);
  }

  return operacion.finally(() => {
    if (timer) { clearTimeout(timer); }
    if (spinnerActivo) { _panel?.detenerSpinner(); }
  });
}

const handlers: Record<ComandoTp, ComandoHandler> = {
  /** /tp login — muestra los términos primero, luego inicia el OAuth. */
  login: async () => {
    const yo = getUsuarioActual();
    if (yo) {
      return t('session.already_active', yo.github_login);
    }
    _panel?.mostrarConsentimientoSiNecesario();
    return "";
  },

  /** /tp search — busca un desarrollador compatible disponible. */
  search: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }

    const limite = await conSpinner(
      t('search.verifying'),
      verificarYConsumirBusqueda(base.id),
    );
    if (!limite.permitido) {
      setEsperandoRespuestaPro(true);
      return [
        t('search.limit_reached'),
        "",
        t('pro.title'),
        t('pro.feature1'),
        t('pro.feature2'),
        t('pro.feature3'),
        "",
        t('pro.question'),
        "",
        t('pro.opt1'),
        t('pro.opt2'),
        t('pro.opt3'),
        "",
        t('pro.prompt'),
      ].join("\n");
    }

    const yo = await refrescarUsuario(base);
    const activa = await obtenerConversacionActiva(yo.id);
    if (activa) {
      return t('search.active_conv');
    }

    const miStack = await detectarWorkspace();
    const resultado = await conSpinner(
      t('search.searching'),
      buscarMatch(yo.id, yo.busca ?? 'colaborar'),
    );
    if (!resultado) {
      return t('search.no_match');
    }

    const { usuario: match, nivelMatch } = resultado;
    const proyectoMatch = await obtenerProyectoActivo(match.id);
    const { puntaje } = calcularCompatibilidad(
      miStack as Proyecto,
      (proyectoMatch ?? {}) as Proyecto,
      yo.zona_horaria,
      match.zona_horaria,
    );

    setMatchActual({
      usuario: match,
      proyecto: proyectoMatch,
      compatibilidad: puntaje,
      nivelMatch,
    });

    const postal =
      renderPostal(
        match.github_login,
        match.locacion,
        match.bio,
        proyectoMatch,
      ) + "\n\n";

    return (
      postal +
      formatoMatch(match, proyectoMatch, puntaje, nivelMatch) +
      `\n\n${t('search.remaining', limite.restantes)}`
    );
  },

  /** /tp friends — lista tus amigos confirmados con su stack. */
  friends: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }

    let amigos = getAmigosCache();
    if (amigos.length === 0) {
      const relaciones = await conSpinner(
        t('friends.loading'),
        obtenerAmigos(yo.id),
        2000,
      );
      const usuarios = await Promise.all(
        relaciones.map((a) => obtenerUsuario(a.amigo_id)),
      );
      amigos = usuarios.filter((u): u is Usuario => u !== null);
      setAmigosCache(amigos);
    }
    if (amigos.length === 0) {
      return t('friends.empty');
    }

    const cuerpo = amigos
      .map((u) => `  @${u.github_login}`)
      .join("\n");

    return [
      t('friends.title'),
      "",
      cuerpo,
      "",
      t('friends.total', amigos.length),
      t('friends.invite_hint'),
      t('friends.separator'),
    ].join("\n");
  },

  /** /tp invite @username — invita a un amigo guardado a chatear. */
  invite: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const username = (args[0] ?? "").replace(/^@/, "");
    if (!username) {
      return t('invite.usage');
    }

    const amigos = await obtenerAmigos(yo.id);
    const usuarios = await Promise.all(
      amigos.map((a) => obtenerUsuario(a.amigo_id)),
    );
    const amigo = usuarios.find((u) => u?.github_login === username) ?? null;
    if (!amigo) {
      return t('invite.not_friend', username);
    }

    const activa = await obtenerConversacionActiva(yo.id);
    if (activa) {
      return t('connect.active_conv');
    }

    const [miProyecto, proyectoAmigo] = await Promise.all([
      obtenerProyectoActivo(yo.id),
      obtenerProyectoActivo(amigo.id),
    ]);
    const puntaje =
      miProyecto && proyectoAmigo
        ? calcularCompatibilidad(miProyecto, proyectoAmigo, yo.zona_horaria, amigo.zona_horaria).puntaje
        : 0;

    const invit = await crearInvitacion(
      yo.id,
      amigo.id,
      miProyecto?.readme ?? "",
      puntaje,
    );

    escucharInvitaciones(invit.id, yo.id, amigo.id, username, puntaje);

    return [
      t('invite.sent', username),
      t('connect.waiting'),
    ].join("\n");
  },

  /** /tp help — muestra los comandos disponibles. */
  help: async () => textoAyuda(),

  /** /tp status — resumen de sesión, workspace y conexiones. */
  status: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const yo = await refrescarUsuario(base);
    const info = await conSpinner(
      t('status.loading'),
      detectarWorkspace(),
      2000,
    );
    const proyecto = getProyectoActual();
    const stackFuente = proyecto?.stack ?? info.stack ?? [];
    const stack = stackFuente.slice(0, 3).join(" · ") || "—";

    const readmeEstado = !proyecto
      ? t('status.readme_unset')
      : proyecto.comparte_readme === false
        ? t('status.readme_private')
        : t('status.readme_public');

    const hoy = new Date().toISOString().slice(0, 10);
    const ultimaFecha = yo.ultima_busqueda_en
      ? new Date(yo.ultima_busqueda_en).toISOString().slice(0, 10)
      : null;
    const searchesActuales =
      ultimaFecha === hoy ? (yo.searches_hoy ?? 0) : 0;
    const busquedasRestantes = Math.max(0, 4 - searchesActuales);

    const lineas = [
      t('status.title'),
      "",
      t('status.user', yo.github_login),
      t('status.looking_for', yo.busca ?? "—"),
      t('status.session'),
      "",
      t('status.workspace'),
      t('status.language', info.lenguajes?.[0] ?? "—"),
      t('status.domain', traducirDominio(info.dominio)),
      t('status.tests', info.tiene_tests ? t('bool.yes') : t('bool.no')),
      t('status.stack', stack),
      readmeEstado,
      "",
      yo.conversacion_activa_id ? t('status.active_conv_yes') : t('status.active_conv_no'),
      t('status.friends', getAmigosCache().length),
      t('status.searches', busquedasRestantes),
      t('status.separator'),
    ];
    if (proyecto) {
      lineas.push(t('status.readme_toggle'));
    }
    return lineas.join("\n");
  },

  /** /tp add <usuario> — propone amistad en la conversación activa. */
  add: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return t('add.no_conv');
    }
    const otroId = conv.usuario_a === yo.id ? conv.usuario_b : conv.usuario_a;
    const otro = await obtenerUsuario(otroId);
    const otroUsername = otro?.github_login ?? otroId;

    const yaPropuso = await existeSolicitudPendiente(otroId, yo.id);
    if (yaPropuso) {
      await confirmarAmistad(yo.id, otroId);
      setAmigosCache([]);
      await enviarMensajeSistema(conv.id, {
        tipo: "amistad_confirmada",
        de_usuario_id: yo.id,
        de_username: yo.github_login,
      });
      return [
        t('add.confirmed', otroUsername),
        t('add.confirmed_stay'),
      ].join("\n");
    }

    await proponerAmistad(yo.id, otroId);
    await enviarMensajeSistema(conv.id, {
      tipo: "amistad_propuesta",
      de_usuario_id: yo.id,
      de_username: yo.github_login,
    });
    return t('add.proposed_waiting', otroUsername);
  },

  /** /tp leave — cierra la conversación activa. */
  leave: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return t('leave.no_conv');
    }
    await enviarMensajeSistema(conv.id, {
      tipo: "conversacion_cerrada",
      de_usuario_id: yo.id,
      de_username: yo.github_login,
    });
    const motivo = conv.usuario_a === yo.id ? "usuario_a_salio" : "usuario_b_salio";
    await cerrarConversacion(conv.id, motivo);
    await actualizarConversacionActiva(yo.id, null);
    yo.conversacion_activa_id = null;
    setUsuarioActual(yo);
    return t('leave.success');
  },

  /** /tp readme [toggle] — muestra el README del match en conversación, o togglea el tuyo. */
  readme: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }

    if (args[0] === "toggle") {
      const proyecto = getProyectoActual();
      if (!proyecto) {
        return t('readme.no_project');
      }
      const nuevoValor = proyecto.comparte_readme === false ? true : false;
      const actualizado = await crearOActualizarProyecto({
        ...proyecto,
        comparte_readme: nuevoValor,
        actualizado_por: yo.id,
      });
      setProyectoActual(actualizado);
      return nuevoValor ? t('readme.public') : t('readme.private');
    }

    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return t('readme.no_match_conv');
    }
    const otroId = conv.usuario_a === yo.id ? conv.usuario_b : conv.usuario_a;
    const proyecto = await obtenerProyectoActivo(otroId);
    if (!proyecto?.readme) {
      return t('readme.no_readme_conv');
    }
    return proyecto.readme;
  },

  /** /tp read — muestra el README completo del match actual (antes de aceptar). */
  read: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const match = getMatchActual();
    if (!match) {
      return t('connect.no_match');
    }
    const proyecto = await obtenerProyectoActivo(match.usuario.id);
    if (proyecto?.comparte_readme === false) {
      return t('readme.not_shared');
    }
    if (!proyecto?.readme) {
      return t('readme.no_match');
    }
    return [
      t('readme.header', match.usuario.github_login),
      "",
      proyecto.readme,
      "",
      t('search.separator'),
      t('search.connect_hint'),
      t('search.next_hint'),
    ].join("\n");
  },

  /** /tp stack — barra de compatibilidad con el match de la conversación. */
  stack: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const conv = await obtenerConversacionActiva(yo.id);
    if (!conv) {
      return t('leave.no_conv');
    }
    const otroId = conv.usuario_a === yo.id ? conv.usuario_b : conv.usuario_a;
    const [mio, suyo] = await conSpinner(
      t('stack.calculating'),
      Promise.all([
        obtenerProyectoActivo(yo.id),
        obtenerProyectoActivo(otroId),
      ]),
      0,
    );
    if (!mio) {
      return t('stack.no_workspace');
    }
    if (!suyo) {
      return t('stack.no_project_theirs');
    }
    return tablaCompatibilidad(mio, suyo);
  },

  /** /tp profile [edit] — muestra tu postal o activa la edición de la bio. */
  profile: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    if (args[0] === "edit") {
      return { modo: "edicion_bio" };
    }

    const proyecto = getProyectoActual();
    const postal = renderPostal(yo.github_login, yo.locacion, yo.bio, proyecto);
    return `${postal}\n\n${t('profile.edit_hint')}`;
  },

  /** /tp clear — limpia la pantalla del panel. */
  clear: async () => {
    return { accion: "clear" };
  },

  /** /tp connect — envía la invitación al match actual. */
  connect: async () => {
    const base = requiereUsuario();
    if (typeof base === "string") {
      return base;
    }
    const match = getMatchActual();
    if (!match) {
      return t('connect.no_match');
    }
    const yo = await refrescarUsuario(base);
    if (yo.conversacion_activa_id) {
      return t('connect.active_conv');
    }

    const miProyecto = await obtenerProyectoActivo(yo.id);
    const invit = await conSpinner(
      t('connect.sending'),
      crearInvitacion(yo.id, match.usuario.id, miProyecto?.readme ?? '', getPuntajeActual()),
    );

    escucharInvitaciones(
      invit.id,
      yo.id,
      match.usuario.id,
      match.usuario.github_login,
      getPuntajeActual(),
    );

    return [
      t('connect.sent', match.usuario.github_login),
      t('connect.waiting'),
    ].join("\n");
  },

  /** /tp accept — acepta la invitación pendiente. */
  accept: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const pend = getInvitacionPendiente();
    if (!pend) {
      return t('accept.no_pending');
    }
    const conv = await crearConversacion(
      pend.invitacion.de_usuario,
      yo.id,
      pend.invitacion.puntaje,
    );
    await actualizarConversacionActiva(pend.invitacion.de_usuario, conv.id);
    await actualizarConversacionActiva(yo.id, conv.id);
    await conSpinner(
      t('accept.loading'),
      responderInvitacion(pend.invitacion.id, "aceptada", conv.id),
    );
    yo.conversacion_activa_id = conv.id;
    setUsuarioActual(yo);
    iniciarChat(conv.id, yo.id, pend.username);
    setInvitacionPendiente(null);
    return [
      t('accept.success', pend.username),
      t('connect.started'),
      t('connect.stack_hint'),
    ].join("\n");
  },

  /** /tp reject — rechaza la invitación pendiente. */
  reject: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const pend = getInvitacionPendiente();
    if (!pend) {
      return t('accept.no_pending');
    }
    await responderInvitacion(pend.invitacion.id, "rechazada");
    setInvitacionPendiente(null);
    return t('reject.success');
  },

  /** /tp bug <mensaje> — reporta un problema. */
  bug: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const mensaje = args.join(" ").trim();
    if (!mensaje) {
      return t('feedback.bug_usage');
    }
    await crearFeedback(yo.id, "bug", mensaje, yo.id);
    return t('feedback.bug_success');
  },

  /** /tp sugerencia <mensaje> — propone una mejora. */
  sugerencia: async (args) => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    const mensaje = args.join(" ").trim();
    if (!mensaje) {
      return t('feedback.suggestion_usage');
    }
    await crearFeedback(yo.id, "sugerencia", mensaje, yo.id);
    return t('feedback.suggestion_success');
  },

  /** /tp logout — cierra la sesión, elimina el token y limpia el flag de consentimiento. */
  logout: async () => {
    const yo = getUsuarioActual();
    if (!yo) {
      return t('logout.no_session');
    }
    if (_ctx) {
      await eliminarToken(_ctx);
      await _ctx.globalState.update("termpals.consent.shown", false);
    }
    setUsuarioActual(null);
    return t('logout.success');
  },

  /** /tp delete — inicia el flujo de eliminación de cuenta con confirmación. */
  delete: async () => {
    const yo = requiereUsuario();
    if (typeof yo === "string") {
      return yo;
    }
    setEsperandoConfirmacionDelete(true);
    return t('delete.confirm_full');
  },
};

/** Lista de comandos válidos. */
export const COMANDOS: ComandoTp[] = Object.keys(handlers) as ComandoTp[];

/** Prefijo con el que el panel envía el texto de la bio en modo edición. */
const PREFIJO_BIO = "__BIO__:";

/**
 * Parsea y ejecuta una línea de chat (p. ej. `"/tp invite alice"`).
 * Devuelve `null` si la línea no es un comando ni una entrada de bio.
 */
export async function ejecutarComando(
  linea: string,
): Promise<ResultadoComando | null> {
  if (getEsperandoConfirmacionDelete()) {
    setEsperandoConfirmacionDelete(false);
    if (linea.trim() === "CONFIRMAR") {
      const yo = getUsuarioActual();
      if (!yo) { return t('error.session'); }
      await eliminarCuenta(yo.id);
      if (_ctx) { await eliminarToken(_ctx); }
      setUsuarioActual(null);
      return t('delete.success');
    }
    return t('delete.cancelled');
  }

  if (getEsperandoRespuestaPro()) {
    const opcion = linea.trim();

    if (opcion === "/tp skip" || opcion === "3") {
      setEsperandoRespuestaPro(false);
      return t('pro.skipped');
    }

    if (opcion !== "1" && opcion !== "2") {
      return t('error.pro_invalid');
    }

    const yo = getUsuarioActual();
    if (!yo) {
      return t('error.session');
    }
    const interesado = opcion === "1";
    await crearFeedback(yo.id, 'interes_pro', interesado ? 'si' : 'no', yo.id);
    setEsperandoRespuestaPro(false);
    if (interesado) {
      return [
        t('pro.interested'),
        t('pro.free_reminder'),
        t('pro.daily_limit'),
      ].join("\n");
    } else {
      return [
        t('pro.not_interested'),
        t('pro.free_reminder'),
        t('pro.daily_limit'),
      ].join("\n");
    }
  }

  const paso = getOnboardingPaso();

  if (paso === 'busca') {
    const opciones: Record<string, string> = {
      '1': 'colaborar', '2': 'networking', '3': 'ambas',
    };
    const valor = opciones[linea.trim()];
    if (!valor) {
      return t('error.invalid_option');
    }
    setOnboardingDatos({ ...getOnboardingDatos(), busca: valor });
    setOnboardingPaso('bio');
    return [
      t('onboarding.step1_saved'),
      "",
      t('onboarding.step2_title'),
      "",
      "  " + t('onboarding.step2_hint'),
      "  " + t('onboarding.step2_skip'),
      "",
      "  " + t('onboarding.step2_prompt'),
    ].join("\n");
  }

  if (paso === 'bio') {
    const yo = getUsuarioActual();
    if (!yo) { return t('error.session'); }

    if (linea.trim() === '/tp skip') {
      setOnboardingPaso('readme');
      return [
        t('onboarding.step2_skipped'),
        "",
        t('onboarding.step3_title'),
        "",
        "  " + t('onboarding.step3_desc'),
        "",
        t('onboarding.step3_opt1'),
        t('onboarding.step3_opt2'),
        "",
        t('onboarding.step3_prompt'),
      ].join("\n");
    }

    if (linea.length > 280) {
      return t('profile.bio_too_long');
    }

    setOnboardingDatos({ ...getOnboardingDatos(), bio: linea });
    setOnboardingPaso('readme');
    return [
      "  " + t('profile.bio_saved'),
      "",
      t('onboarding.step3_title'),
      "",
      "  " + t('onboarding.step3_desc'),
      "",
      t('onboarding.step3_opt1'),
      t('onboarding.step3_opt2'),
      "",
      t('onboarding.step3_prompt'),
    ].join("\n");
  }

  if (paso === 'readme') {
    const yo = getUsuarioActual();
    if (!yo) { return t('error.session'); }

    const opcion = linea.trim();
    if (opcion !== '1' && opcion !== '2') {
      return t('error.invalid_option_12');
    }

    const compartirReadme = opcion === '1';
    const datos = getOnboardingDatos();

    await actualizarBusca(yo.id, datos.busca as "colaborar" | "networking" | "ambas");
    if (datos.bio) {
      await actualizarBio(yo.id, datos.bio);
    }

    const proyecto = getProyectoActual();
    if (proyecto) {
      await crearOActualizarProyecto({
        ...proyecto,
        usuario_id: yo.id,
        comparte_readme: compartirReadme,
        creado_por: yo.id,
        actualizado_por: yo.id,
      });
    }

    yo.busca = datos.busca as "colaborar" | "networking" | "ambas";
    if (datos.bio) { yo.bio = datos.bio; }
    setUsuarioActual(yo);
    setOnboardingPaso(null);
    setOnboardingDatos({});

    return [
      t('onboarding.saved'),
      "",
      "  " + t('onboarding.search_hint'),
    ].join("\n");
  }

  // Texto de bio enviado desde el panel en modo edición.
  if (linea.startsWith(PREFIJO_BIO)) {
    const bio = linea.slice(PREFIJO_BIO.length).trim();
    const yo = getUsuarioActual();
    if (!yo) {
      return t('error.session');
    }
    if (bio.length > 280) {
      return t('error.bio_length', bio.length);
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
      yo.locacion,
      bio,
      getProyectoActual(),
    );
    return `${t('profile.bio_saved')}\n\n${postal}`;
  }

  const partes = linea.trim().split(/\s+/);
  if (partes[0] !== "/tp") {
    const yo = getUsuarioActual();
    if (yo?.conversacion_activa_id) {
      try {
        await enviarMensaje(yo.conversacion_activa_id, linea, yo.id);
      } catch (err) {
        return t('error.send_message', (err as Error).message);
      }
      return null;
    }
    return t('error.unknown_command');
  }
  const nombre = partes[1] as ComandoTp | undefined;
  if (!nombre || !(nombre in handlers)) {
    return t('error.unknown_command');
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
    return t('error.no_session');
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
    t('help.title'),
    t('help.search'),
    t('help.connect'),
    t('help.accept'),
    t('help.reject'),
    t('help.friends'),
    t('help.invite'),
    t('help.add'),
    t('help.leave'),
    t('help.status'),
    t('help.stack'),
    t('help.read'),
    t('help.readme'),
    t('help.readme_toggle'),
    t('help.profile'),
    t('help.profile_edit'),
    t('help.clear'),
    t('help.bug'),
    t('help.suggestion'),
    t('help.logout'),
    t('help.delete'),
    t('help.help'),
    "",
    t('help.onboarding'),
    t('help.skip'),
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
  return [proyecto.lenguajes?.[0], proyecto.stack?.[0], proyecto.dominio]
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
 * nunca una palabra.
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
 * Renderiza la postal ASCII de un usuario.
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
    [mio.lenguajes?.[0] ?? "—", suyo.lenguajes?.[0] ?? "—"],
    [mio.stack?.[0] ?? "—", suyo.stack?.[0] ?? "—"],
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

/** Tarjeta de resultado de /tp search. */
function formatoMatch(
  match: Usuario,
  proyecto: Proyecto | null,
  puntaje: number,
  nivelMatch: 'exacto' | 'ambas' | 'cualquiera' = 'exacto',
): string {
  const lugar = match.locacion ? ` · ${match.locacion}` : "";
  const readmeLinea = proyecto?.comparte_readme === false
    ? t('search.not_shared')
    : proyecto?.readme ? t('search.available') : t('search.no_readme');
  const tests = proyecto?.tiene_tests ? t('bool.yes') : t('bool.no');

  const avisoNivel =
    nivelMatch === 'ambas'
      ? t('search.match_diff_category')
      : nivelMatch === 'cualquiera'
        ? t('search.match_any_category')
        : null;

  const lineas = [
    t('search.found'),
    "",
    `@${match.github_login}${lugar}`,
  ];

  if (avisoNivel) {
    lineas.push(avisoNivel);
  }

  lineas.push(
    `busca: ${match.busca ?? "—"}`,
    "",
    `README:    ${readmeLinea}`,
    "",
    `stack:     ${lineaStack(proyecto)}`,
    `tests:     ${tests}`,
    "",
    `compatibilidad: ${barraCompat(puntaje)} ${puntaje}%`,
    "",
    t('search.connect_hint'),
    t('search.read_hint'),
    t('search.next_hint'),
    t('search.separator'),
  );

  return lineas.join("\n");
}

export { handlers };

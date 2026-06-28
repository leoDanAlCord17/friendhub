import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../supabase/client";
import { Invitacion, Mensaje } from "../types";
import { obtenerUsuario } from "../supabase/usuarios";
import { setMatchActual, setInvitacionPendiente, getUsuarioActual, setUsuarioActual, getAmigosCache } from "../state";
import { emitir } from "../output";
import { t } from "../i18n";

/**
 * Chat en tiempo real sobre Supabase Realtime **Broadcast**.
 *
 * Los mensajes NO se persisten en base de datos: solo se transmiten en vivo
 * por el canal de la conversación.
 */

export type ManejadorMensaje = (mensaje: Mensaje) => void;

const EVENTO = "mensaje";
const EVENTO_SISTEMA = "sistema";

export type TipoSistema = "amistad_propuesta" | "amistad_confirmada" | "conversacion_cerrada";

export interface MensajeSistema {
  tipo: TipoSistema;
  de_usuario_id: string;
  de_username: string;
}

const suscripciones = new Map<string, RealtimeChannel>();

/** Se suscribe a los mensajes en vivo de una conversación. */
export function suscribirseAlChat(
  conversacion_id: string,
  onMensaje: ManejadorMensaje,
): RealtimeChannel {
  desuscribirse(conversacion_id);

  const canal = getSupabase()
    .channel(`chat:${conversacion_id}`, {
      config: { broadcast: { self: true } },
    })
    .on("broadcast", { event: EVENTO }, ({ payload }) => {
      onMensaje(payload as Mensaje);
    })
    .subscribe();

  suscripciones.set(conversacion_id, canal);
  return canal;
}

/** Envía un mensaje por el canal de la conversación. */
export async function enviarMensaje(
  conversacion_id: string,
  contenido: string,
  autor_id: string,
): Promise<Mensaje> {
  const canal = suscripciones.get(conversacion_id);
  if (!canal) {
    throw new Error("No estás suscrito a esta conversación.");
  }

  const ahora = Date.now();
  const mensaje: Mensaje = {
    id: `${ahora}-${autor_id}`,
    conversacion_id,
    remitente_id: autor_id,
    contenido,
    estatus: true,
    creado_en: new Date(ahora).toISOString(),
    creado_por: autor_id,
    actualizado_en: new Date(ahora).toISOString(),
    actualizado_por: autor_id,
  };

  const estado = await canal.send({
    type: "broadcast",
    event: EVENTO,
    payload: mensaje,
  });
  if (estado !== "ok") {
    throw new Error(`No se pudo enviar el mensaje (${estado}).`);
  }

  return mensaje;
}

/** Cierra la suscripción de una conversación. */
export function desuscribirse(conversacion_id: string): void {
  const canal = suscripciones.get(conversacion_id);
  if (canal) {
    getSupabase().removeChannel(canal);
    suscripciones.delete(conversacion_id);
  }
}

// ---------------------------------------------------------------------------
// Invitaciones en tiempo real (postgres_changes)
// ---------------------------------------------------------------------------

const canalesInvitacion = new Map<string, RealtimeChannel>();

/** Barra de 10 segmentos a partir de un puntaje 0-100. */
function barra10(puntaje: number): string {
  const llenas = Math.max(0, Math.min(10, Math.round(puntaje / 10)));
  return "█".repeat(llenas) + "░".repeat(10 - llenas);
}

/** Handler que imprime los mensajes del chat en el panel. */
function impresorMensajes(miId: string, otroUsername: string): ManejadorMensaje {
  return (m) => {
    const quien = m.remitente_id === miId ? t('chat.you') : `@${otroUsername}`;
    emitir(`${quien}: ${m.contenido}`);
  };
}

/** Inicia la suscripción al chat de una conversación ya creada. */
export function iniciarChat(
  conversacion_id: string,
  miId: string,
  otroUsername: string,
): void {
  desuscribirse(conversacion_id);

  const canal = getSupabase()
    .channel(`chat:${conversacion_id}`, { config: { broadcast: { self: true } } })
    .on("broadcast", { event: EVENTO }, ({ payload }) => {
      impresorMensajes(miId, otroUsername)(payload as Mensaje);
    })
    .on("broadcast", { event: EVENTO_SISTEMA }, ({ payload }) => {
      manejarSistema(conversacion_id, otroUsername, payload as MensajeSistema);
    })
    .subscribe();

  suscripciones.set(conversacion_id, canal);
}

/** Maneja mensajes de sistema recibidos por el otro usuario. */
function manejarSistema(
  conversacion_id: string,
  otroUsername: string,
  msg: MensajeSistema,
): void {
  // Con self:true el emisor también recibe su propio broadcast — lo ignoramos.
  // El emisor ya ve la respuesta del comando; el receptor ve el broadcast.
  if (msg.de_usuario_id === getUsuarioActual()?.id) { return; }

  if (msg.tipo === "amistad_propuesta") {
    emitir(t('chat.system_separator'));
    emitir([
      t('chat.friend_request', msg.de_username),
      t('chat.friend_confirm'),
    ].join("\n"));
  } else if (msg.tipo === "amistad_confirmada") {
    emitir(t('chat.system_separator'));
    emitir([
      t('chat.friends_confirmed', otroUsername),
      t('chat.friends_now'),
    ].join("\n"));
  } else if (msg.tipo === "conversacion_cerrada") {
    emitir(t('chat.system_separator'));
    emitir([
      t('chat.conv_closed', msg.de_username),
      t('chat.no_more_messages'),
      t('chat.reinvite', msg.de_username),
    ].join("\n"));
    const yo = getUsuarioActual();
    if (yo) {
      yo.conversacion_activa_id = null;
      setUsuarioActual(yo);
    }
    desuscribirse(conversacion_id);
  }
}

/** Envía un mensaje de sistema al otro usuario de la conversación. */
export async function enviarMensajeSistema(
  conversacion_id: string,
  payload: MensajeSistema,
): Promise<void> {
  const canal = suscripciones.get(conversacion_id);
  if (!canal) { return; }
  await canal.send({
    type: "broadcast",
    event: EVENTO_SISTEMA,
    payload,
  });
}

/**
 * Escucha la respuesta a una invitación que el usuario actual envió.
 * Al aceptarse, crea la conversación, actualiza ambos usuarios e inicia el
 * chat; al rechazarse, limpia el match.
 */
export function escucharInvitaciones(
  invitacionId: string,
  miId: string,
  _otroId: string,
  otroUsername: string,
  _puntaje: number,
): RealtimeChannel {
  const clave = `inv-out:${invitacionId}`;
  cerrarCanalInvitacion(clave);

  const canal = getSupabase()
    .channel(clave)
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "invitaciones",
        filter: `id=eq.${invitacionId}`,
      },
      async ({ new: fila }) => {
        const estado = (fila as Invitacion).estado;
        if (estado === "aceptada") {
          // conversacion_id viene en el mismo payload del evento — sin race condition.
          const convId = (fila as Invitacion).conversacion_id;
          if (!convId) { return; }
          const yo = getUsuarioActual();
          if (yo) {
            yo.conversacion_activa_id = convId;
            setUsuarioActual(yo);
          }
          iniciarChat(convId, miId, otroUsername);
          emitir(t('connect.accepted', otroUsername));
          emitir(t('connect.started'));
          emitir(t('chat.stack_hint'));
          cerrarCanalInvitacion(clave);
        } else if (estado === "rechazada") {
          emitir(t('invite.not_available', otroUsername));
          setMatchActual(null);
          cerrarCanalInvitacion(clave);
        }
      },
    )
    .subscribe();

  canalesInvitacion.set(clave, canal);
  return canal;
}

/**
 * Escucha las invitaciones entrantes (INSERT) dirigidas al usuario actual e
 * imprime la tarjeta con las opciones /tp accept y /tp reject.
 */
export function escucharInvitacionesEntrantes(
  usuario_id: string,
): RealtimeChannel {
  const clave = `inv-in:${usuario_id}`;
  const existente = canalesInvitacion.get(clave);
  if (existente) {
    return existente;
  }

  const canal = getSupabase()
    .channel(clave)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "invitaciones",
        filter: `para_usuario=eq.${usuario_id}`,
      },
      async ({ new: fila }) => {
        const invit = fila as Invitacion;

        if (invit.de_usuario === usuario_id) {
          return;
        }

        const remitente = await obtenerUsuario(invit.de_usuario);
        const username = remitente?.github_login ?? invit.de_usuario;
        setInvitacionPendiente({ invitacion: invit, username });

        const esAmigo = getAmigosCache().some((u) => u.id === invit.de_usuario);

        if (esAmigo) {
          emitir(
            [
              t('invite.friend_title'),
              t('invite.friend_wants', username),
              "  ",
              t('invite.incoming_accept'),
              t('invite.incoming_reject'),
              t('invite.incoming_sep'),
            ].join("\n"),
          );
        } else {
          const readmeTexto = invit.readme && invit.readme.trim().length > 0
            ? invit.readme.substring(0, 300) + (invit.readme.length > 300 ? '...' : '')
            : t('invite.no_readme');
          emitir(
            [
              t('invite.incoming_title'),
              t('invite.incoming_wants', username),
              "  ",
              t('invite.incoming_readme'),
              `  ${readmeTexto}`,
              "  ",
              t('invite.incoming_compat', barra10(invit.puntaje), invit.puntaje),
              "  ",
              t('invite.incoming_accept'),
              t('invite.incoming_reject'),
              t('invite.incoming_sep'),
            ].join("\n"),
          );
        }
      },
    )
    .subscribe();

  canalesInvitacion.set(clave, canal);
  return canal;
}

/** Cierra un canal de invitaciones por su clave. */
function cerrarCanalInvitacion(clave: string): void {
  const canal = canalesInvitacion.get(clave);
  if (canal) {
    getSupabase().removeChannel(canal);
    canalesInvitacion.delete(clave);
  }
}

/** Cierra todas las suscripciones activas (chat e invitaciones). */
export function cerrarTodas(): void {
  for (const id of [...suscripciones.keys()]) {
    desuscribirse(id);
  }
  for (const clave of [...canalesInvitacion.keys()]) {
    cerrarCanalInvitacion(clave);
  }
}

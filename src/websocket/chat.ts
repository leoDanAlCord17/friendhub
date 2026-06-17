import { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "../supabase/client";
import { Invitacion, Mensaje } from "../types";
import { crearConversacion } from "../supabase/conversaciones";
import {
  actualizarConversacionActiva,
  obtenerUsuario,
} from "../supabase/usuarios";
import { setMatchActual, setInvitacionPendiente, getUsuarioActual, setUsuarioActual } from "../state";
import { emitir } from "../output";

/**
 * Chat en tiempo real sobre Supabase Realtime **Broadcast**.
 *
 * Los mensajes NO se persisten en base de datos: solo se transmiten en vivo
 * por el canal de la conversación.
 */

export type ManejadorMensaje = (mensaje: Mensaje) => void;

const EVENTO = "mensaje";

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
    const quien = m.remitente_id === miId ? "tú" : `@${otroUsername}`;
    emitir(`${quien}: ${m.contenido}`);
  };
}

/** Inicia la suscripción al chat de una conversación ya creada. */
export function iniciarChat(
  conversacion_id: string,
  miId: string,
  otroUsername: string,
): void {
  suscribirseAlChat(conversacion_id, impresorMensajes(miId, otroUsername));
}

/**
 * Escucha la respuesta a una invitación que el usuario actual envió.
 * Al aceptarse, crea la conversación, actualiza ambos usuarios e inicia el
 * chat; al rechazarse, limpia el match.
 */
export function escucharInvitaciones(
  invitacionId: string,
  miId: string,
  otroId: string,
  otroUsername: string,
  puntaje: number,
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
          const conv = await crearConversacion(miId, otroId, puntaje);
          await actualizarConversacionActiva(miId, conv.id);
          await actualizarConversacionActiva(otroId, conv.id);
          const yo = getUsuarioActual();
          if (yo) {
            yo.conversacion_activa_id = conv.id;
            setUsuarioActual(yo);
          }
          iniciarChat(conv.id, miId, otroUsername);
          emitir(`  ✓ @${otroUsername} aceptó tu invitación.`);
          emitir("  conversación iniciada.");
          emitir("  escribe /mh stack para ver la compatibilidad.");
          cerrarCanalInvitacion(clave);
        } else if (estado === "rechazada") {
          emitir(`  @${otroUsername} no está disponible ahora.`);
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
 * imprime la tarjeta con las opciones /mh accept y /mh reject.
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
        const remitente = await obtenerUsuario(invit.de_usuario);
        const username = remitente?.github_login ?? invit.de_usuario;
        setInvitacionPendiente({ invitacion: invit, username });

        const readme = (invit.readme ?? "Sin README.").slice(0, 300);
        emitir(
          [
            "  ── nueva invitación ──────────────────",
            `  @${username} quiere conectar contigo.`,
            "  ",
            "  README de su proyecto:",
            `  ${readme}`,
            "  ",
            `  compatibilidad: ${barra10(invit.puntaje)} ${invit.puntaje}%`,
            "  ",
            "  /mh accept   → aceptar",
            "  /mh reject   → rechazar",
            "  ──────────────────────────────────────",
          ].join("\n"),
        );
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

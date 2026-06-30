import * as https from "https";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { Usuario } from "../types";
import {
  obtenerUsuarioPorGithubId,
  obtenerUsuario,
  crearUsuario,
  actualizarZonaHoraria,
} from "../supabase/usuarios";
import {
  detectarWorkspace,
  crearOActualizarProyecto,
} from "../supabase/proyectos";
import { obtenerConversacionActiva } from "../supabase/conversaciones";
import { iniciarChat } from "../websocket/chat";
import {
  setUsuarioActual,
  cargarSesion,
  setOnboardingPaso,
  getConsentimientoPendiente,
  setConsentimientoPendiente,
} from "../state";
import {
  obtenerVersionActiva,
  registrarConsentimiento,
} from "../supabase/consentimientos";
import { idioma } from "../i18n";

/**
 * Flujo de GitHub OAuth para TermPals a través de un endpoint serverless en
 * Vercel.
 *
 * GitHub redirige a `https://termpals.vercel.app/api/callback`, que
 * intercambia el `code` por el `access_token` (el client secret vive en Vercel,
 * nunca en el cliente) y reenvía a `vscode://leodanielalvarez.termpals/callback`
 * con el `access_token` y el `state` en los query params. VS Code entrega ese
 * URI a la extensión vía `registerUriHandler`; aquí validamos el `state` y
 * usamos el token directamente.
 */

/** Endpoint serverless de Vercel que hace el intercambio code → token. */
const REDIRECT_URI = "https://termpals.vercel.app/api/callback";
const SCOPES = "read:user user:email";
const TIMEOUT_MS = 120_000;
const STATE_KEY = "termpals.oauthState";
const TOKEN_KEY = "termpals.github.token";

/** Persiste el access token de GitHub en el almacén cifrado del OS. */
export async function guardarToken(
  context: vscode.ExtensionContext,
  token: string,
): Promise<void> {
  await context.secrets.store(TOKEN_KEY, token);
}

/** Recupera el access token guardado, o undefined si no existe. */
export async function obtenerTokenGuardado(
  context: vscode.ExtensionContext,
): Promise<string | undefined> {
  return context.secrets.get(TOKEN_KEY);
}

/** Elimina el access token guardado (logout o token inválido). */
export async function eliminarToken(
  context: vscode.ExtensionContext,
): Promise<void> {
  await context.secrets.delete(TOKEN_KEY);
}

/** Resultado que el UriHandler entrega al login en curso. */
type ResultadoCallback = { token: string; lang: string } | { error: string };

/** Canal por el que el UriHandler entrega el access_token (o un error). */
const emisorCallback = new vscode.EventEmitter<ResultadoCallback>();

interface PerfilGithub {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  location: string | null;
  email: string | null;
}

const GITHUB_CLIENT_ID = 'Ov23liSbRYaNMxE5NIbY';

/** Inicia el login con GitHub y devuelve el usuario autenticado. */
export async function iniciarLoginGithub(
  context: vscode.ExtensionContext,
): Promise<Usuario> {
  const clientId = GITHUB_CLIENT_ID;

  // State aleatorio anti-CSRF, guardado para que el UriHandler lo valide.
  const state = crypto.randomUUID();
  await context.globalState.update(STATE_KEY, state);

  const stateConLang = `${state}|${idioma()}`;
  const authUrl =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(stateConLang)}` +
    `&prompt=select_account`;

  // Suscribirse ANTES de abrir el browser para no perder el callback.
  const promesaToken = esperarCallback();
  await vscode.env.openExternal(vscode.Uri.parse(authUrl));
  const { token: accessToken } = await promesaToken;

  // Persistir el token para restaurar sesión en futuros arranques.
  await guardarToken(context, accessToken);

  // Vercel ya intercambió el code: usamos el access_token directamente.
  const perfil = await obtenerPerfil(accessToken);

  let usuario = await obtenerUsuarioPorGithubId(String(perfil.id));
  if (!usuario) {
    usuario = await crearUsuario({
      github_id: String(perfil.id),
      github_login: perfil.login,
      nombre_usuario: perfil.login,
      nombre: perfil.name ?? perfil.login,
      avatar_url: perfil.avatar_url,
      locacion: perfil.location ?? null,
      email: perfil.email ?? null,
      busca: null,
      estatus: true,
    });
  }

  // Bug 1: siempre refresca el estado completo desde Supabase para que
  // conversacion_activa_id y otros campos reflejen la BD, no la sesión anterior.
  usuario = (await obtenerUsuario(usuario.id)) ?? usuario;

  // Registrar consentimiento GDPR si hay uno pendiente y el usuario aún no tiene uno activo.
  const pendiente = getConsentimientoPendiente();
  if (pendiente && !usuario.consentimiento_activo) {
    const version = await obtenerVersionActiva();
    if (version) {
      await registrarConsentimiento(
        usuario.id,
        version.id,
        "aceptado",
        pendiente,
        "0.1.0",
      );
      usuario.consentimiento_activo = true;
    }
    setConsentimientoPendiente(null);
  }

  // Actualizar zona horaria detectada en el cliente (puede cambiar si el usuario viaja).
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
  await actualizarZonaHoraria(usuario.id, zonaHoraria);
  usuario.zona_horaria = zonaHoraria;

  // Bug 2: persiste el workspace detectado para que buscarMatch() tenga datos reales.
  const proyecto = await detectarWorkspace();
  if (proyecto.lenguajes && proyecto.lenguajes.length > 0) {
    await crearOActualizarProyecto({
      ...proyecto,
      usuario_id: usuario.id,
      creado_por: usuario.id,
      actualizado_por: usuario.id,
    });
  }

  await cargarSesion(usuario);

  // Reconectar al canal de chat si había una conversación activa al momento del login.
  if (usuario.conversacion_activa_id) {
    const conv = await obtenerConversacionActiva(usuario.id);
    if (conv) {
      const otroId = conv.usuario_a === usuario.id ? conv.usuario_b : conv.usuario_a;
      const otro = await obtenerUsuario(otroId);
      iniciarChat(conv.id, usuario.id, otro?.github_login ?? otroId);
    }
  }

  if (usuario.busca === null || usuario.busca === undefined) {
    setOnboardingPaso('busca');
  }

  setUsuarioActual(usuario);
  return usuario;
}

/** Espera el callback del UriHandler (con timeout) y resuelve con el token. */
function esperarCallback(): Promise<{ token: string; lang: string }> {
  return new Promise<{ token: string; lang: string }>((resolve, reject) => {
    const temporizador = setTimeout(() => {
      sub.dispose();
      reject(new Error("Tiempo de espera de autorización agotado."));
    }, TIMEOUT_MS);
    temporizador.unref?.();

    const sub = emisorCallback.event((resultado) => {
      clearTimeout(temporizador);
      sub.dispose();
      if ("token" in resultado) {
        resolve({ token: resultado.token, lang: resultado.lang });
      } else {
        reject(new Error(resultado.error));
      }
    });
  });
}

/**
 * Procesa el URI de callback entregado por VS Code (lo invoca el UriHandler
 * registrado en `extension.ts`). Valida el `state` contra el guardado en
 * `globalState` y extrae el `access_token` (que Vercel ya obtuvo de GitHub).
 */
export function manejarCallback(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
): void {
  const fragment = new URLSearchParams(uri.fragment);
  const accessToken = fragment.get("access_token");
  const params = new URLSearchParams(uri.query);
  const rawState = params.get("state") ?? "";
  const [stateReal, lang] = rawState.split("|");
  const guardado = context.globalState.get<string>(STATE_KEY);

  if (!accessToken) {
    emisorCallback.fire({ error: "No se recibió 'access_token'." });
    return;
  }
  if (!stateReal || !guardado || stateReal !== guardado) {
    emisorCallback.fire({ error: "State inválido (posible CSRF)." });
    return;
  }
  void context.globalState.update(STATE_KEY, undefined);
  emisorCallback.fire({ token: accessToken, lang: lang ?? "es" });
}

/** GET usando el módulo nativo `https`. Resuelve con el body crudo. */
function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opciones: https.RequestOptions = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: "GET",
      headers: { "User-Agent": "TermPals", ...headers },
    };
    const req = https.get(opciones, (res) => {
      let datos = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (datos += chunk));
      res.on("end", () => resolve(datos));
    });
    req.on("error", (err) => reject(err));
  });
}

/**
 * Intenta restaurar la sesión usando el token guardado en secrets.
 * Devuelve el Usuario si el token sigue siendo válido, o null si expiró/no existe.
 * Elimina el token guardado cuando detecta que ya no es válido.
 */
export async function intentarLoginSilencioso(
  context: vscode.ExtensionContext,
): Promise<Usuario | null> {
  const token = await obtenerTokenGuardado(context);
  if (!token) { return null; }

  try {
    const perfil = await obtenerPerfil(token);
    if (!perfil.id) { throw new Error("Token inválido"); }

    let usuario = await obtenerUsuarioPorGithubId(String(perfil.id));
    if (!usuario) { throw new Error("Usuario no encontrado en Supabase"); }

    usuario = (await obtenerUsuario(usuario.id)) ?? usuario;
    await cargarSesion(usuario);

    if (usuario.conversacion_activa_id) {
      const conv = await obtenerConversacionActiva(usuario.id);
      if (conv) {
        const otroId = conv.usuario_a === usuario.id ? conv.usuario_b : conv.usuario_a;
        const otro = await obtenerUsuario(otroId);
        iniciarChat(conv.id, usuario.id, otro?.github_login ?? otroId);
      }
    }

    if (usuario.busca === null || usuario.busca === undefined) {
      setOnboardingPaso("busca");
    }

    setUsuarioActual(usuario);
    return usuario;
  } catch {
    await eliminarToken(context);
    return null;
  }
}

/** Consulta el perfil del usuario en GitHub. Exportado como alias público. */
export async function obtenerPerfilGithub(token: string): Promise<PerfilGithub> {
  return obtenerPerfil(token);
}

/** Consulta el perfil del usuario en GitHub. */
async function obtenerPerfil(token: string): Promise<PerfilGithub> {
  let cuerpo: string;
  try {
    cuerpo = await httpGet("https://api.github.com/user", {
      Authorization: `token ${token}`,
      "User-Agent": "TermPals",
      Accept: "application/vnd.github+json",
    });
  } catch (err) {
    throw new Error(
      `Error de red al consultar el perfil de GitHub: ${(err as Error).message}`,
    );
  }

  try {
    return JSON.parse(cuerpo) as PerfilGithub;
  } catch {
    throw new Error(`Respuesta no-JSON de GitHub /user: ${cuerpo.slice(0, 200)}`);
  }
}

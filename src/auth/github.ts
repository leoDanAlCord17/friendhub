import * as https from "https";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { Usuario } from "../types";
import {
  obtenerUsuarioPorGithubId,
  obtenerUsuario,
  crearUsuario,
  actualizarBusca,
} from "../supabase/usuarios";
import {
  detectarWorkspace,
  crearOActualizarProyecto,
} from "../supabase/proyectos";
import { obtenerConversacionActiva } from "../supabase/conversaciones";
import { iniciarChat } from "../websocket/chat";
import { setUsuarioActual, cargarSesion } from "../state";

/**
 * Flujo de GitHub OAuth para TermPals a través de un endpoint serverless en
 * Vercel.
 *
 * GitHub redirige a `https://friendhub-six.vercel.app/api/callback`, que
 * intercambia el `code` por el `access_token` (el client secret vive en Vercel,
 * nunca en el cliente) y reenvía a `vscode://leodanielalvarez.termpals/callback`
 * con el `access_token` y el `state` en los query params. VS Code entrega ese
 * URI a la extensión vía `registerUriHandler`; aquí validamos el `state` y
 * usamos el token directamente.
 */

/** Endpoint serverless de Vercel que hace el intercambio code → token. */
const REDIRECT_URI = "https://friendhub-six.vercel.app/api/callback";
const SCOPES = "read:user user:email";
const TIMEOUT_MS = 120_000;
const STATE_KEY = "termpals.oauthState";

/** Resultado que el UriHandler entrega al login en curso. */
type ResultadoCallback = { token: string } | { error: string };

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

/**
 * El client secret ya NO se usa en el cliente: el intercambio code → token lo
 * hace el endpoint de Vercel. Solo necesitamos el Client ID para construir la
 * URL de autorización.
 */
function leerClientId(): string {
  const config = vscode.workspace.getConfiguration("termpals");
  const clientId = config.get<string>("githubClientId", "").trim();
  if (!clientId) {
    throw new Error("Configura termpals.githubClientId en Settings.");
  }
  return clientId;
}

/** Inicia el login con GitHub y devuelve el usuario autenticado. */
export async function iniciarLoginGithub(
  context: vscode.ExtensionContext,
): Promise<Usuario> {
  const clientId = leerClientId();

  // State aleatorio anti-CSRF, guardado para que el UriHandler lo valide.
  const state = crypto.randomUUID();
  await context.globalState.update(STATE_KEY, state);

  const authUrl =
    "https://github.com/login/oauth/authorize" +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${encodeURIComponent(state)}`;

  // Suscribirse ANTES de abrir el browser para no perder el callback.
  const promesaToken = esperarCallback();
  await vscode.env.openExternal(vscode.Uri.parse(authUrl));
  const accessToken = await promesaToken;

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
      location: perfil.location ?? null,
      email: perfil.email ?? null,
      busca: 'colaborar',
      estatus: true,
      creado_por: perfil.login,
      actualizado_por: perfil.login,
    });
  }

  // Bug 1: siempre refresca el estado completo desde Supabase para que
  // conversacion_activa_id y otros campos reflejen la BD, no la sesión anterior.
  usuario = (await obtenerUsuario(usuario.id)) ?? usuario;

  // Bug 2: persiste el workspace detectado para que buscarMatch() tenga datos reales.
  const proyecto = await detectarWorkspace();
  if (proyecto.lenguajes && proyecto.lenguajes.length > 0) {
    await crearOActualizarProyecto({
      ...proyecto,
      usuario_id: usuario.id,
      creado_por: usuario.github_login,
      actualizado_por: usuario.github_login,
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

  // Primera vez: capturar la intención de búsqueda.
  if (usuario.busca === null || usuario.busca === undefined) {
    const valor = await preguntarBusca();
    await actualizarBusca(usuario.id, valor);
    usuario.busca = valor; // actualiza el objeto en memoria
  }

  setUsuarioActual(usuario);
  return usuario;
}

/** Pregunta al usuario qué tipo de conexión busca. */
async function preguntarBusca(): Promise<
  "colaborar" | "networking" | "ambas"
> {
  const COLABORAR = "👥  Colaborar — encontrar devs para proyectos";
  const NETWORKING = "🤝  Networking — ampliar mi red profesional";
  const AMBAS = "🎯  Ambas — colaborar y hacer networking";
  const eleccion = await vscode.window.showQuickPick(
    [COLABORAR, NETWORKING, AMBAS],
    {
      title: "¿Qué buscas en TermPals?",
      placeHolder: "¿Qué buscas en TermPals?",
      ignoreFocusOut: true,
    },
  );
  if (eleccion === NETWORKING) {
    return "networking";
  }
  if (eleccion === AMBAS) {
    return "ambas";
  }
  return "colaborar"; // por defecto si se cierra sin elegir
}

/** Espera el callback del UriHandler (con timeout) y resuelve con el token. */
function esperarCallback(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const temporizador = setTimeout(() => {
      sub.dispose();
      reject(new Error("Tiempo de espera de autorización agotado."));
    }, TIMEOUT_MS);
    temporizador.unref?.();

    const sub = emisorCallback.event((resultado) => {
      clearTimeout(temporizador);
      sub.dispose();
      if ("token" in resultado) {
        resolve(resultado.token);
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
  const params = new URLSearchParams(uri.query);
  const accessToken = params.get("access_token");
  const state = params.get("state");
  const guardado = context.globalState.get<string>(STATE_KEY);

  if (!accessToken) {
    emisorCallback.fire({ error: "No se recibió 'access_token'." });
    return;
  }
  if (!state || !guardado || state !== guardado) {
    emisorCallback.fire({ error: "State inválido (posible CSRF)." });
    return;
  }
  void context.globalState.update(STATE_KEY, undefined);
  emisorCallback.fire({ token: accessToken });
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

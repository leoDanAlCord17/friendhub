import * as https from "https";
import * as crypto from "crypto";
import * as vscode from "vscode";
import { Usuario } from "../types";
import {
  obtenerUsuarioPorGithubId,
  crearUsuario,
  actualizarBusca,
} from "../supabase/usuarios";
import { setUsuarioActual, cargarSesion } from "../state";

/**
 * Flujo de GitHub OAuth para MeetHub a través de un endpoint serverless en
 * Vercel.
 *
 * GitHub redirige a `https://friendhub-six.vercel.app/api/callback`, que
 * intercambia el `code` por el `access_token` (el client secret vive en Vercel,
 * nunca en el cliente) y reenvía a `vscode://leodanielalvarez.meethub/callback`
 * con el `access_token` y el `state` en los query params. VS Code entrega ese
 * URI a la extensión vía `registerUriHandler`; aquí validamos el `state` y
 * usamos el token directamente.
 */

/** Endpoint serverless de Vercel que hace el intercambio code → token. */
const REDIRECT_URI = "https://friendhub-six.vercel.app/api/callback";
const SCOPES = "read:user user:email";
const TIMEOUT_MS = 120_000;
const STATE_KEY = "meethub.oauthState";

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
  const config = vscode.workspace.getConfiguration("meethub");
  const clientId = config.get<string>("githubClientId", "").trim();
  if (!clientId) {
    throw new Error("Configura meethub.githubClientId en Settings.");
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
      estatus: true,
      creado_por: perfil.login,
      actualizado_por: perfil.login,
    });
  }

  await cargarSesion(usuario);

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
      title: "¿Qué buscas en MeetHub?",
      placeHolder: "¿Qué buscas en MeetHub?",
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
      headers: { "User-Agent": "MeetHub", ...headers },
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
      "User-Agent": "MeetHub",
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

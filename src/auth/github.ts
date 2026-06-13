import * as http from "http";
import * as vscode from "vscode";
import { Usuario } from "../types";
import {
  obtenerUsuarioPorGithubId,
  crearUsuario,
  actualizarBusca,
} from "../supabase/usuarios";
import { setUsuarioActual } from "../state";

/**
 * Flujo completo de GitHub OAuth para FriendHub.
 *
 * Levanta un servidor HTTP local temporal en el puerto 7777, abre la pantalla
 * de autorización de GitHub, recibe el `code` en `/callback`, lo intercambia
 * por un `access_token`, consulta el perfil, sincroniza el usuario con
 * Supabase y lo guarda en el estado de sesión.
 */

const PUERTO = 7777;
const REDIRECT_URI = `http://localhost:${PUERTO}/callback`;
const SCOPES = "read:user user:email";
const TIMEOUT_MS = 120_000;

interface PerfilGithub {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  location: string | null;
  email: string | null;
}

function leerCredencialesOAuth(): { clientId: string; clientSecret: string } {
  const config = vscode.workspace.getConfiguration("friendhub");
  const clientId = config.get<string>("githubClientId", "").trim();
  const clientSecret = config.get<string>("githubClientSecret", "").trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      "Configura friendhub.githubClientId y friendhub.githubClientSecret en Settings.",
    );
  }
  return { clientId, clientSecret };
}

/** Inicia el login con GitHub y devuelve el usuario autenticado. */
export async function iniciarLoginGithub(): Promise<Usuario> {
  const { clientId, clientSecret } = leerCredencialesOAuth();
  const estadoCsrf = Math.random().toString(36).slice(2);

  const code = await esperarCallback(clientId, estadoCsrf);
  const token = await intercambiarCodePorToken(
    clientId,
    clientSecret,
    code,
  );
  const perfil = await obtenerPerfil(token);

  let usuario = await obtenerUsuarioPorGithubId(String(perfil.id));
  if (!usuario) {
    usuario = await crearUsuario({
      github_id: String(perfil.id),
      github_login: perfil.login,
      nombre: perfil.name,
      avatar_url: perfil.avatar_url,
      location: perfil.location,
      email: perfil.email,
      disponible: true,
    });
  }

  // Primera vez: capturar la intención de búsqueda.
  if (usuario.busca === null || usuario.busca === undefined) {
    const busca = await preguntarBusca();
    usuario = await actualizarBusca(usuario.id, busca);
  }

  setUsuarioActual(usuario);
  return usuario;
}

/** Pregunta al usuario qué tipo de conexión busca. */
async function preguntarBusca(): Promise<"amigos" | "algo_mas"> {
  const AMIGOS = "👥  Amigos — conocer devs con quien colaborar";
  const ALGO_MAS = "💜  Algo más — también abierto a algo romántico";
  const eleccion = await vscode.window.showQuickPick([AMIGOS, ALGO_MAS], {
    placeHolder: "¿Qué buscas en FriendHub?",
    ignoreFocusOut: true,
  });
  return eleccion === ALGO_MAS ? "algo_mas" : "amigos";
}

/** Levanta el servidor local, abre el browser y resuelve con el `code`. */
function esperarCallback(
  clientId: string,
  estadoCsrf: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const servidor = http.createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", REDIRECT_URI);
        if (url.pathname !== "/callback") {
          res.writeHead(404).end();
          return;
        }
        const code = url.searchParams.get("code");
        const estado = url.searchParams.get("state");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        if (!code || estado !== estadoCsrf) {
          res.end("<h2>FriendHub: autorización inválida. Cierra esta pestaña.</h2>");
          cerrar(servidor);
          reject(new Error("Respuesta OAuth inválida (state/code)."));
          return;
        }
        res.end(
          "<h2>FriendHub conectado ✅</h2><p>Ya puedes cerrar esta pestaña y volver a VS Code.</p>",
        );
        cerrar(servidor);
        resolve(code);
      } catch (err) {
        cerrar(servidor);
        reject(err as Error);
      }
    });

    servidor.on("error", (err) => reject(err));

    servidor.listen(PUERTO, () => {
      const authUrl =
        "https://github.com/login/oauth/authorize" +
        `?client_id=${encodeURIComponent(clientId)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&scope=${encodeURIComponent(SCOPES)}` +
        `&state=${encodeURIComponent(estadoCsrf)}`;
      void vscode.env.openExternal(vscode.Uri.parse(authUrl));
    });

    const temporizador = setTimeout(() => {
      cerrar(servidor);
      reject(new Error("Tiempo de espera de autorización agotado."));
    }, TIMEOUT_MS);
    temporizador.unref?.();
  });
}

/** Cierra el servidor temporal de forma segura. */
function cerrar(servidor: http.Server): void {
  servidor.close();
}

/** Intercambia el `code` por un `access_token`. */
async function intercambiarCodePorToken(
  clientId: string,
  clientSecret: string,
  code: string,
): Promise<string> {
  const resp = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  if (!resp.ok) {
    throw new Error(`GitHub OAuth respondió ${resp.status}`);
  }
  const json = (await resp.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!json.access_token) {
    throw new Error(`No se obtuvo access_token (${json.error ?? "desconocido"}).`);
  }
  return json.access_token;
}

/** Consulta el perfil del usuario en GitHub. */
async function obtenerPerfil(token: string): Promise<PerfilGithub> {
  const resp = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
  });
  if (!resp.ok) {
    throw new Error(`GitHub /user respondió ${resp.status}`);
  }
  return (await resp.json()) as PerfilGithub;
}

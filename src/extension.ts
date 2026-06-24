import * as vscode from "vscode";
import { TermPalsPanel } from "./panel/TermPalsPanel";
import {
  cerrarTodas,
  escucharInvitacionesEntrantes,
} from "./websocket/chat";
import { hayCredenciales } from "./supabase/client";
import { iniciarLoginGithub, manejarCallback } from "./auth/github";
import { getOnboardingPaso } from "./state";
import { configurarContextComandos, setProveedorPanel } from "./commands";

/**
 * Punto de entrada de la extensión TermPals.
 *
 * Registra el webview del panel inferior, el comando `mh.open` y el comando
 * `mh.login` que ejecuta el flujo de GitHub OAuth.
 */
export function activate(context: vscode.ExtensionContext): void {
  configurarContextComandos(context);
  const proveedor = new TermPalsPanel(context.extensionUri, context);
  setProveedorPanel(proveedor);

  if (!hayCredenciales()) {
    void vscode.window.showWarningMessage(
      "TermPals: configura termpals.supabaseUrl y termpals.supabaseAnonKey en Settings para empezar.",
    );
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TermPalsPanel.viewType,
      proveedor,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tp.open", async () => {
      await vscode.commands.executeCommand("termpals.main.focus");
      proveedor.mostrar();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("tp.login", async () => {
      try {
        const usuario = await iniciarLoginGithub(context);
        proveedor.imprimir(`Sesión iniciada como @${usuario.github_login}`);
        escucharInvitacionesEntrantes(usuario.id);
        if (getOnboardingPaso() === 'busca') {
          proveedor.imprimir([
            `¡Bienvenido a TermPals, @${usuario.github_login}!`,
            '',
            'Vamos a configurar tu perfil rápido.',
            '',
            'Paso 1 de 3 — ¿Qué buscás en TermPals?',
            '',
            '  1. Colaborar — encontrar devs para proyectos',
            '  2. Networking — ampliar mi red profesional',
            '  3. Ambas — colaborar y hacer networking',
            '',
            'Escribe el número de tu elección y pulsa Enter:',
          ].join('\n'));
        }
      } catch (err) {
        const msg = (err as Error).message;
        proveedor.imprimir(`Error de login: ${msg}`);
        void vscode.window.showErrorMessage(`TermPals: ${msg}`);
      }
    }),
  );

  // Recibe el callback de GitHub OAuth (URI vscode://leodanielalvarez.TermPals/callback).
  context.subscriptions.push(
    vscode.window.registerUriHandler({
      handleUri(uri: vscode.Uri) {
        manejarCallback(context, uri);
      },
    }),
  );
}

/** Limpieza al desactivar la extensión. */
export function deactivate(): void {
  cerrarTodas();
}

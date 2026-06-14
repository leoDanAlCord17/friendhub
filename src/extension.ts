import * as vscode from "vscode";
import { MeetHubPanel } from "./panel/MeetHubPanel";
import {
  cerrarTodas,
  escucharInvitacionesEntrantes,
} from "./websocket/chat";
import { hayCredenciales } from "./supabase/client";
import { iniciarLoginGithub, manejarCallback } from "./auth/github";

/**
 * Punto de entrada de la extensión MeetHub.
 *
 * Registra el webview del panel inferior, el comando `mh.open` y el comando
 * `mh.login` que ejecuta el flujo de GitHub OAuth.
 */
export function activate(context: vscode.ExtensionContext): void {
  const proveedor = new MeetHubPanel(context.extensionUri);

  if (!hayCredenciales()) {
    void vscode.window.showWarningMessage(
      "MeetHub: configura meethub.supabaseUrl y meethub.supabaseAnonKey en Settings para empezar.",
    );
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      MeetHubPanel.viewType,
      proveedor,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mh.open", async () => {
      await vscode.commands.executeCommand("meethub.main.focus");
      proveedor.mostrar();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("mh.login", async () => {
      try {
        const usuario = await iniciarLoginGithub(context);
        proveedor.imprimir(`Sesión iniciada como @${usuario.github_login}`);
        escucharInvitacionesEntrantes(usuario.id);
      } catch (err) {
        const msg = (err as Error).message;
        proveedor.imprimir(`Error de login: ${msg}`);
        void vscode.window.showErrorMessage(`MeetHub: ${msg}`);
      }
    }),
  );

  // Recibe el callback de GitHub OAuth (URI vscode://leodanielalvarez.meethub/callback).
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

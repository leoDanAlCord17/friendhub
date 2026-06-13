import * as vscode from "vscode";
import { FriendHubPanel } from "./panel/FriendHubPanel";
import {
  cerrarTodas,
  escucharInvitacionesEntrantes,
} from "./websocket/chat";
import { hayCredenciales } from "./supabase/client";
import { iniciarLoginGithub } from "./auth/github";

/**
 * Punto de entrada de la extensión FriendHub.
 *
 * Registra el webview del panel inferior, el comando `fh.open` y el comando
 * `fh.login` que ejecuta el flujo de GitHub OAuth.
 */
export function activate(context: vscode.ExtensionContext): void {
  const proveedor = new FriendHubPanel(context.extensionUri);

  if (!hayCredenciales()) {
    void vscode.window.showWarningMessage(
      "FriendHub: configura friendhub.supabaseUrl y friendhub.supabaseAnonKey en Settings para empezar.",
    );
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      FriendHubPanel.viewType,
      proveedor,
      { webviewOptions: { retainContextWhenHidden: true } },
    ),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fh.open", async () => {
      await vscode.commands.executeCommand("friendhub.main.focus");
      proveedor.mostrar();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("fh.login", async () => {
      try {
        const usuario = await iniciarLoginGithub();
        proveedor.imprimir(`Sesión iniciada como @${usuario.github_login}`);
        escucharInvitacionesEntrantes(usuario.id);
      } catch (err) {
        const msg = (err as Error).message;
        proveedor.imprimir(`Error de login: ${msg}`);
        void vscode.window.showErrorMessage(`FriendHub: ${msg}`);
      }
    }),
  );
}

/** Limpieza al desactivar la extensión. */
export function deactivate(): void {
  cerrarTodas();
}

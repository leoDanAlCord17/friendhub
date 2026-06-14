import * as vscode from "vscode";
import { ejecutarComando } from "../commands";
import { getUsuarioActual } from "../state";
import { setEmisor } from "../output";

/**
 * Proveedor del webview de FriendHub que vive en el panel inferior de VS Code
 * (junto a la Terminal). Renderiza una consola estilo terminal donde el
 * usuario escribe comandos `/fh` y recibe las respuestas.
 */
export class FriendHubPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "friendhub.main";

  private view?: vscode.WebviewView;
  private loginIntentado = false;

  constructor(private readonly extensionUri: vscode.Uri) {}

  /** Llamado por VS Code cuando la vista del panel se hace visible. */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };
    webviewView.webview.html = this.getHtml();

    // Permite que cualquier módulo (listeners de Realtime) imprima aquí.
    setEmisor((texto) => this.imprimir(texto));

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.tipo === "comando" && typeof msg.texto === "string") {
        const respuesta = await ejecutarComando(msg.texto);
        webviewView.webview.postMessage({
          tipo: "salida",
          texto: respuesta ?? `comando no reconocido: ${msg.texto}`,
        });
      }
    });

    // Primer arranque sin sesión: dispara el login automáticamente.
    if (!this.loginIntentado && !getUsuarioActual()) {
      this.loginIntentado = true;
      void vscode.commands.executeCommand("fh.login");
    }
  }

  /** Imprime texto en la consola desde el extension host (eventos en vivo). */
  public imprimir(texto: string): void {
    this.view?.webview.postMessage({ tipo: "salida", texto });
  }

  /** Da foco a la vista (usado por el comando fh.open). */
  public mostrar(): void {
    this.view?.show?.(true);
  }

  private getHtml(): string {
    const nonce = generarNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FriendHub</title>
  <style>
    html, body {
      height: 100%;
      margin: 0;
      background: #1e1e1e;
      color: #d4d4d4;
      font-family: Consolas, "Courier New", monospace;
      font-size: 13px;
      line-height: 1.45;
    }
    #terminal {
      display: flex;
      flex-direction: column;
      height: 100vh;
      box-sizing: border-box;
      padding: 8px 10px;
    }
    #output {
      flex: 1;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .bloque { margin: 0 0 8px; }
    .eco { color: #569cd6; }
    .sistema { color: #6a9955; }
    #prompt-fila {
      display: flex;
      align-items: center;
      gap: 6px;
      border-top: 1px solid #333;
      padding-top: 6px;
    }
    #signo { color: #569cd6; }
    #entrada {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: #d4d4d4;
      font-family: inherit;
      font-size: inherit;
    }
    #entrada::placeholder { color: #6b6b6b; }
    #output::-webkit-scrollbar { width: 10px; }
    #output::-webkit-scrollbar-thumb { background: #424242; border-radius: 5px; }
  </style>
</head>
<body>
  <div id="terminal">
    <div id="output"></div>
    <div id="prompt-fila">
      <span id="signo">&gt;</span>
      <input id="entrada" type="text" autocomplete="off" spellcheck="false"
        placeholder="escribe un comando  /fh help" />
    </div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const output = document.getElementById('output');
    const entrada = document.getElementById('entrada');

    function imprimir(texto, clase) {
      const div = document.createElement('div');
      div.className = 'bloque' + (clase ? ' ' + clase : '');
      div.textContent = texto;
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
    }

    function enviar() {
      const texto = entrada.value.trim();
      if (!texto) { return; }
      imprimir('> ' + texto, 'eco');
      vscode.postMessage({ tipo: 'comando', texto });
      entrada.value = '';
    }

    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); enviar(); }
    });

    window.addEventListener('message', (e) => {
      if (e.data && e.data.tipo === 'salida') { imprimir(e.data.texto); }
    });

    // Pantalla de bienvenida.
    imprimir([
      '╔═══════════════════════════════════════╗',
      '║          F R I E N D H U B           ║',
      '║       conecta con otros devs          ║',
      '╚═══════════════════════════════════════╝',
      '',
      'v0.1.0  ·  hecho para devs, por devs',
      '',
      'para empezar:',
      '  1. escribe /fh login     → conecta tu GitHub',
      '  2. escribe /fh search    → busca un match',
      '  3. escribe /fh help      → ver todos los comandos',
      '',
      '────────────────────────────────────────'
    ].join('\\n'), 'sistema');
    entrada.focus();
  </script>
</body>
</html>`;
  }
}

function generarNonce(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let texto = "";
  for (let i = 0; i < 32; i++) {
    texto += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return texto;
}

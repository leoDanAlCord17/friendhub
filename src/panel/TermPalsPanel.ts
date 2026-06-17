import * as vscode from "vscode";
import { ejecutarComando } from "../commands";
import { getUsuarioActual } from "../state";
import { setEmisor } from "../output";

/**
 * Proveedor del webview de TermPals que vive en el panel inferior de VS Code
 * (junto a la Terminal). Renderiza una consola estilo terminal donde el
 * usuario escribe comandos `/tp` y recibe las respuestas.
 */
export class TermPalsPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "termpals.main";

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
        if (respuesta && typeof respuesta === "object" && "modo" in respuesta) {
          webviewView.webview.postMessage({
            tipo: "modo",
            modo: respuesta.modo,
          });
        } else if (
          respuesta &&
          typeof respuesta === "object" &&
          "accion" in respuesta
        ) {
          webviewView.webview.postMessage({
            tipo: "accion",
            accion: respuesta.accion,
          });
        } else {
          const esComando = msg.texto.startsWith("/tp") || msg.texto.startsWith("__BIO__:");
          const texto = respuesta ?? (esComando ? `comando no reconocido: ${msg.texto}` : null);
          if (texto !== null) {
            webviewView.webview.postMessage({ tipo: "salida", texto });
          }
        }
      }
    });

    // Primer arranque sin sesión: dispara el login automáticamente.
    if (!this.loginIntentado && !getUsuarioActual()) {
      this.loginIntentado = true;
      void vscode.commands.executeCommand("tp.login");
    }
  }

  /** Imprime texto en la consola desde el extension host (eventos en vivo). */
  public imprimir(texto: string): void {
    this.view?.webview.postMessage({ tipo: "salida", texto });
  }

  /** Da foco a la vista (usado por el comando mh.open). */
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
  <title>TermPals</title>
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
    #hint {
      display: none;
      color: #d7ba7d;
      font-size: 11px;
      padding: 2px 0 0 14px;
    }
    #hint.visible { display: block; }
    #prompt-fila.edicion { border-top-color: #d7ba7d; }
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
        placeholder="escribe un comando  /tp help" />
    </div>
    <div id="hint"></div>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const output = document.getElementById('output');
    const entrada = document.getElementById('entrada');
    const hint = document.getElementById('hint');
    const fila = document.getElementById('prompt-fila');

    const PLACEHOLDER_NORMAL = 'escribe un comando  /tp help';
    const PLACEHOLDER_BIO = 'escribe tu bio aquí y presiona Enter...';
    let modoEdicion = false;

    // Historial de comandos (solo entradas que empiezan con /tp).
    const MAX_HISTORIAL = 50;
    let historialComandos = [];
    let indiceHistorial = -1;

    function imprimir(texto, clase) {
      const div = document.createElement('div');
      div.className = 'bloque' + (clase ? ' ' + clase : '');
      div.textContent = texto;
      output.appendChild(div);
      output.scrollTop = output.scrollHeight;
    }

    function mostrarBienvenida() {
      imprimir([
        '╔═══════════════════════════════════════╗',
        '║            T E R M P A L S            ║',
        '║       conecta con otros devs          ║',
        '╚═══════════════════════════════════════╝',
        '',
        'v0.1.0  ·  hecho para devs, por devs',
        '',
        'para empezar:',
        '  1. escribe /tp login     → conecta tu GitHub',
        '  2. escribe /tp search    → busca un match',
        '  3. escribe /tp help      → ver todos los comandos',
        '',
        '────────────────────────────────────────'
      ].join('\\n'), 'sistema');
    }

    function limpiarPantalla() {
      output.textContent = '';
      mostrarBienvenida();
    }

    function entrarEdicionBio() {
      modoEdicion = true;
      entrada.placeholder = PLACEHOLDER_BIO;
      hint.textContent = 'modo edición · ESC para cancelar';
      hint.classList.add('visible');
      fila.classList.add('edicion');
      entrada.focus();
    }

    function salirEdicionBio() {
      modoEdicion = false;
      entrada.placeholder = PLACEHOLDER_NORMAL;
      hint.classList.remove('visible');
      fila.classList.remove('edicion');
    }

    function agregarAlHistorial(texto) {
      if (!texto.startsWith('/tp')) { return; }
      if (historialComandos[historialComandos.length - 1] !== texto) {
        historialComandos.push(texto);
        if (historialComandos.length > MAX_HISTORIAL) {
          historialComandos.shift();
        }
      }
      indiceHistorial = -1;
    }

    function enviar() {
      const texto = entrada.value.trim();
      if (!texto) { return; }
      if (modoEdicion) {
        imprimir('> ' + texto, 'eco');
        vscode.postMessage({ tipo: 'comando', texto: '__BIO__:' + texto });
        entrada.value = '';
        salirEdicionBio();
        return;
      }
      imprimir('> ' + texto, 'eco');
      vscode.postMessage({ tipo: 'comando', texto });
      agregarAlHistorial(texto);
      entrada.value = '';
    }

    function historialArriba() {
      if (historialComandos.length === 0) { return; }
      if (indiceHistorial === -1) {
        indiceHistorial = historialComandos.length - 1;
      } else if (indiceHistorial > 0) {
        indiceHistorial--;
      }
      entrada.value = historialComandos[indiceHistorial];
    }

    function historialAbajo() {
      if (indiceHistorial === -1) { return; }
      if (indiceHistorial < historialComandos.length - 1) {
        indiceHistorial++;
        entrada.value = historialComandos[indiceHistorial];
      } else {
        indiceHistorial = -1;
        entrada.value = '';
      }
    }

    entrada.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); enviar(); }
      else if (e.key === 'Escape' && modoEdicion) {
        e.preventDefault();
        entrada.value = '';
        salirEdicionBio();
        imprimir('edición cancelada.', 'sistema');
      }
      else if (e.key === 'ArrowUp' && !modoEdicion) {
        e.preventDefault();
        historialArriba();
      }
      else if (e.key === 'ArrowDown' && !modoEdicion) {
        e.preventDefault();
        historialAbajo();
      }
    });

    window.addEventListener('message', (e) => {
      if (!e.data) { return; }
      if (e.data.tipo === 'salida') { imprimir(e.data.texto); }
      else if (e.data.tipo === 'modo' && e.data.modo === 'edicion_bio') {
        entrarEdicionBio();
      }
      else if (e.data.tipo === 'accion' && e.data.accion === 'clear') {
        limpiarPantalla();
      }
    });

    // Pantalla de bienvenida.
    mostrarBienvenida();
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

import * as vscode from "vscode";
import { ejecutarComando } from "../commands";
import { getUsuarioActual, getOnboardingPaso, setConsentimientoPendiente } from "../state";
import { setEmisor } from "../output";
import { intentarLoginSilencioso } from "../auth/github";
import { escucharInvitacionesEntrantes } from "../websocket/chat";
import { t } from "../i18n";

/**
 * Proveedor del webview de TermPals que vive en el panel inferior de VS Code
 * (junto a la Terminal). Renderiza una consola estilo terminal donde el
 * usuario escribe comandos `/tp` y recibe las respuestas.
 */
export class TermPalsPanel implements vscode.WebviewViewProvider {
  public static readonly viewType = "termpals.main";

  private static readonly CONSENT_KEY = "termpals.consent.shown";

  private view?: vscode.WebviewView;
  private loginIntentado = false;

  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private readonly SPINNER_FRAMES = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  private spinnerIndex = 0;

  public iniciarSpinner(texto: string): void {
    this.spinnerIndex = 0;
    this.view?.webview.postMessage({ tipo: 'spinner_iniciar', texto });
    this.spinnerInterval = setInterval(() => {
      const frame = this.SPINNER_FRAMES[this.spinnerIndex % this.SPINNER_FRAMES.length];
      this.view?.webview.postMessage({ tipo: 'spinner_frame', frame, texto });
      this.spinnerIndex++;
    }, 100);
  }

  public actualizarSpinner(texto: string): void {
    this.view?.webview.postMessage({
      tipo: 'spinner_frame',
      frame: this.SPINNER_FRAMES[this.spinnerIndex % this.SPINNER_FRAMES.length],
      texto,
    });
  }

  public detenerSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.view?.webview.postMessage({ tipo: 'spinner_fin' });
  }

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {}

  private async guardarConsentimiento(): Promise<void> {
    await this.context.globalState.update(TermPalsPanel.CONSENT_KEY, true);
    await this.context.globalState.update(
      "termpals.consent.date",
      new Date().toISOString(),
    );
  }

  private async loginSilenciosoOManual(): Promise<void> {
    this.iniciarSpinner(t('session.verifying'));

    const usuario = await intentarLoginSilencioso(this.context);

    if (usuario) {
      if (!usuario.consentimiento_activo) {
        this.detenerSpinner();
        this.view!.webview.html = this.getConsentHtml();
        return;
      }
      this.actualizarSpinner(t('session.loading'));
      await new Promise(r => setTimeout(r, 300));
      this.detenerSpinner();
      this.imprimir(t('session.restored', usuario.github_login));
      escucharInvitacionesEntrantes(usuario.id);
      if (getOnboardingPaso() === 'busca') {
        this.imprimir([
          t('onboarding.welcome', usuario.github_login),
          '',
          t('onboarding.setup'),
          '',
          t('onboarding.step1_title'),
          '',
          t('onboarding.step1_opt1'),
          t('onboarding.step1_opt2'),
          t('onboarding.step1_opt3'),
          '',
          t('onboarding.step1_prompt'),
        ].join('\n'));
      }
    } else {
      this.detenerSpinner();
      this.view!.webview.html = this.getConsentHtml();
    }
  }

  /** Llamado por VS Code cuando la vista del panel se hace visible. */
  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Permite que cualquier módulo (listeners de Realtime) imprima aquí.
    setEmisor((texto) => this.imprimir(texto));

    // Mostrar el panel terminal inmediatamente para que no quede en blanco.
    webviewView.webview.html = this.getHtml();

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg?.tipo === "consentimiento_aceptado") {
        const granular = msg.granular ?? {
          acepta_perfil: true,
          acepta_stack: true,
          acepta_readme: true,
          acepta_matching: true,
        };
        setConsentimientoPendiente(granular);
        await this.guardarConsentimiento();
        webviewView.webview.html = this.getHtml();
        if (!getUsuarioActual()) {
          void vscode.commands.executeCommand("tp.login");
        }
        return;
      }

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

    // Login en background: decide si mostrar consentimiento o restaurar sesión.
    if (!this.loginIntentado && !getUsuarioActual()) {
      this.loginIntentado = true;
      void this.loginSilenciosoOManual();
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

  /** Muestra la pantalla de consentimiento (llamado desde /tp login cuando no hay sesión). */
  public mostrarConsentimientoSiNecesario(): void {
    this.view!.webview.html = this.getConsentHtml();
  }

  private getConsentHtml(): string {
    const nonce = generarNonce();
    return /* html */ `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>TermPals — Consentimiento</title>
  <style>
    body { padding-bottom: 100px; }
    .botones-fijos {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      background: #0a0d0a;
      border-top: 1px solid #1a3a1a;
      padding: 16px 32px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      z-index: 100;
    }
  </style>
</head>
<body style="margin:0;background:#0a0d0a;font-family:'Courier New',Courier,monospace;color:#9ca3af;font-size:13px;line-height:1.9;padding:20px 24px;min-height:100vh;box-sizing:border-box;">
  <div style="max-width:580px;">

    <div style="color:#4ade80;margin-bottom:2px;">$ termpals --first-run</div>
    <div style="color:#6b7280;margin-bottom:20px;">TermPals v0.1.0 — primera ejecución detectada</div>
    <div style="border-top:1px solid #1a2a1a;margin-bottom:18px;"></div>

    <div style="color:#d1fae5;margin-bottom:10px;">Para usar TermPals necesitamos tu consentimiento (RGPD / GDPR).</div>
    <div style="color:#6b7280;margin-bottom:18px;">
      Tus datos se almacenan en Supabase (servidores en EU). Podés eliminar tu
      cuenta en cualquier momento con <span style="color:#4ade80;">/tp delete</span>.
    </div>

    <div style="color:#9ca3af;margin-bottom:10px;">${t('consent.data_title')}</div>

    <div style="margin-bottom:6px;">
      <input type="checkbox" id="cb-perfil" checked disabled
        style="accent-color:#4ade80;margin-right:8px;" />
      <label for="cb-perfil" style="color:#d4d4d4;">
        Perfil de GitHub (nombre, avatar, ubicación)
      </label>
      <span style="color:#6b7280;font-size:11px;margin-left:6px;">— REQUERIDO</span>
    </div>
    <div style="margin-bottom:6px;">
      <input type="checkbox" id="cb-stack" checked disabled
        style="accent-color:#4ade80;margin-right:8px;" />
      <label for="cb-stack" style="color:#d4d4d4;">
        Stack tecnológico del workspace
      </label>
      <span style="color:#6b7280;font-size:11px;margin-left:6px;">— REQUERIDO para el matching</span>
    </div>
    <div style="margin-bottom:6px;">
      <input type="checkbox" id="cb-readme"
        style="accent-color:#4ade80;margin-right:8px;" />
      <label for="cb-readme" style="color:#d4d4d4;">
        README del proyecto
      </label>
      <span style="color:#6b7280;font-size:11px;margin-left:6px;">— OPCIONAL · podés cambiarlo con /tp readme toggle</span>
    </div>
    <div style="margin-bottom:18px;">
      <input type="checkbox" id="cb-matching" checked disabled
        style="accent-color:#4ade80;margin-right:8px;" />
      <label for="cb-matching" style="color:#d4d4d4;">
        Aparecer en búsquedas de otros usuarios
      </label>
      <span style="color:#6b7280;font-size:11px;margin-left:6px;">— REQUERIDO para usar la app</span>
    </div>

    <div style="color:#9ca3af;margin-bottom:10px;">${t('consent.usage_title')}</div>
    <div style="color:#6b7280;margin-bottom:18px;padding-left:12px;border-left:2px solid #1a2a1a;">
      Usamos tus datos únicamente para hacer matching con otros devs y mantener
      tu perfil activo en la plataforma. No los vendemos ni compartimos con terceros.<br/>
      Conservación: mientras mantengas cuenta activa. Se eliminan con /tp delete.
    </div>

    <div style="color:#9ca3af;margin-bottom:10px;">${t('consent.rights_title')}</div>
    <div style="color:#6b7280;margin-bottom:18px;padding-left:12px;border-left:2px solid #1a2a1a;">
      Acceso · Rectificación · Supresión · Portabilidad · Oposición<br/>
      Contacto: leodanielalvarezcordero@gmail.com<br/>
      Base legal: consentimiento explícito (Art. 6.1.a)
    </div>

    <div id="politica" style="display:none;border:1px solid #1a2a1a;padding:14px;color:#6b7280;font-size:12px;line-height:1.7;margin-bottom:14px;">
      <div style="color:#9ca3af;margin-bottom:8px;">Política de privacidad — TermPals</div>
      <div>Responsable: TermPals (leodanielalvarezcordero@gmail.com)</div>
      <div style="margin-top:6px;">Base legal: consentimiento explícito (RGPD Art. 6.1.a)</div>
      <div style="margin-top:6px;">Transferencias: datos alojados en Supabase (EU-West). No se realizan transferencias fuera del EEE.</div>
      <div style="margin-top:6px;">Derechos: podés ejercerlos escribiendo a leodanielalvarezcordero@gmail.com o usando /tp delete para eliminación completa.</div>
      <div style="margin-top:6px;">Conservación: mientras la cuenta esté activa. Eliminación inmediata con /tp delete.</div>
    </div>

    <div style="color:#374151;font-size:11px;">
      ${t('consent.footer')}
    </div>
  </div>
  <div class="botones-fijos">
    <button id="btn-aceptar"
      style="background:#14532d;color:#4ade80;border:1px solid #16a34a;padding:8px 18px;font-family:inherit;font-size:13px;cursor:pointer;">
      ${t('consent.btn_accept')}
    </button>
    <button id="btn-leer-mas"
      style="background:transparent;color:#6b7280;border:1px solid #374151;padding:8px 18px;font-family:inherit;font-size:13px;cursor:pointer;">
      ${t('consent.btn_policy')}
    </button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-aceptar').addEventListener('click', function() {
      const cbReadme = document.getElementById('cb-readme');
      vscode.postMessage({
        tipo: 'consentimiento_aceptado',
        granular: {
          acepta_perfil: true,
          acepta_stack: true,
          acepta_readme: cbReadme.checked,
          acepta_matching: true
        }
      });
    });
    document.getElementById('btn-leer-mas').addEventListener('click', function() {
      const pol = document.getElementById('politica');
      pol.style.display = pol.style.display === 'none' ? 'block' : 'none';
    });
  </script>
</body>
</html>`;
  }

  private getHtml(): string {
    const nonce = generarNonce();
    const tagline = t('banner.tagline');
    const boxInner = 39;
    const pad = Math.floor((boxInner - tagline.length) / 2);
    const taglineLine = '║' + ' '.repeat(pad) + tagline + ' '.repeat(Math.max(0, boxInner - pad - tagline.length)) + '║';
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
        '${taglineLine}',
        '╚═══════════════════════════════════════╝',
        '',
        'v0.1.0  ·  ${t('banner.tagline_full')}',
        '',
        '${t('banner.start')}',
        '${t('banner.hint1')}',
        '${t('banner.hint2')}',
        '${t('banner.hint3')}',
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

    let spinnerEl = null;

    window.addEventListener('message', (e) => {
      if (!e.data) { return; }
      if (e.data.tipo === 'salida') { imprimir(e.data.texto); }
      else if (e.data.tipo === 'modo' && e.data.modo === 'edicion_bio') {
        entrarEdicionBio();
      }
      else if (e.data.tipo === 'accion' && e.data.accion === 'clear') {
        limpiarPantalla();
      }
      else if (e.data.tipo === 'spinner_iniciar') {
        spinnerEl = document.createElement('div');
        spinnerEl.id = 'tp-spinner';
        spinnerEl.style.cssText = 'color:#6b7280;font-family:monospace;font-size:13px;padding:2px 0;';
        spinnerEl.textContent = '⠋  ' + e.data.texto;
        output.appendChild(spinnerEl);
        output.scrollTop = output.scrollHeight;
      }
      else if (e.data.tipo === 'spinner_frame') {
        const el = document.getElementById('tp-spinner');
        if (el) {
          el.textContent = e.data.frame + '  ' + e.data.texto;
          output.scrollTop = output.scrollHeight;
        }
      }
      else if (e.data.tipo === 'spinner_fin') {
        const el = document.getElementById('tp-spinner');
        if (el) { el.remove(); }
        spinnerEl = null;
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

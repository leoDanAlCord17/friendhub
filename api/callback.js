export default async function handler(req, res) {
  const { code, state } = req.query;

  // ── Helpers de presentación ──────────────────────────────────────────────

  const paginaError = (titulo, mensaje) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TermPals — Error</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #161b18;
      color: #f87171;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: #1e2922;
      border: 1px solid #f8717140;
      border-radius: 8px;
      padding: 32px;
    }
    .logo { color: #4ade80; font-size: 1.1rem; margin-bottom: 24px; }
    h1 { font-size: 1rem; margin-bottom: 16px; }
    p { color: #cbd5e1; font-size: 0.9rem; line-height: 1.6; margin-bottom: 20px; }
    .hint {
      color: #64748b;
      font-size: 0.8rem;
      border-top: 1px solid #2d3a30;
      padding-top: 16px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">▸ TermPals</div>
    <h1>${titulo}</h1>
    <p>${mensaje}</p>
    <p class="hint">Cerrá esta pestaña y volvé a VS Code para intentar /tp login de nuevo.</p>
  </div>
</body>
</html>`;

  const paginaExito = (vscodeUrl) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TermPals — Conectado</title>
  <meta http-equiv="refresh" content="3;url=${vscodeUrl}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #161b18;
      color: #4ade80;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 24px;
    }
    .card {
      max-width: 520px;
      width: 100%;
      background: #1e2922;
      border: 1px solid #4ade8040;
      border-radius: 8px;
      padding: 32px;
    }
    .logo { font-size: 1.1rem; margin-bottom: 24px; }
    h1 { font-size: 1rem; margin-bottom: 16px; }
    p { color: #cbd5e1; font-size: 0.9rem; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">▸ TermPals</div>
    <h1>✓ Autenticación completada</h1>
    <p>Redirigiendo a VS Code... Si no abre automáticamente, <a href="${vscodeUrl}" style="color:#4ade80">hacé click aquí</a>.</p>
  </div>
  <script>window.location.href = ${JSON.stringify(vscodeUrl)};</script>
</body>
</html>`;

  // ── 1. Verificar que GitHub no envió un error en la query ─────────────────

  if (req.query.error) {
    const errCode = req.query.error;
    const mensajes = {
      'access_denied':
        'Cancelaste la autorización en GitHub. Volvé a intentar /tp login cuando quieras.',
      'redirect_uri_mismatch':
        'La URL de redirección no coincide con la configurada en GitHub. Este es un problema de configuración, contactá al desarrollador.',
    };
    const mensaje = mensajes[errCode]
      ?? `GitHub reportó un error: ${req.query.error_description ?? errCode}`;
    return res.status(200).send(paginaError('Error de autorización', mensaje));
  }

  // ── 2. Verificar que llegó el code ────────────────────────────────────────

  if (!code) {
    return res.status(200).send(paginaError(
      'Falta el código de autorización',
      'Asegurate de iniciar el login desde /tp login en VS Code, no accedas a esta URL directamente.'
    ));
  }

  // ── 3. Verificar variables de entorno ─────────────────────────────────────

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI;

  if (!clientId || !clientSecret) {
    console.error('TermPals callback: faltan GITHUB_CLIENT_ID o GITHUB_CLIENT_SECRET en las variables de entorno.');
    return res.status(200).send(paginaError(
      'Error de configuración del servidor',
      'El servidor no está configurado correctamente (faltan credenciales). Contactá al desarrollador.'
    ));
  }

  // ── 4. Intercambio code → access_token con GitHub ─────────────────────────

  const body = { client_id: clientId, client_secret: clientSecret, code };
  if (redirectUri) {
    body.redirect_uri = redirectUri;
  }

  let response;
  try {
    response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    console.error('TermPals callback: error de red al contactar GitHub:', networkError);
    return res.status(200).send(paginaError(
      'Error de conexión',
      'No se pudo conectar con GitHub. Verificá tu conexión e intentá de nuevo.'
    ));
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error('TermPals callback: respuesta no-JSON de GitHub:', parseError);
    return res.status(200).send(paginaError(
      'Respuesta inesperada',
      'GitHub devolvió una respuesta inesperada. Intentá de nuevo en unos minutos.'
    ));
  }

  console.log('TermPals callback: respuesta GitHub:', {
    error: data.error ?? null,
    token: data.access_token ? 'ok' : 'ausente',
  });

  // ── 5. Si GitHub devolvió un error en el JSON ─────────────────────────────

  if (data.error) {
    const mensajes = {
      'bad_verification_code':
        'El código de autorización expiró o ya fue usado. Volvé a intentar /tp login desde VS Code.',
      'incorrect_client_credentials':
        'Error de configuración del servidor (credenciales incorrectas). Contactá al desarrollador.',
    };
    const mensaje = mensajes[data.error]
      ?? `GitHub rechazó la solicitud: ${data.error_description ?? data.error}`;
    return res.status(200).send(paginaError('Error al obtener el token', mensaje));
  }

  // ── 6. Éxito: redirigir a VS Code ─────────────────────────────────────────

  const vscodeUrl = `vscode://leodanielalvarez.termpals/callback` +
    `?access_token=${encodeURIComponent(data.access_token)}&state=${encodeURIComponent(state ?? '')}`;
  return res.status(200).send(paginaExito(vscodeUrl));
}

export default async function handler(req, res) {
  const { code, state } = req.query;

  // ── Helpers de presentación ──────────────────────────────────────────────

  const paginaError = (titulo, mensaje) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TermPals</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #0a0d0a;
      min-height: 100vh;
      padding: 32px;
    }
    .linea { font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
    .prompt { color: #4ade80; }
    .progreso { color: #6b7280; }
    .error { color: #f87171; margin-top: 8px; }
    .mensaje { color: #9ca3af; margin-top: 8px; max-width: 600px; }
    .hint { color: #6b7280; margin-top: 24px; font-size: 13px; }
  </style>
</head>
<body>
  <div class="linea prompt">$ /tp login --provider github</div>
  <div class="linea progreso">&gt; conectando con github.com...</div>
  <div class="linea error">[ERROR] ${titulo}</div>
  <div class="linea mensaje">${mensaje}</div>
  <div class="linea hint">&gt; cerrá esta pestaña y volvé a VS Code para intentar /tp login de nuevo</div>
</body>
</html>`;

  const paginaExito = (vscodeUrl) => `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TermPals</title>
  <meta http-equiv="refresh" content="3;url=${vscodeUrl}">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Courier New', Courier, monospace;
      background: #0a0d0a;
      min-height: 100vh;
      padding: 32px;
    }
    .linea { font-size: 14px; line-height: 1.8; white-space: pre-wrap; }
    .prompt { color: #4ade80; }
    .progreso { color: #6b7280; }
    .ok { color: #4ade80; margin-top: 8px; }
    .redirigiendo { color: #6b7280; margin-top: 16px; }
    .link { color: #4ade80; margin-top: 24px; }
    .link a { color: #4ade80; text-decoration: underline; }
    @keyframes blink { 0%,50%{opacity:1} 51%,100%{opacity:0} }
    .cursor { animation: blink 1s infinite; }
  </style>
</head>
<body>
  <div class="linea prompt">$ /tp login --provider github</div>
  <div class="linea progreso">&gt; conectando con github.com...</div>
  <div class="linea progreso">&gt; intercambiando código de autorización...</div>
  <div class="linea progreso">&gt; verificando token...</div>
  <div class="linea ok">[OK] autenticación completada</div>
  <div class="linea redirigiendo">redirigiendo a vs code<span class="cursor">_</span></div>
  <div class="linea link">&gt; <a href="${vscodeUrl}">abrir vs code manualmente</a></div>
  <script>
    setTimeout(() => { window.location.href = ${JSON.stringify(vscodeUrl)}; }, 1500);
  </script>
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

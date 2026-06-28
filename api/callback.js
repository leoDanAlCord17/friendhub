export default async function handler(req, res) {
  const { code, state } = req.query;

  // ── Idioma (extraído del state=UUID|lang) ────────────────────────────────
  const [, langFromState] = (state ?? '').split('|');
  const lang = langFromState === 'en' ? 'en' : 'es';

  const i18n = {
    es: {
      cmd:               '$ /tp login --provider github',
      connecting:        '&gt; conectando con github.com...',
      exchanging:        '&gt; intercambiando código de autorización...',
      verifying:         '&gt; verificando token...',
      ok:                '[OK] autenticación completada',
      redirecting:       'redirigiendo a vs code',
      manual:            '&gt; abrir vs code manualmente',
      error_title:       'Error de verificación',
      error_footer:      'Cerrá esta pestaña y volvé a VS Code para intentar /tp login de nuevo.',
      access_denied:     'Cancelaste la autorización en GitHub. Volvé a intentar /tp login cuando quieras.',
      redirect_mismatch: 'La URL de redirección no coincide con la configurada en GitHub. Contactá al desarrollador.',
      missing_code:      'Asegurate de iniciar el login desde /tp login en VS Code, no accedas a esta URL directamente.',
      missing_code_title:'Falta el código de autorización',
      no_config:         'El servidor no está configurado correctamente. Contactá al desarrollador.',
      no_config_title:   'Error de configuración',
      network_error:     'No se pudo conectar con GitHub. Verificá tu conexión e intentá de nuevo.',
      network_title:     'Error de conexión',
      parse_error:       'GitHub devolvió una respuesta inesperada. Intentá de nuevo en unos minutos.',
      parse_title:       'Respuesta inesperada',
      bad_code:          'El código de autorización expiró o ya fue usado. Volvé a intentar /tp login.',
      bad_code_title:    'Código inválido',
      bad_creds:         'Error de configuración del servidor (credenciales incorrectas). Contactá al desarrollador.',
      bad_creds_title:   'Error de credenciales',
      generic_error:     'GitHub rechazó la solicitud',
    },
    en: {
      cmd:               '$ /tp login --provider github',
      connecting:        '&gt; connecting to github.com...',
      exchanging:        '&gt; exchanging authorization code...',
      verifying:         '&gt; verifying token...',
      ok:                '[OK] authentication complete',
      redirecting:       'redirecting to vs code',
      manual:            '&gt; open vs code manually',
      error_title:       'Verification error',
      error_footer:      'Close this tab and return to VS Code to try /tp login again.',
      access_denied:     'You cancelled the GitHub authorization. Try /tp login again whenever you want.',
      redirect_mismatch: 'The redirect URL does not match the one configured in GitHub. Contact the developer.',
      missing_code:      'Make sure to start login from /tp login in VS Code, do not access this URL directly.',
      missing_code_title:'Missing authorization code',
      no_config:         'The server is not configured correctly. Contact the developer.',
      no_config_title:   'Configuration error',
      network_error:     'Could not connect to GitHub. Check your connection and try again.',
      network_title:     'Connection error',
      parse_error:       'GitHub returned an unexpected response. Try again in a few minutes.',
      parse_title:       'Unexpected response',
      bad_code:          'The authorization code expired or was already used. Try /tp login again.',
      bad_code_title:    'Invalid code',
      bad_creds:         'Server configuration error (incorrect credentials). Contact the developer.',
      bad_creds_title:   'Credentials error',
      generic_error:     'GitHub rejected the request',
    },
  };

  const tx = i18n[lang];

  // ── Helpers de presentación ──────────────────────────────────────────────

  const paginaError = (titulo, mensaje) => `<!DOCTYPE html>
<html lang="${lang}">
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
  <div class="linea prompt">${tx.cmd}</div>
  <div class="linea progreso">${tx.connecting}</div>
  <div class="linea error">[ERROR] ${titulo}</div>
  <div class="linea mensaje">${mensaje}</div>
  <div class="linea hint">${tx.error_footer}</div>
</body>
</html>`;

  const paginaExito = (vscodeUrl) => `<!DOCTYPE html>
<html lang="${lang}">
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
  <div class="linea prompt">${tx.cmd}</div>
  <div class="linea progreso">${tx.connecting}</div>
  <div class="linea progreso">${tx.exchanging}</div>
  <div class="linea progreso">${tx.verifying}</div>
  <div class="linea ok">${tx.ok}</div>
  <div class="linea redirigiendo">${tx.redirecting}<span class="cursor">_</span></div>
  <div class="linea link"><a href="${vscodeUrl}">${tx.manual}</a></div>
  <script>
    setTimeout(() => { window.location.href = ${JSON.stringify(vscodeUrl)}; }, 1500);
  </script>
</body>
</html>`;

  // ── 1. Verificar que GitHub no envió un error en la query ─────────────────

  if (req.query.error) {
    const errCode = req.query.error;
    const mensajes = {
      'access_denied':       tx.access_denied,
      'redirect_uri_mismatch': tx.redirect_mismatch,
    };
    const mensaje = mensajes[errCode]
      ?? `${tx.generic_error}: ${req.query.error_description ?? errCode}`;
    return res.status(200).send(paginaError(tx.error_title, mensaje));
  }

  // ── 2. Verificar que llegó el code ────────────────────────────────────────

  if (!code) {
    return res.status(200).send(paginaError(tx.missing_code_title, tx.missing_code));
  }

  // ── 3. Verificar variables de entorno ─────────────────────────────────────

  const clientId     = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri  = process.env.REDIRECT_URI;

  if (!clientId || !clientSecret) {
    console.error('TermPals callback: faltan GITHUB_CLIENT_ID o GITHUB_CLIENT_SECRET en las variables de entorno.');
    return res.status(200).send(paginaError(tx.no_config_title, tx.no_config));
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
    return res.status(200).send(paginaError(tx.network_title, tx.network_error));
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    console.error('TermPals callback: respuesta no-JSON de GitHub:', parseError);
    return res.status(200).send(paginaError(tx.parse_title, tx.parse_error));
  }

  console.log('TermPals callback: respuesta GitHub:', {
    error: data.error ?? null,
    token: data.access_token ? 'ok' : 'ausente',
  });

  // ── 5. Si GitHub devolvió un error en el JSON ─────────────────────────────

  if (data.error) {
    const mensajes = {
      'bad_verification_code':        tx.bad_code,
      'incorrect_client_credentials': tx.bad_creds,
    };
    const mensaje = mensajes[data.error]
      ?? `${tx.generic_error}: ${data.error_description ?? data.error}`;
    return res.status(200).send(paginaError(tx.error_title, mensaje));
  }

  // ── 6. Éxito: redirigir a VS Code ─────────────────────────────────────────

  const vscodeUrl = `vscode://leodanielalvarez.termpals/callback` +
    `?access_token=${encodeURIComponent(data.access_token)}&state=${encodeURIComponent(state ?? '')}`;
  return res.status(200).send(paginaExito(vscodeUrl));
}

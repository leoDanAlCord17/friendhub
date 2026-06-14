export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'code requerido' });
  }

  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.REDIRECT_URI;

  console.log('Variables:', {
    clientId: clientId ? 'ok' : 'FALTA',
    clientSecret: clientSecret ? 'ok' : 'FALTA',
    redirectUri
  });

  try {
    const body = {
      client_id: clientId,
      client_secret: clientSecret,
      code,
    };

    // Solo agrega redirect_uri si está definido
    if (redirectUri) {
      body.redirect_uri = redirectUri;
    }

    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await response.json();

    console.log('Respuesta GitHub:', data);

    if (data.error) {
      return res.status(200).send(`
        <html>
        <body style="font-family:monospace;background:#1e1e1e;color:#e06c75;
        display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center">
          <h2>MeetHub</h2>
          <p>Puedes cerrar esta pestaña y volver a VS Code.</p>
        </div>
        </body>
        </html>
      `);
    }

    const vscodeUrl = `vscode://leodanielalvarez.meethub/callback?access_token=${data.access_token}&state=${state ?? ''}`;
    res.redirect(302, vscodeUrl);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

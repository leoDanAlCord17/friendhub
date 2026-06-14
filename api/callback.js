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
      return res.status(400).json({
        error: data.error,
        description: data.error_description
      });
    }

    const vscodeUrl = `vscode://leodanielalvarez.meethub/callback?access_token=${data.access_token}&state=${state ?? ''}`;
    res.redirect(302, vscodeUrl);

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
}

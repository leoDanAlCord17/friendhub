export default async function handler(req, res) {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'code requerido' });
  }

  try {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.REDIRECT_URI
      })
    });

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error_description });
    }

    // Redirigir a la extensión con el token
    const redirectUrl = `vscode://leodanielalvarez.meethub/callback?access_token=${data.access_token}&state=${state}`;
    res.redirect(302, redirectUrl);

  } catch (error) {
    res.status(500).json({ error: 'Error interno' });
  }
}

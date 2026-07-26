export interface Env {
  IG_APP_ID: string;
  IG_APP_SECRET: string;
  ADMIN_KEY: string;
  TOKENS: KVNamespace;
}

const THANK_YOU_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Connected</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background:#faf8f5; color:#171717; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; }
  .card { text-align:center; padding: 40px; }
  h1 { font-size: 22px; margin-bottom: 8px; }
  p { color:#6b655f; font-size: 15px; }
</style>
</head>
<body>
  <div class="card">
    <h1>You're all set ✅</h1>
    <p>Your Instagram account is connected. You can close this tab now.</p>
  </div>
</body>
</html>`;

const ERROR_PAGE = (message: string) => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Something went wrong</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center;">
  <h1>Something went wrong</h1>
  <p>${message}</p>
</body>
</html>`;

async function exchangeCodeForShortLivedToken(
  code: string,
  redirectUri: string,
  env: Env,
): Promise<string> {
  const body = new URLSearchParams({
    client_id: env.IG_APP_ID,
    client_secret: env.IG_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });

  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`Short-lived token exchange failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { data?: Array<{ access_token: string }>; access_token?: string };
  const token = data.data?.[0]?.access_token ?? data.access_token;
  if (!token) throw new Error('No access_token in short-lived token response.');
  return token;
}

async function exchangeForLongLivedToken(shortLivedToken: string, env: Env): Promise<string> {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', env.IG_APP_SECRET);
  url.searchParams.set('access_token', shortLivedToken);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Long-lived token exchange failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/admin') {
      if (url.searchParams.get('key') !== env.ADMIN_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      const list = await env.TOKENS.list();
      const entries = await Promise.all(
        list.keys.map(async (k) => ({
          client: k.name,
          value: JSON.parse((await env.TOKENS.get(k.name)) || '{}'),
        })),
      );
      return new Response(JSON.stringify(entries, null, 2), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') || 'default';

    if (!code) {
      return new Response(ERROR_PAGE('Missing authorization code.'), {
        status: 400,
        headers: { 'Content-Type': 'text/html' },
      });
    }

    try {
      const redirectUri = `${url.origin}${url.pathname}`;
      const shortLived = await exchangeCodeForShortLivedToken(code, redirectUri, env);
      const longLived = await exchangeForLongLivedToken(shortLived, env);

      await env.TOKENS.put(
        state,
        JSON.stringify({ accessToken: longLived, obtainedAt: new Date().toISOString() }),
      );

      return new Response(THANK_YOU_PAGE, { headers: { 'Content-Type': 'text/html' } });
    } catch (err) {
      return new Response(ERROR_PAGE((err as Error).message), {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      });
    }
  },
};

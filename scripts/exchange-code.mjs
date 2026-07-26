// Manual fallback: exchange an OAuth "code" for a long-lived Instagram access token.
// Usage: IG_APP_ID=... IG_APP_SECRET=... node scripts/exchange-code.mjs "<code>" "<redirect_uri>"

const [, , code, redirectUri] = process.argv;
const { IG_APP_ID, IG_APP_SECRET } = process.env;

if (!code || !redirectUri || !IG_APP_ID || !IG_APP_SECRET) {
  console.error(
    'Usage: IG_APP_ID=... IG_APP_SECRET=... node scripts/exchange-code.mjs "<code>" "<redirect_uri>"',
  );
  process.exit(1);
}

async function exchangeShortLived() {
  const body = new URLSearchParams({
    client_id: IG_APP_ID,
    client_secret: IG_APP_SECRET,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Short-lived exchange failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.data?.[0]?.access_token ?? data.access_token;
}

async function exchangeLongLived(shortLived) {
  const url = new URL('https://graph.instagram.com/access_token');
  url.searchParams.set('grant_type', 'ig_exchange_token');
  url.searchParams.set('client_secret', IG_APP_SECRET);
  url.searchParams.set('access_token', shortLived);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`Long-lived exchange failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return data.access_token;
}

const shortLived = await exchangeShortLived();
const longLived = await exchangeLongLived(shortLived);
console.log('Long-lived access token (60 days):');
console.log(longLived);

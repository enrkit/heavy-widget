import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const MEDIA_LIMIT = Number(process.env.IG_MEDIA_LIMIT || 24);

if (!IG_ACCESS_TOKEN) {
  console.error('Missing IG_ACCESS_TOKEN env var.');
  process.exit(1);
}

async function refreshToken(token) {
  const url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token refresh failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.access_token;
}

async function fetchMedia(token, limit) {
  const fields = 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp';
  const url = `https://graph.instagram.com/me/media?fields=${fields}&limit=${limit}&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Media fetch failed (${res.status}): ${body}`);
  }
  const data = await res.json();
  return data.data || [];
}

async function main() {
  let token = IG_ACCESS_TOKEN;
  let tokenRefreshed = false;

  try {
    const refreshed = await refreshToken(token);
    if (refreshed && refreshed !== token) {
      if (process.env.GITHUB_ACTIONS) {
        console.log(`::add-mask::${refreshed}`);
      }
      token = refreshed;
      tokenRefreshed = true;
      console.log('Access token refreshed.');
    }
  } catch (err) {
    console.warn('Token refresh failed, continuing with existing token:', err.message);
  }

  const media = await fetchMedia(token, MEDIA_LIMIT);

  const photos = media
    .filter((m) => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM')
    .map((m) => ({
      id: m.id,
      caption: m.caption || '',
      imageUrl: m.media_type === 'CAROUSEL_ALBUM' ? (m.thumbnail_url || m.media_url) : m.media_url,
      permalink: m.permalink,
      timestamp: m.timestamp,
    }));

  const outDir = path.join(process.cwd(), 'data');
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, 'feed.json'),
    `${JSON.stringify({ updatedAt: new Date().toISOString(), photos }, null, 2)}\n`,
  );

  console.log(`Wrote ${photos.length} photos to data/feed.json`);

  if (tokenRefreshed && process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `token_refreshed=true\n`);
    await appendFile(process.env.GITHUB_OUTPUT, `new_token=${token}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

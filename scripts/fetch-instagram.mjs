import { mkdir, writeFile, appendFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const IG_ACCESS_TOKEN = process.env.IG_ACCESS_TOKEN;
const MEDIA_LIMIT = Number(process.env.IG_MEDIA_LIMIT || 24);
// Displayed at 420px wide in the marquee; 880px gives headroom for ~2x/retina
// screens without shipping Instagram's full original resolution (often 1-2MB).
const MAX_WIDTH = 880;
const CDN_BASE = 'https://cdn.jsdelivr.net/gh/enrkit/heavy-widget@main/data/images';

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

async function downloadAndCompress(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const before = buf.length;
  const webp = await sharp(buf)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toBuffer();
  await mkdir(path.dirname(destPath), { recursive: true });
  await writeFile(destPath, webp);
  return { before, after: webp.length };
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

  const rawPhotos = media
    .filter((m) => m.media_type === 'IMAGE' || m.media_type === 'CAROUSEL_ALBUM')
    .map((m) => ({
      id: m.id,
      caption: m.caption || '',
      sourceUrl: m.media_type === 'CAROUSEL_ALBUM' ? (m.thumbnail_url || m.media_url) : m.media_url,
      permalink: m.permalink,
      timestamp: m.timestamp,
    }));

  const imagesDir = path.join(process.cwd(), 'data', 'images');
  await rm(imagesDir, { recursive: true, force: true });

  let totalBefore = 0;
  let totalAfter = 0;
  const photos = [];

  for (const p of rawPhotos) {
    const filename = `${p.id}.webp`;
    const destPath = path.join(imagesDir, filename);
    try {
      const { before, after } = await downloadAndCompress(p.sourceUrl, destPath);
      totalBefore += before;
      totalAfter += after;
      photos.push({
        id: p.id,
        caption: p.caption,
        imageUrl: `${CDN_BASE}/${filename}`,
        permalink: p.permalink,
        timestamp: p.timestamp,
      });
      console.log(`  ${p.id}: ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB`);
    } catch (err) {
      console.warn(`  ${p.id}: compression failed (${err.message}), falling back to original URL`);
      photos.push({
        id: p.id,
        caption: p.caption,
        imageUrl: p.sourceUrl,
        permalink: p.permalink,
        timestamp: p.timestamp,
      });
    }
  }

  if (totalBefore) {
    console.log(`Image recompression: ${(totalBefore / 1024 / 1024).toFixed(2)}MB -> ${(totalAfter / 1024 / 1024).toFixed(2)}MB`);
  }

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

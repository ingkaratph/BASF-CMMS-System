import { readFile, writeFile, mkdir, stat, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, '..');
const seedFile = join(root, 'server', 'part-image-seeds.json');
const mapFile = join(root, 'server', 'part-images.json');
const reportFile = join(root, 'server', 'part-images-sync-report.json');
const publicDir = join(root, 'public', 'part-images');
const distDir = join(root, 'dist', 'part-images');

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [k, ...rest] = arg.replace(/^--/, '').split('=');
  return [k, rest.length ? rest.join('=') : true];
}));
const delayMs = Math.max(150, Number(args.delay || 800));
const limit = args.limit ? Math.max(1, Number(args.limit)) : Infinity;
const force = Boolean(args.force);
const onlyFailed = Boolean(args['only-failed']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const compact = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const words = (s) => clean(s).toLowerCase().split(/[^a-z0-9]+/).filter((x) => x.length >= 3);
const uniq = (arr) => [...new Set(arr)];
const safeSlug = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72);
const csv = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"').replace(/&#34;/g, '"')
    .replace(/&amp;/g, '&').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

function timeoutSignal(ms = 16000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

async function fetchText(url, extraHeaders = {}) {
  const t = timeoutSignal();
  try {
    const res = await fetch(url, {
      signal: t.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        ...extraHeaders,
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { t.clear(); }
}

function parseBingImageResults(html) {
  const out = [];
  const re = /<a[^>]+class="[^"]*iusc[^"]*"[^>]+m="([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const obj = JSON.parse(decodeEntities(m[1]));
      if (obj.murl) out.push({
        imageUrl: obj.murl,
        sourceUrl: obj.purl || '',
        title: clean(obj.t || obj.desc || ''),
        engine: 'bing-images',
      });
    } catch {}
  }
  // Alternate JSON pattern sometimes present in Bing HTML.
  if (!out.length) {
    const alt = /\{[^{}]*?"murl"\s*:\s*"([^"]+)"[^{}]*?"purl"\s*:\s*"([^"]*)"[^{}]*?\}/gi;
    while ((m = alt.exec(html))) {
      const dec = (x) => x.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').replace(/\\u0026/gi, '&');
      out.push({ imageUrl: dec(m[1]), sourceUrl: dec(m[2]), title: '', engine: 'bing-images-alt' });
    }
  }
  return out;
}

async function bingImages(query) {
  const url = `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC3&first=1&count=35`;
  const html = await fetchText(url);
  return parseBingImageResults(html);
}

function parseWebLinks(html) {
  const links = [];
  const blockRe = /<li[^>]+class="[^"]*b_algo[^"]*"[\s\S]*?<h2[^>]*>[\s\S]*?<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = blockRe.exec(html))) {
    const url = decodeEntities(m[1]);
    const title = clean(m[2].replace(/<[^>]+>/g, ' '));
    if (/^https?:\/\//i.test(url)) links.push({ url, title });
    if (links.length >= 8) break;
  }
  return links;
}

function metaImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i,
    /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/i,
    /"image"\s*:\s*"(https?:\\?\/\\?\/[^"\\]+(?:\\.[a-zA-Z]{2,5})?[^"\\]*)"/i,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return decodeEntities(m[1]).replace(/\\\//g, '/');
  }
  return '';
}

function htmlTitle(html) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? clean(decodeEntities(m[1].replace(/<[^>]+>/g, ' '))) : '';
}

async function bingWebOgImages(query) {
  const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=8`;
  const html = await fetchText(url);
  const links = parseWebLinks(html);
  const out = [];
  for (const link of links.slice(0, 5)) {
    try {
      const page = await fetchText(link.url);
      const imageUrl = metaImage(page);
      if (imageUrl) out.push({ imageUrl, sourceUrl: link.url, title: htmlTitle(page) || link.title, engine: 'bing-web-og' });
    } catch {}
  }
  return out;
}

const preferredDomains = ['siemens.com','sieportal.siemens.com','festo.com','smcworld.com','smcpneumatics.com','ifm.com','abb.com','omron.com','keyence.com','sick.com','turck.com','bannerengineering.com','honeywell.com','ckd.co.jp','mitsubishielectric.com','deltaww.com','wenglor.com','misumi','digikey','mouser','rs-online','radwell'];
const weakDomains = ['pinterest.','facebook.','instagram.','tiktok.','aliexpress.','shopee.','lazada.'];

function scoreCandidate(seed, c) {
  const hay = clean(`${c.title} ${c.sourceUrl} ${c.imageUrl}`).toLowerCase();
  const hayCompact = compact(hay);
  const model = clean(seed.Description);
  const modelCompact = compact(model);
  const brand = clean(seed.Brand).toLowerCase();
  const pname = clean(seed.PartName).toLowerCase();
  let score = 0;
  let exactModel = false;

  if (modelCompact.length >= 4 && hayCompact.includes(modelCompact)) { score += 115; exactModel = true; }
  const mt = uniq(words(model)).filter((x) => /\d/.test(x) || x.length >= 4);
  if (mt.length) {
    const hit = mt.filter((x) => hayCompact.includes(compact(x))).length;
    score += (hit / mt.length) * 65;
  }
  if (brand && brand !== '-' && hay.includes(brand)) score += 25;
  const pt = uniq(words(pname)).filter((x) => !['part','parts','set','assy','assembly','spare'].includes(x));
  if (pt.length) {
    const hit = pt.filter((x) => hay.includes(x)).length;
    score += Math.min(18, (hit / pt.length) * 18);
  }
  const src = c.sourceUrl.toLowerCase();
  if (preferredDomains.some((d) => src.includes(d))) score += 12;
  if (weakDomains.some((d) => src.includes(d))) score -= 20;
  if (/logo|icon|banner|placeholder|noimage|no-image/i.test(c.imageUrl)) score -= 35;
  return { score, exactModel };
}

async function downloadImage(candidate, dest, referer = '') {
  const t = timeoutSignal(20000);
  try {
    const res = await fetch(candidate.imageUrl, {
      signal: t.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36',
        'accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
        ...(referer ? { referer } : {}),
      },
    });
    if (!res.ok) throw new Error(`image HTTP ${res.status}`);
    const type = (res.headers.get('content-type') || '').toLowerCase();
    if (type && !type.startsWith('image/')) throw new Error(`not image (${type})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1500 || buf.length > 15_000_000) throw new Error(`bad size ${buf.length}`);
    await sharp(buf, { failOn: 'none' })
      .rotate()
      .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(dest);
    const info = await sharp(dest).metadata();
    if (!info.width || !info.height || info.width < 80 || info.height < 80) throw new Error('image too small');
    return { bytes: buf.length, width: info.width, height: info.height };
  } finally { t.clear(); }
}

async function saveMaps(entries) {
  const tmp = mapFile + '.tmp';
  await writeFile(tmp, JSON.stringify(entries, null, 2), 'utf8');
  await writeFile(mapFile, await readFile(tmp));
}

function confidenceFrom(score, exact) {
  if (exact) return Math.min(100, Math.round(92 + Math.min(8, (score - 100) / 10)));
  return Math.max(60, Math.min(89, Math.round(55 + score / 3)));
}

async function main() {
  await mkdir(publicDir, { recursive: true });
  if (existsSync(join(root, 'dist'))) await mkdir(distDir, { recursive: true });
  const seeds = JSON.parse(await readFile(seedFile, 'utf8'));
  let mappings = existsSync(mapFile) ? JSON.parse(await readFile(mapFile, 'utf8')) : [];
  const byId = new Map();
  for (const e of mappings) for (const id of e.ids || []) byId.set(String(id), e);
  let previousReport = { results: [] };
  if (existsSync(reportFile)) {
    try { previousReport = JSON.parse(await readFile(reportFile, 'utf8')); } catch {}
  }
  const oldStatus = new Map((previousReport.results || []).map((r) => [String(r.PartID), r.status]));
  const results = [];
  let attempted = 0, matched = 0, skipped = 0, failed = 0;

  console.log(`CMMS Spare Part Image Sync`);
  console.log(`Root: ${root}`);
  console.log(`Seeds: ${seeds.length} | delay=${delayMs}ms | limit=${limit === Infinity ? 'ALL' : limit}`);
  console.log('Search source: Bing Images -> Bing Web/OG fallback');
  console.log('----------------------------------------------------------------');

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const pid = String(seed.PartID);
    const existing = byId.get(pid);
    const existingPath = existing?.file ? join(publicDir, existing.file) : '';
    if (!force && existing && existingPath && existsSync(existingPath)) {
      results.push({ PartID: pid, status: 'existing', file: existing.file, matchType: existing.matchType || 'EXISTING', confidence: existing.confidence ?? 100 });
      matched++;
      continue;
    }
    if (onlyFailed && !['failed','unmatched'].includes(oldStatus.get(pid))) continue;
    if (!seed.Searchable || !seed.Query) {
      results.push({ PartID: pid, status: 'skipped', reason: 'no searchable text' });
      skipped++;
      continue;
    }
    if (attempted >= limit) break;
    attempted++;
    const label = `${seed.Brand || ''} ${seed.Description || seed.PartName}`.trim();
    process.stdout.write(`[${i + 1}/${seeds.length}] PartID ${pid} ${label.slice(0, 72)} ... `);
    try {
      const query = `${seed.Query} product`;
      let candidates = [];
      try { candidates = await bingImages(query); } catch (e) { console.log(`image-search error: ${e.message}`); }
      if (!candidates.length) {
        try { candidates = await bingWebOgImages(query); } catch {}
      }
      const ranked = candidates
        .map((c) => ({ ...c, ...scoreCandidate(seed, c) }))
        .sort((a, b) => b.score - a.score);

      const minScore = seed.StrongModel ? 42 : (seed.Brand ? 62 : 78);
      let chosen = null, imageInfo = null, file = '';
      for (const c of ranked.slice(0, 8)) {
        if (c.score < minScore) break;
        const stem = safeSlug(`${pid}-${seed.Brand}-${seed.Description || seed.PartName}`) || `part-${pid}`;
        file = `${stem}.webp`;
        const dest = join(publicDir, file);
        try {
          imageInfo = await downloadImage(c, dest, c.sourceUrl);
          chosen = c;
          if (existsSync(join(root, 'dist'))) await copyFile(dest, join(distDir, file));
          break;
        } catch {}
      }
      if (!chosen) {
        // If image search had no downloadable result, try product pages and OG images.
        let webCandidates = [];
        try { webCandidates = await bingWebOgImages(query); } catch {}
        const rankedWeb = webCandidates.map((c) => ({ ...c, ...scoreCandidate(seed, c) })).sort((a,b) => b.score-a.score);
        for (const c of rankedWeb.slice(0, 5)) {
          if (c.score < minScore) break;
          const stem = safeSlug(`${pid}-${seed.Brand}-${seed.Description || seed.PartName}`) || `part-${pid}`;
          file = `${stem}.webp`;
          const dest = join(publicDir, file);
          try {
            imageInfo = await downloadImage(c, dest, c.sourceUrl);
            chosen = c;
            if (existsSync(join(root, 'dist'))) await copyFile(dest, join(distDir, file));
            break;
          } catch {}
        }
      }

      if (!chosen) {
        console.log('SKIP (no confident/downloadable image)');
        results.push({ PartID: pid, status: 'unmatched', query });
        failed++;
      } else {
        const conf = confidenceFrom(chosen.score, chosen.exactModel);
        const matchType = chosen.exactModel || chosen.score >= 105 ? 'EXACT' : 'CLOSE';
        const entry = {
          ids: [pid],
          model: seed.Description || '',
          brand: seed.Brand || '',
          partName: seed.PartName || '',
          partCode: seed.PartCode || '',
          sapMaterial: seed.SAPMaterial || '',
          file,
          source: chosen.sourceUrl || '',
          imageSource: chosen.imageUrl,
          caption: `ภาพอ้างอิง ${seed.Brand || ''} ${seed.PartName || ''} · ${seed.Description || seed.PartCode || pid}`.replace(/\s+/g,' ').trim(),
          matchByIdOnly: true,
          matchType,
          confidence: conf,
          searchEngine: chosen.engine,
          mappedAt: new Date().toISOString(),
        };
        // Replace current reference mapping for this PartID only; media uploads remain separate.
        mappings = mappings.filter((e) => !(e.ids || []).map(String).includes(pid));
        mappings.push(entry);
        byId.set(pid, entry);
        await saveMaps(mappings);
        console.log(`${matchType} ${conf}% -> ${file}`);
        results.push({ PartID: pid, status: 'matched', matchType, confidence: conf, file, source: chosen.sourceUrl, imageSource: chosen.imageUrl, query, score: Math.round(chosen.score) });
        matched++;
      }
    } catch (e) {
      console.log(`ERROR ${e.message}`);
      results.push({ PartID: pid, status: 'failed', error: e.message });
      failed++;
    }
    const report = { updatedAt: new Date().toISOString(), totalSeeds: seeds.length, attempted, matched, skipped, failed, results };
    await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');
    await sleep(delayMs);
  }

  // Include rows not touched in this run from previous report, useful when running with --limit.
  const currentIds = new Set(results.map((r) => String(r.PartID)));
  for (const r of previousReport.results || []) if (!currentIds.has(String(r.PartID))) results.push(r);
  const report = { updatedAt: new Date().toISOString(), totalSeeds: seeds.length, attempted, matched, skipped, failed, results };
  await writeFile(reportFile, JSON.stringify(report, null, 2), 'utf8');

  const csvRows = [['PartID','status','matchType','confidence','file','source','query','error'], ...results.map((r) => [r.PartID,r.status,r.matchType||'',r.confidence??'',r.file||'',r.source||'',r.query||'',r.error||''])];
  await writeFile(join(root, 'server', 'part-images-sync-report.csv'), csvRows.map((row) => row.map(csv).join(',')).join('\r\n'), 'utf8');
  console.log('----------------------------------------------------------------');
  console.log(`Finished. attempted=${attempted}, matched/existing=${matched}, skipped=${skipped}, unmatched/failed=${failed}`);
  console.log(`Mapping: ${mapFile}`);
  console.log(`Report : ${reportFile}`);
  console.log('Refresh the CMMS page. The patched mapper reloads part-images.json automatically.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });

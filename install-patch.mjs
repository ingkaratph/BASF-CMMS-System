import { readFile, writeFile, mkdir, copyFile, cp, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const patchRoot = dirname(fileURLToPath(import.meta.url));
const target = resolve(process.argv[2] || process.cwd());
const stamp = new Date().toISOString().replace(/[:.]/g,'-');
const backup = join(target, `backup_part_images_${stamp}`);
await mkdir(backup, { recursive: true });

async function backupFile(rel) {
  const src = join(target, rel);
  if (!existsSync(src)) return;
  const dst = join(backup, rel);
  await mkdir(dirname(dst), { recursive: true });
  await copyFile(src, dst);
}
for (const rel of ['server/part-images.json','server/part-images.mjs','server/part-image-seeds.json','scripts/sync-part-images.mjs']) await backupFile(rel);

// Merge mappings so existing/manual references are preserved unless this patch has the same PartID.
const targetMap = join(target, 'server', 'part-images.json');
let current = [];
try { current = JSON.parse(await readFile(targetMap,'utf8')); } catch {}
const patchEntries = JSON.parse(await readFile(join(patchRoot,'server','part-images.json'),'utf8'));
const patchIds = new Set(patchEntries.flatMap((e) => (e.ids || []).map(String)));
const merged = current.filter((e) => !(e.ids || []).some((id) => patchIds.has(String(id))));
merged.push(...patchEntries);
await mkdir(join(target,'server'), { recursive: true });
await writeFile(targetMap, JSON.stringify(merged,null,2),'utf8');

for (const rel of ['server/part-images.mjs','server/part-image-seeds.json','scripts/sync-part-images.mjs','run_full_image_sync.bat','retry_unmatched_images.bat','README_FULL_PATCH.txt']) {
  const src=join(patchRoot,rel), dst=join(target,rel);
  await mkdir(dirname(dst),{recursive:true});
  await copyFile(src,dst);
}
if (existsSync(join(patchRoot,'mapping'))) {
  await mkdir(join(target,'mapping'),{recursive:true});
  await cp(join(patchRoot,'mapping'),join(target,'mapping'),{recursive:true,force:true});
}
for (const folder of ['public/part-images','dist/part-images']) {
  const src=join(patchRoot,folder), dst=join(target,folder);
  if (existsSync(src)) { await mkdir(dst,{recursive:true}); await cp(src,dst,{recursive:true,force:true}); }
}
console.log(`Patch installed: ${target}`);
console.log(`Backup: ${backup}`);
console.log('Next: run run_full_image_sync.bat inside the CMMS root, or:');
console.log('node scripts\\sync-part-images.mjs');

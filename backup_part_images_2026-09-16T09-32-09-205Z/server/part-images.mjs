import { readFileSync, statSync } from 'node:fs';

const jsonUrl = new URL('./part-images.json', import.meta.url);
let cachedMtime = -1;
let cachedImages = new Map();
let lastCheck = 0;

const normalize = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function loadImages() {
  const now = Date.now();
  if (now - lastCheck < 1000 && cachedImages.size) return cachedImages;
  lastCheck = now;
  try {
    const mtime = statSync(jsonUrl).mtimeMs;
    if (mtime === cachedMtime && cachedImages.size) return cachedImages;
    const entries = JSON.parse(readFileSync(jsonUrl, 'utf8'));
    cachedImages = new Map(entries.flatMap((entry) => (entry.ids || []).map((id) => [String(id), entry])));
    cachedMtime = mtime;
  } catch {
    // Keep the previous valid map if the JSON is temporarily being replaced.
  }
  return cachedImages;
}

export function addPartReference(row) {
  const image = loadImages().get(String(row.PartID));
  if (!image) return row;
  if (!image.matchByIdOnly && image.model && normalize(row.Description) !== normalize(image.model)) return row;
  const referenceUrl = image.file ? '/part-images/' + image.file : image.imageSource;
  if (!referenceUrl) return row;
  return {
    ...row,
    ReferenceImageUrl: referenceUrl,
    ReferenceSourceUrl: image.source || image.imageSource || '',
    ReferenceCaption: image.caption || '',
    ReferenceImageMatchType: image.matchType || '',
    ReferenceImageConfidence: image.confidence ?? null,
  };
}

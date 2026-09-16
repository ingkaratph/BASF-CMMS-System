CMMS SPARE PART IMAGE FULL PATCH — 1,204 ITEMS

Purpose
- Uses SparPartMaster.xlsx (1,204 rows) as the complete seed list.
- Tries every searchable part.
- Exact model/brand matches get priority.
- Close product/series images are accepted when confidence is sufficient.
- Ambiguous or non-downloadable results are skipped rather than forcing a bad image.
- Existing mapped images are preserved/skipped.
- Sync can be rerun and resumes from completed images.

INSTALL
Option A (recommended):
1. Extract this ZIP anywhere.
2. Run install_patch.bat.
3. Enter your CMMS root, e.g. C:\Users\Administrator\Documents\ChatGPT\CMMS
4. Go to the CMMS root and run run_full_image_sync.bat.

Option B:
- Copy server/, scripts/, public/, dist/ and run_full_image_sync.bat into the CMMS root, then run the BAT.

WHAT THE SYNC DOES
1. Reads server/part-image-seeds.json (all 1,204 rows).
2. Searches by Brand + Description/Model + PartName.
3. Scores result relevance.
4. Downloads the best confident result.
5. Converts it to WebP <= 800x800 with Sharp.
6. Saves to public/part-images and dist/part-images.
7. Writes the mapping to server/part-images.json.
8. Writes server/part-images-sync-report.csv/json.

IMPORTANT
- Internet access is required while run_full_image_sync.bat is running.
- The process is deliberately rate-limited. With 1,204 rows it can take a while.
- If Bing temporarily blocks/rate-limits searches, stop and run retry_unmatched_images.bat later.
- The patch changes part-images.mjs so new mappings are reloaded automatically; normally a browser refresh is enough after sync.
- Uploaded user images still have higher priority because mediaStore enrichment runs after reference-image mapping in the existing CMMS backend.

FILES
server/part-image-seeds.json        Complete 1,204-row search list
server/part-images.json             Existing verified mapping baseline
server/part-images.mjs              Dynamic/reload mapper
scripts/sync-part-images.mjs        Full auto search/download/map script
mapping/all-parts-search-seeds.csv  Human-readable master/search queries
run_full_image_sync.bat             Run all
retry_unmatched_images.bat          Retry failed/unmatched only

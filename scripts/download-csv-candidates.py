import json,urllib.request,concurrent.futures
from pathlib import Path
root=Path(__file__).resolve().parent.parent/'artifacts'/'csv-photo-review'
rows=json.loads((root/'search-candidates.json').read_text(encoding='utf-8'))
rows += json.loads((root/'sensor-candidates.json').read_text(encoding='utf-8'))
def download(row):
 try:
  file=row['PartID']+'-'+row['model'].lower()+'.source'
  if not (root/file).exists():
   with urllib.request.urlopen(row['imageSource'],timeout=20) as response:
    data=response.read(10_000_001)
    if not response.headers.get('Content-Type','').startswith('image/') or not 1000<len(data)<10_000_000:raise ValueError('Invalid image')
    (root/file).write_bytes(data)
  return dict(row,download=file,status='CANDIDATE')
 except Exception as e:return dict(row,status='SKIPPED',reason=str(e))
with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:result=list(pool.map(download,rows))
(root/'search-downloads.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'model':r['model'],'status':r['status'],'reason':r.get('reason')} for r in result]))

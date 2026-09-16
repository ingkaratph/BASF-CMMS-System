"""Collect candidate product photos from vendor product pages; review before publishing."""
import csv, json, re, html, urllib.request, urllib.parse, concurrent.futures
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'artifacts' / 'csv-photo-review'
OUT.mkdir(parents=True, exist_ok=True)
rows = list(csv.DictReader(open(r'C:\Users\Administrator\Downloads\cmms-spare-parts-2026-09-16.csv', encoding='utf-8-sig')))
def fetch(url):
    req=urllib.request.Request(url, headers={})
    with urllib.request.urlopen(req, timeout=25) as response:
        return response.read(12_000_000), response.headers.get('Content-Type','')
def collect(row):
    brand,model=row['Brand'].upper(),row['Description'].strip()
    if brand=='IFM' and re.fullmatch(r'[A-Z]{2,3}\d{3,4}',model):
        url='https://www.ifm.com/ca/en/product/'+model
    elif brand=='OMRON' and re.fullmatch(r'[A-Z0-9]+(?:-[A-Z0-9]+)*',model):
        url='https://industrial.omron.eu/en/products/'+model
    else:return None
    result={'id':row['PartID'],'partCode':row['PartCode'],'name':row['PartName'],'brand':row['Brand'],'model':model,'source':url}
    try:
        body,_=fetch(url);text=body.decode('utf-8')
        title=html.unescape(re.search(r'<title[^>]*>(.*?)</title>',text,re.S).group(1)).strip()
        if model.lower() not in title.lower():raise ValueError('Product model not confirmed in page title')
        if brand=='IFM':
            image=re.search(r'<meta property="og:image" content="([^"]+)"',text).group(1)
        else:
            tags=re.findall(r'<img[^>]+>',text)
            tag=next(t for t in tags if 'loading="eager"' in t and 'tinifycdn' in t)
            image=re.search(r'\bsrc="([^"]+)"',tag).group(1)
        image=html.unescape(image)
        data,mime=fetch(image)
        if not mime.startswith('image/') or len(data)<1000:raise ValueError('Missing product photo')
        file=row['PartID']+'-'+model.lower()+'.source'
        (OUT/file).write_bytes(data)
        result.update(imageSource=image,download=file,title=title,status='CANDIDATE')
    except Exception as e:result.update(status='SKIPPED',reason=str(e))
    return result
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results=[r for r in pool.map(collect,rows) if r]
(OUT/'candidates.json').write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(results,ensure_ascii=False,indent=2))

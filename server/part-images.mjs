import {readFileSync} from 'node:fs';
const entries=JSON.parse(readFileSync(new URL('./part-images.json',import.meta.url),'utf8'));
const images=new Map(entries.flatMap(entry=>entry.ids.map(id=>[id,entry])));
const normalize=v=>String(v||'').replace(/\s/g,'').toLowerCase();
export function addPartReference(row){
 const image=images.get(String(row.PartID));
 if(!image||normalize(row.Description)!==normalize(image.model))return row;
 return {...row,ReferenceImageUrl:'/part-images/'+image.file,ReferenceSourceUrl:image.source,ReferenceCaption:image.caption};
}

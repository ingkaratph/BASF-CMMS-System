// PriceText is the source supplied by the inventory owner. Reject ambiguous text.
const currencyCode=token=>({บาท:'THB','฿':'THB','€':'EUR','$':'USD'}[token]||token?.toUpperCase()||'');
function parsePrice(value){
 // Duplicate SQL column names can produce arrays; never interpret them as money.
 if(typeof value!=='string'&&typeof value!=='number')return null;
 const match=String(value??'').trim().match(/^(?:(THB|EUR|USD|บาท|฿|€|\$)\s*)?((?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?)(?:\s*(THB|EUR|USD|บาท|฿|€|\$))?$/i);
 if(!match)return null;
 const before=currencyCode(match[1]),after=currencyCode(match[3]);
 if(before&&after&&before!==after)return null;
 const n=Number(match[2].replaceAll(',',''));return Number.isFinite(n)&&n>=0?{price:n,currency:before||after}:null;
}
export function parsePriceText(value){return parsePrice(value)?.price??null}
export function valueInventory(rows,asOf=new Date().toISOString()){
 const groups=new Map();let missingPrice=0,invalidQuantity=0,zeroPrice=0,inStock=0,assumedCurrency=0;
 const details=rows.map(row=>{
  const quantity=row.Quantity===null||row.Quantity===undefined||String(row.Quantity).trim()===''?null:Number(row.Quantity);
  const parsed=parsePrice(row.PriceText),explicit=String(row.CurrencyCode||'').trim().toUpperCase();
  const price=explicit&&parsed?.currency&&explicit!==parsed.currency?null:parsed?.price??null,currency=explicit||parsed?.currency||'THB';
  const hasQuantity=quantity!==null&&Number.isFinite(quantity)&&quantity>=0;
  if(!hasQuantity)invalidQuantity++;
  if(hasQuantity&&quantity>0){inStock++;if(price===null)missingPrice++;if(price===0)zeroPrice++;if(!explicit&&!parsed?.currency)assumedCurrency++}
  const rawAmount=hasQuantity&&(quantity===0||price!==null)?quantity*(price||0):null;
  const amount=rawAmount!==null&&Number.isFinite(rawAmount)?Math.round(rawAmount*100)/100:null;
  if(amount!==null){const g=groups.get(currency)||{currency,value:0,pricedItems:0};g.value=Math.round((g.value+amount)*100)/100;if(quantity>0)g.pricedItems++;groups.set(currency,g)}
  return {PartID:String(row.PartID),PartCode:row.PartCode,PartName:row.PartName,Department:row.Department||'ไม่ระบุ',Quantity:hasQuantity?quantity:null,PriceText:row.PriceText??null,UnitPrice:price,CurrencyCode:currency,Value:amount};
 });
 return {asOf,basis:'inv.Part.PriceText',defaultCurrency:'THB',rowCount:rows.length,inStock,missingPrice,invalidQuantity,zeroPrice,assumedCurrency,totals:[...groups.values()].sort((a,b)=>a.currency.localeCompare(b.currency)),details};
}
export function bangkokMonth(date){return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit'}).format(new Date(date))}

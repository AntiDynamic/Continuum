import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
import {lookup,changeStock} from './catalog.ts';
import {computeTotal,computeFee} from './pricing.ts';
import {find,save,markCancelled} from './store.ts';
export function reserve(db:DatabaseSync,input:ReserveInput):Receipt {
 const existing=find(db,input.tenantId,input.requestId);
 if(existing)return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existing.total_cents,feeCents:existing.fee_cents};
 if(!Array.isArray(input.items)||input.items.length===0)throw new Error('EMPTY_ITEMS');
 for(const item of input.items)if(!Number.isSafeInteger(item.quantity)||item.quantity<=0)throw new Error('INVALID_QUANTITY');
 db.exec('BEGIN IMMEDIATE');
 try {
  const existingInTx=find(db,input.tenantId,input.requestId);
  if(existingInTx){db.exec('COMMIT');return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existingInTx.total_cents,feeCents:existingInTx.fee_cents};}
  const quantities=new Map<string,number>();
  for(const item of input.items)quantities.set(item.sku,(quantities.get(item.sku)??0)+item.quantity);
  const lines=[...quantities].map(([sku,quantity])=>{const row=lookup(db,input.tenantId,sku);if(!row)throw new Error('UNKNOWN_SKU');if(row.stock<quantity)throw new Error('INSUFFICIENT_STOCK');return {sku,quantity,unitPriceCents:row.unit_price_cents};});
  const totalCents=computeTotal(lines),receipt={reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents,feeCents:computeFee(totalCents)};
  for(const line of lines)changeStock(db,input.tenantId,line.sku,-line.quantity);
  save(db,{...input,items:lines.map(({sku,quantity})=>({sku,quantity}))},receipt);db.exec('COMMIT');return receipt;
 } catch(error){try{db.exec('ROLLBACK');}catch{} throw error;}
}
export function cancel(db:DatabaseSync,tenantId:string,requestId:string):boolean {
 db.exec('BEGIN IMMEDIATE');
 try {const row=find(db,tenantId,requestId);if(!row||row.status!=='active'){db.exec('COMMIT');return false;}
  for(const item of JSON.parse(row.items_json) as Array<{sku:string;quantity:number}>)changeStock(db,tenantId,item.sku,item.quantity);
  const result=markCancelled(db,tenantId,requestId);db.exec('COMMIT');return result;
 } catch(error){try{db.exec('ROLLBACK');}catch{} throw error;}
}

import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
import {lookup,changeStock} from './catalog.ts';
import {computeTotal,computeFee} from './pricing.ts';
import {find,save} from './store.ts';
export function reserve(db:DatabaseSync,input:ReserveInput):Receipt {
 const existing=find(db,input.tenantId,input.requestId);
 if(existing)return {reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents:existing.total_cents,feeCents:existing.fee_cents};
 if(!Array.isArray(input.items)||input.items.length===0)throw new Error('EMPTY_ITEMS');
 const lines=input.items.map(item=>{if(!Number.isInteger(item.quantity)||item.quantity<=0)throw new Error('INVALID_QUANTITY');const row=lookup(db,input.tenantId,item.sku);if(!row)throw new Error('UNKNOWN_SKU');return {sku:item.sku,quantity:item.quantity,stock:row.stock,unitPriceCents:row.unit_price_cents};});
 const requested=new Map<string,number>();for(const line of lines)requested.set(line.sku,(requested.get(line.sku)??0)+line.quantity);
 for(const line of lines)if((requested.get(line.sku)??0)>line.stock)throw new Error('INSUFFICIENT_STOCK');
 const totalCents=computeTotal(lines),receipt={reservationId:`r-${input.tenantId}-${input.requestId}`,totalCents,feeCents:computeFee(totalCents)};
 db.exec('BEGIN');try{for(const [sku,quantity] of requested)changeStock(db,input.tenantId,sku,-quantity);save(db,input,receipt);db.exec('COMMIT');return receipt;}catch(error){db.exec('ROLLBACK');throw error;}
}
export function cancel(db:DatabaseSync,tenantId:string,requestId:string):boolean {const row=find(db,tenantId,requestId);if(!row||row.status!=='active')return false;db.exec('BEGIN');try{for(const item of JSON.parse(row.items_json) as Array<{sku:string;quantity:number}>)changeStock(db,tenantId,item.sku,item.quantity);const result=db.prepare("UPDATE reservations SET status='cancelled' WHERE tenant_id=? AND request_id=? AND status='active'").run(tenantId,requestId);if(result.changes!==1){db.exec('ROLLBACK');return false;}db.exec('COMMIT');return true;}catch(error){db.exec('ROLLBACK');throw error;}}

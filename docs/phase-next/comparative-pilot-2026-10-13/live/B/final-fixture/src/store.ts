import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput,Receipt} from './types.ts';
export function find(db:DatabaseSync,tenantId:string,requestId:string) {
 return db.prepare('SELECT * FROM reservations WHERE tenant_id=? AND request_id=?').get(tenantId,requestId) as {tenant_id:string;request_id:string;items_json:string;total_cents:number;fee_cents:number;status:string}|undefined;
}
export function save(db:DatabaseSync,input:ReserveInput,receipt:Receipt) {
 db.prepare('INSERT INTO reservations(tenant_id,request_id,items_json,total_cents,fee_cents,status) VALUES(?,?,?,?,?,?)').run(input.tenantId,input.requestId,JSON.stringify(input.items),receipt.totalCents,receipt.feeCents,'active');
}

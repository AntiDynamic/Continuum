import type {DatabaseSync} from 'node:sqlite';
import type {ReserveInput} from './types.ts';
import {reserve,cancel} from './service.ts';
export function createApi(db:DatabaseSync) {
 return {reserve(input:ReserveInput){return Promise.resolve().then(()=>reserve(db,input));},cancel(tenantId:string,requestId:string){return Promise.resolve().then(()=>cancel(db,tenantId,requestId));}};
}

export function computeTotal(lines:Array<{quantity:number;unitPriceCents:number}>):number {
 return lines.reduce((total,line)=>total+line.quantity,0);
}
export function computeFee(totalCents:number):number {return 50;}

export function computeTotal(lines:Array<{quantity:number;unitPriceCents:number}>):number {
 return lines.reduce((total,line)=>total+line.quantity*line.unitPriceCents,0);
}
export function computeFee(totalCents:number):number {return totalCents<10000?25:0;}

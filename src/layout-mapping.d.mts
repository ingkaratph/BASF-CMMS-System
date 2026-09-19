import type {Row} from './api';
export interface LayoutItem {id:string;name:string;category:string;kind:string;h:number;w:number;d:number;x:number;y:number;z?:number;}
export interface LayoutEntry {id:string;kind:string;assets:Row[];workOrders:Row[];activeCount:number|null;state:string;aliases:string[];}
export const layoutTags:Record<string,string[]>;
export const layoutAreas:Record<string,string[]>;
export function mapLayout(items:LayoutItem[],assets:Row[]|undefined,workOrders:Row[]|undefined):{entries:LayoutEntry[];matchedObjects:number;unmappedAssets:Row[];unmappedWorkOrders:Row[]};

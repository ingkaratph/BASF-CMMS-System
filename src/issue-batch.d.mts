export function issueSequentially<T extends {state:string}>(lines:T[],send:(line:T)=>Promise<unknown>,result:(line:T,state:'saved'|'uncertain',error?:unknown)=>void):Promise<number>;

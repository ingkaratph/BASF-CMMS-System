import {config} from 'dotenv';
// The launcher may override the listener, but the saved project API credentials
// must take precedence over obsolete credentials inherited from the desktop.
const listener={PORT:process.env.PORT,HOST:process.env.HOST};
config({override:true});
for(const [key,value] of Object.entries(listener))if(value!==undefined)process.env[key]=value;
await import('../server/index.mjs');

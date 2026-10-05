#!/usr/bin/env node
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const [command,argument='{}',vault]=process.argv.slice(2);
const allowed=['capabilities','list_models','inspect','preview','commit','explain','discard','export','receipts'];
if(!allowed.includes(command)){console.error('Usage: node request.mjs <command> <JSON | @request.json | -> [vault-name]');process.exit(2);}
try{
 const body=argument==='-'?fs.readFileSync(0,'utf8'):argument.startsWith('@')?fs.readFileSync(argument.slice(1),'utf8'):argument;
 const request=JSON.parse(body);
 const binary=process.env.NOTECALC_OBSIDIAN_BINARY??(process.platform==='darwin'?'/Applications/Obsidian.app/Contents/MacOS/Obsidian':'obsidian');
 const result=execFileSync(binary,[...(vault?['vault='+vault]:[]),'notecalc:'+command,'request='+JSON.stringify(request)],{encoding:'utf8',timeout:15000,maxBuffer:4_000_000});
 const response=JSON.parse(result.trim());
 process.stdout.write(JSON.stringify(response,null,2)+'\n');if(response.ok!==true)process.exitCode=1;
}catch(error){console.error(JSON.stringify({ok:false,error:{code:'RUNTIME_UNAVAILABLE',message:String(error)},offlineFallback:false}));process.exitCode=1;}

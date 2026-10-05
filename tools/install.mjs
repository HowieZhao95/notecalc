import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const vault=process.argv[2];
if(!vault||!path.isAbsolute(vault))throw new Error('Usage: node tools/install.mjs /absolute/vault/path');
await fs.access(path.join(vault,'.obsidian'));
const destination=path.join(vault,'.obsidian/plugins/notecalc');
try{await fs.access(destination);await fs.cp(destination,path.join(root,'backups','plugin-'+Date.now()),{recursive:true});}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.mkdir(destination,{recursive:true});
for(const name of ['main.js','main.js.map','styles.css','manifest.json'])await fs.copyFile(path.join(root,name),path.join(destination,name));
console.log(JSON.stringify({installed:destination,enableCommand:'notecalc'}));

import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(process.argv[2]||'dist');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(m=>m[1]);
if(html.includes('/src/main.tsx')||assets.length<2)throw new Error('Missing compiled entrypoint');
for(const asset of assets){
 const file=resolve(root,'.'+asset);
 if(!file.startsWith(root+'/assets/')||!existsSync(file))throw new Error(`Build references a missing asset: ${asset}`);
}
console.log('Verified compiled HTML and all referenced assets');

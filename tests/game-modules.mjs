import {readFile,mkdir,writeFile} from 'node:fs/promises';
import ts from 'typescript';
const dir=new URL('../outputs/game-tests/',import.meta.url);await mkdir(dir,{recursive:true});
for(const name of ['engine','session']){
 const source=await readFile(new URL(`../app/games/${name}.ts`,import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("from './engine'","from './engine.js'");
 await writeFile(new URL(`${name}.js`,dir),code);
}
export const {GameEngine,shapeCells,fits,validState}=await import(new URL('engine.js',dir));
export const {GameSession}=await import(new URL('session.js',dir));

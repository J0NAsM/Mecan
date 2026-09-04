import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';

const source=process.argv[2]&&path.resolve(process.argv[2]);
const confirmed=process.argv.includes('--confirm');
if(!source||!fs.existsSync(source))throw new Error('Uso: npm run restore -- <backup.db> --confirm');
if(!confirmed)throw new Error('La restauración reemplaza la base activa. Agregue --confirm después de detener el servidor.');
const check=new DatabaseSync(source,{readOnly:true});
const integrity=check.prepare('PRAGMA integrity_check').get();check.close();
if(integrity.integrity_check!=='ok')throw new Error('El archivo no supera PRAGMA integrity_check.');
const target=path.resolve(config.databasePath);
fs.mkdirSync(path.dirname(target),{recursive:true});
if(fs.existsSync(target))fs.copyFileSync(target,`${target}.before-restore-${Date.now()}`);
fs.copyFileSync(source,target);
console.log(`Base restaurada en ${target}. Se conservó una copia previa cuando existía.`);

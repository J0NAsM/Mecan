import fs from 'node:fs';
import path from 'node:path';
import { config } from '../src/config.js';
import { openDatabase } from '../src/db.js';

const source=path.resolve(config.databasePath);
const directory=path.resolve(process.argv[2]||'backups');
fs.mkdirSync(directory,{recursive:true});
const stamp=new Date().toISOString().replace(/[:.]/g,'-');
const target=path.join(directory,`mecan-${stamp}.db`);
const escaped=target.replaceAll("'","''");
const db=openDatabase(source);
db.exec(`VACUUM INTO '${escaped}'`);
db.close();
console.log(`Backup consistente creado: ${target}`);

import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const data=readFileSync('config/scenarios.json','utf8');
const page=readFileSync('page.html','utf8').replace('__SCENARIOS__',data.replace(/</g,'\\u003c'));
const samples=Object.fromEntries(readdirSync('samples').map(f=>['/samples/'+f,readFileSync('samples/'+f,'utf8')]));
const zip=execFileSync('python3',['-c',`import zipfile,io,base64,pathlib
b=io.BytesIO()
with zipfile.ZipFile(b,'w',zipfile.ZIP_DEFLATED) as z:
 for name in ['page.html','server.template.mjs','package.json','README.md','.env.example','.gitignore','LICENSE']:
  z.write(name)
 for directory in ['scripts','config','samples']:
  for p in pathlib.Path(directory).rglob('*'):
   if p.is_file():z.write(p)
print(base64.b64encode(b.getvalue()).decode())`],{maxBuffer:10*1024*1024}).toString().trim();
const source=readFileSync('server.template.mjs','utf8').replace('__DATA__',data).replace('__PAGE__',JSON.stringify(page)).replace('__SAMPLES__',JSON.stringify(samples)).replace('__ARCHIVE__',zip);
mkdirSync('worker',{recursive:true});writeFileSync('worker/index.js',source);
mkdirSync('dist/server',{recursive:true});mkdirSync('dist/.openai',{recursive:true});writeFileSync('dist/server/index.js',source);writeFileSync('dist/.openai/hosting.json',existsSync('.openai/hosting.json')?readFileSync('.openai/hosting.json'):JSON.stringify({d1:null,r2:null}));
console.log('Built Worker and downloadable source archive.');

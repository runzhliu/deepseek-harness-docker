const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict'),net=require('node:net');
const {chromium}=require(process.env.DSH_UI_PLAYWRIGHT_MODULE);
const name='dsh-superagent-capture';
const version=process.env.DSH_UI_VERSION, revision=process.env.DSH_UI_REVISION;
assert(/^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version));assert(/^r[1-9][0-9]*$/.test(revision));
const image=`ghcr.io/runzhliu/deepseek-harness:${version}-${revision}-superagent.1`;
const run=args=>cp.execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
(async()=>{
 const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));
 run(['run','-d','--name',name,'--label','purpose=superagent-public-screenshot','--publish',`127.0.0.1:${port}:3080`,'--read-only','--tmpfs','/tmp:rw,noexec,nosuid,nodev,size=512m','--tmpfs','/workspace:rw,nosuid,nodev,size=512m,uid=1000,gid=1000','--tmpfs','/home/node/.dsh:rw,nosuid,nodev,size=512m,uid=1000,gid=1000','--shm-size','1g','--cap-drop','ALL','--security-opt','no-new-privileges:true','--env',`DSH_SUPERAGENT_PUBLIC_PORT=${port}`,image]);
 assert.equal(run(['exec',name,'dsh','--version']),version);
 let token;for(let i=0;i<90;i++){const logs=run(['logs',name]);token=[...logs.matchAll(/dsh web: http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s)]+)/g)].at(-1)?.[1];if(token)break;await new Promise(r=>setTimeout(r,1000));}assert(token);
 const browser=await chromium.launch({headless:true,executablePath:process.env.DSH_UI_BROWSER_EXECUTABLE});
 try{
  const page=await browser.newPage({locale:'zh-CN',colorScheme:'light',viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?token=${encodeURIComponent(token)}`,{waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor({timeout:30000});
  for(let i=0;i<20;i++){
   await page.waitForTimeout(500);
   for(const name of ['继续','稍后配置']) {const b=page.getByRole('button',{name,exact:true});if(await b.isVisible())await b.click();}
   const dialogs=page.getByRole('dialog');for(const d of await dialogs.all()){const close=d.getByRole('button',{name:'关闭',exact:true});if(await close.isVisible())await close.click();}
  }


  await page.getByRole('button',{name:'账号菜单',exact:true}).click();await page.getByRole('menuitem',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'通用设置',exact:true}).click();await page.getByRole('button',{name:'浅色',exact:true}).click();await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.getByRole('button',{name:'Superagent',exact:true}).click();
  await page.getByRole('tab',{name:'概览',exact:true}).waitFor();await page.waitForTimeout(1200);
  const data=await page.evaluate(async()=>{const r=await fetch('/orchestrator/api/state',{headers:{'x-orchestrator-request':'1'}});return {status:r.status,state:await r.json()}});assert.equal(data.status,200);assert.equal(data.state.paused,true);assert.equal(data.state.load.running,0);assert.equal(data.state.setup.accounts,null);assert.deepEqual(errors,[]);
  await page.screenshot({path:'assets/deepseek-harness-superagent.png'});
  const provenance=JSON.parse(fs.readFileSync('assets/capture-provenance.json','utf8'));provenance.superagentCapture={capturedAt:new Date().toISOString(),runtimeVersion:version,imageReference:image,theme:'light',temporaryStateOnly:true,modelConfigured:false,modelRequestsMade:false};fs.writeFileSync('assets/capture-provenance.json',JSON.stringify(provenance,null,2)+'\n');
  console.log(JSON.stringify({lightScreenshot:true,paused:true,workers:0,accountsConfigured:false,modelRequestsMade:false,jsErrors:errors.length}));
 }finally{await browser.close()}
})().catch(e=>{console.error(String(e.stack||e.message).replace(/([?&]token=)[^\s"'<>]+/g,'$1[REDACTED]'));process.exitCode=1}).finally(()=>{try{run(['rm','-f',name])}catch{}});

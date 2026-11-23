const {chromium} = require(process.env.DSH_UI_PLAYWRIGHT_MODULE || 'playwright');
const {execFileSync} = require('node:child_process');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const version = process.argv[2];
assert(typeof version === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(version), 'pass the exact DSH version');
const marketVersion = process.env.DSH_UI_MARKET_VERSION;
assert(typeof marketVersion === 'string' && /^[0-9]+\.[0-9]+\.[0-9]+$/.test(marketVersion), 'set the pinned DSH_UI_MARKET_VERSION');
const container = 'dsh-readme-ui';
const outputDir = process.env.DSH_UI_OUTPUT || 'assets';
const releaseUrl = 'https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v' + version;
fs.mkdirSync(outputDir, {recursive:true});
(async () => {
  const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
  assert.equal(info.Config.Labels.purpose,'dsh-readme-verification');
  assert(info.Mounts.every(m=>m.Type==='tmpfs'),'screenshots must not use host data or persistent volumes');
  assert.equal(info.HostConfig.ReadonlyRootfs,true);
  assert.equal(info.HostConfig.Privileged,false);
  assert(info.HostConfig.CapDrop.includes('ALL'));
  assert(['node','1000','1000:1000'].includes(info.Config.User));
  assert(Object.values(info.NetworkSettings.Ports).flatMap(x=>x||[]).every(x=>x.HostIp==='127.0.0.1'),'only loopback ports are allowed');
  assert.equal(execFileSync('docker',['exec',container,'dsh','--version'],{encoding:'utf8'}).trim(),version);
  let token;
  for(let attempt=0;attempt<240;attempt++) {
    token=execFileSync('docker',['logs',container],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).match(/\?token=([^\s)]+)/)?.[1];
    if(token) break;
    await new Promise(resolve=>setTimeout(resolve,500));
  }
  assert(token);
  const browser = await chromium.launch({headless:true, ...(process.env.DSH_UI_BROWSER_EXECUTABLE ? {executablePath:process.env.DSH_UI_BROWSER_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900},locale:'zh-CN',colorScheme:'light'});
    const errors=[];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:3179/?token=${encodeURIComponent(token)}`);
    const notice=page.getByRole('button',{name:'继续',exact:true});
    const later=page.getByRole('button',{name:'稍后配置',exact:true});
    await page.getByRole('button',{name:'账号菜单',exact:true}).waitFor();
    await page.waitForTimeout(1000);
    await notice.waitFor({state:'visible',timeout:20000}).catch(()=>{});
    if(await notice.isVisible()) {
      await notice.click();
      await notice.waitFor({state:'hidden'});
      await page.waitForTimeout(600);
    }
    if(await later.isVisible()) {
      await later.click();
      await later.waitFor({state:'hidden'});
    }
    const start=page.getByRole('dialog',{name:'开始使用',exact:true});
    await start.waitFor({state:'visible',timeout:15000}).catch(()=>{});
    if(await start.isVisible()) await start.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'账号菜单',exact:true}).click();
    await page.getByRole('menuitem',{name:'设置',exact:true}).click();
    await page.getByRole('button',{name:'通用设置',exact:true}).click();
    await page.getByRole('button',{name:'浅色',exact:true}).click();
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    if(!await page.getByRole('tree',{name:'会话',exact:true}).getByText('demo-project',{exact:true}).isVisible()) {
      await page.getByRole('button',{name:'添加工作区',exact:true}).click();
      const picker=page.getByRole('dialog',{name:'选择工作区目录',exact:true});
      await picker.getByRole('button',{name:'demo-project',exact:true}).click();
      await picker.getByRole('button',{name:'打开',exact:true}).click();
      await picker.waitFor({state:'hidden'});
    }
    await page.getByRole('tree',{name:'会话',exact:true}).getByText('demo-project',{exact:true}).waitFor();
    await page.getByRole('button',{name:'选择工作区',exact:true}).click();
    await page.getByRole('menuitem',{name:'demo-project',exact:true}).click();
    await page.getByRole('button',{name:'请选择模型',exact:true}).waitFor();
    const providerStatus=await page.evaluate(async()=>{
      const method='session/modelCatalog';
      const r=await fetch('/api/'+method,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({type:'client-request',rpcId:crypto.randomUUID(),method,payload:{args:{}}})});
      const body=await r.json();
      return {status:r.status,ok:body.result?.ok,hasGroups:Array.isArray(body.result?.value?.groups)};
    });
    assert.deepEqual(providerStatus,{status:200,ok:true,hasGroups:true},'authenticated model catalog must return a successful RPC result');
    const more=page.getByRole('navigation',{name:'全局面板',exact:true}).getByRole('button',{name:'更多',exact:true});
    await more.click();
    const entryMenu=page.getByRole('menu');
    await entryMenu.getByRole('menuitem').first().waitFor();
    const entryLabels=await entryMenu.getByRole('menuitem').allTextContents();
    assert.equal(entryLabels.length,2,'navigation More menu should offer browsing and creation');
    assert(entryLabels.some(x=>x.includes('浏览')) && entryLabels.some(x=>x.includes('创建')));
    console.log('Navigation More menu:',entryLabels);
    await page.keyboard.press('Escape');
    await entryMenu.waitFor({state:'hidden'});
    await page.getByRole('button',{name:'账号菜单',exact:true}).click();
    await page.getByRole('menuitem',{name:'设置',exact:true}).click();
    await page.getByRole('button',{name:'插件市场',exact:true}).click();
    await page.getByText(`v${marketVersion}`,{exact:true}).waitFor();
    await page.getByRole('button',{name:'安装',exact:true}).first().waitFor({timeout:60000});
    const loading=page.getByText(/正在读取宿主要求/);
    for(let attempt=0;attempt<120 && await loading.count();attempt++) await page.waitForTimeout(500);
    assert.equal(await loading.count(),0,'market compatibility metadata must finish loading');
    await page.screenshot({path:path.join(outputDir,'plugin-market-webui.png')});
    await page.getByRole('button',{name:'关闭',exact:true}).click();
    await page.waitForTimeout(1000);
    console.log('Capturing the isolated Light start page.');
    await page.screenshot({path:path.join(outputDir,'deepseek-harness-web.png')});
    const opened = await page.evaluate(async url => {
      const response = await fetch('/browser-desktop/open', {
        method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({url})
      });
      return response.ok && (await response.json()).status === 'opened';
    }, releaseUrl);
    assert(opened, 'authenticated desktop request must open the upstream release');
    await page.getByRole('button',{name:'打开浏览器桌面并人工接管',exact:true}).click();
    const frame=page.frameLocator('iframe[title="容器 Chromium 桌面"]');
    await frame.locator('canvas').waitFor({state:'visible'});
    const panel=page.getByRole('dialog',{name:'浏览器桌面 · 人工接管',exact:true});
    const initial=await panel.boundingBox();
    await page.mouse.move(initial.x+180,initial.y+22);
    await page.mouse.down();
    await page.mouse.move(292+180,88+22,{steps:12});
    await page.mouse.up();
    const rect=await panel.boundingBox();
    const grip=await panel.getByRole('separator',{name:'调整浏览器窗口大小',exact:true}).boundingBox();
    await page.mouse.move(grip.x+11,grip.y+11);
    await page.mouse.down();
    await page.mouse.move(grip.x+11+1120-rect.width,grip.y+11+744-rect.height,{steps:16});
    await page.mouse.up();
    await page.waitForTimeout(10000);
    assert.equal(await frame.locator('#noVNC_error').isVisible(),false);
    let releaseLoaded=false;
    for(let attempt=0;attempt<60;attempt++) {
      const loaded=execFileSync('docker',['exec',container,'node','-e',`
        fetch('http://127.0.0.1:9222/json/list').then(r=>r.json()).then(tabs=>{
          process.stdout.write(String(tabs.some(tab=>tab.url==='${releaseUrl}' && tab.title.includes('${version}'))));
        }).catch(()=>process.exit(1));
      `],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
      if(loaded.trim()==='true'){releaseLoaded=true;break;}
      await page.waitForTimeout(500);
    }
    assert(releaseLoaded,'the public release page must finish loading before capture');
    await page.screenshot({path:path.join(outputDir,'browser-desktop-webui.png')});
    await panel.getByRole('button',{name:'关闭',exact:true}).click();
    const editor=page.getByRole('textbox',{name:/描述你想要构建的内容/});
    const draft=version+' draft preservation check - not submitted';
    await editor.fill(draft);
    await page.waitForTimeout(500);
    await page.getByRole('button',{name:'添加工作区',exact:true}).click();
    const draftPicker=page.getByRole('dialog',{name:'选择工作区目录',exact:true});
    await draftPicker.getByRole('button',{name:'draft-check',exact:true}).first().click();
    await draftPicker.getByRole('button',{name:'打开',exact:true}).click();
    await draftPicker.waitFor({state:'hidden'});
    const workspaceChoice=page.getByRole('button',{name:'选择工作区',exact:true});
    for(let attempt=0;attempt<60 && !(await workspaceChoice.textContent()).includes('draft-check');attempt++) await page.waitForTimeout(500);
    assert((await workspaceChoice.textContent()).includes('draft-check'));
    await workspaceChoice.click();
    await page.getByRole('menuitem',{name:'demo-project',exact:true}).click();
    await page.getByRole('button',{name:'新建会话',exact:true}).first().click();
    await editor.waitFor();
    let restored='';
    for(let attempt=0;attempt<60;attempt++) {
      restored=await editor.evaluate(e=>e.value ?? e.textContent);
      if(restored===draft) break;
      await page.waitForTimeout(500);
    }
    assert.equal(restored,draft,'New Session must recover the unsent draft after switching away');
    await editor.fill('');
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(outputDir,'capture-provenance.json'), JSON.stringify({
      capturedAt:new Date().toISOString(),
      runtimeVersion:version,
      marketVersion,
      imageReference:info.Config.Image,
      imageId:info.Image,
      sourceRevision:info.Config.Labels['org.opencontainers.image.revision'],
      browserVersion:browser.version(),
      viewport:{width:1440,height:900},
      theme:'light',
      temporaryStateOnly:true,
      modelConfigured:false,
      modelRequestsMade:false,
      checks:['authenticated model catalog RPC','navigation More menu','market catalogue compatibility metadata','live noVNC canvas','unsent draft recovery']
    },null,2)+'\n');
    console.log('UI smoke passed: authenticated Web, More menu and draft recovery, community market, noVNC canvas; no model requests');
  } finally {await browser.close();}
})().catch(e=>{console.error(String(e?.stack ?? e).replace(/([?&]token=)[^\s)"'<>]+/g,'$1[REDACTED]'));process.exitCode=1;});



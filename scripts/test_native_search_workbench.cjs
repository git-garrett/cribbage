// Browser integration: native tabs, curves, trial selection and small screens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('@playwright/test');
const staticRoot = path.join(__dirname, 'benchmark-workbench');
function fixture(model) {
  return {id:`native-${model}`,kind:'training',mode:'native-search',title:`Model ${model}`,model,state:'running',asOf:1700000000,
    config:{widths:[1024,512],rate:.0003,mixtures:8,auxiliary:1},activity:{state:'running',stage:'train-32-1-8',label:model===32?'Learning':'Waiting'},
    opponent:'Frozen original Model 31',reference:{winRate:.6428,games:10000,label:'Larger Model 31'},pace:null,candidates:[],
    seeds:[{seed:1,initializationSeed:1,bestRound:2,history:[{hours:1,winRate:.60,paired95:[.58,.62],round:1,games:1000,phase:'Candidate testing'}, {hours:1.5,winRate:.62,paired95:[.60,.64],round:2,games:1000,phase:'Continued training'}]}, {seed:2,initializationSeed:2,history:[{hours:1,winRate:.55,paired95:[.53,.57],round:1,games:1000,phase:'Independent confirmation'}]}],
    trials:[0,1].map(i=>({id:`trial-0${i}`,config:{widths:[1024,512],rate:.0003},selected:i===0,history:[{hours:.01,loss:2.5},{hours:.02,loss:2.7}],bestHours:.01,bestLoss:2.5,earlyStopped:true}))};
}
(async()=>{
  const reports=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):[fixture(32),fixture(33)];
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1280,height:960}}), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://127.0.0.1:8766/**', async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/jobs') return route.fulfill({json:{jobs:reports.map(r=>({id:r.id,title:r.title,kind:'training',state:r.state,aliases:[]})),refreshSeconds:15,uiVersion:'native-test'}});
      if(url.pathname==='/api/report') return route.fulfill({json:reports.find(r=>r.id===url.searchParams.get('job'))});
      const filename=url.pathname==='/'?'index.html':url.pathname.slice(1);
      assert(['index.html','app.js','native-search.js','style.css','favicon.svg'].includes(filename));
      return route.fulfill({body:fs.readFileSync(path.join(staticRoot,filename),'utf8').replaceAll('__WORKBENCH_UI_VERSION__','native-test'),contentType:filename.endsWith('.js')?'text/javascript':filename.endsWith('.css')?'text/css':'text/html'});
    });
    await page.goto(`http://127.0.0.1:8766/?job=${reports[0].id}`);
    await page.waitForLoadState('networkidle');
    await page.locator('#native-search-report').waitFor({state:'visible'});
    assert.match(await page.locator('#native-search-report').innerText(),/Independent confirmation/);
    assert.match(await page.locator('#native-search-report').innerText(),/64.28%/);
    assert.equal(await page.locator('#training-report').isVisible(),false);
    assert.equal(await page.locator('#native-search-report svg').count(),2);
    await page.locator('#native-loss-trial').selectOption({index:1});
    await page.getByRole('tab',{name:new RegExp(reports[1].title)}).click();
    await page.waitForFunction(title=>document.getElementById('native-search-report').textContent.includes(title),reports[1].title);
    assert.equal(await page.locator('#native-search-report').count(),1);
    await page.screenshot({path:'/private/tmp/native-search-desktop.png',fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
    await page.screenshot({path:'/private/tmp/native-search-mobile.png',fullPage:true});
    assert.deepEqual(errors,[]);
    console.log('Native search browser integration passed (desktop and mobile).');
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});

async (page) => {
 const manifest = __MANIFEST__;
 const root=__ROOT__;
 const context=await page.context().browser().newContext({viewport:{width:1600,height:1000},recordVideo:{dir:root+'/recordings',size:{width:1600,height:1000}}});const p=await context.newPage();await p.goto(__APP_URL__);await p.getByRole('button',{name:'skanda-grounding-q3-mixed Connected',exact:true}).waitFor({timeout:60000});
 const records=[];const responses=[];
 p.on('response',async r=>{if(r.url().includes('/chat/completions')){try{responses.push({status:r.status(),body:await r.text()})}catch(e){responses.push({error:String(e)})}}});
 for(const c of manifest){
 {
  await p.locator('.sample-studies input[type=file]').setInputFiles(root+'/data/'+c.modality+'.nrrd');
  await p.getByRole('spinbutton',{name:'Slice number',exact:true}).waitFor();
  await p.evaluate(async c=>{
   const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/components/shell/shellState.ts'));
   const {useShell}=await import(url);const source=useShell.getState().volumeSource;
   useShell.getState().openVolume({...source,title:c.modality==='ct'?'Liver CT reference case':'Brain MRI T1 post-contrast reference case',modality:c.modality==='ct'?'CT':'MRI',initialWindow:c.window});
  },c);
  await p.getByRole('spinbutton',{name:'Slice number',exact:true}).waitFor();
  if(await p.getByRole('button',{name:'Single plane',exact:true}).count())await p.getByRole('button',{name:'Single plane',exact:true}).click();
  if(await p.getByRole('button',{name:'Reading mode',exact:true}).count())await p.getByRole('button',{name:'Reading mode',exact:true}).click();
  await p.getByText('Analyze current slice only',{exact:true}).click();
 }
  for(const s of c.slices){
   await p.getByRole('spinbutton',{name:'Slice number',exact:true}).fill(String(s.number));
   await p.getByRole('spinbutton',{name:'Slice number',exact:true}).evaluate(el=>el.blur());await p.mouse.move(20,20);await p.waitForTimeout(800);const start=responses.length;
   const requestLabel=await p.getByRole('region',{name:'Slice abnormality detection',exact:true}).locator(':scope > p').first().innerText();if(!requestLabel.includes('axial '+s.number+'/'))throw new Error('Source slice mismatch before request: '+requestLabel);
   await p.getByRole('button',{name:'Analyze slice',exact:true}).evaluate(el=>el.click());
   await p.waitForTimeout(1000);
   await p.getByRole('button',{name:'Analyze slice',exact:true}).waitFor({timeout:180000});
   await p.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Analyze slice');return b&&!b.disabled},null,{timeout:300000});
   await p.waitForTimeout(1200);
   await p.getByRole('region',{name:'Slice abnormality detection',exact:true}).scrollIntoViewIfNeeded();
   const ui=await p.getByRole('region',{name:'Slice abnormality detection',exact:true}).innerText();
   const analysis=await p.getByRole('region',{name:'Slice abnormality detection',exact:true}).evaluate(el=>{let f=el[Object.keys(el).find(k=>k.startsWith('__reactFiber'))];const candidates=[];while(f){for(const fiber of [f,f.alternate]){let h=fiber?.memoizedState;while(h&&typeof h==='object'){if(h.memoizedState?.analysis)candidates.push(h.memoizedState);h=h.next}}f=f.return}const displayed=el.querySelector('.volume-analysis-result > strong')?.textContent;return candidates.find(x=>'Results: '+x.label===displayed)?.analysis??null});
   const resultLabel=await p.locator('.volume-analysis-result > strong').innerText();if(!resultLabel.includes('axial '+s.number+'/'))throw new Error('Source slice mismatch in response: '+resultLabel);
   await p.getByRole('spinbutton',{name:'Slice number',exact:true}).fill(String(s.number));await p.getByRole('spinbutton',{name:'Slice number',exact:true}).evaluate(el=>el.blur());await p.waitForTimeout(300);

   await p.screenshot({path:root+'/'+c.modality+'-'+s.number+'-app.png'});
   records.push({case:c.case,modality:c.modality,slice:s.number,window:c.window,reference:s,requestLabel,resultLabel,ui,analysis,responses:responses.slice(start),timestamp:new Date().toISOString()});
   await p.evaluate(r=>{localStorage.setItem('labeledValidationProgress',JSON.stringify(r))},records);
  }
  await p.getByRole('button',{name:'Three planes',exact:true}).click();await p.waitForTimeout(1300);await p.screenshot({path:root+'/'+c.modality+'-multiplanar.png'});
 }
 const downloadPromise=p.waitForEvent('download');await p.evaluate(records=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(records,null,2)],{type:'application/json'}));a.download='app-results.json';a.click()},records);const download=await downloadPromise;await download.saveAs(root+'/app-results.json');
 await p.close();await p.video().saveAs(root+'/labeled-case-tests.webm');await context.close();return records.map(x=>({modality:x.modality,slice:x.slice,ui:x.ui}));
}

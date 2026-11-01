import fs from 'node:fs'
import {extractJsonWithInfo,normalizeAnalysis} from '../../app/src/lib/parse.ts'
const root=new URL('./',import.meta.url)
const records=JSON.parse(fs.readFileSync(new URL('app-results.json',root),'utf8'))
for(const r of records){
 if(r.analysis)continue
 for(const response of (r.responses??[]).slice().reverse()){
  try{
   let text='';let reason='';
   for(const line of response.body.split('\n'))if(line.startsWith('data: ')&&!line.includes('[DONE]')){const chunk=JSON.parse(line.slice(6));text+=chunk.choices?.[0]?.delta?.content??'';reason=chunk.choices?.[0]?.finish_reason??reason}
   if(!text){const obj=JSON.parse(response.body);text=obj.choices?.[0]?.message?.content??''}
   const extraction=extractJsonWithInfo(text);r.analysis=normalizeAnalysis(extraction.value,{rawText:text,model:'skanda-grounding-q3-mixed',durationMs:0,truncated:reason==='length'||extraction.closedContainers});r.normalization='Same app parser applied to captured response';break
  }catch(e){r.parseError=String(e)}
 }
}
fs.writeFileSync(new URL('normalized-results.json',root),JSON.stringify(records,null,2))
console.log(JSON.stringify(records.map(r=>({modality:r.modality,slice:r.slice,impression:r.analysis?.impression,findings:r.analysis?.findings,parseError:r.parseError})),null,2))

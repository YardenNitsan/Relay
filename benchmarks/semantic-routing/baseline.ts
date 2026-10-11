import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {phraseDemand} from '../../server/models/intent-phrases.js';

const [input,output]=process.argv.slice(2);
if(!input||!output)throw new Error('Provide input corpus and output report paths');
const bytes=await readFile(input),data=JSON.parse(bytes.toString('utf8')) as {cases:{id:string;language:string;objective:string;required:string[];forbidden:string[]}[]};
const outcomes=data.cases.map(item=>{
  const start=performance.now(),demand=phraseDemand(item.objective),latencyMs=performance.now()-start;
  const missing=item.required.filter(label=>!demand.categories.includes(label));
  const forbidden=item.forbidden.filter(label=>demand.categories.includes(label));
  return {id:item.id,language:item.language,predicted:demand.categories,missing,forbidden,satisfied:!missing.length&&!forbidden.length,latencyMs};
});
const result={candidate:'bilingual-phrases-v2',casesHash:createHash('sha256').update(bytes).digest('hex'),metrics:{
  satisfied:outcomes.filter(item=>item.satisfied).length,total:outcomes.length,
  missingRequired:outcomes.reduce((sum,item)=>sum+item.missing.length,0),forbiddenLabels:outcomes.reduce((sum,item)=>sum+item.forbidden.length,0),
  languages:Object.fromEntries(['en','he'].map(language=>[language,{satisfied:outcomes.filter(item=>item.language===language&&item.satisfied).length,total:outcomes.filter(item=>item.language===language).length}])),outcomes,
}};
await writeFile(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result.metrics,outcomes:undefined}));

/** Explicit experiment settings, never product defaults or admission overrides. */
export function codingAcceptanceOptions(args:string[]):{mode:'sandbox'|'discover'|'model';modelId:string|null;contextTokens:number;maxOutputTokens:number}{
  const usage='Choose --sandbox-only, --discover, or --model=EXACT_INSTALLED_ID; model options: --context=16384|32768 and --output=4096|8192';
  const first=args[0]??'';
  const mode=first==='--sandbox-only'?'sandbox':first==='--discover'?'discover':first.startsWith('--model=')&&first.slice(8).trim()?'model':null;
  if(!mode||args.length>3||(mode!=='model'&&args.length!==1))throw new Error(usage);
  let contextTokens=16384,maxOutputTokens=4096;
  const seen=new Set<string>();
  for(const argument of args.slice(1)){
    const match=/^--(context|output)=(\d+)$/.exec(argument);
    if(!match||seen.has(match[1]))throw new Error(usage);
    seen.add(match[1]);const value=Number(match[2]);
    if(match[1]==='context'&&[16384,32768].includes(value))contextTokens=value;
    else if(match[1]==='output'&&[4096,8192].includes(value))maxOutputTokens=value;
    else throw new Error(usage);
  }
  return {mode,modelId:mode==='model'?first.slice(8):null,contextTokens,maxOutputTokens};
}

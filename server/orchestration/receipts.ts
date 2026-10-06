/** Keep execution metadata intact. Truncating a JSON string destroys both its
 * schema and fields after the text, including hashes needed for safe editing. */
export function boundedReceipt(content:string,maxBytes:number):string {
  if(Buffer.byteLength(content)<=maxBytes)return content;
  let value:unknown;
  try{value=JSON.parse(content);}catch{/* Plain tool errors are also bounded explicitly. */}
  if(value&&typeof value==='object'&&!Array.isArray(value)) {
    const record:Record<string,unknown>={...value as Record<string,unknown>,truncated:true};
    const textFields=['content','stdout','stderr'].filter(key=>typeof record[key]==='string');
    for(const key of textFields){
      const original=record[key] as string;record[key]='';
      if(Buffer.byteLength(JSON.stringify(record))>maxBytes)continue;
      let low=0,high=original.length;
      while(low<high){const middle=Math.ceil((low+high)/2);record[key]=original.slice(0,middle);if(Buffer.byteLength(JSON.stringify(record))<=maxBytes)low=middle;else high=middle-1;}
      record[key]=original.slice(0,low);
    }
    for(const key of ['files','matches']) {
      const items=record[key];
      if(!Array.isArray(items))continue;
      while(items.length&&Buffer.byteLength(JSON.stringify(record))>maxBytes)items.pop();
    }
    // If metadata alone exceeds the budget retain it. fitContext fails closed
    // before generation instead of silently dropping a hash, status or receipt.
    return JSON.stringify(record);
  }
  const suffix='\n[Tool output truncated; complete output is in task activity.]';
  let low=0,high=content.length;
  while(low<high){const middle=Math.ceil((low+high)/2);if(Buffer.byteLength(content.slice(0,middle)+suffix)<=maxBytes)low=middle;else high=middle-1;}
  return content.slice(0,low)+suffix;
}

/** An excerpt with a byte ceiling; never split a UTF-8 character. */
export function utf8Excerpt(text:string,limit:number):{text:string;truncated:boolean}{
  if(!Number.isSafeInteger(limit)||limit<0)throw new Error('Invalid text budget');
  const bytes=Buffer.from(text,'utf8');if(bytes.length<=limit)return {text,truncated:false};
  let end=limit;while(end>0&&(bytes[end]&0xc0)===0x80)end--;
  return {text:bytes.subarray(0,end).toString('utf8'),truncated:true};
}

// Disposable browser benchmark data. Never imported by the production host.
import {randomUUID} from 'node:crypto';
import type {Store} from '../server/db/store';

export const performanceConversationId='6a010004-1111-4111-8111-111111111111';
export const performanceResponse=Array.from({length:24},(_,index)=>`### Review section ${index+1}\n\nThe implementation preserves the current account, workspace and expected file version before applying a change. Reconnection retrieves durable evidence and does not repeat an uncertain operation. This is synthetic performance data.\n\n- Check the requested scope.\n- Preserve the exact result.\n- Run independent verification.\n\n\`\`\`typescript\nconst receipt = await workspace.read('src/example-${index}.ts');\nawait workspace.write({ path: receipt.path, expectedHash: receipt.sha256, content: proposed });\n\`\`\`\n`).join('\n');
export async function seedPerformanceFixture(store:Store){
  await store.db.query("INSERT INTO conversations(id,user_id,title,created_at,updated_at) VALUES ($1,'owner','Studio performance fixture',now(),now())",[performanceConversationId]);
  for(let index=0;index<40;index++)await store.db.query("INSERT INTO messages(id,conversation_id,role,content,created_at) VALUES ($1,$2,$3,$4,'2026-01-01'::timestamptz + $5::int * interval '1 second')",[randomUUID(),performanceConversationId,index%2?'assistant':'user',index%2?`## Implementation ${Math.ceil(index/2)}\n\n${performanceResponse}`:`Inspect implementation ${index/2+1} and explain its verification.`,index]);
}

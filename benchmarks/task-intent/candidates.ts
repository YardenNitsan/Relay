/** Experimental candidates. Not imported by production before the held-out gate. */
export const labels=['debugging','coding','repository_architecture','multi_file_implementation','structured_extraction','document_analysis','research_synthesis','tool_driven','planning_delegation','review_verification','security_review','mathematics','complex_reasoning','multimodal','factual_explanation','conversation'] as const;
export type Label=typeof labels[number];
export interface IntentCase {id:string;language:'en'|'he';objective:string;required:Label[];forbidden:Label[]}
export interface Demand {categories:string[];complexity:'simple'|'standard'|'complex';method:string}
const MAX_INPUT=16_384;
export const normalize=(value:string)=>value.slice(0,MAX_INPUT).normalize('NFKC').replace(/[\u0591-\u05bd\u05bf\u05c1\u05c2\u05c4\u05c5\u05c7]/g,'').toLowerCase();
const hebrew=(text:string,terms:string[])=>terms.some(term=>new RegExp(`(?:^|[^\\p{L}\\p{N}_])[ובכלמשה]{0,2}${term}(?=$|[^\\p{L}\\p{N}_])`,'u').test(text));

function finish(text:string,categories:string[],method:string):Demand {
  if(!categories.length)categories.push('conversation');
  const complex=categories.some(category=>['debugging','multi_file_implementation','complex_reasoning','repository_architecture','security_review'].includes(category));
  return {categories,complexity:complex?'complex':text.length<220&&categories.every(category=>['conversation','factual_explanation'].includes(category))?'simple':'standard',method};
}

export function phraseDemand(objective:string):Demand {
  const text=normalize(objective),found=new Set<string>();
  const he=(...terms:string[])=>hebrew(text,terms);
  const add=(label:Label,condition:boolean)=>{if(condition)found.add(label);};
  const nonCode=/\b(?:dress|postal|zip|coupon|discount|access) code\b/.test(text)||/קוד ה?(?:לבוש|קופון|הנחה|גישה)/.test(text);
  const codeTerm=!nonCode&&(/\b(?:code|coding)\b/.test(text)||he('קוד'));
  const software=codeTerm||/\b(?:app|application|software|website|webpage|program|script|api|frontend|backend|server|repository|repo|codebase|build|compiler|database|function|typescript|javascript|python|csharp|dotnet|react|node|login|sign in)\b/.test(text)||he('אפליקציה','יישום','תוכנה','אתר','מערכת','שרת','ממשק','פרויקט','ריפוזיטורי','מודול','מודולים','בנייה','קומפילציה','מסד','פונקציה','פייתון','גאווהסקריפט','טייפסקריפט','כניסה');
  const repair=/\b(?:fix|repair|diagnos\w*|troubleshoot\w*|broken|malfunction\w*|crash\w*|fail\w*|error\w*|regression\w*|incorrect|wrong|stuck|freez\w*|hang\w*)\b|\b(?:stops? responding|does(?:n't| not) work|won(?:'t| not) (?:start|load|open))\b/.test(text)||he('תקן','לתקן','תיקון','תקלה','תקלות','שגיאה','שגיאות','קורסת','קורס','קריסה','נכשל','נכשלת','נתקע','נתקעת','תקוע','שבור','שבורה','שגוי')||/לא (?:עובד|עובדת|נפתח|נטען|מגיב|מגיבה)/.test(text);
  const debugging=/\bdebug\w*\b/.test(text)||(software&&repair);
  add('debugging',debugging);
  const architecture=/\b(?:repository|repo|codebase|architecture|architectural)\b|\b(?:system design|module dependencies)\b/.test(text)||he('ארכיטקטורה','ארכיטקטורת','ריפוזיטורי')||/(?:מבנה|תלויות|בפרויקט|בפרוייקט).{0,80}(?:פרויקט|מודולים|רכיב)|(?:מבנה הפרויקט|מבנה הפרוייקט)/.test(text);
  add('repository_architecture',architecture);
  const multi=/\b(?:multi[- ]file|multiple files|several files|across.{0,80}files)\b/.test(text)||/(?:כמה|מספר|מרובים|מרובות|שני|שתי) קבצים|בין הקבצים/.test(text);
  add('multi_file_implementation',multi);
  add('coding',debugging||codeTerm||/\b(?:coding|implement|refactor\w*|typescript|javascript|python|csharp|dotnet|function|compile\w*)\b/.test(text)||he('פונקציה','פייתון','טייפסקריפט','ממש','לממש','מימוש','ריפקטור')||(software&&(/\b(?:change|modify|build|patch|develop|create)\b/.test(text)||he('שנה','שינוי','שינויים','כתוב','צור','בנה','לפתח','פיתוח')))||multi);
  add('structured_extraction',/\b(?:extract\w*|json|schema|csv)\b/.test(text)||he('חלץ','חילוץ','לחלץ')||/(?:לטבלה|לטבלת|בפורמט מובנה)/.test(text));
  add('document_analysis',/\b(?:document\w*|pdf|report|contract|attached (?:file|text)|spreadsheet)\b/.test(text)||he('מסמך','מסמכים','חוזה','דוח','דוחות','מצורף','מצורפת','גיליון'));
  add('research_synthesis',/\b(?:research\w*|sources|synthesi\w*|literature|findings|citations|evidence from)\b/.test(text)||he('חקור','מחקר','מקורות','ממצאים','סקירה','מאמרים'));
  add('tool_driven',/\b(?:run|execute|search|browse|download|install)\b|\b(?:read|write|open|save).{0,50}\bfiles?\b/.test(text)||he('הרץ','הריצו','הריץ','הפעל','הורד','חפש','בצע','התקן')||/(?:קרא|כתוב|שמור|פתח).{0,50}(?:קובץ|קבצים)/.test(text));
  add('planning_delegation',/\b(?:plan\w*|delegate\w*|schedule\w*|workflow|milestones|design)\b/.test(text)||he('תכנן','תכנון','תוכנית','תכנית','שלבים','האצל')||/אבני דרך/.test(text));
  const security=/\b(?:security|vulnerabilit\w*|exploit\w*|privilege escalation|prompt injection|sql injection|xss|csrf|threat model)\b/.test(text)||he('אבטחה','אבטחת','חולשה','חולשות','הרשאות','פריצה')||/עקיפת הרשאות|לעקוף הרשאות/.test(text);
  add('security_review',security);
  add('review_verification',security||/\b(?:review\w*|verif\w*|test\w*|audit\w*|validate\w*|check)\b/.test(text)||he('סקור','סקירה','ביקורת','בדוק','בדיקות','בדיקה','אמת','אימות','ודא','לוודא'));
  const math=/\b(?:calculat\w*|equation|algebra\w*|theorem|derive|proof|integral|arithmetic|mathematics|solve|probability)\b/.test(text)||he('חשב','חישוב','משוואה','משוואות','אלגברה','אינטגרל','נגזרת','הסתברות','הוכח','הוכחה','מתמטיקה');
  add('mathematics',math);
  add('complex_reasoning',/\b(?:prove|theorem|derive|multi[- ]step|algorithm|tradeoffs|proof)\b/.test(text)||he('הוכח','הוכחה','אלגוריתם','הסקה')||/רב שלבי/.test(text));
  add('multimodal',/\b(?:image|picture|screenshot|audio|video|photograph|recording)\b/.test(text)||he('תמונה','תמונות','שמע','וידאו','סרטון','הקלטה','הקלטת','תמלל')||/צילום מסך|צילום המסך/.test(text));
  add('factual_explanation',/\b(?:explain|what is|what are|define|definition)\b/.test(text)||he('הסבר','הסביר','הגדר','מהי','מהו')||/מה זה/.test(text));
  return finish(text,labels.filter(label=>found.has(label)),'bilingual-phrases-v2');
}

// A small, dependency-free lexical alternative. Features never include held-out data.
function features(text:string):Set<string> {
  const words=normalize(text).match(/[\p{L}\p{N}_]+/gu)??[],result=new Set<string>();
  for(const word of words){if(word.length<3)continue;result.add('w:'+word);for(let i=0;i+3<=word.length;i++)result.add('c:'+word.slice(i,i+3));}
  return result;
}
export function prototypeClassifier(training:IntentCase[]):(objective:string)=>Demand {
  const samples=training.filter(item=>item.required.length).map(item=>({features:features(item.objective),labels:item.required}));
  const frequency=new Map<string,number>();for(const sample of samples)for(const term of sample.features)frequency.set(term,(frequency.get(term)??0)+1);
  const weight=(term:string)=>Math.log((1+samples.length)/(1+(frequency.get(term)??0)))+1;
  const norm=(terms:Set<string>)=>Math.sqrt([...terms].reduce((sum,term)=>sum+weight(term)**2,0));
  const norms=samples.map(sample=>norm(sample.features));
  return objective=>{
    const query=features(objective),length=norm(query);
    const ranked=samples.map((sample,index)=>({sample,score:length&&norms[index]?[...query].reduce((sum,term)=>sum+(sample.features.has(term)?weight(term)**2:0),0)/(length*norms[index]!):0})).sort((a,b)=>b.score-a.score);
    const best=ranked[0];const categories=best&&best.score>=.3?[...best.sample.labels]:[];
    return finish(normalize(objective),categories,'lexical-prototype-v1');
  };
}

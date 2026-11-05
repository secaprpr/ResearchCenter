import fs from 'node:fs/promises';
import {getDocument} from 'pdfjs-dist/legacy/build/pdf.mjs';
// Regenerate from the unmodified official PDF linked by CCF's 2026 catalogue page.
const source='https://www.ccf.org.cn/Academic_Evaluation/By_category/';
const pdf=await getDocument({data:new Uint8Array(await fs.readFile(process.argv[2] || '.taste-skill/ccf-2026.pdf')),isEvalSupported:false}).promise;
const rows=[];let kind='journal',rank='',row=null;
function finish(){if(!row)return;const title=row.title.join(' ').replace(/\s+/g,' ').trim();const acronym=row.acronym.join(' ').replace(/\s+/g,' ').trim();if(title&&rank)rows.push({acronym,title,rank:row.rank,kind:row.kind,page:row.page});row=null;}
for(let page=1;page<=pdf.numPages;page++){
 const content=await(await pdf.getPage(page)).getTextContent();
 for(const item of content.items){if(!('str' in item))continue;const text=item.str.trim();if(!text)continue;const x=item.transform[4],center=x+item.width/2;
  if(text.includes('推荐国际学术期刊')){finish();kind='journal';continue;}
  if(text.includes('推荐国际学术会议')){finish();kind='conference';continue;}
  if(/^[ABC]$/.test(text)&&x<120){finish();rank=text;continue;}
  if(/^\d+$/.test(text)&&x>=75&&x<110){finish();row={acronym:[],title:[],kind,rank,page};continue;}
  if(!row)continue;
  if(center>=110&&center<185)row.acronym.push(text);
  else if(center>=185&&center<450&&/[a-zA-Z]/.test(text))row.title.push(text);
 }
 finish();
}
const unique=[...new Map(rows.map(r=>[r.kind+'|'+r.title.toLowerCase(),r])).values()];
if(unique.length<600||unique.length>1000)throw new Error('Unexpected catalogue size: '+unique.length);
const data={edition:'CCF 2026 第七版（2026-04-09 勘误版）',year:2026,source,pdfSource:'https://www.ccf.org.cn/ccf/contentcore/resource/download?ID=112CF3BF7E1140ACEB271ADAED12A67ADFABB8FF099E40C2759502A85C8A281F',retrievedAt:'2026-10-20',entries:unique};
await fs.writeFile('src/port/data/ccf-2026.json',JSON.stringify(data,null,2)+'\n');
console.log('CCF entries',unique.length);console.log(unique.filter(r=>/^(CVPR|ICCV|MICCAI|NeurIPS|ICML|ICLR|IJCAI|TPAMI|AAMAS)$/.test(r.acronym)));

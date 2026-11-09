// Lightweight reader for Protheus client exports. Ignores formatting and unrelated columns.
const columns=new Map(['A','B','C','E','F','G','H','I','J','L','M','U','Y','AA','AD','CY','DN'].map(c=>[c,[...c].reduce((n,x)=>n*26+x.charCodeAt(0)-64,0)-1]));
const decoder=new TextDecoder();
function xml(s){return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,v)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1))):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"})[v]);}
function texts(s){return [...s.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map(m=>xml(m[1])).join('');}
export function readClientSheets(bytes,unzipSync){
 let total=0;
 const files=unzipSync(bytes,{filter:f=>{
   const keep=f.name==='xl/sharedStrings.xml'||/^xl\/worksheets\/[^/]+\.xml$/.test(f.name);
   if(keep){total+=f.originalSize;if(total>64*1024*1024)throw Error('Planilha descompactada excede 64 MB.');}
   return keep;
 }});
 const shared=files['xl/sharedStrings.xml']?[...decoder.decode(files['xl/sharedStrings.xml']).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map(m=>texts(m[1])):[];
 const sheets=[];
 for(const [name,data] of Object.entries(files)){
  if(!/^xl\/worksheets\/[^/]+\.xml$/.test(name))continue;
  const rows=[];
  for(const match of decoder.decode(data).matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)){
   const ref=/\br="([A-Z]+)(\d+)"/.exec(match[1]);if(!ref||!columns.has(ref[1]))continue;
   const row=Number(ref[2])-1;if(row>20000)throw Error('Aba excede 20.001 linhas.');
   const col=columns.get(ref[1]);const type=/\bt="([^"]+)"/.exec(match[1])?.[1];
   const body=match[2]||'';const raw=/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(body)?.[1];
   let value=type==='inlineStr'?texts(body):raw===undefined?'':type==='s'?shared[Number(raw)]:xml(raw);
   if(value===undefined)throw Error('Referência de texto inválida na planilha.');
   (rows[row]??=[])[col]=value;
  }
  // Array gaps are valid blank rows, but the parser needs actual row arrays.
  sheets.push({name,rows:Array.from({length:rows.length},(_,i)=>rows[i]||[])});
 }
 if(!sheets.length)throw Error('Arquivo sem abas de clientes.');
 return sheets;
}

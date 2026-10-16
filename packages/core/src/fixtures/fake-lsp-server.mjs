import process from "node:process";
let buffer=Buffer.alloc(0);
let opens=0;
let changes=0;
const docs=new Map();
function send(value){
 const bytes=Buffer.from(JSON.stringify(value),"utf8");
 process.stdout.write("Content-Length: "+bytes.length+"\r\n\r\n");
 process.stdout.write(bytes);
}
function onMessage(m){
 const method=m.method;
 if(method==="textDocument/didOpen"){
   opens++;docs.set(m.params.textDocument.uri,{version:m.params.textDocument.version,text:m.params.textDocument.text});
 }else if(method==="textDocument/didChange"){
   changes++;const d=docs.get(m.params.textDocument.uri);
   docs.set(m.params.textDocument.uri,{version:m.params.textDocument.version,text:m.params.contentChanges[0].text});
 }else if(method==="exit"){process.exit(0);}
 if(typeof m.id!=="number")return;
 let result=null;
 if(method==="initialize")result={capabilities:{documentSymbolProvider:true,hoverProvider:true}};
 if(method==="textDocument/documentSymbol"){
   const doc=docs.get(m.params.textDocument.uri);
   result=[{name:doc?.text||"missing",kind:12,detail:JSON.stringify({pid:process.pid,opens,changes,version:doc?.version})}];
 }
 if(method==="textDocument/hover")result={contents:[{language:"plaintext",value:"fake hover"}]};
 send({jsonrpc:"2.0",id:m.id,result});
}
process.stdin.on("data",chunk=>{
 buffer=Buffer.concat([buffer,chunk]);
 while(true){
   const end=buffer.indexOf("\r\n\r\n");
   if(end<0)return;
   const match=/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0,end).toString("ascii"));
   if(!match){buffer=buffer.subarray(end+4);continue;}
   const length=Number(match[1]),body=end+4;
   if(buffer.length<body+length)return;
   const payload=buffer.subarray(body,body+length).toString("utf8");
   buffer=buffer.subarray(body+length);
   onMessage(JSON.parse(payload));
 }
});

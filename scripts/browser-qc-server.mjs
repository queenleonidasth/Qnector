import http from "node:http";
const host="127.0.0.1";
const port=48341;
const html='<!doctype html><html lang="th"><meta charset="utf-8"><title>QNECTOR CDP QC</title><main><h1 id="title">QNECTOR CDP QC</h1><button id="increment" aria-label="Increment">Click test</button><output id="count">0</output><div id="delayed" hidden>WAITING</div><script>let count=0;document.querySelector("#increment").addEventListener("click",()=>{document.querySelector("#count").textContent=String(++count)});setTimeout(()=>{const e=document.querySelector("#delayed");e.hidden=false;e.textContent="READY ภาษาไทย"},300);</script></main></html>';
const server=http.createServer((request,response)=>{
  const url=new URL(request.url??"/","http://localhost");
  if(url.pathname==="/health"){response.writeHead(200,{"Content-Type":"application/json"});response.end(JSON.stringify({ok:true}));return;}
  if(url.pathname!=="/qc"){response.writeHead(404);response.end("not found");return;}
  response.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});response.end(html);
});
server.listen(port,host,()=>console.log(JSON.stringify({host,port,ready:true})));
for(const sig of ["SIGTERM","SIGINT"])process.on(sig,()=>server.close(()=>process.exit(0)));

import json,base64,os
os.chdir('/home/claude/hr')
s=open('src/HamsterRAGAssistant.js').read(); body=open('demo_body.html').read()
mock="""
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
async function mockAsk(q,{onStage}){
  onStage('retrieving'); await sleep(1500);
  onStage('generating'); await sleep(1500);
  if(document.getElementById('fail').checked) throw new Error('The knowledge service returned 500.');
  return 'Here is a mock answer to: "'+q+'". Connect your real RAG function as onAsk to get real answers.';
}
"""
LAY=['idle_body','idle_head','idle_earL','idle_earR','idle_eyeL','idle_eyeR','idle_armL','idle_armR','hold_base','hold_eyeL','hold_eyeR','book_closed']
paths={n:f'rig/{n}.png' for n in LAY}; paths['happy']='poses/happy.png'; paths['confused']='poses/confused.png'
open('demo.html','w').write(f"""<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Hamster RAG demo</title></head><body>{body}
<script type=module>
import {{ HamsterRAGAssistant }} from './src/HamsterRAGAssistant.js';
const assets={json.dumps({k:'./'+v for k,v in paths.items()})};
{mock}
window.h=new HamsterRAGAssistant({{assets,onAsk:mockAsk}}); h.mount();
</script></body></html>""")
data={k:'data:image/png;base64,'+base64.b64encode(open(v,'rb').read()).decode() for k,v in paths.items()}
head='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Hamster RAG Assistant</title></head><body>'
open('/mnt/user-data/outputs/hamster-rag-preview.html','w').write(head+body+"<script>\nconst ASSETS="+json.dumps(data)+";\n"+s.replace('export ','')+mock+"\nwindow.h=new HamsterRAGAssistant({assets:ASSETS,onAsk:mockAsk}); h.mount();\ndocument.getElementById('btn').onclick=()=>alert('Page button works');\n</script></body></html>")
print('built')

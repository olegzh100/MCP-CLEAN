const VERSION='1.2.2';
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

async function ensureBridgeTab(){
  try{
    const url=`chrome-extension://${chrome.runtime.id}/bridge.html`;
    const tabs=await chrome.tabs.query({url});
    if(tabs.length) return;
    const wins=await chrome.windows.getAll({populate:true});
    for(const win of wins){
      if((win.tabs||[]).some(t=>t.url===url)) return;
    }
    await chrome.windows.create({url,focused:false,state:'minimized'});
  }catch{}
}

chrome.runtime.onInstalled.addListener(()=>ensureBridgeTab());
chrome.runtime.onStartup.addListener(()=>ensureBridgeTab());
ensureBridgeTab();
setInterval(ensureBridgeTab,30000);

async function isUserActiveTab(tabId){
  const tab=await chrome.tabs.get(Number(tabId));
  const win=await chrome.windows.get(tab.windowId);
  return Boolean(tab.active && win.focused);
}

async function runInTab(tabId,op){
  const res=await chrome.scripting.executeScript({target:{tabId:Number(tabId)},args:[op],func:(op)=>{
    const norm=(s)=>String(s??'').replace(/\s+/g,' ').trim();
    const visible=(el)=>{if(!el)return false;const r=el.getBoundingClientRect();const st=getComputedStyle(el);return r.width>0&&r.height>0&&st.display!=='none'&&st.visibility!=='hidden';};
    const path=(el)=>{if(!el||el.nodeType!==1)return'';if(el.id)return`#${CSS.escape(el.id)}`;const parts=[];let cur=el;for(let d=0;cur&&cur.nodeType===1&&d<8;d++,cur=cur.parentElement){let s=cur.tagName.toLowerCase();const tid=cur.getAttribute('data-testid');if(tid){s+=`[data-testid="${CSS.escape(tid)}"]`;parts.unshift(s);break;}const nm=cur.getAttribute('name');if(nm)s+=`[name="${CSS.escape(nm)}"]`;if(cur.parentElement){const peers=[...cur.parentElement.children].filter(x=>x.tagName===cur.tagName);if(peers.length>1)s+=`:nth-of-type(${peers.indexOf(cur)+1})`;}parts.unshift(s);}return parts.join(' > ');};
    const candidates=(selector,text)=>{let arr=[];if(selector){try{arr=[...document.querySelectorAll(selector)];}catch{}}if(!arr.length&&text){const q=norm(text).toLowerCase();const all=[...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="link"],[contenteditable="true"]')];arr=all.filter(el=>norm(el.innerText||el.value||el.getAttribute('aria-label')||el.getAttribute('title')||el.textContent).toLowerCase().includes(q));}return arr;};
    if(op.kind==='read'){const max=Math.max(1000,Math.min(Number(op.max_chars||30000),200000));let target=document.body||document.documentElement;if(op.selector){target=document.querySelector(op.selector);if(!target)throw new Error('ELEMENT_NOT_FOUND');}const text=norm(target.innerText||target.textContent||'');return{title:document.title,url:location.href,text:text.slice(0,max),truncated:text.length>max,selector:op.selector||'body'};}
    if(op.kind==='find'){const max=Math.max(1,Math.min(Number(op.max_items||30),100));return candidates(op.selector,op.text).slice(0,max).map(el=>({selector:path(el),tag:el.tagName.toLowerCase(),text:norm(el.innerText||el.value||el.textContent).slice(0,500),aria:el.getAttribute('aria-label')||'',role:el.getAttribute('role')||'',type:el.getAttribute('type')||'',visible:visible(el),disabled:Boolean(el.disabled)}));}
    if(op.kind==='scroll'){window.scrollBy(Number(op.delta_x||0),Number(op.delta_y||0));return{ok:true,x:window.scrollX,y:window.scrollY};}
    if(op.kind==='navigate'){if(op.action==='back')history.back();else if(op.action==='forward')history.forward();else location.reload();return{ok:true,action:op.action};}
    if(op.kind==='mouse_point'){const x=Number(op.x||0),y=Number(op.y||0);const el=document.elementFromPoint(x,y);if(!el)throw new Error('ELEMENT_NOT_FOUND_AT_POINT');const type=String(op.event||'click');const init={bubbles:true,cancelable:true,clientX:x,clientY:y,button:op.button==='right'?2:op.button==='middle'?1:0,buttons:type==='mouseup'?0:1,view:window};if(type==='click'&&typeof el.click==='function'&&init.button===0){el.click();}else{el.dispatchEvent(new MouseEvent(type,init));}return{ok:true,event:type,selector:path(el),text:norm(el.innerText||el.value||el.textContent).slice(0,200)};}
    if(op.kind==='mouse_drag'){const x1=Number(op.from_x||0),y1=Number(op.from_y||0),x2=Number(op.to_x||0),y2=Number(op.to_y||0),steps=Math.max(1,Math.min(Number(op.steps||10),200));const el=document.elementFromPoint(x1,y1);if(!el)throw new Error('ELEMENT_NOT_FOUND_AT_POINT');const btn=op.button==='right'?2:op.button==='middle'?1:0;el.dispatchEvent(new MouseEvent('mousedown',{bubbles:true,cancelable:true,clientX:x1,clientY:y1,button:btn,buttons:1,view:window}));for(let i=1;i<=steps;i++){const x=x1+(x2-x1)*i/steps,y=y1+(y2-y1)*i/steps;const t=document.elementFromPoint(x,y)||el;t.dispatchEvent(new MouseEvent('mousemove',{bubbles:true,cancelable:true,clientX:x,clientY:y,button:btn,buttons:1,view:window}));}const end=document.elementFromPoint(x2,y2)||el;end.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true,clientX:x2,clientY:y2,button:btn,buttons:0,view:window}));return{ok:true,from_x:x1,from_y:y1,to_x:x2,to_y:y2};}
    const arr=candidates(op.selector,op.text);let el=arr[Number(op.index||0)]||null;if(!el&&op.kind==='press_key'&&!op.selector&&!op.text)el=document.activeElement||document.body||document.documentElement;if(!el)throw new Error('ELEMENT_NOT_FOUND');
    if(op.kind==='click'){el.scrollIntoView({block:'center',inline:'nearest'});el.click();return{ok:true,selector:path(el),text:norm(el.innerText||el.value||el.textContent).slice(0,300)};}
    if(op.kind==='set_value'){const incoming=String(op.value??'');el.scrollIntoView({block:'center',inline:'nearest'});const current=el.isContentEditable?String(el.textContent||''):String(el.value||'');const value=op.append?current+incoming:incoming;if(el.isContentEditable){el.textContent=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:incoming}));el.dispatchEvent(new Event('change',{bubbles:true}));}else{const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const desc=Object.getOwnPropertyDescriptor(proto,'value');if(desc?.set)desc.set.call(el,value);else el.value=value;el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));}return{ok:true,selector:path(el),value};}
    if(op.kind==='select'){let value=op.value;if(value===undefined&&op.label!==undefined){const opt=[...el.options].find(o=>String(o.label||o.textContent).trim()===String(op.label));if(!opt)throw new Error('OPTION_NOT_FOUND');value=opt.value;}if(value===undefined&&op.option_index!==undefined){const opt=el.options[Number(op.option_index)];if(!opt)throw new Error('OPTION_NOT_FOUND');value=opt.value;}el.value=String(value??'');el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return{ok:true,selector:path(el),value:el.value};}
    if(op.kind==='check'){const desired=op.checked!==false;if(Boolean(el.checked)!==desired)el.click();return{ok:true,selector:path(el),checked:Boolean(el.checked)};}
    if(op.kind==='hover'){el.scrollIntoView({block:'center',inline:'nearest'});for(const type of ['mouseover','mouseenter','mousemove'])el.dispatchEvent(new MouseEvent(type,{bubbles:true,cancelable:true,view:window}));return{ok:true,selector:path(el)};}
    if(op.kind==='press_key'){el.focus();const raw=String(op.key||'');const parts=raw.split('+');const key=parts.pop()||raw;const mods={ctrlKey:parts.some(x=>/^control|ctrl$/i.test(x)),shiftKey:parts.some(x=>/^shift$/i.test(x)),altKey:parts.some(x=>/^alt$/i.test(x)),metaKey:parts.some(x=>/^meta|command$/i.test(x))};for(let i=0;i<Math.max(1,Number(op.times||1));i++){el.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true,cancelable:true,...mods}));el.dispatchEvent(new KeyboardEvent('keyup',{key,bubbles:true,cancelable:true,...mods}));if(key==='Enter'&&(el.tagName==='BUTTON'||el.tagName==='A'||el.getAttribute('role')==='button'))el.click();}return{ok:true,selector:path(el),key,times:Math.max(1,Number(op.times||1))};}
    throw new Error(`UNKNOWN_TAB_OP:${op.kind}`);
  }});
  return res?.[0]?.result;
}

async function execute(cmd){
  if(cmd.kind==='tabs'){
    const tabs=await chrome.tabs.query({});const wins=new Map((await chrome.windows.getAll()).map(w=>[w.id,w]));
    return tabs.map(t=>({tab_id:t.id,window_id:t.windowId,title:t.title||'',url:t.url||'',active:Boolean(t.active),window_focused:Boolean(wins.get(t.windowId)?.focused),pinned:Boolean(t.pinned)}));
  }
  if(cmd.kind==='open_tab'){const t=await chrome.tabs.create({url:String(cmd.url||'about:blank'),active:Boolean(cmd.active)});return{tab_id:t.id,window_id:t.windowId,title:t.title||'',url:t.url||'',active:Boolean(t.active)};}
  if(cmd.kind==='close_tab'){await chrome.tabs.remove(Number(cmd.tab_id));return{ok:true,tab_id:Number(cmd.tab_id)};}
  const tabId=Number(cmd.tab_id);if(!Number.isFinite(tabId))throw new Error('TAB_ID_REQUIRED');
  if(cmd.kind==='activate_tab'){const t=await chrome.tabs.get(tabId);await chrome.tabs.update(tabId,{active:true});if(cmd.focus_window!==false)await chrome.windows.update(t.windowId,{focused:true});const u=await chrome.tabs.get(tabId);return{tab_id:u.id,window_id:u.windowId,title:u.title||'',url:u.url||'',active:Boolean(u.active)};}
  if(cmd.kind==='navigate_url'){await chrome.tabs.update(tabId,{url:String(cmd.url)});return{ok:true,tab_id:tabId,url:String(cmd.url)};}
  const writes=new Set(['click','set_value','select','check','batch','navigate','navigate_url','scroll','hover','press_key','mouse_point','mouse_drag']);
  if(writes.has(cmd.kind)&&cmd.allow_active!==true&&await isUserActiveTab(tabId))throw new Error('ACTIVE_TAB_WRITE_BLOCKED');
  if(cmd.kind==='batch'){const out=[];for(const op of(cmd.operations||[])){if(op.kind==='wait'){const ms=Math.max(0,Math.min(Number(op.ms||250),5000));await sleep(ms);out.push({ok:true,waited_ms:ms});continue;}out.push(await runInTab(tabId,op));}return out;}
  return await runInTab(tabId,cmd);
}

function bounded(p,ms){return new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('WORKER_EXEC_TIMEOUT')),ms);Promise.resolve(p).then(v=>{clearTimeout(t);resolve(v)},e=>{clearTimeout(t);reject(e)});});}

chrome.runtime.onMessage.addListener((msg,_sender,sendResponse)=>{
  if(!msg||!msg.bridge_cmd)return;
  bounded(execute(msg.bridge_cmd),6000).then(result=>sendResponse({ok:true,result})).catch(e=>sendResponse({ok:false,error:String(e?.message||e)}));
  return true;
});

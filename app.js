const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r,ms));

const DEMO = {
  alias:'7K3M',
  secret:'atomic-commits-demo-shared-secret',
  demoWindowMs:15000,
  txCap:50,
  monthCap:500,
  monthSpent:0,
  spent:new Set(),
  acceptedWindows:6,
  carried:null,
  lastSuccess:null,
  busy:false
};
const enc = new TextEncoder();
const cache = new Map();

function currentWindow(){ return Math.floor(Date.now()/DEMO.demoWindowMs); }

function setStage(index){
  document.querySelectorAll('.stage-nav div').forEach((el,i)=>el.classList.toggle('active',i===index));
}

async function hmac(message){
  if (window.crypto && window.crypto.subtle){
    const key = await crypto.subtle.importKey('raw',enc.encode(DEMO.secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(message)));
  }
  let h=2166136261;
  const s=DEMO.secret+'|'+message;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return new Uint8Array([(h>>>24)&255,(h>>>16)&255,(h>>>8)&255,h&255]);
}
async function codeForWindow(w){
  if(cache.has(w)) return cache.get(w);
  const bytes=await hmac(`${DEMO.alias}|${w}`);
  let n=0;
  for(let i=0;i<Math.min(bytes.length,6);i++) n=(n*257+bytes[i])>>>0;
  const code=String(n%1000000).padStart(6,'0');
  cache.set(w,code);
  return code;
}
function stamp(){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function log(msg,cls=''){
  const row=document.createElement('div');
  row.className=cls;
  row.textContent=`${stamp()}  ${msg}`;
  $('#console').appendChild(row);
  $('#console').scrollTop=$('#console').scrollHeight;
  while($('#console').children.length>60) $('#console').removeChild($('#console').firstChild);
}
function verdict(text,cls=''){
  $('#verdict').textContent=text;
  $('#verdict').className='verdict'+(cls?' '+cls:'');
}
async function tick(){
  const w=currentWindow();
  $('#buyerCode').textContent=await codeForWindow(w);
  const remaining=DEMO.demoWindowMs-(Date.now()%DEMO.demoWindowMs);
  $('#timerFill').style.width=(remaining/DEMO.demoWindowMs*100)+'%';
  $('#timerText').textContent=`rotates in ${(remaining/1000).toFixed(1)}s`;
}
setInterval(tick,200); tick();

$('#sendBtn').addEventListener('click',async()=>{
  const w=currentWindow(),code=await codeForWindow(w);
  DEMO.carried={alias:DEMO.alias,code,window:w};
  setStage(1);
  $('#payerId').value=DEMO.alias;
  $('#merchantCode').value=code;
  verdict('Code received. Enter an amount and redeem.','pending');
  log(`payer → merchant: ${DEMO.alias} ${code}`,'dim');
});

async function verify(alias,code,count){
  if(alias!==DEMO.alias) return {ok:false,reason:'unknown payer ID'};
  if(DEMO.spent.has(`${alias}:${code}`)) return {ok:false,reason:'code already used'};
  const now=currentWindow();
  for(let i=0;i<count;i++){
    if(await codeForWindow(now-i)===code) return {ok:true};
  }
  return {ok:false,reason:'code expired or invalid'};
}
function updateGrant(){
  const pct=Math.min(100,DEMO.monthSpent/DEMO.monthCap*100);
  $('#grantFill').style.width=pct+'%';
  $('#grantUsed').textContent=`R${DEMO.monthSpent.toFixed(2)} used`;
}
async function redeem(){
  if(DEMO.busy) return;
  DEMO.busy=true;
  $('#redeemBtn').disabled=true;
  $('#replayBtn').disabled=true;

  const alias=$('#payerId').value.trim().toUpperCase();
  const code=$('#merchantCode').value.trim();
  const amount=Number($('#amount').value||0);
  const wallet=$('#wallet').value.trim();
  const windows=DEMO.acceptedWindows;

  setStage(1);
  verdict('Verifying…','pending');
  log(`POST /redeem { payer:${alias}, code:${code}, amount:R${amount.toFixed(2)} }`);
  await sleep(280);

  const v=await verify(alias,code,windows);
  if(!v.ok){log(`reject · ${v.reason}`,'bad');verdict(`Rejected — ${v.reason}.`,'bad');finish();return}
  log('auth · payer located, code matches accepted time window','ok');
  await sleep(220);

  if(amount<=0 || amount>DEMO.txCap){log(`policy · amount exceeds R${DEMO.txCap} per-code cap`,'bad');verdict(`Rejected — per-code limit is R${DEMO.txCap}.`,'bad');finish();return}
  if(DEMO.monthSpent+amount>DEMO.monthCap){log('grant · monthly Open Payments limit would be exceeded','bad');verdict('Rejected — monthly wallet permission exhausted.','bad');finish();return}
  if(!wallet){log('merchant · wallet address missing','bad');verdict('Rejected — merchant wallet missing.','bad');finish();return}

  const key=`${alias}:${code}`;
  DEMO.spent.add(key);
  log('replay guard · authorization claimed once','ok');
  await sleep(220);
  log(`Open Payments · incoming payment for ${wallet}`,'op');
  await sleep(260);
  log('Open Payments · quote created','op');
  await sleep(260);
  log('Open Payments · outgoing payment created using existing grant','op');
  await sleep(380);

  DEMO.monthSpent+=amount;
  DEMO.lastSuccess={alias,code,amount,wallet,windows};
  setStage(2);
  updateGrant();
  log('complete · payment executed','ok');
  verdict(`Approved · R${amount.toFixed(2)} → ${wallet}`,'ok');
  finish(true);

  function finish(success=false){
    DEMO.busy=false;
    $('#redeemBtn').disabled=false;
    $('#replayBtn').disabled=!(success||DEMO.lastSuccess);
  }
}
$('#redeemBtn').addEventListener('click',redeem);
$('#replayBtn').addEventListener('click',()=>{
  if(!DEMO.lastSuccess) return;
  $('#payerId').value=DEMO.lastSuccess.alias;
  $('#merchantCode').value=DEMO.lastSuccess.code;
  $('#amount').value=DEMO.lastSuccess.amount.toFixed(2);
  $('#wallet').value=DEMO.lastSuccess.wallet;
  redeem();
});

function updateCost(){
  const perDay=Number($('#txnSlider').value);
  const perMonth=perDay*30;
  const mb=perMonth*10/1000;
  const cost=perMonth/1000*2;
  $('#txnLabel').textContent=perDay;
  $('#dataOut').textContent=(mb<10?mb.toFixed(1):Math.round(mb))+' MB';
  $('#costOut').textContent='R'+(cost<10?cost.toFixed(2):cost.toFixed(1));
}
$('#txnSlider').addEventListener('input',updateCost);
updateCost();updateGrant();
log('setup · payer secret registered with Atomic Commits','dim');
log('grant · outgoing-payment permission active · R500/month','dim');
'use strict';
const $=id=>document.getElementById(id), money=v=>v==null?'—':Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}), pct=v=>v==null?'—':`${v>0?'+':''}${Number(v).toFixed(2)}%`;
const PUBLIC_URL='https://raw.githubusercontent.com/yun2985-lab/Team-1030/trading-data/latest.json';
const stamp=v=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'—';
let current=null,endpoint='',token='',demo=false,days=0,tab='positions',pending=false,generation=0;
const set=(id,text)=>{$(id).textContent=text;},tone=(el,n)=>{el.classList.toggle('positive',n>0);el.classList.toggle('negative',n<0);};
function emptyChart(id,message='연결 후 차트가 표시됩니다'){$(id).replaceChildren();const x=document.createElement('div');x.className='empty';x.textContent=message;$(id).append(x);}
function svgNode(tag,attrs={},text=''){const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);n.textContent=text;return n;}
function chart(id,rows,type){
 if(!rows.length){emptyChart(id);return;}
 const host=$(id),width=700,height=230,pad={l:16,r:64,t:18,b:30};const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':host.getAttribute('aria-label')});
 let values=rows.flatMap(r=>type==='candle'?[Number(r.l),Number(r.h)]:[Number(r.pnl)]);let lo=Math.min(...values),hi=Math.max(...values);
 if(type==='bar'){lo=Math.min(lo,0);hi=Math.max(hi,0);}if(lo===hi){lo-=1;hi+=1;}else{let d=(hi-lo)*.08;lo-=d;hi+=d;}
 const x=i=>pad.l+i*(width-pad.l-pad.r)/Math.max(rows.length-1,1),y=v=>pad.t+(hi-v)/(hi-lo)*(height-pad.t-pad.b);
 for(let i=0;i<4;i++){let v=lo+(hi-lo)*i/3,yy=y(v);svg.append(svgNode('line',{x1:pad.l,x2:width-pad.r,y1:yy,y2:yy,stroke:'#25303d','stroke-dasharray':'3 5'}),svgNode('text',{x:width-pad.r+8,y:yy+4},money(v)));}
 if(type==='line'){
  const path=rows.map((r,i)=>`${i?'L':'M'}${x(i)},${y(Number(r.pnl))}`).join(' ');
  const defs=svgNode('defs'),g=svgNode('linearGradient',{id:'pnlFill',x1:0,y1:0,x2:0,y2:1});g.append(svgNode('stop',{offset:'0%','stop-color':'#c9ed82','stop-opacity':'.18'}),svgNode('stop',{offset:'100%','stop-color':'#c9ed82','stop-opacity':'0'}));defs.append(g);svg.append(defs);
  svg.append(svgNode('path',{d:path+` L${x(rows.length-1)},${height-pad.b} L${x(0)},${height-pad.b} Z`,fill:'url(#pnlFill)'}),svgNode('path',{d:path,fill:'none',stroke:'#c9ed82','stroke-width':'2'}));
  rows.forEach((r,i)=>{const circle=svgNode('circle',{cx:x(i),cy:y(Number(r.pnl)),r:3,fill:'#d6f283',opacity:rows.length===1?'1':'0'});circle.append(svgNode('title',{},`${stamp(r.at)} · ${money(r.pnl)} USDT`));svg.append(circle);});
 }else rows.forEach((r,i)=>{
  let xx=x(i),bw=Math.max(2,Math.min(24,(width-pad.l-pad.r)/rows.length*.65));
  if(type==='candle'){let up=Number(r.c)>=Number(r.o),color=up?'#6ed2ad':'#e87985';svg.append(svgNode('line',{x1:xx,x2:xx,y1:y(Number(r.h)),y2:y(Number(r.l)),stroke:color}));const rect=svgNode('rect',{x:xx-bw/2,y:Math.min(y(Number(r.o)),y(Number(r.c))),width:bw,height:Math.max(1,Math.abs(y(Number(r.o))-y(Number(r.c)))),fill:color});rect.append(svgNode('title',{},`${stamp(r.t*1000)} · O ${r.o} H ${r.h} L ${r.l} C ${r.c}`));svg.append(rect);
  }else{let val=Number(r.pnl);const rect=svgNode('rect',{x:xx-bw/2,y:Math.min(y(val),y(0)),width:bw,height:Math.max(1,Math.abs(y(val)-y(0))),fill:val>=0?'#9bc875':'#df7c88',rx:2});rect.append(svgNode('title',{},`${r.date} · ${money(val)} USDT`));svg.append(rect);}
 });
 [0,Math.floor((rows.length-1)/2),rows.length-1].filter((v,i,a)=>a.indexOf(v)===i).forEach(i=>{let r=rows[i],label=r.date?r.date.slice(5):new Date(r.at||r.t*1000).toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit'});svg.append(svgNode('text',{x:x(i),y:height-5,'text-anchor':i===0?'start':i===rows.length-1?'end':'middle'},label));});host.replaceChildren(svg);
}
function row(cells){let tr=document.createElement('tr');cells.forEach(c=>{let td=document.createElement('td');td.textContent=typeof c==='object'?c.text:c;if(typeof c==='object'&&c.tone!=null)tone(td,c.tone);tr.append(td);});return tr;}
function emptyTable(body,span,message){let tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=span;td.className='empty-cell';td.textContent=message;tr.append(td);body.append(tr);}
function renderTable(){
 const head=$('tableHead'),body=$('tableBody');head.replaceChildren();body.replaceChildren();
 const headers=tab==='positions'?['종목 / 방향','수량 (BTC)','평균 진입가','현재 마크가','미실현 손익','가격 수익률']:tab==='orders'?['주문번호','방향','가격','남은 계약수','주문 유형','상태']:['체결 시각 (KST)','방향','가격','계약수','수수료','실현 손익'];
 let tr=document.createElement('tr');headers.forEach(h=>{let th=document.createElement('th');th.textContent=h;tr.append(th);});head.append(tr);
 const items=current?.[tab]||[];if(!items.length){emptyTable(body,headers.length,current?.connection==='connected'?'해당 내역이 없습니다.':'서버 연결 후 내역이 표시됩니다.');return;}
 items.forEach(r=>body.append(row(tab==='positions'?[`BTC/USDT · ${r.side}`,r.size,money(r.entry),money(r.mark),{text:money(r.pnl),tone:r.pnl},{text:pct(r.priceReturnPct),tone:r.priceReturnPct}]:tab==='orders'?[r.id,Number(r.size)>0?'매수':'매도',Number(r.price)===0?'시장가':money(r.price),r.left,r.reduce_only?'익절 · Reduce-only':r.tif==='ioc'?'시장가 IOC':'지정가',r.status]:[stamp(Number(r.create_time_ms)),Number(r.size)>0?'매수':'매도',money(r.price),Math.abs(Number(r.size)),money(r.fee),{text:money(r.realized_pnl),tone:Number(r.realized_pnl)}])));
}
function render(v){
 current=v;for(let id of ['equity','available','realizedNetPnl','unrealizedPnl','lastPrice']){set(id,money(v?.[id]));if(['realizedNetPnl','unrealizedPnl'].includes(id))tone($(id),v?.[id]||0);}
 for(let id of ['totalReturnPct','dailyReturnPct','currentLossPct','drawdownPct']){set(id,id==='drawdownPct'&&v?.[id]!=null?Number(v[id]).toFixed(2)+'%':pct(v?.[id]));tone($(id),id==='drawdownPct'?-(v?.[id]||0):v?.[id]||0);}
 const stale=v?.updatedAt&&Date.now()-v.updatedAt>(v.source==='phone-github'?660000:90000),connected=v?.connection==='connected'&&!stale;
 set('connection',demo?'DEMO · 가상 데이터':connected?`${v.environment.toUpperCase()} · ${v.source==='phone-github'?'GitHub 공개':'연결됨'}`:v?.updatedAt?'데이터 지연':'연결 대기');
 set('clock',v?.updatedAt?new Date(v.updatedAt).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false})+' KST':'—');
 $('notice').classList.toggle('demo',demo);set('notice',demo?'데모 모드입니다. 아래 수치·포지션·전략은 화면 확인용 가상 데이터이며 실제 거래 결과가 아닙니다.':!connected?(v?.error||'휴대폰의 첫 공개 게시를 기다리고 있습니다. 앱에서 GitHub 공개 게시를 시작하세요.')+(v?.updatedAt?' · 마지막 데이터: '+stamp(v.updatedAt):''):`${v.source==='phone-github'?'휴대폰 공개본 · 게시 '+stamp(v.publishedAt)+' · ':''}${v.environment==='prod'?'실계좌':'테스트넷'} · ${v.scope} · ${v.tradingUnlocked?'주문 연결 허용':'실거래 잠금'} · ${v.engineConnected?'앱 감시 연결':'앱 감시 미연결'}${v.source==='phone-github'?' (게시 당시)':''}`);
 const curve=(v?.curve||[]).filter(r=>!days||r.at>=Date.now()-days*86400000);
 chart('equityChart',curve,'line');chart('candleChart',v?.candles||[],'candle');
 set('chartPnl',money(curve.at(-1)?.pnl));set('baseline','관측 시작 '+stamp(v?.baselineAt));set('positionCount',String(v?.positions?.length||0));renderTable();
 const daily=(v?.daily||[]).slice(-14);chart('dailyChart',daily,'bar');$('dailyBody').replaceChildren();
 daily.slice().reverse().forEach(d=>$('dailyBody').append(row([d.date,{text:money(d.pnl),tone:d.pnl},{text:pct(d.returnPct),tone:d.returnPct},d.partial?'부분 집계':'관측 구간'])));
 if(!daily.length)emptyTable($('dailyBody'),4,'성과 데이터 수집 대기');
 set('engine',stale?'상태 갱신 지연':v?.engineConnected?(v.source==='phone-github'?'게시 당시 감시 연결':'앱 감시 연결'):'앱 미연결');$('strategyList').replaceChildren();
 const strategies=v?.strategies||[];
 if(!strategies.length){let x=document.createElement('p');x.textContent='앱에서 등록한 전략이 여기에 표시됩니다.';x.style.padding='20px 0';$('strategyList').append(x);}
 strategies.forEach(s=>{let item=document.createElement('div');item.className='strategy';let name=document.createElement('div'),b=document.createElement('b'),small=document.createElement('small'),status=document.createElement('span');b.textContent=s.name;small.textContent=s.error||'0.9.35 전략 엔진';name.append(b,small);status.className='badge';status.textContent=s.status;item.append(name,status);$('strategyList').append(item);});
}
async function fetchSnapshot(base,key){const r=await fetch(base+'/api/dashboard',{headers:{Authorization:'Bearer '+key},cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(r.status===401?'조회 토큰을 확인하세요.':`서버 응답 오류 (${r.status})`);return r.json();}
async function refresh(){if(demo||pending)return;pending=true;const epoch=generation;try{
 let v;if(endpoint&&token)v=await fetchSnapshot(endpoint,token);else{
 const r=await fetch(PUBLIC_URL+'?t='+Math.floor(Date.now()/60000),{cache:'no-store',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error(r.status===404?'휴대폰의 첫 공개 게시를 기다리고 있습니다.':`GitHub 조회 오류 (${r.status})`);
 v=await r.json();if(v.source!=='phone-github'||v.schemaVersion!==1)throw new Error('공개 데이터 형식을 확인하세요.');
 }
 if(epoch===generation)render(v);
 }catch(e){if(epoch===generation)render({...current,connection:current?.updatedAt?'stale':'disconnected',error:e.message});}finally{pending=false;}}
$('connect').onclick=()=>{$('endpoint').value=endpoint||localStorage.getItem('team1030-endpoint')||'';$('token').value='';set('connectError','');$('settings').showModal();};
$('cancel').onclick=()=>{$('settings').close();$('token').value='';};
$('disconnect').onclick=()=>{generation++;endpoint='';token='';demo=false;current=null;localStorage.removeItem('team1030-endpoint');$('settings').close();$('token').value='';render(null);refresh();};
$('settingsForm').onsubmit=async e=>{e.preventDefault();set('connectError','연결 확인 중…');try{let u=new URL($('endpoint').value);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&u.hostname==='127.0.0.1'))throw new Error('HTTPS 서버 주소를 입력하세요.');if(u.username||u.password||u.search||u.hash)throw new Error('사용자정보·쿼리 없는 서버 주소를 입력하세요.');let base=u.href.replace(/\/$/,''),key=$('token').value.trim(),v=await fetchSnapshot(base,key);generation++;endpoint=base;token=key;demo=false;localStorage.setItem('team1030-endpoint',endpoint);$('token').value='';$('settings').close();render(v);}catch(e){set('connectError',e.message);}};
$('refresh').onclick=()=>{if(demo){generation++;demo=false;current=null;}refresh();};$('ranges').onclick=e=>{if(!e.target.dataset.days)return;days=Number(e.target.dataset.days);$('ranges').querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===e.target));render(current);};
document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;document.querySelectorAll('[data-tab]').forEach(t=>t.classList.toggle('selected',t===b));renderTable();});
$('demo').onclick=()=>{generation++;token='';demo=true;let now=Date.now(),base=now-14*86400000,curve=[],daily=[],candles=[],p=0;for(let i=0;i<15;i++){let step=i?Math.sin(i*1.7)*65+38:0;p+=step;curve.push({at:base+i*86400000,pnl:p,returnPct:p/100,equity:10000+p});daily.push({date:new Date(base+i*86400000).toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}),pnl:step,returnPct:step/100,partial:i===0});}let price=97500;for(let i=0;i<100;i++){let o=price,c=o+Math.sin(i*1.4)*90+Math.cos(i*.1)*25;price=c;candles.push({t:Math.floor(now/900000)*900-(99-i)*900,o,h:Math.max(o,c)+40,l:Math.min(o,c)-40,c});}render({connection:'connected',environment:'demo',updatedAt:now,baselineAt:base,equity:10000+p,available:8760,totalReturnPct:p/100,realizedNetPnl:p+34,unrealizedPnl:-34,currentLossPct:-.34,dailyReturnPct:daily.at(-1).returnPct,drawdownPct:.64,curve,daily,candles,lastPrice:price,engineConnected:true,strategies:[{name:'지지저항 돌파',status:'ON · 신호 감시'},{name:'RSI 다이버전스',status:'ON · 신호 감시'},{name:'1분 삼각형',status:'OFF · 청산 유지'},{name:'구출모드',status:'대기'}],positions:[{symbol:'BTC_USDT_Perp',side:'LONG',size:.03,entry:98500,mark:97366.67,pnl:-34,priceReturnPct:-1.15}],orders:[],fills:[]});};
setInterval(refresh,60000);render(null);refresh();

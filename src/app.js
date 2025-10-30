(() => {
  const nowTime = document.getElementById('nowTime');
  const nowDate = document.getElementById('nowDate');
  const alarmForm = document.getElementById('alarmForm');
  const timeInput = document.getElementById('timeInput');
  const labelInput = document.getElementById('labelInput');
  const snoozeInput = document.getElementById('snoozeInput');
  const toneSelect = document.getElementById('toneSelect');
  const weekWrap = alarmForm.querySelector('.week');
  const alarmList = document.getElementById('alarmList');
  const notifyBtn = document.getElementById('notifyBtn');
  const ringDialog = document.getElementById('ringDialog');
  const ringLabel = document.getElementById('ringLabel');
  const stopBtn = document.getElementById('stopBtn');
  const snoozeBtn = document.getElementById('snoozeBtn');
  const snoozeMinutesText = document.getElementById('snoozeMinutes');

  /** State */
  /** @type {Array<Alarm>} */
  let alarms = [];
  let audioCtx = null;
  let ringStopper = null;
  let lastTickMinute = '';

  function fmt2(n){return String(n).padStart(2,'0')}
  function todayStr(){
    const d = new Date();
    return `${d.getFullYear()}-${fmt2(d.getMonth()+1)}-${fmt2(d.getDate())}`;
  }
  function hmStr(date){return `${fmt2(date.getHours())}:${fmt2(date.getMinutes())}`}

  function tickNow(){
    const d = new Date();
    nowTime.textContent = `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}:${fmt2(d.getSeconds())}`;
    nowDate.textContent = d.toLocaleDateString('zh-CN', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  }

  /** Model */
  function load(){
    try { alarms = JSON.parse(localStorage.getItem('alarms')||'[]'); }
    catch{ alarms = []; }
  }
  function save(){ localStorage.setItem('alarms', JSON.stringify(alarms)); }

  function nextOccurrence(hhmm, days){
    const now = new Date();
    const [h,m] = hhmm.split(':').map(Number);
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
    if (!days || days.length === 0){
      if (base <= now) base.setDate(base.getDate()+1);
      return base.getTime();
    }
    // repeating: find next day in days[] from today
    for (let i=0;i<8;i++){
      const check = new Date(base.getTime());
      check.setDate(check.getDate()+i);
      const dow = check.getDay(); // 0-6, 0=Sun
      if (days.includes(dow)){
        if (i===0 && base>now) return base.getTime();
        if (i>0) return new Date(check.getFullYear(),check.getMonth(),check.getDate(),h,m,0,0).getTime();
      }
    }
    return base.getTime();
  }

  function render(){
    alarmList.innerHTML='';
    if (!alarms.length){
      const li=document.createElement('li');
      li.className='muted'; li.textContent='尚未添加闹钟';
      alarmList.appendChild(li); return;
    }
    for (const a of alarms){
      const li=document.createElement('li'); li.className='alarm-item';
      const left=document.createElement('div'); left.className='alarm-left';
      const time=document.createElement('div'); time.className='alarm-time'; time.textContent=a.time;
      const meta=document.createElement('div'); meta.className='alarm-meta';
      if (a.label) { const c=document.createElement('span'); c.className='chip'; c.textContent=a.label; meta.appendChild(c); }
      if (a.days && a.days.length){ const c=document.createElement('span'); c.className='chip'; c.textContent=`重复: ${a.days.map(dowName).join('')}`; meta.appendChild(c); }
      const nextTs = nextOccurrence(a.time, a.days);
      const c2=document.createElement('span'); c2.className='chip'; c2.title=new Date(nextTs).toLocaleString(); c2.textContent='下次: '+relTime(nextTs); meta.appendChild(c2);
      left.appendChild(time); left.appendChild(meta);

      const actions=document.createElement('div'); actions.className='row-actions';
      const toggle=document.createElement('input'); toggle.type='checkbox'; toggle.checked=!!a.enabled; toggle.title='启用/停用';
      toggle.addEventListener('change',()=>{ a.enabled=toggle.checked; a.lastFiredKey=null; save(); render(); });
      const edit=document.createElement('button'); edit.textContent='编辑';
      edit.addEventListener('click',()=> editAlarm(a.id));
      const del=document.createElement('button'); del.textContent='删除';
      del.addEventListener('click',()=> deleteAlarm(a.id));
      actions.appendChild(toggle); actions.appendChild(edit); actions.appendChild(del);

      li.appendChild(left); li.appendChild(actions);
      alarmList.appendChild(li);
    }
  }

  function relTime(ts){
    const diff = ts - Date.now();
    if (diff<=0) return '即将';
    const mins = Math.round(diff/60000);
    if (mins<60) return `${mins} 分钟后`;
    const hours = Math.floor(mins/60);
    const rmins = mins%60;
    return `${hours} 小时 ${rmins} 分`;
  }
  function dowName(d){ return '日一二三四五六'[d]; }

  function createAlarm({time,label,snooze,days,tone}){
    const id = crypto.randomUUID();
    alarms.push({ id, time, label:label||'', snooze: clamp(parseInt(snooze)||5,1,30), days: (days||[]).map(Number), tone: tone||'chime', enabled:true, lastFiredKey:null });
    save(); render();
  }
  function updateAlarm(id, patch){
    const a = alarms.find(x=>x.id===id); if (!a) return;
    Object.assign(a, patch);
    if ('time' in patch || 'days' in patch) a.lastFiredKey=null;
    save(); render();
  }
  function deleteAlarm(id){ alarms = alarms.filter(x=>x.id!==id); save(); render(); }

  function editAlarm(id){
    const a = alarms.find(x=>x.id===id); if (!a) return;
    timeInput.value = a.time;
    labelInput.value = a.label||'';
    snoozeInput.value = a.snooze||5;
    toneSelect.value = a.tone||'chime';
    Array.from(weekWrap.querySelectorAll('input[type="checkbox"]')).forEach(cb=>{ cb.checked = (a.days||[]).includes(Number(cb.value)); });
    // On next submit, treat as update
    alarmForm.dataset.editing = id;
  }

  function clamp(n,min,max){ return Math.max(min, Math.min(max,n)); }

  function readFormDays(){
    return Array.from(weekWrap.querySelectorAll('input[type="checkbox"]:checked')).map(cb=>Number(cb.value));
  }

  alarmForm.addEventListener('submit', (e)=>{
    e.preventDefault();
    const time = timeInput.value;
    if (!time){ alert('请选择时间'); return; }
    const label = labelInput.value.trim();
    const snooze = parseInt(snoozeInput.value)||5;
    const days = readFormDays();
    const tone = toneSelect.value;
    const editing = alarmForm.dataset.editing;
    if (editing){
      updateAlarm(editing, { time, label, snooze, days, tone, enabled:true });
      delete alarmForm.dataset.editing;
    } else {
      createAlarm({ time, label, snooze, days, tone });
    }
    alarmForm.reset();
  });

  notifyBtn.addEventListener('click', async ()=>{
    try{
      const res = await Notification.requestPermission();
      alert(res==='granted'?'已授权通知':'未授权通知');
    }catch{}
  });

  /** Ringer */
  function ensureCtx(){
    if (!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  }
  function playTone(kind='chime'){
    ensureCtx();
    const ctx = audioCtx;
    const master = ctx.createGain(); master.gain.value=0.0; master.connect(ctx.destination);
    const seq = [];
    if (kind==='beep'){
      for (let i=0;i<4;i++) seq.push({type:'square', freq: 1000, dur:0.2, gap:0.1});
    } else if (kind==='soft'){
      for (let i=0;i<3;i++) seq.push({type:'sine', freq: 520, dur:0.6, gap:0.15});
    } else {
      for (let i=0;i<3;i++) seq.push({type:'triangle', freq: 660, dur:0.35, gap:0.12},{type:'triangle', freq: 880, dur:0.35, gap:0.2});
    }
    const startT = ctx.currentTime + 0.02;
    let t = startT;
    seq.forEach(note=>{
      const osc = ctx.createOscillator(); osc.type=note.type; osc.frequency.value=note.freq;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.8, t+0.02);
      g.gain.setTargetAtTime(0.0001, t+note.dur-0.05, 0.03);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(t+note.dur);
      t += note.dur + note.gap;
    });
    master.gain.setTargetAtTime(1.0, startT, 0.03);
    master.gain.setTargetAtTime(0.0001, t, 0.05);
    return () => { master.disconnect(); };
  }

  function showRingUI(alarm){
    ringLabel.textContent = alarm.label || alarm.time;
    snoozeMinutesText.textContent = String(alarm.snooze||5);
    ringDialog.showModal();
  }
  function hideRingUI(){ if (ringDialog.open) ringDialog.close(); }

  stopBtn.addEventListener('click', ()=>{ stopRinging(); });
  snoozeBtn.addEventListener('click', ()=>{
    if (!currentRinging) return; 
    const a = currentRinging; stopRinging();
    // schedule one-off snooze in minutes
    const when = Date.now() + (a.snooze||5)*60000;
    a.snoozeOnceAt = when;
    save(); render();
  });

  let currentRinging = null;
  function ring(alarm){
    currentRinging = alarm;
    try{ if (Notification.permission==='granted') new Notification('闹钟', { body: alarm.label||alarm.time }); }catch{}
    ringStopper = playTone(alarm.tone||'chime');
    showRingUI(alarm);
  }
  function stopRinging(){
    if (ringStopper){ try{ ringStopper(); }catch{} ringStopper=null; }
    currentRinging = null;
    hideRingUI();
  }

  /** Scheduler */
  function minuteKey(date){ return `${date.getFullYear()}-${fmt2(date.getMonth()+1)}-${fmt2(date.getDate())} ${fmt2(date.getHours())}:${fmt2(date.getMinutes())}`; }
  function shouldFire(alarm, now){
    if (!alarm.enabled) return false;
    const key = minuteKey(now);
    if (alarm.lastFiredKey === key) return false; // already fired this minute

    // if snooze once exists
    if (alarm.snoozeOnceAt){
      if (now.getTime() >= alarm.snoozeOnceAt){ delete alarm.snoozeOnceAt; return true; }
      return false;
    }

    // repeating or one-off
    const hm = hmStr(now);
    if (hm !== alarm.time) return false;
    if (alarm.days && alarm.days.length>0){
      if (!alarm.days.includes(now.getDay())) return false;
    }
    return true;
  }
  function postFireUpdate(alarm, now){
    const key = minuteKey(now);
    alarm.lastFiredKey = key;
    save();
  }

  function schedulerTick(){
    const now = new Date();
    const mk = minuteKey(now);
    if (lastTickMinute !== mk){
      lastTickMinute = mk;
      for (const a of alarms){
        try{
          if (shouldFire(a, now)){
            ring(a);
            postFireUpdate(a, now);
            break; // handle one at a time
          }
        }catch{}
      }
    }
  }

  /** Init */
  function init(){
    load(); render(); tickNow();
    setInterval(tickNow, 1000);
    setInterval(schedulerTick, 1000);
    // default time to next rounded minute
    const d=new Date(); d.setMinutes(d.getMinutes()+1); d.setSeconds(0);
    timeInput.value = `${fmt2(d.getHours())}:${fmt2(d.getMinutes())}`;
    // set snooze display link
    snoozeMinutesText.textContent = String(parseInt(snoozeInput.value)||5);
    snoozeInput.addEventListener('input', ()=>{
      snoozeMinutesText.textContent = String(parseInt(snoozeInput.value)||5);
    });
  }

  document.addEventListener('visibilitychange', ()=>{
    if (!audioCtx) return;
    if (document.visibilityState==='visible' && audioCtx.state==='suspended') audioCtx.resume();
  });

  init();
})();



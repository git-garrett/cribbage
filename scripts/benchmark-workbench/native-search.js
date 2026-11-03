/* Read-only views of the C++ Model 32/33 campaign receipts. */
window.NativeSearchWorkbench = (() => {
  const choices = new Map();
  const colors = ['#168f83', '#9361c9'];
  const el = (tag, text, cls) => {
    const node = document.createElement(tag);
    if (text != null) node.textContent = text;
    if (cls) node.className = cls;
    return node;
  };
  const svg = (tag, attrs, text) => {
    const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    if (text != null) node.textContent = text;
    return node;
  };
  const pct = n => n == null ? '—' : `${(n * 100).toFixed(2)}%`;
  const table = (headers, rows) => {
    const wrap = el('div', null, 'table-scroll'), t = el('table'), head = el('thead'), hr = el('tr'), body = el('tbody');
    headers.forEach(h => hr.append(el('th', h))); head.append(hr);
    rows.forEach(row => { const tr = el('tr'); row.forEach(v => tr.append(el('td', v))); body.append(tr); });
    t.append(head, body); wrap.append(t); return wrap;
  };
  function graph(series, {loss = false, reference = null, bestHours = null} = {}) {
    const chart = svg('svg', {viewBox: '0 0 900 320', class: 'chart', role: 'img', 'aria-label': loss ? 'Held-out loss by fitting hours; lower is better' : 'Win rate by training hours with paired 95 percent intervals'});
    const all = series.flatMap(s => s.history);
    if (!all.length) { chart.append(svg('text', {x: 80, y: 100, fill: 'currentColor'}, 'Waiting for completed assessments')); return chart; }
    const values = all.flatMap(p => loss ? [p.loss] : [p.winRate, ...(p.paired95 || [])]);
    if (reference != null) values.push(reference);
    const maxX = Math.max(.1, ...all.map(p => p.hours));
    const rawMin = Math.min(...values), rawMax = Math.max(...values), pad = Math.max(loss ? .005 : .01, (rawMax-rawMin)*.12);
    const minY = Math.max(0, rawMin-pad), maxY = Math.min(loss ? Infinity : 1, rawMax+pad);
    const x = n => 75+n/maxX*800, y = n => 265-(n-minY)/(maxY-minY)*235;
    for (let i=0; i<=4; i++) {
      const v=minY+(maxY-minY)*i/4, h=maxX*i/4;
      chart.append(svg('line',{x1:75,y1:y(v),x2:875,y2:y(v),stroke:'currentColor',opacity:'.12'}));
      chart.append(svg('text',{x:65,y:y(v)+4,'text-anchor':'end',fill:'currentColor','font-size':12},loss?v.toFixed(3):pct(v)));
      chart.append(svg('text',{x:x(h),y:287,'text-anchor':'middle',fill:'currentColor','font-size':12},h.toFixed(2)));
    }
    chart.append(svg('text',{x:475,y:312,'text-anchor':'middle',fill:'currentColor','font-size':13},loss?'Offline fitting hours':'Live training hours, including finalist / confirmation training'));
    if (reference != null) {
      chart.append(svg('line',{x1:75,x2:875,y1:y(reference),y2:y(reference),stroke:'#b47919','stroke-dasharray':'6 4'}));
      chart.append(svg('text',{x:870,y:y(reference)-6,'text-anchor':'end',fill:'#b47919','font-size':12},`Model 31 · ${pct(reference)}`));
    }
    series.forEach((s,index) => {
      const color=colors[index%colors.length];
      for (let i=1;i<s.history.length;i++) {
        const a=s.history[i-1],b=s.history[i];
        chart.append(svg('line',{x1:x(a.hours),y1:y(loss?a.loss:a.winRate),x2:x(b.hours),y2:y(loss?b.loss:b.winRate),stroke:color,'stroke-width':2,'stroke-dasharray':!loss&&b.phase!=='Continued training'?'5 3':'none'}));
      }
      for (const p of s.history) {
        if (!loss && p.paired95) chart.append(svg('line',{x1:x(p.hours),x2:x(p.hours),y1:y(p.paired95[0]),y2:y(p.paired95[1]),stroke:color,opacity:'.4','stroke-width':2}));
        const best=loss?bestHours!=null&&Math.abs(p.hours-bestHours)<1e-7:p.phase==='Continued training'&&p.round===s.bestRound;
        const dot=svg('circle',{cx:x(p.hours),cy:y(loss?p.loss:p.winRate),r:best?6:3,fill:color,stroke:best?'currentColor':color,'stroke-width':best?2:1});
        dot.append(svg('title',{},`${s.label}: ${p.hours.toFixed(2)} hours · ${loss?p.loss.toFixed(5):pct(p.winRate)+' · '+p.phase+' · round '+p.round}${best?' · saved best checkpoint':''}`));chart.append(dot);
      }
    });
    return chart;
  }
  function chartPanel(series, options) {
    const wrap=el('div',null,'table-scroll'), chart=graph(series,options);
    chart.style.minWidth='600px';wrap.append(chart);return wrap;
  }
  function render(value) {
    let panel=document.getElementById('native-search-report');
    if (!panel) {panel=el('div');panel.id='native-search-report';document.getElementById('training-report').after(panel);}
    panel.hidden=false;panel.replaceChildren();document.getElementById('training-report').hidden=true;
    const section=title=>{const node=el('section',null,'panel');node.append(el('h2',title));panel.append(node);return node;};
    const top=section(value.title), a=value.activity, cfg=value.config;
    top.append(el('p',a.label));
    top.append(el('p',`Campaign: ${a.state} · ${a.stage || 'preparing'}. Refreshed ${new Date(value.asOf*1000).toLocaleTimeString()}.`,'caption'));
    if (a.gamesPlanned) top.append(el('p',`${a.gamesCompleted.toLocaleString()} / ${a.gamesPlanned.toLocaleString()} self-play games in this round.`));
    if (cfg.widths) top.append(el('p',`Hidden widths ${cfg.widths.join(' / ')} · learning rate ${cfg.rate}${value.model===33?` · ${cfg.mixtures} mixture components · auxiliary weight ${cfg.auxiliary}`:''}.`));
    const pace=value.pace;
    top.append(el('p',pace?`Latest completed training round: ${pace.gamesPerSecond.toFixed(2)} games/second (${Math.round(pace.gamesPerSecond*3600).toLocaleString()}/hour), including self-play, learning and WP updates. ${pace.run}, round ${pace.round}.`:'Training throughput will appear after a continued-training round completes.'));
    top.append(el('p','Throughput excludes evaluation, archiving and time waiting for the GPU.','caption'));
    const strength=section('Playing strength over time');
    const legend=el('p');
    value.seeds.forEach((s,i)=>{const label=el('span',`Seed ${s.seed}${s.initializationSeed!=null?' ('+s.initializationSeed+')':''}  `);label.style.color=colors[i];label.style.marginRight='1em';legend.append(label);});strength.append(legend);
    strength.append(chartPanel(value.seeds.map(s=>({...s,label:`Seed ${s.seed}`})),{reference:value.reference?.winRate}));
    strength.append(el('p',`Opponent: ${value.opponent}. Each point is a separate checkpoint evaluation; vertical bars are paired 95% intervals. Dashed segments are finalist testing or independent confirmation; solid segments continue the same seed’s saved checkpoint. Outlined dots mark saved best continued-training checkpoints.`,'caption'));
    strength.append(el('p','The x-axis includes inherited live training and excludes offline pretraining, evaluation, archiving and GPU queue time. Seeds remain separate; intervals describe individual checks and do not prove a trend.','caption'));
    if (value.reference) strength.append(el('p',`${value.reference.label}: ${pct(value.reference.winRate)} over ${value.reference.games.toLocaleString()} games against the same reference opponent. This horizontal comparison is not a direct head-to-head match.`, 'caption'));
    strength.append(table(['Seed','Phase','Round','Training hours','Win rate','95% interval','Games'],value.seeds.flatMap(s=>s.history.slice(-5).map(p=>[s.seed,p.phase,p.round,p.hours.toFixed(2),pct(p.winRate),p.paired95.map(pct).join('–'),p.games.toLocaleString()]))));
    const search=section('Candidate tests before longer training');
    search.append(el('p','These were separate candidates. Their results are not consecutive checkpoints of one model.','caption'));
    search.append(table(['Candidate','Hidden widths','Learning rate','Latest win rate','Tested hours'],value.candidates.map(c=>{const p=c.history.at(-1);return [c.id,(c.config.widths||[]).join(' / '),c.config.rate??'—',pct(p?.winRate),p?.hours.toFixed(2)??'—'];})));
    const validation=section('Offline prediction validation');
    validation.append(el('p','Lower loss is better. Compare trials within this model family only. These fixed-dataset screening curves are separate from live playing-strength evaluations.','caption'));
    const select=el('select');select.id='native-loss-trial';select.setAttribute('aria-label','Prediction trial');select.style.maxWidth='100%';
    const available=value.trials.filter(t=>t.history.length);
    if (!available.length) {validation.append(el('p','No validation history available yet.'));return;}
    available.forEach(t=>{const o=el('option',`${t.id} · ${(t.config.widths||[]).join('/')} · rate ${t.config.rate}${t.selected?' · selected configuration':''}`);o.value=t.id;select.append(o);});
    select.value=available.some(t=>t.id===choices.get(value.model))?choices.get(value.model):(available.find(t=>t.selected)||available[0]).id;
    const body=el('div');validation.append(select,body);
    const draw=()=>{choices.set(value.model,select.value);const t=available.find(t=>t.id===select.value);body.replaceChildren(chartPanel([{label:t.id,history:t.history}],{loss:true,bestHours:t.bestHours}),el('p',`Best retained loss: ${t.bestLoss?.toFixed(5)??'pending'} at ${t.bestHours.toFixed(3)} fitting hours. ${t.earlyStopped?'Stopped early after validation stopped improving.':'No early stop recorded.'} Outlined dot marks the best retained checkpoint.`,'caption'));};
    select.addEventListener('change',draw);draw();
  }
  function preview(tab,value) {
    tab.querySelector('.tab-purpose').textContent='Native model learning · separate training seeds';
    tab.querySelector('.tab-state').textContent=value.activity.label;
    const latest=value.seeds.map(s=>s.history.at(-1)).filter(Boolean);
    tab.querySelector('.tab-progress').textContent=latest.map((p,i)=>`Seed ${value.seeds.filter(s=>s.history.length)[i].seed}: ${pct(p.winRate)}`).join(' · ')||'Awaiting evaluation';
    tab.querySelector('.tab-rate').textContent=value.pace?`${value.pace.gamesPerSecond.toFixed(2)} training games/s`:'Throughput pending';
    const previous=tab.querySelector('.tab-chart');
    const chart=graph(value.seeds.map(s=>({...s,label:`Seed ${s.seed}`})),{reference:value.reference?.winRate});
    chart.id=previous.id;chart.classList.add('tab-chart');chart.setAttribute('aria-hidden','true');previous.replaceWith(chart);
  }
  return {render, preview};
})();

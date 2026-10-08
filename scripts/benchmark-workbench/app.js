"use strict";
const $ = (id) => document.getElementById(id);
const uiVersion = document.querySelector('meta[name=workbench-version]').content;
const number = new Intl.NumberFormat();
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const interval = (values) => values ? `${percent(values[0])} – ${percent(values[1])}` : 'More pairs needed';
const modelName = (value) => (value || '').replace('schell_table-peg_table-', '').replace(/^13\.23$/, 'Ace (13.23)');
const standing = (margin, candidate, opponent) => margin === 0 ? `${candidate} and ${opponent} are tied` : margin > 0 ? `${candidate} leads · ${opponent} trails` : `${opponent} leads · ${candidate} trails`;
let report = null;
let timer;
let request;
let selected = new URLSearchParams(location.search).get('job') || '';
let followLatest = true;
let inspectedPairs = 0;
let jobs = [];
let jobsSignature = '';
const previews = new Map();
const visibleJobs = () => jobs.filter((job) => ['asset', 'analysis'].includes(job.kind) || job.state === 'running' || job.state === 'pending' || job.id === selected);
const jobTitle = (job) => job.title || (job.candidate && job.opponent ? `${modelName(job.candidate)} vs ${modelName(job.opponent)}` : job.id);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderJobs() {
  const signature = JSON.stringify(jobs.map(({ id, state, candidate, opponent, title }) => [id, state, candidate, opponent, title]));
  const visible = visibleJobs();
  const tabs = $('run-tabs');
  const tabIds = visible.map((job) => job.id).join(',');
  if (tabs.dataset.jobs !== tabIds || signature !== jobsSignature) {
    const focusedJob = tabs.contains(document.activeElement) ? document.activeElement.dataset.job : null;
    tabs.replaceChildren();
    for (const job of visible) {
      const title = jobTitle(job);
      const tab = element('button', null, 'run-tab');
      tab.type = 'button'; tab.id = `tab-${job.id}`; tab.dataset.job = job.id;
      tab.title = job.id;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'benchmark-view');
      const heading = element('span', null, 'tab-heading');
      heading.append(element('span', title), element('small', job.state, 'tab-state'));
      tab.append(heading, element('small', 'Loading results…', 'tab-rate'));
      tab.append(svgNode('svg', { id: `preview-${job.id}`, class: 'chart tab-chart', 'aria-hidden': 'true' }));
      tab.append(element('small', 'Loading progress…', 'tab-progress'));
      tabs.append(tab);
    }
    tabs.dataset.jobs = tabIds;
    if (focusedJob) document.getElementById(`tab-${focusedJob}`)?.focus({ preventScroll: true });
  }
  for (const tab of tabs.children) {
    const active = tab.dataset.job === selected;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1;
  }
  if (selected) $('benchmark-view').setAttribute('aria-labelledby', `tab-${selected}`);
  const picker = $('jobs');
  if (signature !== jobsSignature) {
    picker.replaceChildren();
    for (const job of jobs) {
      const title = jobTitle(job);
      const option = element('option', `${title} · ${job.state} · ${job.id}`);
      option.value = job.id; picker.append(option);
    }
    jobsSignature = signature;
  }
  picker.value = selected;
  renderPreviews();
}

function renderPreviews() {
  for (const job of visibleJobs()) {
    const tab = document.getElementById(`tab-${job.id}`);
    if (!tab) continue;
    const snapshot = previews.get(job.id);
    if (job.kind === 'analysis' && snapshot && !snapshot.error && !snapshot.waiting) {
      tab.querySelector('.tab-state').textContent = snapshot.state.replaceAll('_', ' ');
      tab.querySelector('.tab-rate').textContent = `${number.format(snapshot.completed)} / ${number.format(snapshot.target)} replays`;
      tab.querySelector('.tab-progress').textContent = `${percent(snapshot.completed / snapshot.target)} complete`;
      const rows = snapshot.history || [], start = rows[0]?.updatedAt || snapshot.asOf;
      chart(`preview-${job.id}`, rows, { compact: true, x: (r) => r.updatedAt-start, y: (r) => r.completed / snapshot.target, percent: true, domain: [0, 1], empty: 'Waiting for progress' });
      continue;
    }
    if (job.kind === 'asset' && snapshot && !snapshot.error && !snapshot.waiting) {
      tab.querySelector('.tab-state').textContent = snapshot.state.replaceAll('_', ' ');
      tab.querySelector('.tab-rate').textContent = `${snapshot.completed.toLocaleString()} / ${snapshot.target.toLocaleString()} chunks`;
      tab.querySelector('.tab-progress').textContent = `${percent(snapshot.completed / snapshot.target)} built · ${snapshot.fresh && snapshot.chunksPerHour != null ? `${number.format(Math.round(snapshot.chunksPerHour))}/h` : 'rate unavailable'}`;
      const history = snapshot.history || [];
      const start = history[0]?.updatedAt || snapshot.asOf;
      chart(`preview-${job.id}`, history, { compact: true, x: (r) => r.updatedAt-start,
        y: (r) => r.completed / snapshot.target, percent: true, domain: [0, 1], empty: 'History starts with this run' });
      tab.querySelector('svg').append(svgNode('title', {}, 'Verified asset build progress, 0–100% of selected target.'));
      continue;
    }
    const unavailable = snapshot?.error || snapshot?.waiting;
    const rows = unavailable ? [] : snapshot?.history || [];
    const rate = tab.querySelector('.tab-rate');
    rate.textContent = unavailable ? (snapshot.error ? 'Data unavailable' : 'Waiting for results') : snapshot ? `${modelName(job.candidate)} paired wins: ${percent(snapshot.latest?.winRate)}` : 'Loading results…';
    const progress = tab.querySelector('.tab-progress');
    progress.textContent = snapshot && !unavailable ? `${number.format(snapshot.saved)} / ${number.format(snapshot.target)} games · ${(100 * snapshot.saved / snapshot.target).toFixed(1)}%` : unavailable || 'Loading progress…';
    progress.title = progress.textContent;
    chart(`preview-${job.id}`, rows, {
      compact: true, x: (r) => r.pairs, y: (r) => r.winRate, percent: true, reference: .5,
      bands: [{ key: 'anytime95', className: 'anytime-band' }, { key: 'fixed95', className: 'fixed-band' }],
      domain: [.4, .6], empty: unavailable ? 'Preview unavailable' : snapshot ? 'Waiting for paired games' : 'Loading…',
    });
    tab.querySelector('svg').append(svgNode('title', {}, 'Paired win rate over completed pairs, 40–60% scale. Ordinary and sequential 95% bands are clipped to this range.'));
  }
}

function selectJob(id) {
  selected = id; followLatest = true; report = null;
  $('report').hidden = true; $('asset-report').hidden = true; $('analysis-report').hidden = true; $('notice').hidden = true;
  renderJobs(); refresh();
}

function svgNode(tag, attributes, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text != null) node.textContent = text;
  return node;
}

function chart(id, rows, options) {
  const svg = $(id);
  svg.replaceChildren();
  const width = Math.max(options.compact ? 180 : 280, svg.clientWidth);
  const height = options.compact ? 76 : id === 'win-chart' && innerWidth > 540 ? 300 : 240;
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const left = options.compact ? 32 : 56, right = width - (options.compact ? 6 : 20), top = options.compact ? 8 : 18, bottom = height - (options.compact ? 8 : 56);
  if (!rows.length) {
    svg.append(svgNode('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle' }, options.empty || 'Waiting for saved game pairs'));
    return;
  }
  const xMax = Math.max(1, ...rows.map(options.x));
  const values = rows.flatMap((row) => [options.y(row), ...(options.bands || []).flatMap((band) => row[band.key] || [])]);
  if (options.reference != null) values.push(options.reference);
  let low = Math.min(...values), high = Math.max(...values);
  const padding = Math.max(options.minSpan || .02, high - low) * .12;
  low -= padding; high += padding;
  if (options.percent) { low = Math.max(0, low); high = Math.min(1, high); }
  if (options.zero) low = 0;
  if (options.domain) [low, high] = options.domain;
  if (high === low) high = low + 1;
  const x = (value) => left + value / xMax * (right - left);
  const y = (value) => bottom - (value - low) / (high - low) * (bottom - top);
  const ticks = options.compact ? 2 : 4;
  for (let i = 0; i <= ticks; i++) {
    const value = low + (high - low) * i / ticks;
    svg.append(svgNode('line', { x1: left, y1: y(value), x2: right, y2: y(value), class: 'grid' }));
    svg.append(svgNode('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end' }, options.percent ? `${Math.round(value * 100)}%` : value.toFixed(options.decimals ?? 1)));
    if (!options.compact) {
      const xValue = xMax * i / ticks;
      svg.append(svgNode('text', { x: x(xValue), y: height - 30, 'text-anchor': 'middle' }, options.xHours ? `${xValue.toFixed(1)}h` : number.format(Math.round(xValue))));
    }
  }
  if (!options.compact) svg.append(svgNode('text', { x: (left + right) / 2, y: height - 7, 'text-anchor': 'middle' }, options.xLabel || (options.xHours ? 'Elapsed hours →' : 'Completed pairs in seed order →')));
  const defs = svgNode('defs', {});
  const clip = svgNode('clipPath', { id: `${id}-clip` });
  clip.append(svgNode('rect', { x: left, y: top, width: right - left, height: bottom - top }));
  defs.append(clip); svg.append(defs);
  const plot = svgNode('g', { 'clip-path': `url(#${id}-clip)` });
  svg.append(plot);
  for (const band of options.bands || []) {
    const data = rows.filter((row) => row[band.key]);
    if (!data.length) continue;
    const upper = data.map((row) => `${x(options.x(row))},${y(row[band.key][1])}`);
    const lower = [...data].reverse().map((row) => `${x(options.x(row))},${y(row[band.key][0])}`);
    plot.append(svgNode('polygon', { points: upper.concat(lower).join(' '), class: band.className }));
    if (band.key === 'anytime95') for (const edge of [0, 1]) plot.append(svgNode('polyline', { points: data.map((row) => `${x(options.x(row))},${y(row[band.key][edge])}`).join(' '), class: 'bound' }));
  }
  if (options.reference != null) plot.append(svgNode('line', { x1: left, y1: y(options.reference), x2: right, y2: y(options.reference), class: 'reference' }));
  plot.append(svgNode('polyline', { points: rows.map((row) => `${x(options.x(row))},${y(options.y(row))}`).join(' '), class: 'line' }));
  if (options.compact) {
    const latest = rows[rows.length - 1];
    plot.append(svgNode('circle', { cx: x(options.x(latest)), cy: y(options.y(latest)), r: 2.5, class: 'point' }));
  }
  if (options.inspected != null && rows[options.inspected]) {
    const row = rows[options.inspected];
    plot.append(svgNode('line', { x1: x(options.x(row)), x2: x(options.x(row)), y1: top, y2: bottom, class: 'cursor' }));
    plot.append(svgNode('circle', { cx: x(options.x(row)), cy: y(options.y(row)), r: 4, class: 'point' }));
  }
}

function renderCharts() {
  if (!report || report.error || report.waiting) return;
  if (report.kind === 'asset') return renderAssetCharts(report);
  if (report.kind === 'analysis') return renderAnalysisChart(report);
  const index = Number($('inspect').value);
  const bands = [];
  if ($('show-anytime').checked) bands.push({ key: 'anytime95', className: 'anytime-band' });
  if ($('show-fixed').checked) bands.push({ key: 'fixed95', className: 'fixed-band' });
  chart('win-chart', report.history, { x: (r) => r.pairs, y: (r) => r.winRate, percent: true, reference: .5, bands, inspected: index, domain: $('win-scale').value === 'focus' ? [.4, .6] : null });
  chart('progress-chart', report.progressHistory, { x: (r) => r.hours, y: (r) => r.games, xHours: true, zero: true, decimals: 0 });
  const point = report.history[index];
  renderMetric('score', $('score-kind').value, point?.pairs || 0);
  renderMetric('wp', $('wp-kind').value, point?.pairs || 0);
  renderMetric('open', 'pone_open', point?.pairs || 0);
  const candidate = modelName(report.candidate), opponent = modelName(report.opponent);
  $('inspection').textContent = point ? `${number.format(point.pairs)} pairs · ${candidate}: ${percent(point.winRate)} · ${opponent}: ${percent(1 - point.winRate)} · ${standing(point.winRate - .5, candidate, opponent)}. ${candidate} win-rate intervals: ordinary ${interval(point.fixed95)}; sequential ${interval(point.anytime95)}.` : 'Waiting for complete pairs';
}

function renderMetric(prefix, key, pairs) {
  const wp = prefix === 'wp', timing = prefix === 'open';
  const unit = timing ? ' s' : wp ? ' pp' : ' pts';
  const format = (value) => value == null ? '—' : `${wp && value > 0 ? '+' : ''}${(value * (wp ? 100 : 1)).toFixed(2)}${unit}`;
  const bounds = (values) => values ? `${format(values[0])} to ${format(values[1])}` : 'More paired deals needed';
  const candidate = modelName(report.candidate), opponent = modelName(report.opponent);
  const rows = report.metrics?.[key] || [];
  const index = rows.findLastIndex((row) => row.pairs <= pairs);
  const current = rows[index];
  const delta = current?.delta;
  const measure = timing ? 'opening seconds' : wp ? 'WP miss (percentage points)' : 'points';
  $(`${prefix}-chart-title`).textContent = `${candidate} − ${opponent} · ${measure}`;
  $(`${prefix}-delta`).textContent = delta != null ? `${!wp && delta > 0 ? '+' : ''}${format(delta)}` : '—';
  $(`${prefix}-standing`).textContent = delta == null ? 'Not enough recorded data to compare both models yet.' :
    wp ? 'Signed miss: positive underpredicts wins; negative overpredicts wins.' :
    delta === 0 ? `Equal observed ${measure}` :
    timing ? `${delta < 0 ? candidate : opponent} has the faster observed opening` :
    standing(delta, candidate, opponent);
  const models = $(`${prefix}-models`);
  models.replaceChildren();
  for (const [side, name] of [['candidate', candidate], ['opponent', opponent]]) {
    const column = element('div');
    column.append(element('span', name, 'label'), element('strong', format(current?.[side])));
    column.append(element('small', current ? `${number.format(current[`${side}N`])} ${key === 'final_score' ? 'games' : wp || timing ? 'calls' : 'hands'} · ${number.format(current[`${side}Clusters`])} pairs` : 'No samples'));
    column.append(element('small', `95%: ${bounds(current?.[`${side}95`])}`));
    models.append(column);
  }
  $(`${prefix}-interval`).textContent = delta != null ? `Difference at ${number.format(current.pairs)} completed pairs: ${bounds(current.fixed95)} (95% pointwise). ${number.format(current.clusters)} deal pairs contribute recorded samples.` : 'Missing telemetry is not treated as zero. A difference requires samples from both models.';
  if (wp) $('wp-calibration').textContent = current ? `Mean predicted / observed wins: ${candidate} ${percent(current.candidatePredicted)} / ${percent(current.candidateActual)}; ${opponent} ${percent(current.opponentPredicted)} / ${percent(current.opponentActual)}. Outcomes are weighted by recorded decisions.` : '';
  const direction = wp ? 'Positive means the first model has a more positive miss, not necessarily better calibration.' : timing ? `Negative favors ${candidate}; positive favors ${opponent}.` : `Positive favors ${candidate}; negative favors ${opponent}.`;
  $(`${prefix}-chart`).setAttribute('aria-label', `${candidate} minus ${opponent} ${measure} over completed pairs. ${direction} Shading is the ordinary 95 percent pointwise interval.`);
  const comparisons = rows.filter((row) => row.delta != null).map((row) => wp ? {
    ...row, delta: row.delta * 100, fixed95: row.fixed95?.map((value) => value * 100),
  } : row);
  chart(`${prefix}-chart`, comparisons, { x: (r) => r.pairs, y: (r) => r.delta, reference: 0,
    minSpan: wp ? .2 : timing ? .1 : 1, decimals: wp ? 2 : 1,
    bands: [{ key: 'fixed95', className: 'fixed-band' }], inspected: comparisons.findLastIndex((row) => row.pairs <= pairs),
    empty: 'Waiting for recorded paired samples' });
}

function render(value) {
  report = value;
  const error = value.error || value.waiting;
  $('report').hidden = Boolean(error) || ['asset', 'analysis'].includes(value.kind);
  $('analysis-report').hidden = Boolean(error) || value.kind !== 'analysis';
  $('asset-report').hidden = Boolean(error) || value.kind !== 'asset';
  $('notice').hidden = !error && !value.warnings?.length;
  $('notice').textContent = error || (value.warnings || []).join(' ');
  if (error) return;
  if (value.kind === 'asset') return renderAsset(value);
  if (value.kind === 'analysis') return renderAnalysis(value);
  const candidate = modelName(value.candidate), opponent = modelName(value.opponent);
  $('matchup').textContent = `${candidate} vs ${opponent}`;
  $('experiment').textContent = value.experiment;
  $('state').textContent = value.state;
  const active = value.stages.find((s) => s.state === 'running' || s.state === 'failed');
  $('stage').textContent = value.state === 'complete' ? 'Reports and verification complete' : active ? active.name.replaceAll('-', ' ') : 'Waiting for the next stage';
  $('progress-total').textContent = `${number.format(value.saved)} / ${number.format(value.target)} games · ${(100 * value.saved / value.target).toFixed(1)}% complete`;
  $('lanes').replaceChildren();
  $('orientation-rows').replaceChildren();
  value.orientations.forEach((row, i) => {
    const label = `${i === 0 ? candidate : opponent} left`;
    const lane = element('div', null, 'lane');
    const name = element('div', label, 'lane-label');
    name.append(element('small', row.stale ? 'No recent update' : row.state));
    const track = element('div', null, 'lane-track');
    track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', `${label}: games completed`);
    track.setAttribute('aria-valuemin', '0'); track.setAttribute('aria-valuemax', row.target); track.setAttribute('aria-valuenow', row.saved);
    const fill = element('div', null, 'lane-fill'); fill.style.width = `${100 * row.saved / row.target}%`; track.append(fill);
    lane.append(name, track, element('div', `${number.format(row.saved)} / ${number.format(row.target)}`, 'lane-count'));
    $('lanes').append(lane);
    const tr = element('tr');
    [label, number.format(row.saved), number.format(row.candidateWins), percent(row.winRate)].forEach((text) => tr.append(element('td', text)));
    $('orientation-rows').append(tr);
  });
  $('eta').textContent = value.remainingSeconds === 0 ? 'Games complete' : value.estimatedCompletion ? new Date(value.estimatedCompletion).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Waiting for a reliable rate';
  $('pair-count').textContent = `${number.format(value.orderedPairs)} pairs in seed order`;
  $('pair-note').textContent = value.pendingPairs ? `${value.pendingPairs} later pairs waiting for earlier games` : `${number.format(value.matchedPairs)} matched pairs · no skipped indexes`;
  $('updated').textContent = new Date(value.asOf).toLocaleTimeString();
  $('read-cost').textContent = `${value.readMilliseconds} ms to read and calculate · shared cache`;
  const latest = value.latest;
  $('evidence-title').textContent = latest ? standing(latest.winRate - .5, candidate, opponent) : 'Waiting for paired results';
  $('win-rate-label').textContent = `${candidate} paired win rate`;
  $('win-rate').textContent = percent(latest?.winRate);
  $('opponent-rate').textContent = `${opponent}: ${percent(latest ? 1 - latest.winRate : null)}`;
  $('interval-model').textContent = `Both intervals estimate ${candidate}’s win rate.`;
  $('fixed-interval').textContent = interval(latest?.fixed95);
  $('anytime-interval').textContent = latest ? interval(latest.anytime95) : 'More pairs needed';
  $('sweeps').textContent = latest ? `Two-win sweeps: ${candidate} ${latest.candidateSweeps} · ${opponent} ${latest.opponentSweeps} · ${latest.splits} split pairs` : 'Waiting for paired outcomes';
  const advantage = latest?.anytime95[0] > .5;
  const disadvantage = latest?.anytime95[1] < .5;
  $('verdict').textContent = !latest ? 'No evidence yet' : advantage ? `Sequential evidence favors ${candidate}` : disadvantage ? `Sequential evidence favors ${opponent}` : 'No established winner yet: sequential interval includes 50%';
  $('verdict').classList.toggle('positive', advantage || disadvantage);
  $('win-chart-title').textContent = `${candidate} paired win rate (%)`;
  $('win-above').textContent = `↑ Above 50%: ${candidate} leads`;
  $('win-below').textContent = `↓ Below 50%: ${opponent} leads`;
  $('win-chart').setAttribute('aria-label', `${candidate} paired win rate by completed pairs. Above 50% favors ${candidate}; below 50% favors ${opponent}. Shading shows ordinary and sequential 95 percent intervals for ${candidate}.`);
  $('orientation-wins').textContent = `${candidate} wins`;
  $('orientation-rate').textContent = `${candidate} win rate`;
  $('paired-method').textContent = `The paired win rate is ${candidate}’s share of wins; ${opponent}’s share is the remainder. Each deal gives ${candidate} a score of 0, ½, or 1: two losses, a split, or two wins. Each deal is played with sides reversed. Every graph point includes all earlier pairs in the fixed index order. Pairs beyond an unfinished earlier game wait before entering the evidence calculation.`;
  $('sequence-method').textContent = `*The confidence sequence is usually wider. Sequential evidence favors ${candidate} only when its lower bound exceeds 50%, or ${opponent} when its upper bound falls below 50%. An observed lead alone does not establish an advantage. Score intervals are ordinary intervals. Curves use a sample of display points; all pairs enter the calculations.`;
  const rates = value.orientations.map((x) => x.gamesPerHour);
  $('throughput').textContent = rates.every((x) => x != null) ? `${Math.round(rates[0] + rates[1])}/hr` : '—';
  $('integrity').replaceChildren();
  for (const [name, text] of [['Engines & seeds', 'Matching in the saved snapshot'], ['Seed', value.seed || 'Not recorded'], ['Workers', value.orientations.map((x) => x.workers ?? '?').join(' + ')], ['Source', value.sourceCommit?.slice(0, 12) || 'Not recorded']]) {
    $('integrity').append(element('dt', name), element('dd', text));
  }
  $('source').textContent = `Snapshot: ${value.id}`;
  const max = Math.max(0, value.history.length - 1);
  $('inspect').max = max;
  if (followLatest) $('inspect').value = max;
  else $('inspect').value = value.history.reduce((best, point, index) => Math.abs(point.pairs - inspectedPairs) < Math.abs(value.history[best].pairs - inspectedPairs) ? index : best, 0);
  $('inspect').disabled = !value.history.length;
  renderCharts();
}

const duration = (seconds) => seconds == null ? '—' : seconds < 3600 ? `${Math.ceil(seconds / 60)} min` : seconds < 86400 ? `${(seconds / 3600).toFixed(1)} hours` : `${(seconds / 86400).toFixed(1)} days`;
const bytes = (value) => value == null ? '—' : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} MiB` : `${(value / 1024 ** 3).toFixed(2)} GiB`;

function renderAsset(value) {
  $('asset-state').textContent = value.state.replaceAll('_', ' ');
  $('asset-snapshot').textContent = `Snapshot ${new Date(value.updatedAt * 1000).toLocaleString()}`;
  $('asset-completed').textContent = number.format(value.completed);
  $('asset-target').textContent = `of ${number.format(value.target)} chunks`;
  $('asset-fraction').textContent = `${percent(value.completed / value.target)} built`;
  const lanes = $('asset-lanes'); lanes.replaceChildren();
  for (const [label, count] of [['Built · full depth, local', value.completed], ['Published · two replies, Ace', value.published], ['Archived · TerraMaster', value.archive?.completed]]) {
    const lane = element('div', null, 'asset-lane');
    const title = element('div', null, 'section-heading');
    title.append(element('span', label), element('span', count == null ? 'No verified snapshot' : number.format(count), 'numeric'));
    const track = element('div', null, 'lane-track');
    const fill = element('div', null, 'lane-fill');
    fill.style.width = `${Math.min(100, 100 * (count || 0) / value.target)}%`;
    track.append(fill); lane.append(title, track); lanes.append(lane);
  }
  $('asset-rate').textContent = value.fresh && value.chunksPerHour != null ? `${number.format(Math.round(value.chunksPerHour))} / hour` : 'Measuring…';
  $('asset-eta').textContent = duration(value.remainingSeconds);
  $('asset-finish').textContent = value.remainingSeconds == null ? 'ETA waits for fresh, active throughput' : `Around ${new Date((value.asOf + value.remainingSeconds) * 1000).toLocaleString()}`;
  $('asset-workers').textContent = value.fresh ? `${value.workers} / ${value.workerLimit}` : '—';
  $('asset-scheduling').textContent = `${value.scheduling || 'Unknown'} scheduling`;
  $('asset-eta-note').textContent = value.etaBasis;
  const coverage = value.coverage;
  $('asset-coverage').textContent = `${percent(coverage?.current?.heldOut)} covered`;
  const stats = $('asset-coverage-stats'); stats.replaceChildren();
  for (const [label, stat] of [['Covered now · held-out openings', coverage?.current?.heldOut], ['At target · held-out openings', coverage?.target?.heldOut], ['At target · recent 28.3 openings', coverage?.target?.recent]]) {
    const row = element('div'); row.append(element('span', label, 'label'), element('strong', percent(stat))); stats.append(row);
  }
  $('asset-coverage-note').textContent = coverage ? `${coverage.basis} ${number.format(coverage.samples?.heldOut || 0)} held-out openings; ${number.format(coverage.samples?.recent || 0)} recent 28.3 openings. Current coverage is a conservative checkpoint at or below the contiguous completed prefix (${number.format(value.contiguousCompleted || 0)} chunks).` : 'Coverage evidence is not available for this build ranking.';
  const storage = $('asset-storage'); storage.replaceChildren();
  for (const [label, stat] of [
    ['Full-depth output built', bytes(value.fullBytes)], ['Two-reply output published', value.published === value.completed ? bytes(value.shallowBytes) : 'See publication count above'],
    ['Verified on TerraMaster', value.archive ? `${bytes(value.archive.bytes)} · ${new Date(value.archive.updatedAt * 1000).toLocaleString()}` : 'No verified snapshot'],
    ['Awaiting archive', value.archivePending == null ? 'Unknown' : `${number.format(value.archivePending)} chunks`],
    ['Internal disk free / reserve', `${bytes(value.diskFreeBytes)} / ${bytes(value.diskReserveBytes)}`],
  ]) storage.append(element('dt', label), element('dd', stat));
  $('asset-storage-note').textContent = `Archiving to TerraMaster is a separate foreground step. The builder waits safely at the disk reserve. ${value.storageWaitHours == null ? '' : `At the current average shard size and rate, staging reaches the reserve in about ${duration(value.storageWaitHours * 3600)} without further archiving or space changes.`}`;
  const milestones = $('asset-milestones'); milestones.replaceChildren();
  for (const row of value.milestones) {
    const tr = element('tr'); tr.append(element('td', number.format(row.chunks)), element('td', duration(row.seconds))); milestones.append(tr);
  }
  $('asset-policy').textContent = `Frozen policy: ${value.policy}`;
  renderAssetCharts(value);
}

function renderAssetCharts(value) {
  const curve = value.coverage?.curve || [];
  chart('asset-coverage-chart', curve, { x: (r) => r.chunks, y: (r) => r.heldOut,
    percent: true, domain: [0, 1], xLabel: 'Completed chunks in build order →',
    inspected: curve.findLastIndex((r) => r.chunks <= (value.contiguousCompleted || 0)), empty: 'Waiting for coverage evidence' });
  const rows = value.history || [], start = rows[0]?.updatedAt || value.asOf;
  const options = { x: (r) => (r.updatedAt-start)/3600, xHours: true, zero: true, decimals: 0,
    empty: 'Progress history starts with this controller version' };
  chart('asset-progress-chart', rows, { ...options, y: (r) => r.completed });
  chart('asset-rate-chart', rows.filter((r) => r.chunksPerHour != null), { ...options, y: (r) => r.chunksPerHour });
  $('asset-history-note').textContent = rows.length ? `Recorded window begins ${new Date(start * 1000).toLocaleString()}. Saved totals include earlier work; the time axis includes any pauses. Up to 500 history points are shown.` : 'Earlier chunks are preserved; detailed history begins with this update.';
}

async function refresh() {
  clearTimeout(timer);
  request?.abort();
  const controller = new AbortController(); request = controller;
  $('connection').textContent = 'Updating…';
  $('benchmark-view').setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/jobs', { signal: controller.signal });
    if (!response.ok) throw new Error(`Workbench returned ${response.status}`);
    const value = await response.json();
    if (controller.signal.aborted) return;
    if (value.uiVersion && value.uiVersion !== uiVersion) {
      location.reload();
      return;
    }
    jobs = value.jobs;
    for (const id of previews.keys()) if (!jobs.some((job) => job.id === id)) previews.delete(id);
    if (!jobs.length) {
      selected = ''; jobsSignature = ''; $('run-tabs').replaceChildren();
      $('run-tabs').dataset.jobs = '';
      $('benchmark-view').removeAttribute('aria-labelledby');
      $('jobs').replaceChildren(element('option', 'No paired benchmarks registered'));
      $('empty').hidden = false; $('report').hidden = true; $('asset-report').hidden = true; $('analysis-report').hidden = true; $('notice').hidden = true;
      $('connection').textContent = 'Connected';
      return;
    }
    $('empty').hidden = true;
    const current = jobs.find((job) => job.id === selected || job.aliases?.includes(selected));
    selected = (current || jobs[0]).id;
    renderJobs();
    history.replaceState(null, '', `/?job=${encodeURIComponent(selected)}`);
    // Reuse each snapshot for both its preview and the selected detail panel.
    // A slow or unavailable run must not block the other tabs from updating.
    await Promise.all(visibleJobs().map(async (job) => {
      let snapshot;
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
        const data = await fetch(`/api/report?job=${encodeURIComponent(job.id)}&uiVersion=${encodeURIComponent(uiVersion)}`, { signal });
        if (!data.ok) throw new Error(`Benchmark returned ${data.status}`);
        snapshot = await data.json();
      } catch (error) {
        if (controller.signal.aborted) return;
        snapshot = { error: error.message };
      }
      if (controller.signal.aborted) return;
      previews.set(job.id, snapshot);
      renderPreviews();
      if (job.id === selected) {
        render(snapshot);
        $('connection').textContent = snapshot.error ? 'Data unavailable' : 'Live · 15s refresh';
      }
    }));
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('connection').textContent = 'Disconnected';
    $('notice').hidden = false;
    $('notice').textContent = `${error.message}. Displayed figures may be out of date. Retrying automatically.`;
    for (const job of visibleJobs()) previews.set(job.id, { error: 'Connection lost; retrying automatically.' });
    renderPreviews();
  } finally {
    if (request === controller) {
      $('benchmark-view').setAttribute('aria-busy', 'false');
      if (!document.hidden) timer = setTimeout(refresh, 15000);
    }
  }
}

$('jobs').addEventListener('change', () => selectJob($('jobs').value));
$('run-tabs').addEventListener('click', (event) => {
  const tab = event.target.closest('[role="tab"]');
  if (tab) selectJob(tab.dataset.job);
});
$('run-tabs').addEventListener('keydown', (event) => {
  const tabs = [...$('run-tabs').children];
  const index = tabs.indexOf(event.target);
  if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  const id = tabs[next].dataset.job;
  selectJob(id);
  document.getElementById(`tab-${id}`)?.focus();
});
$('refresh').addEventListener('click', refresh);
$('show-fixed').addEventListener('change', renderCharts);
$('show-anytime').addEventListener('change', renderCharts);
$('win-scale').addEventListener('change', renderCharts);
$('score-kind').addEventListener('change', renderCharts);
$('wp-kind').addEventListener('change', renderCharts);
$('inspect').addEventListener('input', () => { followLatest = Number($('inspect').value) === Number($('inspect').max); inspectedPairs = report.history[Number($('inspect').value)]?.pairs || 0; renderCharts(); });
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(); else request?.abort(); });
refresh();

let resizeFrame;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(() => { renderCharts(); renderPreviews(); }); });

function renderAnalysisChart(value) {
  const rows = value.history || [], start = rows[0]?.updatedAt || value.asOf;
  chart('analysis-progress-chart', rows, { x: (r) => (r.updatedAt-start)/3600, y: (r) => r.completed,
    xHours: true, zero: true, decimals: 0, empty: 'Waiting for progress history' });
}
function renderAnalysis(value) {
  $('analysis-title').textContent = value.title;
  $('analysis-state').textContent = value.state.replaceAll('_', ' ');
  $('analysis-stage').textContent = value.stage.replaceAll('-', ' ');
  $('analysis-snapshot').textContent = `Snapshot ${new Date(value.updatedAt*1000).toLocaleString()}`;
  $('analysis-total').textContent = `${number.format(value.completed)} / ${number.format(value.target)} · ${percent(value.completed/value.target)}`;
  const track = element('div', null, 'lane-track'), fill = element('div', null, 'lane-fill');
  fill.style.width = `${Math.min(100, value.completed/value.target*100)}%`; track.append(fill); $('analysis-lanes').replaceChildren(track);
  $('analysis-workers').textContent = value.fresh && value.state === 'running' ? `${value.workers} / ${value.workerLimit}` : `${['stale', 'unavailable'].includes(value.state) ? '—' : '0'} / ${value.workerLimit}`;
  $('analysis-reused').textContent = `${number.format(value.reused)} earlier exact replays preserved`;
  $('analysis-eta').textContent = duration(value.remainingSeconds);
  $('analysis-finish').textContent = value.remainingSeconds == null ? 'ETA waits for active compute telemetry' : `Around ${new Date((value.asOf+value.remainingSeconds)*1000).toLocaleString()}`;
  $('analysis-eta-note').textContent = value.etaBasis;
  const groups = new Map(), labels = { pair: 'Pairs', triple: 'Pair royals', run3: 'Runs of 3', run4: 'Runs of 4', run5: 'Runs of 5', run6: 'Runs of 6', fifteen: 'Fifteens' };
  for (const g of value.groups || []) {
    const key = `${labels[g.kind] || g.kind} / ${g.role}`, row = groups.get(key) || { completed: 0, total: 0 };
    row.completed += g.completed; row.total += g.total; groups.set(key, row);
  }
  const table = $('analysis-groups'); table.replaceChildren();
  for (const [name, g] of groups) {
    const row = element('tr'); row.append(element('td', name), element('td', `${number.format(g.completed)} / ${number.format(g.total)}`), element('td', percent(g.completed/g.total))); table.append(row);
  }
  renderAnalysisChart(value);
}

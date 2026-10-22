"use strict";
const $ = (id) => document.getElementById(id);
const uiVersion = document.querySelector('meta[name=workbench-version]').content;
const number = new Intl.NumberFormat();
const gameRate = (value) => value == null ? 'Not measured yet' : `${number.format(Math.round(value * 100) / 100)} games/s`;
const hourlyGames = (value) => value == null ? '—' : `${number.format(Math.round(value * 3600))} games/hour`;
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
let savingVisibility = false;
const previews = new Map();
const comparisonChoices = new Map();
const comparisonReports = new Map();
let comparisonKey = '';
let evolutionKey = '';
const visibleJobs = () => jobs.filter((job) => !job.archived);
const jobTitle = (job) => job.title || (job.candidate && job.opponent ? `${modelName(job.candidate)} vs ${modelName(job.opponent)}` : job.id);

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderJobs() {
  const signature = JSON.stringify(jobs.map(({ id, state, candidate, opponent, title, archived }) => [id, state, candidate, opponent, title, archived]));
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
      tab.append(heading, element('small', job.kind === 'training' ? 'Model training and evaluation' : job.kind === 'asset' ? 'Build the exact opening accelerator' : job.kind === 'gpu' ? 'Build training assets on the GPU' : job.kind === 'analysis' ? 'Analyze saved decision cases' : 'Paired playing-strength benchmark', 'tab-purpose'), element('small', 'Loading results…', 'tab-rate'));
      tab.append(svgNode('svg', { id: `preview-${job.id}`, class: 'chart tab-chart', 'aria-hidden': 'true' }));
      tab.append(element('small', 'Loading progress…', 'tab-progress'));
      tab.append(element('small', '', 'tab-meaning'));
      tabs.append(tab);
    }
    tabs.dataset.jobs = tabIds;
    if (focusedJob) document.getElementById(`tab-${focusedJob}`)?.focus({ preventScroll: true });
  }
  for (const tab of tabs.children) {
    const active = tab.dataset.job === selected;
    tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active || (!visible.some((job) => job.id === selected) && tab === tabs.firstElementChild) ? 0 : -1;
  }
  if (visible.some((job) => job.id === selected)) $('benchmark-view').setAttribute('aria-labelledby', `tab-${selected}`);
  else $('benchmark-view').removeAttribute('aria-labelledby');
  const picker = $('jobs');
  if (signature !== jobsSignature) {
    picker.replaceChildren();
    for (const job of jobs) {
      const title = jobTitle(job);
      const option = element('option', `${title} · ${job.state}${job.archived ? ' · Archived' : ''} · ${job.id}`);
      option.value = job.id; picker.append(option);
    }
    jobsSignature = signature;
  }
  picker.value = selected;
  renderVisibilityControls();
  renderPreviews();
}

function renderVisibilityControls() {
  const job = jobs.find((item) => item.id === selected);
  document.querySelectorAll('.job-visibility').forEach((button) => {
    button.textContent = job?.archived ? 'Elevate' : 'Archive';
    button.title = job?.archived ? 'Show this job in the tabs' : 'Hide this tab; keep the job in All experiments';
    button.disabled = savingVisibility || !job;
  });
  $('job-fallback').hidden = !job || [...document.querySelectorAll('.run-heading')].some((heading) => !heading.closest('[hidden]'));
  $('job-status').textContent = job?.state || '';
}

async function toggleVisibility() {
  const job = jobs.find((item) => item.id === selected);
  if (!job || savingVisibility) return;
  savingVisibility = true;
  $('visibility-error').hidden = true;
  renderVisibilityControls();
  try {
    const response = await fetch('/api/job-visibility', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench-Request': '1' },
      body: JSON.stringify({ job: job.id, archived: !job.archived }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok || response.redirected) throw new Error('Could not save tab visibility. Refresh and try again.');
    const value = await response.json();
    for (const item of jobs) if (item.id === value.id || item.aliases?.includes(value.id)) item.archived = value.archived;
    renderJobs();
    refresh();
  } catch (error) {
    $('visibility-error').textContent = error.message;
    $('visibility-error').hidden = false;
  } finally {
    savingVisibility = false;
    renderVisibilityControls();
  }
}

function renderPreviews() {
  for (const job of visibleJobs()) {
    const tab = document.getElementById(`tab-${job.id}`);
    if (!tab) continue;
    const snapshot = previews.get(job.id);
    if (job.kind === 'training' && snapshot?.mode === 'cyclic' && !snapshot.error) {
      tab.querySelector('.tab-purpose').textContent = 'Learn one prior at a time from full games';
      tab.querySelector('.tab-state').textContent = snapshot.state;
      tab.querySelector('.tab-rate').textContent = snapshot.activity?.label || snapshot.stage;
      tab.querySelector('.tab-progress').textContent = `${number.format(snapshot.completed)} training games · ${snapshot.completedUpdates} asset updates`;
      tab.querySelector('.tab-meaning').textContent = 'Original-state comparison every 5,000 training games';
      chart(`preview-${job.id}`, snapshot.evaluations, { compact: true, x: (r) => r.trainingGames, y: (r) => r.assessment.winRate, percent: true, domain: [0, 1], empty: 'Waiting for the first 1,000-game comparison' });
      continue;
    }
    if (job.kind === 'training' && snapshot?.mode === 'wins' && !snapshot.error) {
      tab.querySelector('.tab-meaning').textContent = 'Chart: training win rate · not overall completion';
      tab.querySelector('.tab-purpose').textContent = snapshot.discardModels?.length ? 'Play full games · learn and evaluate both policies' : 'Play full games · learn pegging with fixed Ace discard';
      tab.querySelector('.tab-state').textContent = snapshot.activity?.kind || snapshot.state;
      const pace=snapshot.gamePace?.current || snapshot.gamePace?.training;
      tab.querySelector('.tab-rate').textContent = pace ? `${hourlyGames(pace.gamesPerSecond)} · ${snapshot.gamePace.current ? 'playing' : 'games + updates'}` : snapshot.activity?.label || snapshot.stage || snapshot.state;
      tab.querySelector('.tab-progress').textContent = activityProgress(snapshot.activity) || `${snapshot.roundsCompleted} / ${snapshot.rounds} training rounds complete`;
      chart(`preview-${job.id}`, snapshot.history, { compact: true, x: (r) => r.round, y: (r) => r.winRate, percent: true, domain: [0, 1], empty: 'Waiting for the first round' });
      continue;
    }
    if (job.kind === 'training' && snapshot && !snapshot.error) {
      tab.querySelector('.tab-meaning').textContent = 'Chart: choice agreement · not win rate';
      tab.querySelector('.tab-purpose').textContent = snapshot.mode === 'discard' ? 'Learn discards from saved Ace choices' : 'Learn pegging from saved Ace choices';
      tab.querySelector('.tab-state').textContent = snapshot.activity?.kind || snapshot.state;
      tab.querySelector('.tab-rate').textContent = snapshot.activity?.label || `${snapshot.completed} / ${snapshot.target} model fits`;
      tab.querySelector('.tab-progress').textContent = snapshot.current ? `${snapshot.current.parameters?.toLocaleString()} parameters · pass ${snapshot.current.epoch}` : `${snapshot.completed} / ${snapshot.target} fits complete · saved-choice accuracy`;
      const rows = snapshot.current?.history || snapshot.trials.find((r) => r.id === snapshot.preferred)?.history || [];
      chart(`preview-${job.id}`, rows, { compact: true, x: (r) => r.epoch, y: (r) => r.agreement, percent: true, domain: [0, 1], empty: 'Waiting for training metrics' });
      continue;
    }
    if (job.kind === 'gpu' && snapshot && !snapshot.error && !snapshot.waiting) {
      tab.querySelector('.tab-state').textContent = snapshot.state.replaceAll('_', ' ');
      tab.querySelector('.tab-rate').textContent = `${number.format(snapshot.completed)} / ${number.format(snapshot.target)} ${snapshot.unit}`;
      tab.querySelector('.tab-progress').textContent = `${percent(snapshot.completed / snapshot.target)} saved · ${snapshot.ratePerSecond != null ? `${number.format(Math.round(snapshot.ratePerSecond))}/s` : 'measuring rate'}`;
      const rows = snapshot.history || [], start = rows[0]?.updatedAt || snapshot.asOf;
      chart(`preview-${job.id}`, rows, { compact: true, x: (r) => r.updatedAt-start, y: (r) => r.completed / snapshot.target, percent: true, domain: [0, 1], empty: 'Waiting for GPU checkpoints' });
      continue;
    }
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
  comparisonKey = '';
  evolutionKey = '';
  $('report').hidden = true; $('asset-report').hidden = true; $('analysis-report').hidden = true; $('gpu-report').hidden = true; $('training-report').hidden = true; $('selfplay-report').hidden = true; $('cyclic-report').hidden = true; $('study-overview').hidden = true; $('notice').hidden = true;
  $('visibility-error').hidden = true;
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
  if (report.kind === 'gpu') return renderGpuCharts(report);
  if (report.kind === 'training') return report.mode === 'cyclic' ? undefined : report.mode === 'wins' ? renderSelfplayChart(report) : renderTrainingCharts(report);
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
  $('report').hidden = Boolean(error) || ['asset', 'analysis', 'gpu', 'training'].includes(value.kind);
  $('analysis-report').hidden = Boolean(error) || value.kind !== 'analysis';
  $('asset-report').hidden = Boolean(error) || value.kind !== 'asset';
  $('gpu-report').hidden = Boolean(error) || value.kind !== 'gpu';
  $('cyclic-report').hidden = Boolean(error) || value.kind !== 'training' || value.mode !== 'cyclic';
  $('training-report').hidden = Boolean(error) || value.kind !== 'training' || ['wins','cyclic'].includes(value.mode);
  $('selfplay-report').hidden = Boolean(error) || value.kind !== 'training' || value.mode !== 'wins';
  $('notice').hidden = !error && !value.warnings?.length;
  $('notice').textContent = error || (value.warnings || []).join(' ');
  renderStudyOverview(error ? null : value.workflow);
  renderVisibilityControls();
  if (error) return;
  if (value.kind === 'asset') return renderAsset(value);
  if (value.kind === 'analysis') return renderAnalysis(value);
  if (value.kind === 'gpu') return renderGpu(value);
  if (value.kind === 'training') return value.mode === 'cyclic' ? renderCyclic(value) : value.mode === 'wins' ? renderSelfplay(value) : renderTraining(value);
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

function renderGpu(value) {
  $('gpu-title').textContent = value.title;
  $('gpu-scope').textContent = value.scope;
  $('gpu-state').textContent = value.state.replaceAll('_', ' ');
  $('gpu-stage').textContent = value.state === 'complete' ? 'Build, verification and archive complete' : value.stage.replaceAll('-', ' ');
  $('gpu-completed').textContent = number.format(value.completed);
  $('gpu-target').textContent = `of ${number.format(value.target)} ${value.unit}`;
  $('gpu-fraction').textContent = `${percent(value.completed / value.target)} saved`;
  $('gpu-progress').setAttribute('aria-valuemax', value.target);
  $('gpu-progress').setAttribute('aria-valuenow', value.completed);
  $('gpu-fill').style.width = `${100 * value.completed / value.target}%`;
  $('gpu-rate').textContent = value.ratePerSecond == null ? 'Measuring…' : `${number.format(Math.round(value.ratePerSecond))} ${value.unit} / second`;
  $('gpu-snapshot').textContent = value.updatedAt == null ? 'Awaiting the first saved checkpoint' : `Updated ${new Date(value.updatedAt * 1000).toLocaleTimeString()}`;
  $('gpu-eta').textContent = value.completed === value.target ? 'Computation complete' : duration(value.remainingSeconds);
  $('gpu-finish').textContent = value.remainingSeconds == null ? 'ETA uses fresh, active throughput' : `Around ${new Date((value.asOf + value.remainingSeconds) * 1000).toLocaleString()}`;
  $('gpu-workers').textContent = value.fresh && value.state === 'running' ? `${value.workers ?? '—'} / ${value.workerLimit ?? '—'}` : '—';
  $('gpu-backend').textContent = value.backend || 'GPU backend';
  $('gpu-eta-note').textContent = value.etaBasis || 'Compute ETA excludes final verification and archiving.';
  const details = $('gpu-details'); details.replaceChildren();
  for (const [label, stat] of [
    ['Saved by GPU', value.gpuCompleted == null ? 'Not separately recorded' : `${number.format(value.gpuCompleted)} decisions`],
    ['Saved by CPU', value.cpuCompleted == null ? 'Not separately recorded' : `${number.format(value.cpuCompleted)} decisions`],
    ['Priority pass', value.priorityTarget ? `${number.format(value.priorityCompleted || 0)} / ${number.format(value.priorityTarget)} decisions` : 'Not specified'],
    ['Observed frequency covered first', value.priorityCoverage == null ? 'Not specified' : percent(value.priorityCoverage)],
    ['Sampled hands', value.handTarget == null ? 'Not specified' : number.format(value.handTarget)],
    ['Score positions per hand and role', value.scoreCells == null ? 'Not specified' : number.format(value.scoreCells)],
    ['GPU command elapsed time', value.gpuSeconds == null ? 'Not recorded' : duration(value.gpuSeconds)],
    ['GPU sharing target', value.gpuCommandDuty == null ? 'Not specified' : `${percent(value.gpuCommandDuty)} command duty`],
  ]) details.append(element('dt', label), element('dd', stat));
  const checks = $('gpu-checks'); checks.replaceChildren();
  for (const [label, stat] of [['Computation', value.completed === value.target ? 'Complete' : value.state === 'running' ? 'In progress' : value.state.replaceAll('_', ' ')], ['Asset verification', value.verification], ['Verified archive', value.archive]]) {
    checks.append(element('dt', label), element('dd', stat));
  }
  $('gpu-policy').textContent = `Frozen policy: ${value.policy}`;
  renderGpuCharts(value);
}

function renderGpuCharts(value) {
  const rows = value.history || [], start = rows[0]?.updatedAt || value.asOf;
  const options = { x: (r) => (r.updatedAt-start)/3600, xHours: true, zero: true, decimals: 0, empty: 'Waiting for GPU checkpoints' };
  chart('gpu-progress-chart', rows, { ...options, y: (r) => r.completed });
  chart('gpu-rate-chart', rows.filter((r) => r.ratePerSecond != null), { ...options, y: (r) => r.ratePerSecond });
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
      selected = ''; jobsSignature = ''; renderVisibilityControls(); $('run-tabs').replaceChildren();
      $('run-tabs').dataset.jobs = '';
      $('benchmark-view').removeAttribute('aria-labelledby');
      $('jobs').replaceChildren(element('option', 'No paired benchmarks registered'));
      $('empty').hidden = false; $('report').hidden = true; $('asset-report').hidden = true; $('analysis-report').hidden = true; $('gpu-report').hidden = true; $('training-report').hidden = true; $('selfplay-report').hidden = true; $('cyclic-report').hidden = true; $('study-overview').hidden = true; $('notice').hidden = true;
      $('connection').textContent = 'Connected';
      return;
    }
    $('empty').hidden = true;
    const current = jobs.find((job) => job.id === selected || job.aliases?.includes(selected));
    selected = (current || visibleJobs()[0] || jobs[0]).id;
    renderJobs();
    history.replaceState(null, '', `/?job=${encodeURIComponent(selected)}`);
    // Reuse each snapshot for both its preview and the selected detail panel.
    // A slow or unavailable run must not block the other tabs from updating.
    await Promise.all(jobs.filter((job) => !job.archived || job.id === selected).map(async (job) => {
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

// Add the same action beside every job view's main status badge.
document.querySelectorAll('.run-heading .run-state > .state').forEach((badge) => {
  const actions = element('div', null, 'state-actions');
  badge.before(actions); actions.append(badge);
  const button = element('button', 'Archive', 'job-visibility');
  button.type = 'button'; actions.append(button);
});
document.querySelectorAll('.job-visibility').forEach((button) => button.addEventListener('click', toggleVisibility));
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

const stageState = (state) => ({ complete: 'Complete', running: 'In progress', pending: 'Not started', waiting: 'Waiting', failed: 'Failed', blocked: 'Blocked', stopped: 'Stopped' }[state] || state);
function activityProgress(active) {
  if (active?.completed == null || active?.target == null) return '';
  return `${number.format(active.completed)} / ${number.format(active.target)} ${active.unit}`;
}
function renderStudyOverview(flow) {
  $('study-overview').hidden = !flow;
  if (!flow) return;
  $('study-title').textContent = flow.title;
  $('study-now').textContent = flow.label;
  $('study-completed').textContent = `${flow.completed} / ${flow.total} steps complete`;
  $('study-next').textContent = flow.next ? `Next: ${flow.next}.` : flow.state === 'complete' ? 'Results are verified and archived.' : 'Waiting for the current step to finish.';
  $('study-note').textContent = flow.note;
  const list=$('study-steps'); list.replaceChildren();
  flow.steps.forEach((step,index) => {
    const li=element('li',null,`study-step ${step.state}`);
    const available=jobs.some((job)=>job.id===step.jobId);
    const link=element(available?'a':'span',`${index+1}. ${step.label}`);
    if (available) link.href=`?job=${encodeURIComponent(step.jobId)}`;
    if (step.state === 'running') li.setAttribute('aria-current','step');
    li.append(element('span',stageState(step.state),'step-status'),link,element('p',step.description));list.append(li);
  });
}
function renderStageList(id,value) {
  const list=$(id);list.replaceChildren();
  for (const row of value.stages) list.append(element('span',`${value.activity?.stageLabels[row.name] || row.name}: ${stageState(row.state)}`,row.state==='running'?'active-stage':''));
}
function blockState(value,name) {
  const states=value.stages.filter((r)=>(value.stageKinds?.[r.name] || r.name)===name).map((r)=>r.state);
  const state=states.includes('failed')?'failed':states.includes('running')?'running':states.length && states.every((s)=>s==='complete')?'complete':states.includes('complete')?'running':'pending';
  return stageState(state);
}
function modelSize(value,name) {
  if (value.roleStudy) {
    const spec=value.sizes.find((s)=>s.name===name);
    return `${name} · ${number.format(spec?.totalParameters || 0)} across four networks`;
  }
  const i = name === 'small' ? 0 : 1;
  return `${number.format((value.models[i]?.parameters || 0)+(value.discardModels?.[i]?.parameters || 0))} parameters`;
}

function renderSelfplayChart(value) {
  chart('selfplay-chart', value.history, { x: (r) => r.round, xLabel: 'Training round →', y: (r) => r.winRate, percent: true, domain: [0, 1], empty: 'Waiting for a completed training round' });
}
function renderCyclic(value) {
  const p=value.progress, c=value.cache;
  $('cyclic-title').textContent=value.title;
  $('cyclic-state').textContent=value.state;
  $('cyclic-stage').textContent=value.activity.context;
  $('cyclic-activity').textContent=value.activity.label;
  $('cyclic-progress').textContent=activityProgress(value.activity);
  $('cyclic-detail').textContent=value.activity.detail;
  renderStageList('cyclic-stages',value);
  const fill=(id,rows)=>{const list=$(id);list.replaceChildren();for(const [label,stat] of rows)list.append(element('dt',label),element('dd',String(stat)));};
  const speed=p.phaseSeconds>0 && p.phase==='collection' ? `${number.format(Math.round(p.phaseCompleted*3600/p.phaseSeconds))} games/hour this batch` : 'Measured during game collection';
  fill('cyclic-totals',[
    ['CPU allocation',`${value.workers} / ${value.workerLimit} workers`],['Training games',value.continuous ? `${number.format(value.completed)} · continuous` : `${number.format(value.completed)} / ${number.format(value.target)}`],
    ['Cycles',value.continuous ? `${p.cycle || 0} · continuous` : `${p.cycle || 0} / ${value.rounds}`],['Asset updates completed',value.completedUpdates],['Current generation',p.generation || 0],
    ['Forecast learning',p.trainingMode == null ? 'Legacy sampled worlds' : p.trainingMode ? 'Training mode · all rejected discards' : 'Ordinary hands only'],
    ['Forecast hand rollouts',number.format(p.forecastRollouts ?? (p.forecastWorlds || 0)*15)],['Evaluation games',number.format(p.evaluationGames || 0)],
    ['Game pace',speed],['Last checkpoint',p.updatedAt ? new Date(p.updatedAt*1000).toLocaleTimeString() : 'Waiting']]);
  fill('cyclic-cache',[
    ['Hits',number.format(c.hits || 0)],['Missing chunks',number.format(c.misses || 0)],['Expired lookups',number.format(c.expired || 0)],
    ['Fresh chunks written',number.format(c.writes || 0)],['Oldest observed age',`${number.format(c.maxAgeGames || 0)} games`],
    ['Completed-game clock',number.format(p.completedGames || 0)],['Inherited chunks staged',number.format(value.inheritedCache.chunks || 0)]]);
  $('cyclic-cache-note').textContent='Cached dealer choices may lag current priors within the age limit. Fresh solves update the cache on demand; cached choices do not train themselves.';
  const body=$('cyclic-history');body.replaceChildren();
  value.history.forEach((r,i)=>{const row=element('tr');const u=r.update;const coverage=u.cells!=null ? `${number.format(u.cells)} WP cells` : u.contextKeepRows!=null ? `${number.format(u.contextKeepRows)} ${u.forecastRepresentation==='exact-hand tempo correction'?'exact hand/discard contexts':'hand/keep/board contexts'}` : u.rows!=null ? `${number.format(u.rows)} rows` : 'Saved in snapshot';
    for(const text of [value.completedUpdates-value.history.length+i+1,r.phase,r.phase==='forecast' && u.ordinaryHands!=null ? `${number.format(u.ordinaryHands)} played hands · ${number.format(u.rejectedDiscardRollouts)} alternatives` : `${number.format(u.games)} ${r.phase==='forecast'?'opponent worlds':'games'}`,coverage,r.advanced?'Advanced experimentally':'Retained previous',Object.entries(r.evaluations).map(([k,v])=>`${k}: ${v.status}`).join('; ') || 'Scheduled every 5,000 games'])row.append(element('td',String(text)));body.append(row);});
  const evaluations=$('cyclic-evaluations');evaluations.replaceChildren();
  const checkpoints=value.evaluations || [];
  loadEvolution(value.id,checkpoints.at(-1)?.trainingGames || 0);
  const chosen=comparisonChoices.get(value.id) || checkpoints.at(-1)?.trainingGames;
  for(const r of checkpoints){
    const row=element('tr');
    for(const v of [number.format(r.trainingGames),number.format(r.games),percent(r.assessment.winRate),r.assessment.confidence95.map(percent).join(' – '),r.assessment.status])row.append(element('td',v));
    const cell=element('td'),button=element('button','View report');button.type='button';
    button.setAttribute('aria-label',`View benchmark report after ${number.format(r.trainingGames)} training games`);
    button.setAttribute('aria-pressed',String(chosen===r.trainingGames));
    button.addEventListener('click',()=>{comparisonChoices.set(value.id,r.trainingGames);renderCyclic(value);});
    cell.append(button);row.append(cell);evaluations.append(row);
  }
  if(chosen) loadComparison(value.id,chosen);
  else {comparisonKey='';$('cyclic-comparison-detail').replaceChildren(element('p','The first full report appears after the 5,000-game comparison completes.','muted'));}
}

async function loadEvolution(job,checkpoint) {
  const key=`${job}:${checkpoint}`;
  if(evolutionKey===key)return;
  evolutionKey=key;
  const target=$('cyclic-evolution');
  const url=`/api/evolution?job=${encodeURIComponent(job)}`;
  target.replaceChildren(element('p','Loading cumulative evidence…','muted'));
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
    const value=await response.json();
    if(!response.ok || value.error)throw new Error(value.error || `Report returned ${response.status}`);
    if(selected!==job || evolutionKey!==key)return;
    target.replaceChildren();
    const latest=value.latest;
    if(!latest){target.append(element('p','Cumulative evidence begins when the first 1,000-game comparison completes.','muted'));return;}
    const verdict={superior:'Evidence of superiority',inferior:'Evidence of underperformance',inconclusive:'Inconclusive'};
    const facts=element('dl');
    for(const [label,stat] of [
      ['Evaluated checkpoints',number.format(latest.checkpoints)],
      ['Evaluation games / fresh seed pairs',`${number.format(latest.games)} / ${number.format(latest.pairs)}`],
      ['Cumulative win rate',percent(latest.winRate)],
      ['Anytime-valid 95% bounds',latest.confidence95.map(percent).join(' – ')],
      ['Evolving-branch assessment',verdict[latest.status]],
      ['Through training games',number.format(latest.trainingGames)]])facts.append(element('dt',label),element('dd',stat));
    target.append(facts,element('p','Superiority requires the lower bound to exceed 50%. These bounds describe average performance across the evolving branch; use the checkpoint reports below to assess its latest state.','caption'));
    const details=element('details');details.append(element('summary','Cumulative history and method'));
    const scroll=element('div',null,'table-scroll'),table=element('table'),head=element('tr'),body=element('tbody');
    for(const label of ['After training games','Total evaluation games','Cumulative win rate','Anytime-valid 95% bounds','Assessment'])head.append(element('th',label));
    const thead=element('thead');thead.append(head);table.append(thead,body);scroll.append(table);details.append(scroll);
    for(const row of value.history.slice(-60)){
      const tr=element('tr');
      for(const stat of [number.format(row.trainingGames),number.format(row.games),percent(row.winRate),row.confidence95.map(percent).join(' – '),verdict[row.status]])tr.append(element('td',stat));
      body.append(tr);
    }
    if(value.history.length>60)details.append(element('p','Showing the latest 60 checkpoints; cumulative totals include every checkpoint.','caption'));
    details.append(element('p','Empirical-Bernstein confidence sequence for changing means. Each reciprocal seed pair is one observation; all completed checkpoints are included from the first. No extra evaluation games.','caption'));
    const source=element('a','Statistical method · Theorem 4');source.href=value.source;details.append(source);
    const download=element('a','Download cumulative report data');download.href=url;download.download='model29-evolving-branch.json';
    target.append(details,download);
  } catch(error) {
    if(selected!==job || evolutionKey!==key)return;
    evolutionKey='';target.replaceChildren(element('p',`Cumulative evidence unavailable: ${error.message}`,'notice'));
  }
}

async function loadComparison(job,checkpoint) {
  const key=`${job}:${checkpoint}`;
  if(comparisonKey===key)return;
  comparisonKey=key;
  const target=$('cyclic-comparison-detail');
  const url=`/api/comparison?job=${encodeURIComponent(job)}&checkpoint=${checkpoint}`;
  target.replaceChildren(element('p','Loading the saved benchmark report…','muted'));
  try {
    let value=comparisonReports.get(key);
    if(!value){
      const response=await fetch(url,{signal:AbortSignal.timeout(10000)});
      value=await response.json();
      if(!response.ok || value.error)throw new Error(value.error || `Report returned ${response.status}`);
      comparisonReports.set(key,value);
      if(comparisonReports.size>8)comparisonReports.delete(comparisonReports.keys().next().value);
    }
    if(selected!==job || comparisonKey!==key)return;
    renderComparison(target,value,url);
  } catch(error) {
    if(selected!==job || comparisonKey!==key)return;
    comparisonKey='';target.replaceChildren(element('p',`Comparison report unavailable: ${error.message}`,'notice'));
  }
}

function renderComparison(target,value,url) {
  target.replaceChildren();target.className='comparison-detail';
  const n=(v)=>v==null?'Not recorded':number.format(Math.round(v*1000)/1000);
  const band=(v)=>v?v.map(n).join(' – '):'More pairs needed';
  const heading=element('div',null,'section-heading');
  heading.append(element('h3',`Benchmark after ${number.format(value.trainingGames)} training games`));
  const download=element('a','Download report data');download.href=url;download.download=`model29-comparison-${value.trainingGames}.json`;
  heading.append(download);target.append(heading,element('p',`Current state · generation ${value.integrity.generation} versus frozen original state`,'muted'));
  const facts=(title,rows,parent=target)=>{
    const section=element('section',null,'comparison-section');section.append(element('h3',title));
    const list=element('dl');for(const [label,text] of rows)list.append(element('dt',label),element('dd',String(text)));
    section.append(list);parent.append(section);
  };
  const table=(title,headers,rows,parent=target)=>{
    const section=element('section',null,'comparison-section');section.append(element('h3',title));
    const scroll=element('div',null,'table-scroll'),grid=element('table'),head=element('thead'),h=element('tr'),body=element('tbody');
    for(const text of headers)h.append(element('th',text));head.append(h);
    for(const values of rows){const row=element('tr');for(const text of values)row.append(element('td',String(text)));body.append(row);}
    grid.append(head,body);scroll.append(grid);section.append(scroll);parent.append(section);
  };
  const p=value.pairedSeeds;
  facts('Result and paired evidence',[
    ['Games',`${n(value.games)} / ${n(value.games)} complete`],['Wins',`${n(value.candidateWins)} current · ${n(value.opponentWins)} original`],
    ['Current-state win rate',percent(value.candidateWinRate)],['Raw Wilson 95% interval',interval(value.candidateWilson95)],
    ['Paired 95% interval',interval(p.winRate95)],['Checkpoint-adjusted interval',interval(value.assessment.confidence95)],
    ['Assessment',value.assessment.status],['Noninferiority margin',percent(value.assessment.noninferiorityMargin)],
    ['Reciprocal seed pairs',n(p.pairs)],['Pair outcomes',`${n(p.candidateSweeps)} current sweeps · ${n(p.splitPairs)} splits · ${n(p.opponentSweeps)} original sweeps`],
    ['Score advantage per game',n(value.candidateMeanMargin)],['Raw score 95% interval',band(value.candidateMarginNormal95)],
    ['Paired score advantage',n(p.candidateMeanMargin)],['Paired score 95% interval',band(p.score95)]
  ]);
  const orientations=[['Current left',value.orientations.candidateLeft],['Original left',value.orientations.opponentLeft]];
  table('Reciprocal orientations',['Orientation','Games','Current wins','Original wins','Current win rate','Score advantage'],
    orientations.map(([label,r])=>[label,n(r.games),n(r.candidateWins),n(r.opponentWins),percent(r.candidateWinRate),n(r.candidateMeanMargin)]));
  const phases=(title,rows,parent=target)=>table(title,['Phase','Current mean','Original mean','Difference','Difference 95%','N current / original'],
    rows.map(r=>[r.label,n(r.candidate),n(r.opponent),n(r.delta),band(r.fixed95),`${n(r.candidateN)} / ${n(r.opponentN)}`]),parent);
  phases('Realized scoring',value.phaseScoring);
  phases('Available-event scoring',value.availableEventScoring);
  target.append(element('p','Phase values are points per recorded hand in that role; final score and margin are per game. Available-event scoring includes the full winning event. Unreached phases contribute zero.','caption'));
  const calibration=(r,parent=target)=>{
    const labels={discard_total:'Discard total',peg_future:'Remaining net pegging',discard:'Discard',pegging:'Pegging',peg_opening:'Opening play / hand',peg_hand:'Total / pegging hand'};
    for(const [field,title,headers,values] of [
      ['evCalibration','EV calibration',['Kind','Role','State','N','Predicted','Realized','Realized − predicted','Mean absolute error'],x=>[n(x.avgEv),n(x.avgRealized),n(x.avgError),n(x.meanAbsError)]],
      ['winProbabilityCalibration','Win-probability calibration and Brier',['Kind','Role','State','N','Predicted WP','Actual wins','Actual − predicted','Brier','Mean absolute error'],x=>[percent(x.avgPredicted),percent(x.actualWinRate),percent(x.miss),n(x.brier),n(x.meanAbsError)]],
      ['timing','Decision timing · opening and whole pegging hand',['Kind','Role','State','N','Mean ms','Median ms','90th percentile ms','Maximum ms','Total seconds'],x=>[n(x.avgMs),n(x.p50Ms),n(x.p90Ms),n(x.maxMs),n(x.totalSeconds)]]
    ]){
      const data=r[field];
      table(title,headers,(data.rows || []).map(x=>[labels[x.kind] || x.kind,x.role,x.model,n(x.rows),...values(x)]),parent);
      parent.append(element('p',`${data.note}${data.recordedGames == null ? '' : ` Telemetry: ${n(data.recordedGames)} / ${n(data.totalGames)} games (${data.status}).`}`,'caption'));
      if(field==='evCalibration' && data.recordedGames)parent.append(element('p',`EV exclusions: ${Object.entries(data.excluded).map(([key,count])=>`${key}: ${n(count)}`).join(' · ')}`,'caption'));
    }
    const bins=r.winProbabilityCalibration.buckets || [];
    if(bins.length){
      const detail=element('details',null,'methods');detail.append(element('summary','Win-probability calibration by predicted range'));
      table('Prediction ranges',['Kind','Role','State','Range','N','Predicted WP','Actual wins','Brier'],bins.map(x=>[labels[x.kind],x.role,x.model,x.bucket,n(x.rows),percent(x.avgPredicted),percent(x.actualWinRate),n(x.brier)]),detail);parent.append(detail);
    }
  };
  calibration(value);
  const bySide=element('details',null,'methods');bySide.append(element('summary','Full analysis within each reciprocal orientation'));
  const sideBody=element('div');for(const [label,r] of orientations){phases(`${label} · realized scoring`,r.scoring.realized,sideBody);phases(`${label} · available-event scoring`,r.scoring.available,sideBody);calibration(r,sideBody);}
  bySide.append(sideBody);target.append(bySide);
  const speed=value.performance;
  facts('Full-game throughput',[
    ['Comparison wall time',`${n(speed.wallSeconds)} seconds`],['Games per hour',n(speed.gamesPerHour)],
    ['Mean full-game duration',`${n(speed.meanGameSeconds)} seconds`],['Sum of worker game durations',`${n(speed.workerGameSeconds)} seconds`]
  ]);
  const audit=value.integrity;
  facts('Integrity',[
    ['Saved snapshot / request checks',audit.status],['Complete paired indexes',n(audit.completePairs)],
    ['Seed mismatches',n(audit.seedMismatches)],['Snapshot mismatches',n(audit.snapshotMismatches)],['First-winner games',n(audit.firstWinnerGames)],
    ['Seed range',`${audit.firstSeed} – ${audit.lastSeed}`],['Frozen source',audit.sourceRevision],
    ['Current snapshot SHA-256',audit.candidateSnapshot],['Original snapshot SHA-256',audit.originalSnapshot],['Evidence SHA-256',audit.evidenceSha256]
    ,['Evaluation recorder SHA-256',(value.telemetry?.recorderSha256 || []).join(', ') || 'Not recorded']
  ]);
  const methods=element('details',null,'methods');methods.append(element('summary','Report definitions and uncertainty'));
  const explanation=element('div');for(const text of value.notes)explanation.append(element('p',text));methods.append(explanation);target.append(methods);
}
function renderSelfplay(value) {
  $('selfplay-history-panel').hidden=Boolean(value.roleStudy);
  $('selfplay-speed-panel').hidden=Boolean(value.roleStudy);
  $('selfplay-role-panel').hidden=!value.roleStudy;
  $('selfplay-role-sizes').replaceChildren();
  for (const s of value.sizes || []) {
    const row=element('tr'),latest=s.latest;
    for (const v of [s.name,number.format(s.totalParameters),(s.parameters || []).map((n)=>number.format(n)).join(' / '),
      String(s.completedRounds || 0),latest?.kind || 'Preparing',latest ? percent(Math.max(...latest.decisionChange)) : '—',
      latest?.tableChange?.visitWeightedRms == null ? '—' : percent(latest.tableChange.visitWeightedRms),
      s.stop?.stable ? 'Empirical stability reached' : s.stop?.reason ? 'Round limit; not stable' : 'Running']) row.append(element('td',v));
    $('selfplay-role-sizes').append(row);
  }
  $('selfplay-title').textContent = value.title;
  $('selfplay-state').textContent = value.activity.kind;
  $('selfplay-stage').textContent = value.activity.label;
  $('selfplay-activity-kind').textContent = value.activity.kind;
  $('selfplay-activity').textContent = value.activity.label;
  $('selfplay-activity-progress').textContent = activityProgress(value.activity);
  $('selfplay-activity-detail').textContent = value.activity.detail;
  $('selfplay-activity-context').textContent = value.activity.context;
  $('selfplay-speed-state').textContent = blockState(value,'speed');
  $('selfplay-evals-state').textContent = value.roleStudy ? 'After each two-round cycle' : blockState(value,'evaluate');
  $('selfplay-quality-state').textContent = blockState(value,'quality');
  $('selfplay-quality-progress').textContent = value.stage === 'quality' ? `${value.activity.context} · ${activityProgress(value.activity)}. ${value.quality?.length || 0} model comparisons saved.` : `${value.quality?.length || 0} / ${value.discardModels?.length || 0} model comparisons saved.`;
  $('selfplay-games').textContent = `${number.format(value.completed)} / ${number.format(value.target)}`;
  $('selfplay-rounds').textContent = `${value.roundsCompleted} / ${value.rounds} ${value.roleStudy ? 'size-rounds (maximum)' : 'rounds'} complete`;
  $('selfplay-workers').textContent = `${value.workers} / ${value.workerLimit} CPU workers`;
  $('selfplay-gpu').textContent = value.roleStudy ? value.gpuShareDescription : `GPU submission duty capped at ${percent(value.gpuDutyLimit)} while sharing the device`;
  $('selfplay-models').textContent = value.roleStudy ? 'Each size has pone pegging, dealer pegging, pone discard and dealer discard networks.' : value.models.map((m,i) => value.discardModels?.length ? `${number.format(m.parameters + value.discardModels[i].parameters)} total parameters (${number.format(m.parameters)} pegging + ${number.format(value.discardModels[i].parameters)} discard)` : `${number.format(m.parameters)} parameters`).join(' vs ');
  $('selfplay-objective').textContent = value.objective;
  $('selfplay-current').textContent = 'These totals cover learning games only. Evaluation and speed-test games are counted in their own blocks.';
  const pace=value.gamePace || {};
  for (const [name,row] of [['training',pace.training],['rollout',pace.rollout],['live',pace.current]]) {
    $(`selfplay-${name}-rate`).textContent = name==='live' && !row ? '—' : gameRate(row?.gamesPerSecond);
    $(`selfplay-${name}-hourly`).textContent = hourlyGames(row?.gamesPerSecond);
  }
  $('selfplay-live-rate-label').textContent = pace.currentLabel || 'Current comparison average';
  renderStageList('selfplay-stages',value);
  $('selfplay-speed').replaceChildren();
  for (const r of value.speed) {
    const tr=element('tr');
    for (const v of [r.case, number.format(r.games), r.gamesPerSecond.toFixed(2), number.format(Math.round(r.gamesPerSecond*3600)), r.meanCpuCores.toFixed(2), duration(r.stageSeconds.environment), duration(r.stageSeconds.inferenceSmall+r.stageSeconds.inferenceLarge+(r.stageSeconds.discardSmall||0)+(r.stageSeconds.discardLarge||0))]) tr.append(element('td',v));
    $('selfplay-speed').append(tr);
  }
  $('selfplay-quality-panel').hidden = !value.stages.some((s)=>(value.stageKinds?.[s.name] || s.name)==='quality');
  $('selfplay-quality').replaceChildren();
  for (const r of value.quality || []) {
    const tr = element('tr');
    for (const v of [r.candidate, `${r.paired.model0Wins} / ${r.paired.games}`, percent(r.paired.winRate), interval(r.paired.paired95), hourlyGames(r.gamesPerSecond)]) tr.append(element('td', v));
    $('selfplay-quality').append(tr);
  }
  $('selfplay-evals').replaceChildren();
  $('selfplay-evals-interval').textContent = value.familywiseComparisons ? 'Adjusted paired 95% interval' : 'Paired 95% interval';
  $('selfplay-evals-note').textContent = value.familywiseComparisons ? `Greedy paired holdout games never feed training. Intervals adjust for all ${value.familywiseComparisons} planned model/checkpoint comparisons. Round 0 is the pilot checkpoint; later rounds are additional training. The opponent is each model’s frozen original, not full native Ace.` : 'Greedy play on paired holdout seeds. These evaluations never feed training. Intervals describe each checkpoint; this pilot does not establish strength relative to Ace.';
  if (value.roleStudy) $('selfplay-evals-note').textContent=`20,000 paired holdout games per size after each cycle. Round 0 is the four-role initialization. Intervals adjust across ${value.familywiseComparisons} planned comparisons. These games never update networks or WP tables. Opponents are frozen starters; this does not establish native-Ace strength.`;
  for (const r of value.evaluations) {
    const tr=element('tr'), p=r.paired, ci=value.familywiseComparisons ? p.familywise95 : p.paired95;
    for (const v of [String(r.round), modelSize(value,r.candidate), `${p.model0Wins} / ${p.games}`, percent(p.winRate), `${percent(ci[0])}–${percent(ci[1])}`, hourlyGames(r.gamesPerSecond)]) tr.append(element('td',v));
    $('selfplay-evals').append(tr);
  }
  renderSelfplayChart(value);
}

let inspectedTrainingTrial = null;
const trainingMode = (value) => ({ broad: 'Broad corpus', modern: 'Modern Ace tuning', 'target-only': '28.3 only', 'fine-tuned': 'Broad → 28.3' }[value] || value);
const trainingCount = (value) => value == null ? '—' : number.format(value);
const trainingLoss = (value) => value == null ? '—' : value.toFixed(4);
const trainingLabel = (row) => `${trainingCount(row.parameters)} parameters · ${trainingMode(row.mode)} · ${trainingCount(row.positions)} examples`;

function renderTraining(value) {
  const discard = value.mode === 'discard';
  $('training-frontier-panel').hidden = discard;
  $('training-metric-label').textContent = discard ? '28.3 and 28.3.fast · equal-weight validation metrics' : 'Natural 28.3 validation decisions';
  $('training-input-note').textContent = discard ? 'Inputs are the player’s own six suited cards, role and pre-cut scores. No cut or opponent private cards enter the discard network. Deal-seed groups and identical inputs stay in one data partition.' : 'Inputs come directly from saved hands, discards, cut, scores and the pegging series prefix. Each player receives only their own cards and public information. Whole deal-seed groups and identical inputs stay in one data partition.';
  $('training-title').textContent = value.title;
  $('training-kind').textContent = discard ? 'FP32 · learning recorded discard choices' : 'FP32 · learning recorded pegging choices';
  $('training-purpose').textContent = discard ? 'Two model sizes, each trained on the broad Ace corpus and then fine-tuned on modern Ace decisions.' : 'Compare model capacity, training data and repeated passes through saved decisions.';
  $('training-activity-detail').textContent = value.activity.detail;
  $('training-state').textContent = value.activity.kind;
  $('training-stage').textContent = value.activity.label;
  $('training-completed').textContent = value.completed;
  $('training-target').textContent = `of ${value.target} fits complete${discard ? ' · 2 sizes × 2 training phases' : ''}`;
  $('training-fraction').textContent = percent(value.completed / value.target);
  $('training-progress').setAttribute('aria-valuemax', value.target);
  $('training-progress').setAttribute('aria-valuenow', value.completed);
  $('training-fill').style.width = `${100 * value.completed / value.target}%`;
  const active = value.current;
  $('training-current').textContent = active ? `${trainingCount(active.parameters)} parameters` : value.activity.label;
  $('training-epoch').textContent = active ? `${trainingMode(active.mode)} · epoch ${active.epoch} / ${value.maxEpochs} maximum · best so far ${active.bestEpoch}` : value.activity.kind;
  $('training-decisions').textContent = trainingCount(value.data.decisions);
  $('training-games').textContent = discard ? `${trainingCount(value.data.games)} distinct deal seeds before grouping` : `${trainingCount(value.data.games)} eligible natural game records, plus saved 28.3.fast labels`;
  const best = value.trials.find((row) => row.id === value.preferred);
  $('training-best').textContent = best ? `${percent(best.validation.agreement)} agreement` : 'Waiting for a completed fit';
  $('training-best-note').textContent = best ? `${trainingCount(best.parameters)} parameters · lowest validation loss · ${value.selectionFrozen ? 'selection frozen' : 'provisional'}` : '';
  $('training-update').textContent = active ? `Progress updated ${new Date(active.updatedAt * 1000).toLocaleString()} · fit elapsed ${duration(active.seconds)} · GPU peak memory ${bytes(active.gpuPeakBytes)} · ${value.precision}` : `Snapshot ${new Date(value.asOf * 1000).toLocaleTimeString()} · ${value.precision}`;
  renderStageList('training-stages',value);
  const picker = $('training-trial');
  const choices = [...(active ? [active] : []), ...value.trials];
  const chosen = choices.find((row) => row.id === inspectedTrainingTrial)?.id || active?.id || value.preferred;
  const signature = choices.map((row) => row.id).join(',');
  if (picker.dataset.choices !== signature) {
    picker.replaceChildren();
    for (const row of choices) {
      const option = element('option', `${row.id === active?.id ? 'Current · ' : ''}${trainingLabel(row)} · ${row.id.split('-s').pop()}`);
      option.value = row.id; picker.append(option);
    }
    picker.dataset.choices = signature;
  }
  picker.value = chosen || ''; picker.disabled = !choices.length;
  $('training-trials').replaceChildren();
  for (const row of value.trials) {
    const tr = element('tr', null, row.id === value.preferred ? 'selected-trial' : '');
    const td = element('td'), button = element('button', trainingCount(row.parameters));
    button.type = 'button'; button.dataset.trainingTrial = row.id;
    button.title = `Show learning curves for ${row.id}`;
    td.append(button); tr.append(td);
    for (const text of [trainingMode(row.mode), trainingCount(row.positions), row.seed,
      `${row.chosenEpoch} / ${row.lastEpoch}`, percent(row.validation.agreement), trainingLoss(row.validation.crossEntropy),
      row.test?.agreement == null ? 'Pending' : `${percent(row.test.agreement)}${row.test95 ? ` (95%: ${interval(row.test95)})` : ''}`, duration(row.seconds)]) tr.append(element('td', text));
    $('training-trials').append(tr);
  }
  $('training-test-note').textContent = `${value.testAvailable ? 'Test results are now available. Intervals resample whole deal-seed groups.' : 'Test results remain pending until all fits finish and validation freezes selection.'} Highlighted row has the lowest natural 28.3 validation cross-entropy. Checkpoints use that loss, not peak agreement. Click a parameter count to inspect its learning curves.`;
  if (discard) $('training-test-note').textContent = 'Checkpoints minimize the mean validation loss of 28.3 and 28.3.fast. Broad fits use all qualified teachers; modern fits tune on 20.x/28.3. Test remains sealed until all four fits finish. Choice agreement does not establish strength.';
  const data = $('training-data'); data.replaceChildren();
  for (const [label, stat] of [['Training split', trainingCount(value.data.splits?.train)], ['Validation split', trainingCount(value.data.splits?.validation)], ['Test split', trainingCount(value.data.splits?.test)], ['Result verification', value.verification], ['Durable archive', value.archive]]) data.append(element('dt', label), element('dd', stat));
  const teachers = $('training-teachers'); teachers.replaceChildren();
  for (const [teacher, count] of Object.entries(value.data.teachers || {})) teachers.append(element('dt', teacher), element('dd', trainingCount(count)));
  $('training-speed-note').textContent = value.speed.status === 'complete' ? `${value.speed.includes} ${value.speed.sharedGpu}` : 'Scheduled after fitting and held-out evaluation. These measurements will include input encoding, inference and legal choice selection.';
  $('training-speed-label').textContent = `${discard ? 'Discard' : 'Pegging'} choice speed · diagnostic only`;
  $('training-speed-unit').textContent = `${discard ? 'Discard' : 'Pegging'} choices / sec`;
  if (discard) $('training-speed-note').textContent = 'Full-game speed and win-rate results belong to the game study. Follow the steps above to see their current status.';
  $('training-speed').replaceChildren();
  for (const row of value.speed.rows || []) {
    const tr = element('tr');
    for (const text of [trainingCount(row.parameters), trainingCount(row.batch), row.device, trainingCount(Math.round(row.decisionsPerSecond))]) tr.append(element('td', text));
    $('training-speed').append(tr);
  }
  $('training-frontier-note').textContent = value.frontier.limitation || 'Produced after the study finishes. More-data scenarios describe this model family; they do not establish a playing-strength ceiling.';
  $('training-frontier').replaceChildren();
  for (const row of value.frontier.curves || []) {
    const tr = element('tr'); tr.append(element('td', trainingCount(row.parameters)));
    for (const scale of ['2', '4', '10']) {
      const point = row.powerLawScenario?.[scale];
      tr.append(element('td', point ? `${percent(point.bestAgreement)} (${interval(point.agreementRange)})` : 'No stable projection'));
    }
    $('training-frontier').append(tr);
  }
  $('training-source').textContent = value.id;
  renderTrainingCharts(value);
}

function renderTrainingCharts(value) {
  const chosen = $('training-trial').value;
  const row = value.current?.id === chosen ? value.current : value.trials.find((trial) => trial.id === chosen);
  const history = row?.history || [];
  const epoch = row?.chosenEpoch ?? row?.bestEpoch;
  const options = { x: (r) => r.epoch, xLabel: 'Completed training epochs →', empty: 'Waiting for the first saved epoch', inspected: history.findIndex((r) => r.epoch === epoch) };
  chart('training-agreement-chart', history.filter((r) => r.agreement != null), { ...options, y: (r) => r.agreement, percent: true });
  chart('training-loss-chart', history.filter((r) => r.crossEntropy != null), { ...options, y: (r) => r.crossEntropy, decimals: 3, minSpan: .01 });
  $('training-curve-note').textContent = row ? `${trainingLabel(row)}. ${trainingCount(history[0]?.decisions)} ${value.mode === 'discard' ? '28.3/28.3.fast' : 'natural 28.3'} validation decisions per epoch. Marked epoch: ${epoch ?? 'pending'}, selected by lowest prediction loss. Later epochs can lose accuracy through overfitting.` : 'Training metrics appear after each completed epoch.';
}

$('training-trial').addEventListener('change', () => { inspectedTrainingTrial = $('training-trial').value; if (report?.kind === 'training') renderTrainingCharts(report); });
$('training-trials').addEventListener('click', (event) => {
  const button = event.target.closest('[data-training-trial]');
  if (!button || report?.kind !== 'training') return;
  inspectedTrainingTrial = button.dataset.trainingTrial; $('training-trial').value = inspectedTrainingTrial;
  renderTrainingCharts(report); $('training-trial').scrollIntoView({ behavior: 'smooth', block: 'center' });
});

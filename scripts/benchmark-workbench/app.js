"use strict";
const $ = (id) => document.getElementById(id);
const number = new Intl.NumberFormat();
const percent = (value) => value == null ? '—' : `${(value * 100).toFixed(2)}%`;
const interval = (values) => values ? `${percent(values[0])} – ${percent(values[1])}` : 'More pairs needed';
const modelName = (value) => (value || '').replace('schell_table-peg_table-', '').replace(/^13\.23$/, 'Ace (13.23)');
let report = null;
let timer;
let request;
let selected = new URLSearchParams(location.search).get('job') || '';
let followLatest = true;
let inspectedPairs = 0;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text != null) node.textContent = text;
  if (className) node.className = className;
  return node;
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
  const [, , width, height] = svg.getAttribute('viewBox').split(' ').map(Number);
  const left = 56, right = width - 20, top = 18, bottom = height - 38;
  if (!rows.length) {
    svg.append(svgNode('text', { x: width / 2, y: height / 2, 'text-anchor': 'middle' }, 'Waiting for saved game pairs'));
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
  for (let i = 0; i <= 4; i++) {
    const value = low + (high - low) * i / 4;
    svg.append(svgNode('line', { x1: left, y1: y(value), x2: right, y2: y(value), class: 'grid' }));
    svg.append(svgNode('text', { x: left - 9, y: y(value) + 4, 'text-anchor': 'end' }, options.percent ? `${Math.round(value * 100)}%` : value.toFixed(options.decimals ?? 1)));
    const xValue = xMax * i / 4;
    svg.append(svgNode('text', { x: x(xValue), y: height - 12, 'text-anchor': 'middle' }, options.xHours ? `${xValue.toFixed(1)}h` : number.format(Math.round(xValue))));
  }
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
  if (options.inspected != null && rows[options.inspected]) {
    const row = rows[options.inspected];
    plot.append(svgNode('line', { x1: x(options.x(row)), x2: x(options.x(row)), y1: top, y2: bottom, class: 'cursor' }));
    plot.append(svgNode('circle', { cx: x(options.x(row)), cy: y(options.y(row)), r: 4, class: 'point' }));
  }
}

function renderCharts() {
  if (!report || report.error || report.waiting) return;
  const index = Number($('inspect').value);
  const bands = [];
  if ($('show-anytime').checked) bands.push({ key: 'anytime95', className: 'anytime-band' });
  if ($('show-fixed').checked) bands.push({ key: 'fixed95', className: 'fixed-band' });
  chart('win-chart', report.history, { x: (r) => r.pairs, y: (r) => r.winRate, percent: true, reference: .5, bands, inspected: index, domain: $('win-scale').value === 'focus' ? [.4, .6] : null });
  chart('score-chart', report.history, { x: (r) => r.pairs, y: (r) => r.scoreDelta, reference: 0, minSpan: 1, bands: [{ key: 'score95', className: 'fixed-band' }], inspected: index });
  chart('progress-chart', report.progressHistory, { x: (r) => r.hours, y: (r) => r.games, xHours: true, zero: true, decimals: 0 });
  const point = report.history[index];
  $('inspection').textContent = point ? `${number.format(point.pairs)} pairs · win rate ${percent(point.winRate)} · ordinary ${interval(point.fixed95)} · sequential ${interval(point.anytime95)}` : 'Waiting for complete pairs';
}

function render(value) {
  report = value;
  const error = value.error || value.waiting;
  $('report').hidden = Boolean(error);
  $('notice').hidden = !error && !value.warnings?.length;
  $('notice').textContent = error || (value.warnings || []).join(' ');
  if (error) return;
  $('matchup').textContent = `${modelName(value.candidate)} vs ${modelName(value.opponent)}`;
  $('experiment').textContent = value.experiment;
  $('state').textContent = value.state;
  const active = value.stages.find((s) => s.state === 'running' || s.state === 'failed');
  $('stage').textContent = value.state === 'complete' ? 'Reports and verification complete' : active ? active.name.replaceAll('-', ' ') : 'Waiting for the next stage';
  $('progress-total').textContent = `${number.format(value.saved)} / ${number.format(value.target)} · ${(100 * value.saved / value.target).toFixed(1)}%`;
  $('lanes').replaceChildren();
  $('orientation-rows').replaceChildren();
  value.orientations.forEach((row, i) => {
    const label = i === 0 ? 'Candidate left' : 'Opponent left';
    const lane = element('div', null, 'lane');
    const name = element('div', label, 'lane-label');
    name.append(element('small', row.stale ? 'No recent update' : row.state));
    const track = element('div', null, 'lane-track');
    track.setAttribute('role', 'progressbar'); track.setAttribute('aria-label', label);
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
  $('win-rate').textContent = percent(latest?.winRate);
  $('fixed-interval').textContent = interval(latest?.fixed95);
  $('anytime-interval').textContent = latest ? interval(latest.anytime95) : 'More pairs needed';
  $('sweeps').textContent = latest ? `${latest.candidateSweeps} sweeps · ${latest.splits} splits · ${latest.opponentSweeps} opponent sweeps` : 'Waiting for paired outcomes';
  const advantage = latest?.anytime95[0] > .5;
  const disadvantage = latest?.anytime95[1] < .5;
  $('verdict').textContent = advantage ? 'Sequential evidence favors the candidate' : disadvantage ? 'Sequential evidence favors the opponent' : 'Sequential interval still includes 50%';
  $('verdict').classList.toggle('positive', advantage);
  $('score-delta').textContent = latest ? `${latest.scoreDelta >= 0 ? '+' : ''}${latest.scoreDelta.toFixed(2)}` : '—';
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

async function refresh() {
  clearTimeout(timer);
  request?.abort();
  const controller = new AbortController(); request = controller;
  $('connection').textContent = 'Updating…';
  try {
    const response = await fetch('/api/jobs', { signal: controller.signal });
    if (!response.ok) throw new Error(`Workbench returned ${response.status}`);
    const { jobs } = await response.json();
    const picker = $('jobs');
    picker.replaceChildren();
    if (!jobs.length) {
      picker.append(element('option', 'No paired benchmarks registered'));
      $('empty').hidden = false; $('report').hidden = true; $('notice').hidden = true;
      $('connection').textContent = 'Connected';
      return;
    }
    $('empty').hidden = true;
    if (!jobs.some((job) => job.id === selected)) selected = jobs[0].id;
    jobs.forEach((job) => { const option = element('option', `${job.state} · ${job.id}`); option.value = job.id; picker.append(option); });
    picker.value = selected;
    history.replaceState(null, '', `/?job=${encodeURIComponent(selected)}`);
    const data = await fetch(`/api/report?job=${encodeURIComponent(selected)}`, { signal: controller.signal });
    if (!data.ok) throw new Error(`Benchmark returned ${data.status}`);
    const value = await data.json();
    if (controller.signal.aborted) return;
    render(value);
    $('connection').textContent = value.error ? 'Data unavailable' : 'Live · 15s refresh';
  } catch (error) {
    if (error.name === 'AbortError') return;
    $('connection').textContent = 'Disconnected';
    $('notice').hidden = false;
    $('notice').textContent = `${error.message}. Displayed figures may be out of date. Retrying automatically.`;
  } finally {
    if (request === controller && !document.hidden) timer = setTimeout(refresh, 15000);
  }
}

$('jobs').addEventListener('change', () => { selected = $('jobs').value; followLatest = true; $('report').hidden = true; refresh(); });
$('refresh').addEventListener('click', refresh);
$('show-fixed').addEventListener('change', renderCharts);
$('show-anytime').addEventListener('change', renderCharts);
$('win-scale').addEventListener('change', renderCharts);
$('inspect').addEventListener('input', () => { followLatest = Number($('inspect').value) === Number($('inspect').max); inspectedPairs = report.history[Number($('inspect').value)]?.pairs || 0; renderCharts(); });
document.addEventListener('visibilitychange', () => { clearTimeout(timer); if (!document.hidden) refresh(); else request?.abort(); });
refresh();

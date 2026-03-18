import type { BenchmarkResult, StrategyId } from '../types.js'

declare const Chart: any

const COLORS: Record<StrategyId, string> = {
  'navbandit': '#58a6ff',
  'navbandit-ts': '#a371f7',
  'prefetch-all': '#f85149',
  'static-top-k': '#d29922',
  'random-k': '#8b949e',
  'no-prefetch': '#484f58',
}

const LABELS: Record<StrategyId, string> = {
  'navbandit': 'NavBandit (UCB1)',
  'navbandit-ts': 'NavBandit (Thompson)',
  'prefetch-all': 'Prefetch All',
  'static-top-k': 'Static Top-K (Oracle)',
  'random-k': 'Random K',
  'no-prefetch': 'No Prefetch',
}

const STRATEGY_ORDER: StrategyId[] = [
  'navbandit',
  'navbandit-ts',
  'prefetch-all',
  'static-top-k',
  'random-k',
  'no-prefetch',
]

export function renderCards(result: BenchmarkResult, container: HTMLDivElement): void {
  const nb = result.strategies['navbandit']
  const ts = result.strategies['navbandit-ts']
  const pa = result.strategies['prefetch-all']

  const bandwidthSaved = pa.mean.bandwidthKB > 0
    ? ((1 - nb.mean.bandwidthKB / pa.mean.bandwidthKB) * 100).toFixed(0)
    : '0'

  const efficiencyMultiple = pa.mean.efficiency > 0
    ? (nb.mean.efficiency / pa.mean.efficiency).toFixed(1)
    : 'N/A'

  const nbConv = nb.mean.convergenceNav > 0 ? `~${Math.round(nb.mean.convergenceNav)}` : 'N/R'
  const tsConv = ts.mean.convergenceNav > 0 ? `~${Math.round(ts.mean.convergenceNav)}` : 'N/R'

  const cards = [
    { label: 'UCB1 Hit Rate', value: `${(nb.mean.hitRate * 100).toFixed(1)}%`, cls: 'blue' },
    { label: 'Thompson Hit Rate', value: `${(ts.mean.hitRate * 100).toFixed(1)}%`, cls: 'purple' },
    { label: 'Bandwidth Saved vs Prefetch All', value: `${bandwidthSaved}%`, cls: 'green' },
    { label: 'Efficiency Multiplier', value: `${efficiencyMultiple}×`, cls: 'green' },
    { label: 'UCB1 Convergence', value: nbConv, cls: 'blue' },
    { label: 'Thompson Convergence', value: tsConv, cls: 'purple' },
  ]

  for (const card of cards) {
    const div = document.createElement('div')
    div.className = 'card'
    div.innerHTML = `
      <div class="label">${card.label}</div>
      <div class="value ${card.cls}">${card.value}</div>
    `
    container.appendChild(div)
  }
}

export function renderCharts(result: BenchmarkResult, container: HTMLDivElement): void {
  // 1. Efficiency comparison (bar chart)
  const effContainer = createChartContainer('Efficiency (Hits / Total Prefetches)')
  container.appendChild(effContainer.wrapper)
  createEfficiencyChart(result, effContainer.canvas)

  // 2. Bandwidth cost (bar chart)
  const bwContainer = createChartContainer('Bandwidth Cost (MB)')
  container.appendChild(bwContainer.wrapper)
  createBandwidthChart(result, bwContainer.canvas)

  // 3. Hit rate comparison (bar chart)
  const hrContainer = createChartContainer('Hit Rate Comparison')
  container.appendChild(hrContainer.wrapper)
  createHitRateChart(result, hrContainer.canvas)

  // 4. Bandwidth breakdown - useful vs wasted
  const breakdownContainer = createChartContainer('Useful vs Wasted Prefetches')
  container.appendChild(breakdownContainer.wrapper)
  createBreakdownChart(result, breakdownContainer.canvas)
}

function createChartContainer(title: string): { wrapper: HTMLDivElement; canvas: HTMLCanvasElement } {
  const wrapper = document.createElement('div')
  wrapper.className = 'chart-container'

  const h3 = document.createElement('h3')
  h3.textContent = title
  wrapper.appendChild(h3)

  const canvas = document.createElement('canvas')
  wrapper.appendChild(canvas)

  return { wrapper, canvas }
}

function createEfficiencyChart(result: BenchmarkResult, canvas: HTMLCanvasElement): void {
  const active = STRATEGY_ORDER.filter(s => s !== 'no-prefetch')
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: active.map(s => LABELS[s]),
      datasets: [{
        data: active.map(s => result.strategies[s].mean.efficiency * 100),
        backgroundColor: active.map(s => COLORS[s]),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Efficiency %', color: '#8b949e' },
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' },
        },
        x: { ticks: { color: '#8b949e' }, grid: { display: false } },
      },
    },
  })
}

function createBandwidthChart(result: BenchmarkResult, canvas: HTMLCanvasElement): void {
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: STRATEGY_ORDER.map(s => LABELS[s]),
      datasets: [{
        data: STRATEGY_ORDER.map(s => result.strategies[s].mean.bandwidthKB / 1024),
        backgroundColor: STRATEGY_ORDER.map(s => COLORS[s]),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.parsed.y.toFixed(1)} MB` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          title: { display: true, text: 'Bandwidth (MB)', color: '#8b949e' },
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' },
        },
        x: { ticks: { color: '#8b949e' }, grid: { display: false } },
      },
    },
  })
}

function createHitRateChart(result: BenchmarkResult, canvas: HTMLCanvasElement): void {
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: STRATEGY_ORDER.map(s => LABELS[s]),
      datasets: [{
        data: STRATEGY_ORDER.map(s => result.strategies[s].mean.hitRate * 100),
        backgroundColor: STRATEGY_ORDER.map(s => COLORS[s]),
        borderRadius: 4,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx: any) => `${ctx.parsed.y.toFixed(1)}%` } },
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Hit Rate %', color: '#8b949e' },
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' },
        },
        x: { ticks: { color: '#8b949e' }, grid: { display: false } },
      },
    },
  })
}

function createBreakdownChart(result: BenchmarkResult, canvas: HTMLCanvasElement): void {
  const active = STRATEGY_ORDER.filter(s => s !== 'no-prefetch')
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: active.map(s => LABELS[s]),
      datasets: [
        {
          label: 'Hits (useful)',
          data: active.map(s => result.strategies[s].mean.hits),
          backgroundColor: '#3fb950',
          borderRadius: 4,
        },
        {
          label: 'Wasted',
          data: active.map(s => result.strategies[s].mean.wastedPrefetches),
          backgroundColor: '#f8514966',
          borderRadius: 4,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { labels: { color: '#8b949e' } },
      },
      scales: {
        x: { stacked: true, ticks: { color: '#8b949e' }, grid: { display: false } },
        y: {
          stacked: true,
          title: { display: true, text: 'Prefetches', color: '#8b949e' },
          ticks: { color: '#8b949e' },
          grid: { color: '#21262d' },
        },
      },
    },
  })
}

export function renderTable(result: BenchmarkResult, container: HTMLElement): void {
  const table = document.createElement('table')

  const pct = (v: number, ci: [number, number]) => {
    const margin = ((ci[1] - ci[0]) / 2) * 100
    return `${(v * 100).toFixed(1)}% ± ${margin.toFixed(1)}%`
  }

  const mb = (kb: number, ci: [number, number]) => {
    const margin = (ci[1] - ci[0]) / 2 / 1024
    return `${(kb / 1024).toFixed(1)} ± ${margin.toFixed(1)} MB`
  }

  table.innerHTML = `
    <thead>
      <tr>
        <th>Strategy</th>
        <th>Hit Rate</th>
        <th>Efficiency</th>
        <th>Total Prefetches</th>
        <th>Hits</th>
        <th>Wasted</th>
        <th>Bandwidth</th>
        <th>Convergence</th>
      </tr>
    </thead>
    <tbody>
      ${STRATEGY_ORDER.map(sid => {
        const s = result.strategies[sid]
        const convStr = (sid === 'navbandit' || sid === 'navbandit-ts')
          ? (s.mean.convergenceNav > 0 ? `~${Math.round(s.mean.convergenceNav)} navs` : 'not reached')
          : sid === 'static-top-k' ? 'oracle' : 'n/a'
        return `<tr>
          <td><span style="color:${COLORS[sid]}">●</span> ${LABELS[sid]}</td>
          <td>${sid === 'no-prefetch' ? '0.0%' : pct(s.mean.hitRate, s.ci95.hitRate)}</td>
          <td>${sid === 'no-prefetch' ? 'n/a' : pct(s.mean.efficiency, s.ci95.efficiency)}</td>
          <td>${Math.round(s.mean.totalPrefetches)}</td>
          <td>${Math.round(s.mean.hits)}</td>
          <td>${Math.round(s.mean.wastedPrefetches)}</td>
          <td>${mb(s.mean.bandwidthKB, s.ci95.bandwidthKB)}</td>
          <td>${convStr}</td>
        </tr>`
      }).join('')}
    </tbody>
  `

  container.appendChild(table)
}

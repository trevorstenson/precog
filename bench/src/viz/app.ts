import { renderCharts, renderCards, renderTable } from './charts.js'
import { renderSweepHeatmap, renderSweepDetails } from './sweep-charts.js'
import type { BenchmarkResult, SweepResult } from '../types.js'

const fileInput = document.getElementById('fileInput') as HTMLInputElement
const content = document.getElementById('content') as HTMLDivElement
const status = document.getElementById('status') as HTMLSpanElement

// Try to load results.json and sweep-results.json automatically
async function tryAutoLoad() {
  for (const file of ['results.json', 'sweep-results.json']) {
    try {
      const resp = await fetch(`/${file}`)
      if (resp.ok) {
        const data = await resp.json()
        loadData(data)
        status.textContent = `Auto-loaded ${file}`
        return
      }
    } catch {
      // Try next
    }
  }
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]
  if (!file) return

  try {
    const text = await file.text()
    const data = JSON.parse(text)
    loadData(data)
    status.textContent = `Loaded ${file.name}`
  } catch (e) {
    status.textContent = `Error: ${e}`
  }
})

function isSweepResult(data: any): data is SweepResult {
  return data && Array.isArray(data.scenarios) && data.scenarios[0]?.scenario?.network
}

function loadData(data: any) {
  content.innerHTML = ''

  if (isSweepResult(data)) {
    loadSweepData(data)
    return
  }

  const results: BenchmarkResult[] = Array.isArray(data) ? data : [data]

  for (const result of results) {
    const section = document.createElement('div')
    section.style.marginBottom = '3rem'

    const heading = document.createElement('h2')
    heading.style.color = '#e6edf3'
    heading.style.marginBottom = '1.5rem'
    heading.textContent = `${result.topology.archetype.toUpperCase()} — ${result.trials} trials × ${result.navigationsPerTrial} navigations`
    section.appendChild(heading)

    // Summary cards
    const cardsDiv = document.createElement('div')
    cardsDiv.className = 'cards'
    section.appendChild(cardsDiv)
    renderCards(result, cardsDiv)

    // Charts
    const chartsDiv = document.createElement('div')
    chartsDiv.className = 'charts'
    section.appendChild(chartsDiv)
    renderCharts(result, chartsDiv)

    // Data table
    const tableHeading = document.createElement('h3')
    tableHeading.style.color = '#e6edf3'
    tableHeading.style.margin = '1.5rem 0 1rem'
    tableHeading.textContent = 'Full Results'
    section.appendChild(tableHeading)
    renderTable(result, section)

    content.appendChild(section)
  }
}

function loadSweepData(data: SweepResult) {
  const section = document.createElement('div')

  const heading = document.createElement('h2')
  heading.style.color = '#e6edf3'
  heading.style.marginBottom = '0.5rem'
  heading.textContent = `Scenario Sweep: ${data.topology.archetype.toUpperCase()}`
  section.appendChild(heading)

  const subtitle = document.createElement('p')
  subtitle.style.color = '#8b949e'
  subtitle.style.marginBottom = '2rem'
  subtitle.textContent = `${data.trials} trials × ${data.navigationsPerTrial} navigations | ${data.scenarios.length} scenarios`
  section.appendChild(subtitle)

  // Heatmap
  renderSweepHeatmap(data, section)

  // Full details table
  const detailsHeading = document.createElement('h3')
  detailsHeading.style.color = '#e6edf3'
  detailsHeading.style.margin = '1.5rem 0 1rem'
  detailsHeading.textContent = 'All Scenarios'
  section.appendChild(detailsHeading)
  renderSweepDetails(data, section)

  content.appendChild(section)
}

tryAutoLoad()

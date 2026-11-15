import { useState } from 'react'
import { track } from '@vercel/analytics'
import { V1_BENCH, V1_CONFIRMATORY, V1_SOURCE } from '../lib/skandaV1'
import { Reveal, pct } from './ui'

/** Categorical colours by model, fixed so a model keeps its colour across tabs (grey baseline, amber MAIRA-2 as in the history chart). */
const colorOf: Record<string, string> = { 'MedGemma 27B': '#8f8f8f', 'MAIRA-2': 'var(--sk-amber)', 'MedGemma + MAIRA-2': '#d9569a', 'Skanda V1': 'var(--sk-blue)' }
const fmt = (v: number) => pct(v, v % 1 ? 1 : 0)

export function V1Results() {
  const [tab, setTab] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const t = V1_BENCH[tab]
  return <Reveal className="sk-wrap sk-chart-card sk-v1" id="skanda-v1-results">
    <div className="sk-chart-head">
      <div><p className="sk-plan-label">Served model · Skanda V1</p><h3>Skanda V1 on {t.label === 'Chest X-ray' ? 'chest X-ray' : t.label}</h3><p className="sk-bench-sub">{t.cases}. Every model read by the same runner and scored by the same script. Percent, higher is better.</p></div>
      <div className="sk-seg sk-seg-lg" role="tablist" aria-label="Skanda V1 modality">{V1_BENCH.map((b, i) => <button key={b.label} role="tab" aria-selected={i === tab} onClick={() => { setTab(i); track('benchmark_tab', { table: `v1-${b.label}` }) }}>{b.label}</button>)}</div>
    </div>
    <div className="sk-legend">{t.columns.map((c) => <span key={c}><i style={{ background: colorOf[c] }} />{c}</span>)}</div>
    <div className="sk-bars" key={tab}>
      {t.rows.map((row, r) => <div className="sk-bar-row" key={row.metric} style={{ ['--r' as string]: r }}>
        <span className="sk-bar-label">{row.metric}</span>
        <div className="sk-bar-group">{row.values.map((v, c) => {
          const name = t.columns[c]
          const id = `${row.metric}-${c}`
          if (v === null) return <div key={c} className="sk-bar sk-bar-empty"><span>{name}: not run</span></div>
          return <div key={c} className="sk-bar" data-model={name === 'Skanda V1' ? 'skanda' : undefined} tabIndex={0} onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)} aria-label={`${name}, ${row.metric}: ${fmt(v)}`}>
            <i className="sk-bar-fill" style={{ width: `${v}%`, background: colorOf[name], animationDelay: `${r * 60 + c * 70}ms` }} />
            <b>{fmt(v)}</b>
            {hover === id && <span className="sk-tip">{name} · {row.metric} · {fmt(v)}</span>}
          </div>
        })}</div>
      </div>)}
    </div>
    <p className="sk-chart-foot">Source: {V1_SOURCE}. Skanda V1 is the run 4b checkpoint served in the hosted workspace. Baselines are the re-read published on the same card, so they differ slightly from the earlier comparison. Each chest X-ray number moves about ±10 points by chance across 111 films. Research use only; not a medical device.</p>
  </Reveal>
}

export function V1Confirmatory({ full = false }: { full?: boolean }) {
  const c = V1_CONFIRMATORY
  const all = c.columns.length - 1
  const tiles = [
    ['2,584', 'new held-out cases, read after the analysis plan was committed'],
    [fmt(c.rows[1].values[all]!), 'normals cleared, no finding drawn'],
    [fmt(c.rows[4].values[all]!), 'mean Dice of the outlines it found'],
    [`${c.secondsPerRead[all]} s`, 'per read, as served'],
  ] as const
  return <Reveal className="sk-wrap sk-confirm" id="confirmatory">
    <div className="sk-confirm-head">
      <div><p className="sk-plan-label">Pre-registered · confirmatory set</p><h3>Fixed in advance, then read once</h3></div>
      <p>The analysis plan, lexicon and scoring code were committed on 6 Nov 2026 before Skanda V1 read a single confirmatory case. Descriptive results below; the planned hypothesis tests are still running.</p>
    </div>
    <ul className="sk-confirm-tiles">{tiles.map(([b, s]) => <li key={s}><b>{b}</b><span>{s}</span></li>)}</ul>
    {full && <div className="sk-table-scroll" tabIndex={0} role="region" aria-label="Confirmatory results by modality">
      <table className="sk-confirm-table"><thead><tr><th scope="col">Metric, %</th>{c.columns.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{c.rows.map((r) => <tr key={r.metric}><th scope="row">{r.metric}</th>{r.values.map((v, i) => <td key={i} className={i === all ? 'sk-confirm-all' : undefined}>{v.toFixed(1)}</td>)}</tr>)}
          <tr><th scope="row">Seconds per read</th>{c.secondsPerRead.map((v, i) => <td key={i} className={i === all ? 'sk-confirm-all' : undefined}>{v.toFixed(1)}</td>)}</tr></tbody></table>
    </div>}
    <p className="sk-chart-foot">{c.note}{!full && <> <a href="/benchmarks#confirmatory">Per-modality results</a></>}</p>
  </Reveal>
}

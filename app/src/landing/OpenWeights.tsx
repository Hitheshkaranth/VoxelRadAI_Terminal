import { useState } from 'react'
import { ArrowRight, Check, Copy } from 'lucide-react'
import { track } from '@vercel/analytics'
import { BENCHMARKS, BUILDS, SKANDA_0, downloadCommand, hfFilesUrl, hfUrl } from '../lib/openModels'
import { Pill, Reveal, pct } from './ui'

const [baselines, quants] = BENCHMARKS
const quantByMetric = (group: string, metric: string, col: number) =>
  quants.groups.find((g) => g.label === group)?.rows.find((r) => r.metric === metric)?.values[col] ?? null

const buildCopy = {
  bf16: { label: 'Full precision · bf16', blurb: 'Reference weights. Needs about 68 GB of memory to serve, 93 GB at peak.' },
  int8: { label: 'Recommended · int8', blurb: 'Per-row int8. Half the size and effectively lossless against bf16.' },
  int4: { label: 'Smallest · int4', blurb: 'Group-128 int4. Fits smaller GPUs, with a measurable drop on CT and MRI.' },
} as const

const buildRows = [
  ['Right finding type · X-ray', 'Chest X-ray', 'Right finding type'],
  ['Normals cleared · CT', 'CT', 'Normals called normal'],
  ['Right finding type · MRI', 'MRI', 'Right finding type'],
  ['Box recall · MRI', 'MRI', 'Box recall'],
] as const

/** Series colours: model identity matches the Benchmarks section; quant builds are three steps of the brand blue. */
const baselineColor = ['#8f8f8f', 'var(--sk-amber)', 'var(--sk-blue)']
const quantColor = ['var(--sk-blue-2)', 'var(--sk-blue)', 'var(--sk-blue-3)']

const views = {
  CT: { table: baselines, group: 'CT', cols: [0, 2] },
  MRI: { table: baselines, group: 'MRI', cols: [0, 2] },
  'Quantized builds': { table: quants, group: null, cols: [0, 1, 2] },
} as const
type View = keyof typeof views

export function OpenWeights() {
  const [view, setView] = useState<View>('CT')
  const [hover, setHover] = useState<string | null>(null)
  const v = views[view]
  const colors = v.table === quants ? quantColor : baselineColor
  const rows = v.group
    ? v.table.groups.filter((g) => g.label === v.group).flatMap((g) => g.rows.map((r) => ({ label: r.metric, values: r.values })))
    : v.table.groups.flatMap((g) => g.rows.map((r) => ({ label: `${r.metric} · ${g.label === 'Chest X-ray' ? 'X-ray' : g.label}`, values: r.values })))

  return <section className="sk-bench sk-weights" id="weights" aria-labelledby="weights-title">
    <div className="sk-wrap sk-center">
      <p className="sk-eyebrow">Open source · Skanda-0 · {SKANDA_0.license}</p>
      <h2 id="weights-title" className="sk-h2 sk-weights-title">Open <em>weights</em></h2>
      <p className="sk-weights-lead">Skanda-0 is our open-source model, published on Hugging Face as <a href={hfUrl(SKANDA_0.repo)} onClick={() => track('model_card_open', { from: 'landing' })}>{SKANDA_0.repo}</a> in three builds. Only its language model is quantized; the outline model and score head stay bf16. The hosted workspace serves Skanda V1, which is not part of this release.</p>
    </div>

    <Reveal className="sk-wrap sk-plans sk-weights-plans">{BUILDS.map((b, i) => {
      const c = buildCopy[b.precision]
      return <article key={b.repo} className="sk-plan" data-model={b.recommended ? 'skanda' : undefined} style={{ ['--r' as string]: i }}>
        <span className="sk-plan-label">{c.label}</span>
        <p className="sk-plan-price"><small>download</small>{b.size.replace(' GB', '')}<span className="sk-weights-unit">GB</span></p>
        <p className="sk-plan-blurb">{c.blurb}</p>
        <ul>{buildRows.map(([label, group, metric]) => {
          const val = quantByMetric(group, metric, i)
          return <li key={label}><span>{label}</span><b>{val === null ? '—' : pct(val, val % 1 ? 1 : 0)}</b></li>
        })}</ul>
        <CopyCommand command={downloadCommand(b.repo)} build={b.precision} />
        <div className="sk-plan-actions">
          <Pill href={hfFilesUrl(b.repo)} tone={b.recommended ? 'light' : 'grey'} onClick={() => track('model_download', { build: b.precision, link: 'files', from: 'landing' })}>Download</Pill>
          <a href={hfUrl(b.repo)} className="sk-details" onClick={() => track('model_download', { build: b.precision, link: 'huggingface', from: 'landing' })}>Model card <ArrowRight size={13} /></a>
        </div>
      </article>
    })}</Reveal>

    <Reveal className="sk-wrap sk-chart-card">
      <div className="sk-chart-head">
        <div>
          <h3>{view === 'Quantized builds' ? 'What quantization costs' : `Skanda-0 on ${view}`}</h3>
          <p>{view === 'Quantized builds'
            ? 'The same test sets re-read with each Skanda-0 build. int8 tracks bf16 within a point or two; int4 gives up most on MRI box recall and CT normals.'
            : `${v.table.groups.find((g) => g.label === v.group)?.cases}. Open Skanda-0 against MedGemma 27B in the same pipeline. MAIRA-2 reads chest X-ray only.`}</p>
        </div>
        <div className="sk-seg sk-seg-lg" role="tablist" aria-label="Open weights benchmark view">{(Object.keys(views) as View[]).map((k) =>
          <button key={k} role="tab" aria-selected={k === view} onClick={() => { setView(k); track('benchmark_tab', { table: k, from: 'landing' }) }}>{k}</button>)}</div>
      </div>
      <div className="sk-legend">{v.cols.map((c) => <span key={c}><i style={{ background: colors[c] }} />{v.table.columns[c]}</span>)}</div>
      <div className="sk-bars" key={view}>
        {rows.map((row, r) => <div className="sk-bar-row" key={row.label} style={{ ['--r' as string]: r }}>
          <span className="sk-bar-label">{row.label}</span>
          <div className="sk-bar-group">{v.cols.map((c) => {
            const val = row.values[c]
            const name = v.table.columns[c]
            const id = `${row.label}-${c}`
            if (val === null) return <div key={c} className="sk-bar sk-bar-empty"><span>{name}: not run</span></div>
            const shown = pct(val, val % 1 ? 1 : 0)
            return <div key={c} className="sk-bar" tabIndex={0} onPointerEnter={() => setHover(id)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(id)} onBlur={() => setHover(null)} aria-label={`${name}, ${row.label}: ${shown}`}>
              <i className="sk-bar-fill" style={{ width: `${val}%`, background: colors[c], animationDelay: `${r * 60 + c * 80}ms` }} />
              <b>{shown}</b>
              {hover === id && <span className="sk-tip">{name} · {row.label} · {shown}</span>}
            </div>
          })}</div>
        </div>)}
      </div>
      <p className="sk-chart-foot">{v.table.caption} {v.table.footnote} These figures are for the open Skanda-0, not Skanda V1. Source: the <a href={hfUrl(SKANDA_0.repo)}>Skanda-0 model card</a>. CT and MRI figures come from the model card’s held-out sets, which differ from the chest X-ray comparison above. Research use only; not a medical device.</p>
    </Reveal>
  </section>
}

function CopyCommand({ command, build }: { command: string; build: string }) {
  const [copied, setCopied] = useState(false)
  return <div className={`sk-cmd${copied ? ' sk-cmd-done' : ''}`}>
    <code>{command}</code>
    <button type="button" aria-label={copied ? 'Copied' : 'Copy download command'} onClick={async () => {
      try {
        await navigator.clipboard.writeText(command)
        setCopied(true)
        track('model_download', { build, link: 'copy_command', from: 'landing' })
        setTimeout(() => setCopied(false), 1600)
      } catch { /* clipboard blocked: the command stays selectable */ }
    }}>{copied ? <Check size={14} /> : <Copy size={14} />}</button>
  </div>
}

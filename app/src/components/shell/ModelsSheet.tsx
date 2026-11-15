// Open models: the published Skanda-0 builds, download links and benchmark numbers, shown inside the app.
import { useState, type CSSProperties } from 'react'
import { track } from '@vercel/analytics'
import { AlertCircle, Check, Copy, Download } from 'lucide-react'
import { useApp } from '../../store'
import {
  BENCHMARKS, BUILDS, MODEL_DISCLAIMER, QUANT_NOTE, SKANDA_0,
  downloadCommand, hfFilesUrl, hfUrl, type BenchTable,
} from '../../lib/openModels'
import { Sheet } from './Sheet'
import { BrandIcon } from '../BrandIcon'
import { toast } from './toastStore'
import './shell.css'
import './models.css'

export function ModelsSheet() {
  const openSheet = useApp((s) => s.openSheet)
  const [tableId, setTableId] = useState(BENCHMARKS[0].id)
  const table = BENCHMARKS.find((t) => t.id === tableId) ?? BENCHMARKS[0]

  return (
    <Sheet open wide onClose={() => openSheet(null)} title="Open models" subtitle="Skanda-0, the open-source Skanda model, on Hugging Face. The hosted workspace serves Skanda V1.">
      <div className="om-stack">
        <section className="sh-settings-section" aria-labelledby="om-model">
          <div className="om-model-head">
            <div style={{ minWidth: 0 }}>
              <h3 id="om-model" className="om-model-name">{SKANDA_0.name}</h3>
              <p className="sh-settings-section-desc">{SKANDA_0.summary}</p>
            </div>
            <div className="om-links">
              <a className="btn btn-sm btn-primary" href={hfUrl(SKANDA_0.repo)} target="_blank" rel="noreferrer" onClick={() => track('model_card_open')}>
                <BrandIcon name="huggingface" /> Model card
              </a>
              <a className="btn btn-sm" href={SKANDA_0.github} target="_blank" rel="noreferrer">
                <BrandIcon name="github" mono /> Code
              </a>
            </div>
          </div>
          <dl className="om-specs">
            {SKANDA_0.architecture.map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
            ))}
            <div><dt>License</dt><dd>{SKANDA_0.license}. {SKANDA_0.licenseNote}</dd></div>
          </dl>
        </section>

        <section className="sh-settings-section" aria-labelledby="om-builds">
          <div className="sh-settings-section-head">
            <h3 id="om-builds" className="sh-settings-section-title">Downloads</h3>
            <div className="sh-settings-section-desc">{QUANT_NOTE}</div>
          </div>
          <div className="om-builds">
            {BUILDS.map((b, i) => (
              <article key={b.repo} className={`om-build${b.recommended ? ' om-build--rec' : ''}`} style={{ '--i': i } as CSSProperties}>
                <div className="om-build-top">
                  <span className="om-precision">{b.precision}</span>
                  {b.recommended && <span className="om-rec">Recommended</span>}
                  <span className="om-size">{b.size}</span>
                </div>
                <div className="om-repo" title={b.repo}>{b.repo}</div>
                <div className="sh-field-hint om-note">{b.note}</div>
                <CopyCommand command={downloadCommand(b.repo)} build={b.precision} />
                <div className="om-build-actions">
                  <a className="btn btn-sm" href={hfFilesUrl(b.repo)} target="_blank" rel="noreferrer" onClick={() => track('model_download', { build: b.precision, link: 'files' })}><Download /> Files</a>
                  <a className="btn btn-sm" href={hfUrl(b.repo)} target="_blank" rel="noreferrer" onClick={() => track('model_download', { build: b.precision, link: 'huggingface' })}><BrandIcon name="huggingface" /> Hugging Face</a>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="sh-settings-section" aria-labelledby="om-bench">
          <div className="sh-settings-section-head om-bench-head">
            <div>
              <h3 id="om-bench" className="sh-settings-section-title">Benchmarks</h3>
              <div className="sh-settings-section-desc">{table.caption}</div>
            </div>
            <div className="segmented" role="tablist" aria-label="Benchmark table">
              {BENCHMARKS.map((t) => (
                <button key={t.id} type="button" role="tab" aria-selected={t.id === table.id} onClick={() => { setTableId(t.id); track('benchmark_tab', { table: t.id }) }}>{t.title}</button>
              ))}
            </div>
          </div>
          <BenchmarkTable key={table.id} table={table} />
        </section>

        <div className="sh-disclaimer">
          <AlertCircle />
          <span>{MODEL_DISCLAIMER}</span>
        </div>
      </div>
    </Sheet>
  )
}

function CopyCommand({ command, build }: { command: string; build: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      track('model_download', { build, link: 'copy_command' })
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast('Could not copy. Select the command and copy it manually.', 'error')
    }
  }
  return (
    <div className={`om-cmd${copied ? ' om-cmd--done' : ''}`}>
      <code>{command}</code>
      <button type="button" className="icon-btn" aria-label={copied ? 'Copied' : 'Copy download command'} onClick={copy}>
        {copied ? <Check key="done" className="om-pop" /> : <Copy key="copy" />}
      </button>
    </div>
  )
}

function BenchmarkTable({ table }: { table: BenchTable }) {
  return (
    <div className="om-table-wrap">
      <table className="om-table">
        <thead>
          <tr>
            <th scope="col">Metric</th>
            {table.columns.map((c, i) => <th key={c} scope="col" className={i === table.highlight ? 'om-hl' : undefined}>{c}</th>)}
          </tr>
        </thead>
        {table.groups.map((g, gi) => (
          <tbody key={g.label}>
            <tr className="om-group">
              <th colSpan={table.columns.length + 1} scope="colgroup">{g.label} <span>{g.cases}</span></th>
            </tr>
            {g.rows.map((row, ri) => {
              const order = gi * 6 + ri
              const best = Math.max(...row.values.filter((v): v is number => v !== null))
              return (
                <tr key={row.metric} className="om-row" style={{ '--i': order } as CSSProperties}>
                  <th scope="row">{row.metric}</th>
                  {row.values.map((v, i) => (
                    <td key={i} className={i === table.highlight ? 'om-hl' : undefined}>
                      {v === null ? <span className="om-na">—</span> : (
                        <div className={`om-cell${v === best ? ' om-best' : ''}`}>
                          <span className="om-val">{v}%</span>
                          <span className="om-bar" aria-hidden><span style={{ width: `${v}%`, '--j': i } as CSSProperties} /></span>
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        ))}
      </table>
      {table.footnote && <p className="om-foot">{table.footnote} Bold marks the best value in each row.</p>}
    </div>
  )
}

import { useState } from 'react'
import { ArrowUpRight, ChevronDown } from 'lucide-react'
import { Reveal } from './ui'
import { BrandIcon } from '../components/BrandIcon'

const repo = 'https://github.com/Hitheshkaranth/VoxelRadAI_Terminal/blob/main/'
type Entry = { date: string; title: string; text: string; kind: 'model' | 'eval' | 'product' | 'failure'; link?: [string, string] }

/** Dated from the repository history and the Hugging Face model card. Newest first. */
const entries: Entry[] = [
  { date: '15 Nov 2026', kind: 'product', title: 'Demo workspace and access requests', text: 'An account-free demo with six held-out films and recorded reads, a request form for the hosted workspace, and Skanda-0 downloads on this site.', link: ['Try the demo', '/demo'] },
  { date: '10 Nov 2026', kind: 'product', title: 'Hosted RadGenie workspace', text: 'Releases v0.2.0-beta.1 and beta.2: authenticated hosting, account recovery, accessibility and imaging hardening.', link: ['Releases', 'https://github.com/Hitheshkaranth/VoxelRadAI_Terminal/releases'] },
  { date: '8 Nov 2026', kind: 'model', title: 'Skanda-0 int8 and int4 builds', text: 'Quantized builds re-read on the same test sets: int8 stays within a point or two of bf16; int4 loses most on MRI box recall and CT normals.', link: ['Compare builds', '/skanda-0'] },
  { date: '6 Nov 2026', kind: 'eval', title: 'Pre-registered confirmatory test of Skanda V1', text: 'The analysis plan, lexicon and scoring code were committed before any result; Skanda V1 then read 2,584 new held-out cases (707 X-ray, 1,093 CT, 784 MRI): 80% of normals cleared, 73% mean Dice on found outlines, 6.4 s per read. Hypothesis tests with intervals are still running.', link: ['Results', '/benchmarks#confirmatory'] },
  { date: '6 Nov 2026', kind: 'product', title: 'Skanda V1 recorded in the workspace', text: 'A three-minute recording of Skanda V1 reading chest films, a CT volume and an MRI volume in the app.', link: ['Watch', '/#demo'] },
  { date: '5 Nov 2026', kind: 'model', title: 'Skanda V1 (run 4b)', text: 'Built on run 3 with a re-weighted score-head loss, more training data and server-side checks. Held out: right finding type 39% on X-ray, 68% on CT, 84% on MRI. bf16, int8 and int4 builds; weights private.', link: ['Benchmarks', '/benchmarks'] },
  { date: '2 Nov 2026', kind: 'failure', title: 'Labelled CT and MRI fault report', text: 'On targeted CT and MRI slices, five of six positive-slice boxes had zero overlap with the reference region. Published with reproducible evidence.', link: ['Read the report', `${repo}docs/validation/2026-11-02-labeled-case-failure-report.md`] },
  { date: '1 Nov 2026', kind: 'model', title: 'Skanda-0 released (run 3)', text: 'Open weights on Hugging Face under CC BY-NC 4.0, with held-out results on 111 chest films, 340 CT and 240 MRI cases. Outline masks drawn in the viewer.', link: ['Model card', 'https://huggingface.co/hitheshkaranth/Skanda-0'] },
  { date: '30 Oct 2026', kind: 'eval', title: 'Skanda run 2 benchmarked', text: 'Side by side with MedGemma 27B and MAIRA-2 on X-ray, and with MedGemma on CT and MRI.', link: ['Benchmarks', '/benchmarks'] },
  { date: '2 Oct 2026', kind: 'eval', title: 'Held-out ChestX-Det benchmark', text: '111 test films labelled and boxed by three radiologists, one scorer, Wilson intervals. MAIRA-2 added as a second reader.', link: ['Method', `${repo}benchmark/README.md`] },
  { date: '26 Sep 2026', kind: 'product', title: 'First version', text: 'A local chest X-ray reading app built around MedGemma.' },
]
const kindLabel = { model: 'Model', eval: 'Evaluation', product: 'Product', failure: 'Known failure' } as const

export function ResultsLog() {
  const [all, setAll] = useState(false)
  const shown = all ? entries : entries.slice(0, 4)
  return <section className="sk-wrap sk-log" id="log" aria-labelledby="log-title">
    <Reveal className="sk-log-head"><h2 id="log-title" className="sk-h2">Results <em>log</em></h2><p>What changed, when, including what didn’t work. Dates come from the repository history and the model card.</p></Reveal>
    <ol className="sk-log-list">{shown.map((e) => <li key={e.date + e.title} className="sk-log-item" data-kind={e.kind}><Reveal className="sk-log-row">
      <time>{e.date}</time>
      <div><span className="sk-log-kind">{kindLabel[e.kind]}</span><h3>{e.title}</h3><p>{e.text}</p>{e.link && <a className="sk-inline-link" href={e.link[1]}>{e.link[1].includes('huggingface.co') ? <BrandIcon name="huggingface" size={14} /> : e.link[1].includes('github.com') ? <BrandIcon name="github" size={14} mono /> : null}{e.link[0]}{e.link[1].startsWith('http') && <ArrowUpRight size={13} />}</a>}</div>
    </Reveal></li>)}</ol>
    {!all && <button type="button" className="sk-log-more" onClick={() => setAll(true)}>Show {entries.length - 4} earlier entries <ChevronDown size={15} /></button>}
  </section>
}

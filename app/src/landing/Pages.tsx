import { useEffect, type ReactNode } from 'react'
import { ArrowRight, ArrowUpRight } from 'lucide-react'
import { Nav } from './Hero'
import { Footer } from './Sections'
import { Benchmarks } from './Benchmarks'
import { OpenWeights } from './OpenWeights'
import { CiteCard } from './About'
import { RequestAccess } from './RequestAccess'
import { Foundations } from './Foundations'
import { BUILDS, MODEL_DISCLAIMER, QUANT_NOTE, SKANDA_0, hfFilesUrl, hfUrl } from '../lib/openModels'
import { Pill, Reveal } from './ui'
import { BrandIcon } from '../components/BrandIcon'
import './skanda-landing.css'

const repo = 'https://github.com/Hitheshkaranth/VoxelRadAI_Terminal/blob/main/'
const failureReport = `${repo}docs/validation/2026-11-02-labeled-case-failure-report.md`

export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    document.title = title
    document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    document.querySelector('link[rel="canonical"]')?.setAttribute('href', `https://radgenis.com${location.pathname}`)
  }, [title, description])
}

export function Shell({ children }: { children: ReactNode }) {
  return <div className="sk-page sk-subpage">
    <a className="sk-skip" href="#main">Skip to content</a>
    <Nav />
    <main id="main">{children}</main>
    <Footer />
  </div>
}

export function PageHead({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead: string; children?: ReactNode }) {
  return <header className="sk-wrap sk-page-head">
    <nav className="sk-crumbs" aria-label="Breadcrumb"><a href="/">RadGenis</a><span aria-hidden="true">/</span><span aria-current="page">{eyebrow}</span></nav>
    <h1>{title}</h1>
    <p>{lead}</p>
    {children}
  </header>
}

export function Skanda0Page() {
  usePageMeta('Skanda-0 · open-source grounded radiology model · RadGenis', 'Skanda-0 reads chest X-ray, CT and MRI, writes a JSON report and outlines each finding. Open weights in bf16, int8 and int4 under CC BY-NC 4.0.')
  const int8 = BUILDS.find((b) => b.recommended) ?? BUILDS[0]
  return <Shell>
    <PageHead eyebrow="Skanda-0" title={<>Skanda-0, <em>open source</em></>} lead={`${SKANDA_0.summary} Published under ${SKANDA_0.license}. The hosted RadGenis workspace serves the newer Skanda V1, which is not part of this release.`}>
      <div className="sk-actions sk-actions-left"><Pill href={hfFilesUrl(int8.repo)} lead={<BrandIcon name="huggingface" size={16} />}>{`Download int8 · ${int8.size}`}</Pill><Pill href={hfUrl(SKANDA_0.repo)} tone="ghost" lead={<BrandIcon name="huggingface" size={16} />}>Model card</Pill></div>
    </PageHead>

    <Reveal className="sk-wrap sk-spec-grid">
      <section aria-labelledby="arch-title"><h2 id="arch-title">Architecture</h2><dl>{SKANDA_0.architecture.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
      <section aria-labelledby="run-title"><h2 id="run-title">Run it</h2><ol className="sk-steps">
        <li><b>Pick a build.</b> int8 is half the size of bf16 and effectively lossless; int4 fits smaller GPUs with a measurable drop. {QUANT_NOTE}</li>
        <li><b>Download it</b> with the Hugging Face CLI, using the command on each build card below.</li>
        <li><b>Serve and connect it</b> by following the <a className="sk-inline-link" href={`${repo}docs/reading-with-skanda.md`}>Skanda reader guide</a>, then set the model address in the workspace settings.</li>
      </ol></section>
    </Reveal>

    <Foundations />
    <OpenWeights intro={false} />

    <Reveal className="sk-wrap sk-page-split">
      <section aria-labelledby="limits-title" className="sk-about-card sk-limits"><h2 id="limits-title">Known limits</h2>
        <ul>
          <li>Targeted CT and MRI tests: five of six positive-slice boxes missed the reference region entirely.</li>
          <li>Chest X-ray box recall is about 10%: most findings it names are not boxed where a radiologist would.</li>
          <li>No external test set, reader study or radiologist review of its reports yet.</li>
        </ul>
        <p>{MODEL_DISCLAIMER}</p>
        <a className="sk-inline-link" href={failureReport}>Read the fault report <ArrowUpRight size={13} /></a>
      </section>
      <CiteCard />
    </Reveal>
    <RequestAccess />
  </Shell>
}

export function BenchmarksPage() {
  usePageMeta('Benchmarks · Skanda vs MedGemma 27B and MAIRA-2 · RadGenis', 'Held-out results for Skanda on chest X-ray, CT and MRI against MedGemma 27B and MAIRA-2, with method, intervals and known failures.')
  return <Shell>
    <PageHead eyebrow="Benchmarks" title={<>Benchmarks, <em>held out</em></>} lead="Every figure here comes from held-out cases and one scorer. Skanda V1, the served model, is compared with MedGemma 27B and MAIRA-2 on chest X-ray, CT and MRI, then tested on a confirmatory set fixed in advance. Earlier checkpoints and the open Skanda-0 follow, with known failures next to the wins.">
      <ul className="sk-bench-facts">
        <li><b>691</b><span>held-out cases: 111 X-ray, 340 CT, 240 MRI</span></li>
        <li><b>2,584</b><span>pre-registered confirmatory cases</span></li>
        <li><b>3×</b><span>radiologists per chest film</span></li>
        <li><b>6.4 s</b><span>per read, Skanda V1 as served</span></li>
      </ul>
    </PageHead>
    <Benchmarks />
    <OpenWeights intro={false} cards={false} />
    <Reveal className="sk-wrap sk-page-split">
      <section className="sk-about-card" aria-labelledby="method-title"><h2 id="method-title">Method</h2>
        <ul>
          <li>Chest X-ray: the ChestX-Det test split (111 films), labelled and boxed by three radiologists. All three models are served in the same pipeline with the same prompts and parser, and scored by one script.</li>
          <li>Skanda V1 figures and their baselines come from the Skanda V1 model card (weights private); the confirmatory set's analysis plan was committed before Skanda V1 read it.</li>
          <li>Skanda read every X-ray film twice; its figures are the mean of both reads. MedGemma 27B and MAIRA-2 read once.</li>
          <li>The earlier runs 2–3 comparison uses the results committed in this repository; the Skanda-0 CT and MRI charts come from its public model card.</li>
          <li>Differences under about 15 labels are within run-to-run noise.</li>
        </ul>
        <a className="sk-inline-link" href={`${repo}benchmark/README.md`}>Full method and scorer <ArrowUpRight size={13} /></a>
      </section>
      <section className="sk-about-card sk-limits" aria-labelledby="fail-title"><h2 id="fail-title">Known failures</h2>
        <ul>
          <li>Chest X-ray outlines: Skanda V1 outlined 23.5% of findings on the confirmatory set.</li>
          <li>Pneumothorax (runs 2–3): found on 2 of 10 held-out films, where MedGemma found all 10. Small nodules are often missed.</li>
          <li>CT and MRI localisation on targeted labelled slices: five of six positive-slice boxes had zero overlap with the reference.</li>
        </ul>
        <a className="sk-inline-link" href={failureReport}>Read the fault report <ArrowUpRight size={13} /></a>
        <a className="sk-inline-link" href="/demo">See a miss and a false alarm in the demo <ArrowRight size={13} /></a>
      </section>
    </Reveal>
  </Shell>
}

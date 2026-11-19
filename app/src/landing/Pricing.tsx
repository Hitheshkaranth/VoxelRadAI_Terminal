import { ArrowRight, Check, FileSignature, Info, ScanSearch, Upload } from 'lucide-react'
import { Pill, Reveal } from './ui'

const steps = [
  { icon: Upload, title: 'Send the image', text: 'Your application posts an X-ray, CT slice or MRI image to Skanda V1 through an OpenAI-compatible chat completions request.' },
  { icon: ScanSearch, title: 'Get candidate findings', text: 'Skanda returns candidate findings with boxes and outlines, measurements where it can make them, and a draft report.' },
  { icon: FileSignature, title: 'The radiologist decides', text: 'Candidates appear in your reporting software, where the radiologist reviews, edits or rejects each one and signs the report.' },
] as const

const tiers = [
  {
    name: 'Research & evaluation',
    who: 'For researchers and teams deciding whether Skanda fits their work.',
    points: ['Hosted workspace access', 'A limited number of reads per day', 'Research use with de-identified images'],
  },
  {
    name: 'Clinic & teleradiology',
    who: 'For practices and teleradiology groups integrating Skanda’s drafts into their reporting software.',
    points: ['API access for your reporting software', 'Higher read volume, agreed with you', 'Onboarding support for your integration', 'Hosted workspace for your readers'],
    featured: true,
  },
  {
    name: 'Enterprise & on-premise',
    who: 'For organisations that need the model to run on their own hardware or a dedicated GPU.',
    points: ['Dedicated GPU or on-premise deployment', 'Volume set to your workload', 'Private weights deployment, discussed case by case', 'Integration planning with your team'],
  },
] as const

/** API access and placeholder plans. No prices are published; every plan routes to the access request form. */
export function Pricing() {
  return <section className="sk-wrap sk-api" id="pricing" aria-labelledby="pricing-title">
    <Reveal className="sk-api-head">
      <h2 id="pricing-title" className="sk-h2">Skanda in <em>your software</em></h2>
      <p>Connect Skanda V1 to your own application or radiology reporting software through an OpenAI-compatible API. It drafts; your radiologists review and sign, in the tools they already use.</p>
    </Reveal>

    <Reveal className="sk-api-flow">
      <div className="sk-api-flow-top"><h3 id="api-flow-title" className="sk-plan-label">How integration works</h3><a className="sk-weights-more sk-api-docs" href="/docs">Read the API docs <ArrowRight size={14} /></a></div>
      <ol aria-labelledby="api-flow-title">{steps.map(({ icon: Icon, title, text }, i) => <li key={title} style={{ ['--i' as string]: i }}>
        <span className="sk-api-step"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /><span className="sk-api-step-n">Step {i + 1}</span></span>
        <h3>{title}</h3>
        <p>{text}</p>
      </li>)}</ol>
    </Reveal>

    <Reveal className="sk-api-plans">{tiers.map((t, i) => <article key={t.name} className="sk-plan sk-api-plan" data-model={'featured' in t ? 'skanda' : undefined} style={{ ['--r' as string]: i }}>
      <h3>{t.name}</h3>
      <p className="sk-api-who">{t.who}</p>
      <p className="sk-api-price">Pricing on request</p>
      <ul>{t.points.map((p) => <li key={p}><Check size={14} aria-hidden="true" /><span>{p}</span></li>)}</ul>
      <div className="sk-plan-actions">
        <Pill href="#access" tone={'featured' in t ? 'light' : 'grey'}>Contact for pricing</Pill>
        <a href="/docs" className="sk-details">Read the API docs <ArrowRight size={13} /></a>
      </div>
    </article>)}</Reveal>

    <p className="sk-api-note"><Info size={14} aria-hidden="true" /><span>VoxelRad AI and Skanda are research and review-support software, not a medical device. Every finding is a candidate until a radiologist reviews it. Pricing and availability are on request.</span></p>
  </section>
}

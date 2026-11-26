import { useEffect } from 'react'
import './landing/skanda-landing.css'
import { Hero, Nav } from './landing/Hero'
import { Approach, Capabilities, Closing, Evidence, Faqs, Footer, Intro, Reads, Stack } from './landing/Sections'
import { ResultsLog } from './landing/ResultsLog'
import { Foundations } from './landing/Foundations'
import { Benchmarks } from './landing/Benchmarks'
import { OpenWeights } from './landing/OpenWeights'
import { Demo } from './landing/Demo'
import { About } from './landing/About'
import { RequestAccess } from './landing/RequestAccess'
import { Pricing } from './landing/Pricing'

/** Public landing page. Section order and component geometry follow visuvate.com, re-themed for radiology. */
export function LandingPage() {
  useEffect(() => { document.title = 'RadGenis · Grounded radiology with Skanda V1' }, [])
  // The page mounts after the browser's own hash jump, so links like /#pricing from other pages land at the top. Re-run it once.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (!id) return
    const frame = requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }))
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div className="sk-page">
    <a className="sk-skip" href="#main">Skip to content</a>
    <Nav />
    <main id="main">
      <Hero />
      <Stack />
      <Demo />
      <Intro />
      <Reads />
      <Capabilities />
      <Foundations />
      <Benchmarks history={false} />
      <OpenWeights chart={false} />
      <Approach />
      <Evidence />
      <ResultsLog />
      <Pricing />
      <About />
      <Faqs />
      <RequestAccess />
      <Closing />
    </main>
    <Footer />
  </div>
}

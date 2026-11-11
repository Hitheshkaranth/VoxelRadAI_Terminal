import { useEffect } from 'react'
import './landing/skanda-landing.css'
import { Hero, Nav } from './landing/Hero'
import { Approach, Capabilities, Closing, Evidence, Faqs, Footer, Intro, Reads, Stack, Ticker } from './landing/Sections'
import { Benchmarks } from './landing/Benchmarks'

/** Public landing page. Section order and component geometry follow visuvate.com, re-themed for radiology. */
export function LandingPage() {
  useEffect(() => { document.title = 'VoxelRad AI · Grounded radiology with Skanda V1' }, [])
  return <div className="sk-page">
    <a className="sk-skip" href="#main">Skip to content</a>
    <Nav />
    <main id="main">
      <Hero />
      <Stack />
      <Intro />
      <Reads />
      <Capabilities />
      <Ticker />
      <Benchmarks />
      <Approach />
      <Evidence />
      <Faqs />
      <Closing />
    </main>
    <Footer />
  </div>
}

import { useRef, useState } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { track } from '@vercel/analytics'
import { Reveal } from './ui'

const chapters = [
  ['0:00', 'Chest X-ray', 0],
  ['1:46', 'CT volume', 106],
  ['2:40', 'MRI volume', 160],
] as const

/** Recorded walkthrough of the workspace reading X-ray, CT and MRI with Skanda V1. Loads nothing until played. */
export function Demo() {
  const video = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const play = (at?: number) => {
    const v = video.current
    if (!v) return
    if (at !== undefined) v.currentTime = at
    void v.play()
    if (!started) { setStarted(true); track('demo_play', { at: at ?? 0 }) }
  }
  return <section className="sk-demo" id="demo" aria-labelledby="demo-title">
    <Reveal className="sk-wrap sk-demo-head">
      <h2 id="demo-title" className="sk-h2">Watch a <em>read</em></h2>
      <p>Three minutes in the workspace: Skanda V1 reads a chest film, a CT volume and an MRI volume, and every finding is checked against the source before the report is drafted. Recorded in the app, not a mock-up.</p>
    </Reveal>
    <Reveal className="sk-wrap">
      <div className="sk-demo-frame" data-started={started}>
        <video ref={video} src="/landing/skanda-demo.mp4" poster="/landing/skanda-demo-poster.jpg" preload="none" playsInline controls={started} onPlay={() => setStarted(true)} aria-label="Skanda V1 reading X-ray, CT and MRI in the RadGenis workspace" />
        {!started && <button type="button" className="sk-demo-play" onClick={() => play()} aria-label="Play the demo video"><span><Play size={26} fill="currentColor" /></span>Play · 3:18</button>}
      </div>
      <ol className="sk-demo-chapters" aria-label="Chapters">{chapters.map(([t, label, at]) =>
        <li key={t}><button type="button" onClick={() => play(at)}><b>{t}</b>{label}</button></li>)}</ol>
      <a className="sk-demo-try" href="/demo" onClick={() => track('demo_cta', { from: 'video' })}><span>Prefer to click around?</span> Open the demo workspace with six recorded reads, no account needed <ArrowRight size={15} /></a>
    </Reveal>
  </section>
}

import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { ShellButton } from './ShellButton'

export function LoginCine() {
  const video = useRef<HTMLVideoElement>(null)
  const manuallyPaused = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => {
      if (media.matches || document.hidden || manuallyPaused.current) video.current?.pause()
      else void video.current?.play().catch(() => setPlaying(false))
    }
    sync()
    media.addEventListener('change', sync)
    document.addEventListener('visibilitychange', sync)
    return () => { media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', sync) }
  }, [])
  return <figure className="session-scan">
    {unavailable ? <img src="/login/ct-poster.webp" alt="Axial slice from the public CT brain teaching sample" /> : <video ref={video} muted loop playsInline preload="metadata" poster="/login/ct-poster.webp" aria-label="Looping axial CT brain teaching scan" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onError={() => { setUnavailable(true); setPlaying(false) }}><source src="/login/ct-cine.mp4" type="video/mp4" /></video>}
    <figcaption><span>CT brain <span className="session-scan-detail">/ Axial cine</span></span><span>Public teaching sample</span></figcaption>
    {!unavailable && <ShellButton className="session-cine-toggle" aria-label={playing ? 'Pause CT scan animation' : 'Play CT scan animation'} onClick={() => { manuallyPaused.current = playing; if (playing) video.current?.pause(); else void video.current?.play().catch(() => setPlaying(false)) }}>{playing ? <Pause aria-hidden="true" size={16} /> : <Play aria-hidden="true" size={16} />}{playing ? 'Pause' : 'Play'}</ShellButton>}
  </figure>
}

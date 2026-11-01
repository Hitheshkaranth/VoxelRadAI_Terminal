import { useState } from 'react'
import { Columns2, History, UserRound } from 'lucide-react'
import { useActiveImage, useActiveStudy, useApp } from '../../store'
import { priorStudies } from '../../lib/priors'
import { Sheet } from './Sheet'

export function ClinicalContext() {
  const study = useActiveStudy()
  const image = useActiveImage()
  const studies = useApp((s) => s.studies)
  const [comparing, setComparing] = useState(false)
  const [priorId, setPriorId] = useState('')
  const [imageId, setImageId] = useState('')
  if (!study) return null
  const priors = priorStudies(study, studies)
  const prior = priors.find((p) => p.id === priorId) ?? priors[0]
  const priorImage = prior?.images.find((i) => i.id === imageId) ?? prior?.images[0]
  return <>
    <section className="clinical-context" aria-label="Clinical context">
      <button className="clinical-patient" onClick={() => useApp.getState().openSheet('patient')}>
        <UserRound aria-hidden="true" />
        <span><strong>{study.patient.name || 'Add patient details'}</strong><small>{[study.patient.patientId || 'No patient ID', study.patient.age && `${study.patient.age}y`, study.patient.sex, study.patient.studyDate].filter(Boolean).join(' · ')}</small></span>
      </button>
      <div className="clinical-indication"><span>Clinical indication</span><p>{study.patient.indication || 'No indication provided'}</p></div>
      <button className="btn btn-sm clinical-priors" onClick={() => setComparing(true)}><History /> Priors <span>{priors.length}</span></button>
    </section>
    {comparing && <Sheet open onClose={() => setComparing(false)} title="Prior study comparison" subtitle={`${study.patient.name || study.title} · ${study.patient.patientId || 'No patient ID'}`} wide>
      {prior && priorImage && image ? <>
        <div className="comparison-controls">
          <label>Prior study<select className="input" value={prior.id} onChange={(e) => { setPriorId(e.target.value); setImageId('') }}>{priors.map((p) => <option key={p.id} value={p.id}>{p.patient.studyDate} · {p.title}</option>)}</select></label>
          <label>Prior image<select className="input" value={priorImage.id} onChange={(e) => setImageId(e.target.value)}>{prior.images.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
        </div>
        <div className="comparison-images">
          <figure><figcaption><strong>Current</strong> {study.patient.studyDate}<span>{image.name}</span></figcaption><img src={image.dataUrl} alt={`Current study: ${image.name}`} /></figure>
          <figure><figcaption><strong>Prior</strong> {prior.patient.studyDate}<span>{priorImage.name}</span></figcaption><img src={priorImage.dataUrl} alt={`Prior study: ${priorImage.name}`} /></figure>
        </div>
        <p className="comparison-note">Original imported images. Views are not registered or synchronized. Confirm patient identity and projection before comparing.</p>
      </> : <div className="comparison-empty"><Columns2 /><h3>{!image ? 'Add a current image to compare' : 'No matching prior images'}</h3><p>Prior studies must have the same non-empty patient ID and an earlier study date. Add a dated study with images to this local worklist to compare it here.</p></div>}
    </Sheet>}
  </>
}

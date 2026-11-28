// On-prem export: one ZIP per study or per patient, so a hospital can keep its own copy and generate reports
// locally. Each study folder holds the scan images as stored in RadGenis, the same images with the AI findings drawn
// on, the report as PDF and plain text, and study.json (patient details, every finding and the full report record).
// zip and pdf libraries load only when an export starts.
import type { Study } from '../types'
import { DISCLAIMER, reportToPlainText, studyToJson } from './reportExport'
import { renderAnnotatedImage } from './annotate'

const safe = (value: string, max = 60) => value.normalize('NFKD').replace(/[^\w.-]+/g, '_').replace(/_+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, max) || 'study'
const pad = (n: number) => String(n).padStart(2, '0')
const encoder = new TextEncoder()

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,(.+)$/i.exec(dataUrl)
  if (!match) return null
  const binary = atob(match[2])
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, ext: match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase() }
}

function studyDate(study: Study): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(study.patient.studyDate) ? study.patient.studyDate : new Date(study.createdAt).toISOString().slice(0, 10)
}

/** Folder name: date, title and a short id, so studies sort by date and never collide. */
export function studyFolder(study: Study): string {
  const id = study.patient.patientId.trim()
  return `${studyDate(study)}_${id ? `${safe(id, 24)}_` : ''}${safe(study.title, 40)}_${study.id.slice(0, 8)}`
}

/** File name for the download. A patient archive is named after the patient ID. */
export function archiveName(studies: Study[]): string {
  const day = new Date().toISOString().slice(0, 10)
  const id = studies[0]?.patient.patientId.trim()
  if (studies.length > 1 && id) return `RadGenis_patient_${safe(id, 40)}_${day}.zip`
  return studies[0] ? `RadGenis_${studyFolder(studies[0])}.zip` : `RadGenis_export_${day}.zip`
}

async function reportPdf(study: Study, settings: { institution: string }, annotated: { name: string; dataUrl: string; width: number; height: number }[]): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const width = doc.internal.pageSize.getWidth(), height = doc.internal.pageSize.getHeight(), margin = 48
  let y = margin
  // The plain-text report aligns its labels with spaces, so a fixed-width font keeps the columns straight.
  const lines = reportToPlainText(study, settings).replace(/\t/g, '  ').split('\n')
  for (const [i, raw] of lines.entries()) {
    const heading = i < 2 || (/^[A-Z][A-Za-z ]+$/.test(raw) && /^-+$/.test(lines[i + 1] ?? ''))
    doc.setFont('courier', heading ? 'bold' : 'normal').setFontSize(heading && i === 0 ? 12 : 9.5)
    for (const line of doc.splitTextToSize(raw || ' ', width - margin * 2) as string[]) {
      if (y > height - margin) { doc.addPage(); y = margin }
      doc.text(line, margin, y)
      y += 13
    }
  }
  // Key images with the findings drawn on, one per page, scaled to fit.
  for (const image of annotated) {
    doc.addPage()
    doc.setFont('helvetica', 'bold').setFontSize(11).text(image.name, margin, margin)
    const scale = Math.min((width - margin * 2) / image.width, (height - margin * 3) / image.height)
    doc.addImage(image.dataUrl, 'JPEG', margin, margin + 16, image.width * scale, image.height * scale)
  }
  const pages = doc.getNumberOfPages()
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(110)
    doc.text(`${DISCLAIMER}  ·  Page ${page} of ${pages}`, margin, height - 24, { maxWidth: width - margin * 2 })
    doc.setTextColor(0)
  }
  return new Uint8Array(doc.output('arraybuffer'))
}

/**
 * Builds the ZIP for one or more studies. `onProgress` gets a short status line per study.
 * Images are the stored copies (up to 1536 px on the long edge); volumes opened only in the viewer are not included.
 */
export async function buildStudyArchive(studies: Study[], settings: { institution: string }, onProgress?: (text: string) => void): Promise<Blob> {
  const { zipSync } = await import('fflate')
  const files: Record<string, Uint8Array> = {}
  const index: string[] = []
  for (const [n, study] of studies.entries()) {
    onProgress?.(`Packing study ${n + 1} of ${studies.length}…`)
    const folder = studyFolder(study)
    const annotated: { name: string; dataUrl: string; width: number; height: number }[] = []
    let imageCount = 0
    for (const [k, image] of study.images.entries()) {
      const original = image.dataUrl ? dataUrlBytes(image.dataUrl) : null
      if (!original) continue
      const base = `${pad(k + 1)}_${safe(image.name.replace(/\.[a-z0-9]+$/i, ''), 50)}`
      files[`${folder}/images/${base}.${original.ext}`] = original.bytes
      imageCount++
      if (image.analysis?.findings?.length) {
        try {
          const drawn = await renderAnnotatedImage(image)
          const bytes = dataUrlBytes(drawn)
          if (bytes) {
            files[`${folder}/images-with-findings/${base}_findings.${bytes.ext}`] = bytes.bytes
            annotated.push({ name: `Image ${k + 1}: ${image.name}`, dataUrl: drawn, width: image.width, height: image.height })
          }
        } catch { /* the plain image is still exported */ }
      }
    }
    files[`${folder}/report.txt`] = encoder.encode(reportToPlainText(study, settings))
    files[`${folder}/report.pdf`] = await reportPdf(study, settings, annotated)
    files[`${folder}/study.json`] = encoder.encode(JSON.stringify(studyToJson(study, { institution: settings.institution }), null, 2))
    const p = study.patient
    index.push(`${studyDate(study)}  ${study.title}\n  Folder: ${folder}/\n  Patient: ${p.name || '—'} (ID ${p.patientId || '—'})  Images: ${imageCount}  Report: ${study.report?.signed ? 'signed' : study.report ? 'draft' : 'none'}`)
  }
  files['README.txt'] = encoder.encode([
    `RadGenis export (${new Date().toISOString()})`,
    settings.institution ? `Institution: ${settings.institution}` : '',
    '',
    'Each folder is one study:',
    '  images/                 scan images as stored in RadGenis',
    '  images-with-findings/   the same images with the AI findings drawn on',
    '  report.pdf, report.txt  the report (marked DRAFT unless signed)',
    '  study.json              patient details, every AI finding with its review decision, and the full report record',
    '',
    ...index,
    '',
    'This export contains patient-identifiable information. Store it according to your institution\'s data-protection policy.',
    DISCLAIMER,
  ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n'))
  onProgress?.('Compressing…')
  // Images are already compressed; store them as-is and deflate the text files.
  const zipped = zipSync(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, [bytes, { level: /\.(jpg|png|webp|pdf)$/.test(name) ? 0 : 6 }]])))
  return new Blob([zipped as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

import type { Study } from '../types'
import { reportToPlainText } from './reportExport.ts'

export interface ShareOptions { includeIdentity: boolean; includeImages: boolean }
export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Only locally embedded raster images are accepted. Never emit remote URLs or SVG. */
export function safeShareImage(url: string): boolean {
  return /^data:image\/(?:png|jpeg|webp|gif|bmp);base64,[A-Za-z0-9+/\r\n]*={0,2}$/.test(url)
}

export function shareReportText(study: Study, institution: string, options: ShareOptions): string {
  if (options.includeIdentity) return reportToPlainText(study, { institution })
  const omit = (p: Study['patient']) => ({ ...p, name: '', patientId: '', referringPhysician: '' })
  const copy: Study = { ...study, title: 'Shared study', patient: omit(study.patient),
    images: study.images.map((image, i) => ({ ...image, name: `Image ${i + 1}` })),
    report: study.report ? { ...study.report, patientSnapshot: study.report.patientSnapshot ? omit(study.report.patientSnapshot) : undefined } : undefined }
  return reportToPlainText(copy, { institution })
}

/** A portable, inert document: no scripts, external resources, hidden study JSON or patient URLs. */
export function studyShareHtml(study: Study, institution: string, options: ShareOptions): string {
  const text = shareReportText(study, institution, options)
  const images = options.includeImages ? study.images.map((image, i) => {
    const caption = `Image ${i + 1} · ${image.width} × ${image.height} display pixels`
    return safeShareImage(image.dataUrl)
      ? `<figure><img src="${escapeHtml(image.dataUrl)}" alt="Study image ${i + 1}"><figcaption>${escapeHtml(caption)}</figcaption></figure>`
      : `<p>Image ${i + 1} could not be included. Export the source separately.</p>`
  }).join('') : ''
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><meta name="referrer" content="no-referrer"><title>VoxelRad AI — shared report</title><style>body{font:16px/1.6 system-ui,sans-serif;color:#20252a;background:#f4f5f6;margin:0;padding:24px}main{max-width:850px;margin:auto;background:white;padding:clamp(18px,4vw,48px)}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}aside,figcaption{color:#4c555d;font-size:14px}figure{margin:24px 0}img{display:block;max-width:100%;height:auto;background:#000}@media print{body,main{padding:0;background:white}figure{break-inside:avoid}}</style></head><body><main><h1>VoxelRad AI radiology report</h1><aside>Exported copy. This file does not update, expire, or support revocation. ${options.includeImages ? 'Images are display copies, not original DICOM or a complete volume. ' : ''}${options.includeIdentity ? 'Patient identity fields are included.' : 'Name, patient ID, referring physician and original file names are omitted. Free text and image pixels may still identify the patient.'}</aside><pre>${escapeHtml(text)}</pre>${images}</main></body></html>`
}

import fs from 'node:fs'
import { decodeNrrd, getSliceGeometry, renderSlice } from '../app/src/lib/volume.ts'
const bytes = fs.readFileSync('app/public/samples/ct-brain.nrrd')
const volume = await decodeNrrd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
const geometry = getSliceGeometry(volume, 'axial')
fs.mkdirSync('.tmp/ct-cine', { recursive: true })
const indices = Array.from({ length: geometry.count }, (_, i) => i)
const cycle = [...indices, ...indices.slice(1, -1).reverse()]
for (const [frame, index] of cycle.entries()) {
  const slice = renderSlice(volume, 'axial', index, { center: 40, width: 100 })
  const rgb = Buffer.alloc(slice.width * slice.height * 3)
  for (let i = 0; i < slice.width * slice.height; i++) for (let c = 0; c < 3; c++) rgb[i * 3 + c] = slice.pixels[i * 4 + c]
  fs.writeFileSync(`.tmp/ct-cine/${String(frame).padStart(3, '0')}.ppm`, Buffer.concat([Buffer.from(`P6\n${slice.width} ${slice.height}\n255\n`), rgb]))
}
fs.writeFileSync('.tmp/ct-cine/geometry.json', JSON.stringify({ width: geometry.width, height: geometry.height, spacing: geometry.pixelSpacing, frames: cycle.length }))
console.log(`Rendered ${cycle.length} CT cine frames`)

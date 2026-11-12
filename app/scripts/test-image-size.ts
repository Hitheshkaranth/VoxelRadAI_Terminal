import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { imageSize } from '../src/lib/imageSize.ts'
const u32 = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const png = (w: number, h: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, ...Buffer.from('IHDR'), ...u32(w), ...u32(h), 8, 0, 0, 0, 0])
assert.deepEqual(imageSize(png(16384, 16384)), { width: 16384, height: 16384 })
assert.deepEqual(imageSize(new Uint8Array([...Buffer.from('GIF89a'), 0x20, 0x03, 0x58, 0x02])), { width: 800, height: 600 })
// JPEG: SOI, APP0 (length 16), SOF0 with height 480 width 640
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, ...new Array(14).fill(0), 0xff, 0xc0, 0, 17, 8, 0x01, 0xe0, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0])
assert.deepEqual(imageSize(jpeg), { width: 640, height: 480 })
const vp8x = new Uint8Array(30); vp8x.set(Buffer.from('RIFF'), 0); vp8x.set(Buffer.from('WEBPVP8X'), 8); vp8x.set([0x3f, 0x1f, 0, 0x6f, 0x17, 0], 24)
assert.deepEqual(imageSize(vp8x), { width: 8000, height: 6000 })
assert.equal(imageSize(new Uint8Array(deflateSync(Buffer.from('not an image')))), null)
console.log('Image header dimensions: PNG, GIF, JPEG and WebP (VP8X) sizes read without decoding; unknown formats return null')

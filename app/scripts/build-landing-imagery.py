"""Build the landing page's imaging assets from material already in this repository.

Sources (no new data is downloaded):
  * app/public/samples/ct-brain.nrrd, mr-head.nrrd  - public Slicer teaching volumes (see samples/provenance.json)
  * docs/screenshots/*.png, docs/validation/skanda-rerun/*.png - captures of real model output recorded in this app

Outputs land in app/public/landing/ as WebP, plus provenance.json describing every file.

Overlays drawn here on the Slicer teaching volumes are ILLUSTRATIVE: those volumes carry no labelled finding. The
chest-film and BraTS overlays are crops of recorded Skanda / classifier output, not re-drawn.

Run:  python app/scripts/build-landing-imagery.py
Needs numpy and pillow only.
"""
from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = ROOT / "app" / "public" / "samples"
DOCS = ROOT / "docs"
OUT = ROOT / "app" / "public" / "landing"
SIZE = 720
FONT = ImageFont.truetype(str(ROOT / "app" / "public" / "fonts" / "InstrumentSans.ttf"), 17)
provenance: list[dict] = []


# ---------------------------------------------------------------- volume io
def read_nrrd(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    split = raw.index(b"\n\n")
    header = raw[:split].decode()
    sizes = [int(v) for v in re.search(r"sizes: (.+)", header).group(1).split()]
    kind = re.search(r"type: (\w+)", header).group(1)
    dtype = {"int": "<i4", "short": "<i2", "ushort": "<u2", "float": "<f4"}[kind]
    data = np.frombuffer(gzip.decompress(raw[split + 2 :]), dtype=dtype)
    return data.reshape(sizes[::-1]).astype(np.float32)  # [k][j][i]


def window(a: np.ndarray, width: float, level: float) -> np.ndarray:
    return np.clip((a - (level - width / 2)) / width, 0, 1)


def to_image(a: np.ndarray, aspect: float = 1.0) -> Image.Image:
    """a in 0..1, aspect = physical height / width per pixel ratio correction."""
    img = Image.fromarray((a * 255).astype(np.uint8))
    if aspect != 1.0:
        img = img.resize((img.width, max(1, round(img.height * aspect))), Image.LANCZOS)
    return img


def square(img: Image.Image, size: int = SIZE, fill: int = 0) -> Image.Image:
    img = img.convert("L") if img.mode not in ("L", "RGB") else img
    scale = size / max(img.size)
    img = img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)
    canvas = Image.new(img.mode, (size, size), fill)
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    return canvas


# ---------------------------------------------------------------- overlays
STOPS = np.array([  # app heatmap ramp: blue -> cyan -> green -> yellow -> red
    [0.00, 30, 60, 255], [0.30, 0, 200, 255], [0.52, 40, 230, 120],
    [0.72, 255, 230, 0], [0.88, 255, 120, 0], [1.00, 230, 20, 30]], dtype=np.float32)


def ramp(t: np.ndarray) -> np.ndarray:
    return np.stack([np.interp(t, STOPS[:, 0], STOPS[:, c]) for c in (1, 2, 3)], -1)


def heat_field(shape: tuple[int, int], blobs: list[tuple[float, float, float, float]]) -> np.ndarray:
    h, w = shape
    yy, xx = np.mgrid[0:h, 0:w] / np.array([h, w]).reshape(2, 1, 1)
    field = np.zeros(shape, np.float32)
    for cx, cy, r, weight in blobs:
        field += weight * np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * r * r)))
    # subtle texture so it reads as a computed map, not a vector gradient
    rng = np.random.default_rng(7)
    noise = Image.fromarray((rng.random((h // 24, w // 24)) * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
    field *= 0.86 + 0.14 * (np.asarray(noise, np.float32) / 255)
    return np.clip(field / field.max(), 0, 1)


def overlay_heat(base: Image.Image, blobs, mask_threshold: int = 18, strength: float = 0.62) -> Image.Image:
    g = np.asarray(base.convert("L"), np.float32)
    field = heat_field(g.shape, blobs)
    tissue = np.asarray(Image.fromarray((g > mask_threshold).astype(np.uint8) * 255).filter(ImageFilter.GaussianBlur(6)), np.float32) / 255
    alpha = np.clip((field - 0.12) / 0.88, 0, 1) ** 0.9 * strength * tissue
    rgb = np.repeat(g[..., None], 3, -1)
    out = rgb * (1 - alpha[..., None]) + ramp(field) * alpha[..., None]
    img = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    # iso-line at 55% like the app's region contour
    edge = (field > 0.55).astype(np.uint8) * 255
    edge_img = Image.fromarray(edge).filter(ImageFilter.FIND_EDGES).filter(ImageFilter.MaxFilter(3))
    white = Image.new("RGB", img.size, (255, 255, 255))
    img.paste(white, mask=Image.fromarray((np.asarray(edge_img) * 0.85).astype(np.uint8)))
    return img


def brackets(img: Image.Image, box: tuple[float, float, float, float], color=(255, 184, 64), label: str | None = None) -> Image.Image:
    img = img.convert("RGB")
    d = ImageDraw.Draw(img)
    w, h = img.size
    x0, y0, x1, y1 = box[0] * w, box[1] * h, box[2] * w, box[3] * h
    d.rectangle([x0, y0, x1, y1], outline=color + (90,), width=1)
    c = min(x1 - x0, y1 - y0) * 0.22
    for (ax, ay, sx, sy) in ((x0, y0, 1, 1), (x1, y0, -1, 1), (x0, y1, 1, -1), (x1, y1, -1, -1)):
        d.line([(ax, ay), (ax + sx * c, ay)], fill=color, width=4)
        d.line([(ax, ay), (ax, ay + sy * c)], fill=color, width=4)
    if label:
        tw = d.textlength(label, font=FONT) + 26
        d.rounded_rectangle([x0, y0 - 40, x0 + tw, y0 - 10], radius=15, fill=(8, 8, 8), outline=color, width=2)
        d.text((x0 + 13, y0 - 35), label, fill=(255, 255, 255), font=FONT)
    return img


def save(img: Image.Image, name: str, **meta) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    img.convert("RGB").save(OUT / name, "WEBP", quality=84, method=6)
    provenance.append({"file": name, **meta})


# ---------------------------------------------------------------- CT / DRR
def build_ct() -> None:
    ct = read_nrrd(SAMPLES / "ct-brain.nrrd")  # [76][507][512], HU
    ct = ct[:, ::-1, ::-1]  # anterior to the top, patient right on the viewer's left
    src = {"source": "app/public/samples/ct-brain.nrrd", "dataset": "Slicer CTBrain (public teaching volume)"}
    z_aspect = 2.528 / 0.4297

    for name, k, (w, l) in (("ct-axial-brain.webp", 46, (90, 40)), ("ct-axial-bone.webp", 30, (2200, 500)), ("ct-axial-low.webp", 22, (90, 40)), ("ct-axial-high.webp", 60, (90, 40))):
        save(square(to_image(window(ct[k], w, l))), name, **src, kind="CT axial", note=f"slice {k}, W{w} L{l}", overlay=None)

    sag = ct[::-1, :, ct.shape[2] // 2]  # superior to top
    save(square(to_image(window(sag, 100, 40), z_aspect)), "ct-sagittal.webp", **src, kind="CT sagittal reformat", overlay=None)
    cor = ct[::-1, ct.shape[1] // 2, :]
    save(square(to_image(window(cor, 100, 40), z_aspect)), "ct-coronal.webp", **src, kind="CT coronal reformat", overlay=None)

    # illustrative attention on the brain-window axial slice
    base = square(to_image(window(ct[46], 90, 40)))
    heat = overlay_heat(base, [(0.62, 0.42, 0.075, 1.0), (0.56, 0.52, 0.06, 0.55)])
    save(brackets(heat, (0.50, 0.30, 0.74, 0.62), label="Region for review"), "ct-axial-heat.webp", **src, kind="CT axial + attention map",
         overlay="ILLUSTRATIVE - drawn for this page; the teaching volume has no labelled finding")

    # Digitally reconstructed radiographs: line integrals of linear attenuation through the CT volume
    soft = np.clip((ct + 1000) / 1000, 0, 1.2)
    bone = np.clip((ct - 250) / 1000, 0, 2.5)
    mu = soft + 3.2 * bone  # exaggerate bone so the projection reads like a skull film
    mu[ct < -400] = 0  # drop air and table foam
    for name, axis, label in (("xr-skull-lateral.webp", 2, "lateral"), ("xr-skull-ap.webp", 1, "AP")):
        path = mu.sum(axis=axis)[::-1] * (0.43 if axis else 2.53)  # mm-weighted
        drr = np.clip(path / np.percentile(path, 99.7), 0, 1) ** 1.9
        drr = drr[: int(drr.shape[0] * 0.9)] if axis == 2 else drr  # trim the stepped gantry-tilt edge
        img = square(to_image(drr, z_aspect))
        save(img, name, **src, kind=f"Skull radiograph ({label}), digitally reconstructed from CT", overlay=None)
        if label == "lateral":
            heat = overlay_heat(img, [(0.42, 0.38, 0.09, 1.0)], mask_threshold=30, strength=0.55)
            save(brackets(heat, (0.28, 0.22, 0.56, 0.56), label="Attention"), "xr-skull-lateral-heat.webp", **src,
                 kind="Skull DRR + attention map", overlay="ILLUSTRATIVE - no labelled finding")


# ---------------------------------------------------------------- MR
def build_mr() -> None:
    mr = read_nrrd(SAMPLES / "mr-head.nrrd")  # [k=130 L->R][j sup->inf][i ant->post]
    src = {"source": "app/public/samples/mr-head.nrrd", "dataset": "Slicer MRHead (public teaching volume)"}
    hi = np.percentile(mr, 99.6)
    norm = np.clip(mr / hi, 0, 1) ** 0.85
    aspect = 1.3
    sag = norm[66]
    save(square(to_image(sag)), "mr-sagittal.webp", **src, kind="MRI sagittal", overlay=None)
    for name, j in (("mr-axial.webp", 108), ("mr-axial-high.webp", 78), ("mr-axial-low.webp", 140)):
        ax = norm[::-1, j, :].T  # rows anterior->posterior, cols patient right->left
        save(square(to_image(ax.T, aspect).transpose(Image.TRANSPOSE)), name, **src, kind="MRI axial", note=f"row {j}", overlay=None)
    cor = norm[::-1, :, 120].T
    save(square(to_image(cor.T, aspect).transpose(Image.TRANSPOSE)), "mr-coronal.webp", **src, kind="MRI coronal", overlay=None)

    base = square(to_image(sag))
    heat = overlay_heat(base, [(0.46, 0.33, 0.07, 1.0), (0.52, 0.40, 0.05, 0.5)])
    save(brackets(heat, (0.34, 0.20, 0.62, 0.52), label="Region for review"), "mr-sagittal-heat.webp", **src,
         kind="MRI sagittal + attention map", overlay="ILLUSTRATIVE - no labelled finding")


# ---------------------------------------------------------------- recorded model output
def crop(path: Path, box: tuple[int, int, int, int]) -> Image.Image:
    return Image.open(path).convert("RGB").crop(box)


def build_recorded() -> None:
    shots = DOCS / "screenshots"
    cxr = {"dataset": "ChestX-Det held-out test film (NIH ChestX-ray14 image, Apache-2.0 annotations)"}
    save(square(crop(shots / "skanda-xray.png", (295, 148, 1017, 870))), "cxr-69598.webp", **cxr,
         source="docs/screenshots/skanda-xray.png", kind="Chest X-ray PA, cxd_69598", overlay=None)
    outlined = crop(shots / "segmentation-outline.png", (16, 231, 568, 783))
    # remove the captured mouse pointer: grey-only blurred fill, feathered, with a touch of grain
    region = (356, 290, 432, 376)
    # interpolate each column between the clean rows just above and below, so no pointer pixel is reused
    grey = np.asarray(outlined.convert("L"), np.float32)
    x0, y0, x1, y1 = region
    top = np.convolve(grey[y0 - 3 : y0, x0:x1].mean(0), np.ones(9) / 9, "same")
    bottom = np.convolve(grey[y1 : y1 + 3, x0:x1].mean(0), np.ones(9) / 9, "same")
    t = np.linspace(0, 1, y1 - y0)[:, None]
    fill = top[None] * (1 - t) + bottom[None] * t
    fill += np.random.default_rng(3).normal(0, 2.2, fill.shape)
    patch = Image.fromarray(fill.clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)).convert("RGB")
    feather = Image.new("L", patch.size, 0)
    ImageDraw.Draw(feather).rounded_rectangle([8, 8, patch.width - 8, patch.height - 8], radius=18, fill=255)
    outlined.paste(patch, region[:2], feather.filter(ImageFilter.GaussianBlur(5)))
    save(square(outlined), "cxr-69598-skanda.webp", **cxr,
         source="docs/screenshots/segmentation-outline.png", kind="Chest X-ray + Skanda outlines",
         overlay="RECORDED - Skanda outlines captured in the app (1 Nov 2026)")
    save(square(crop(shots / "heatmap.png", (560, 262, 1378, 980))), "cxr-45707-heat.webp", **cxr,
         source="docs/screenshots/heatmap.png", kind="Chest X-ray + classifier heatmap and finding boxes",
         overlay="RECORDED - TorchXRayVision evidence map and MedGemma boxes captured in the app")
    save(square(crop(shots / "skanda-mri.png", (430, 290, 870, 790)), fill=0), "mri-brats-skanda-boxes.webp",
         source="docs/screenshots/skanda-mri.png", dataset="BraTS glioma case BraTS-GLI-00000-000, axial 75",
         kind="Brain MRI T1c + Skanda candidate regions", overlay="RECORDED - Skanda server run 3")
    panels = Image.open(DOCS / "validation" / "skanda-rerun" / "mri-75.png").convert("RGB")
    for idx, (name, kind, ov) in enumerate((("mri-brats-75.webp", "Brain MRI T1c axial 75", None),
                                            ("mri-brats-75-reference.webp", "Radiologist reference mask", "REFERENCE - BraTS label"),
                                            ("mri-brats-75-skanda.webp", "Skanda outline and box", "RECORDED - Skanda server run 3, Dice in results.json"))):
        p = panels.crop((idx * 240, 0, idx * 240 + 240, 240)).resize((SIZE, SIZE), Image.LANCZOS)
        save(p, name, source="docs/validation/skanda-rerun/mri-75.png", dataset="BraTS glioma, axial 75", kind=kind, overlay=ov)


if __name__ == "__main__":
    build_ct()
    build_mr()
    build_recorded()
    (OUT / "provenance.json").write_text(json.dumps(provenance, indent=2))
    print("\n".join(f"{p['file']:34} {p['kind']}" for p in provenance))

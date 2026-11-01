# Charts for the CXR model comparison (MedGemma base and CXR fine-tune, Skanda run 2), computed from the committed results files with score.py.
#   uv run --with matplotlib plot_comparison.py      → ../docs/benchmark/cxr-comparison-{light,dark}.png
import os
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import score as S

os.chdir(os.path.dirname(os.path.abspath(__file__)))
RUNS = [  # (label, file); colour follows the run, in the palette's fixed slot order
    ("Base MedGemma · Q3_K_S", "results-cxd.jsonl"),
    ("CXR fine-tune · Q3_K_S", "results-cxd-cxr-q3.jsonl"),
    ("CXR fine-tune · Q4_K_M", "results-cxd-cxr.jsonl"),
    ("Skanda run 2 · pass 1", "results-skanda-manifest-cxd.jsonl"),     # radiology-grounding, best checkpoint (stage 2)
    ("Skanda run 2 · pass 2", "results-skanda-r2-manifest-cxd.jsonl"),  # same model, second read
]
THEMES = {
    "light": dict(surface="#fcfcfb", ink="#0b0b0b", ink2="#52514e", muted="#898781", grid="#e1e0d9", axis="#c3c2b7",
                  series=["#2a78d6", "#eb6834", "#1baf7a", "#7c3aed", "#a78bfa"]),
    "dark": dict(surface="#1a1a19", ink="#f0efec", ink2="#c3c2b7", muted="#898781", grid="#2c2c2a", axis="#383835",
                 series=["#3987e5", "#d95926", "#199e70", "#8b5cf6", "#c4b5fd"]),
}
CLASSES = ["Consolidation", "Effusion", "Nodule", "Fibrosis", "Pleural Thickening", "Cardiomegaly", "Fracture",
           "Atelectasis", "Pneumothorax", "Calcification", "Mass", "Emphysema", "Diffuse Nodule"]

M = [S.score(S.load(f), "test") for _, f in RUNS]
headline = [  # (label, (k, n) per run)
    ("Right finding type, all labels", [m["right"] for m in M]),
    ("Abnormal films flagged", [m["flagged"] for m in M]),
    ("Normal films called normal", [m["clear"] for m in M]),
    ("Box centre inside the lesion", [tuple(m["loc"]) for m in M]),
]
per_class = [(f"{c} (n={M[0]['n'][c]})", [(m["tp"][c], m["n"][c]) for m in M]) for c in CLASSES]


def bars(ax, groups, t, ci):
    """Grouped horizontal bars, one group per row, top to bottom; every bar's value labelled at its end."""
    h = 0.8 / len(RUNS) - 0.02
    for gi, (_, vals) in enumerate(groups):
        for si, (k, n) in enumerate(vals):
            y, p = gi + (si - (len(vals) - 1) / 2) * (h + 0.02), 100 * k / n
            ax.barh(y, p, height=h, color=t["series"][si], lw=0)
            x_txt = p
            if ci:
                lo, hi = (100 * v for v in S.wilson_ci(k, n))
                ax.errorbar(p, y, xerr=[[p - lo], [hi - p]], fmt="none", ecolor=t["ink2"], elinewidth=1, capsize=3)
                x_txt = hi
            ax.text(x_txt + 1.2, y, f"{k}/{n} · {p:.0f}%", va="center", ha="left", fontsize=8, color=t["ink2"])
    ax.set_yticks(range(len(groups)), [g[0] for g in groups])
    ax.set_ylim(len(groups) - 0.5, -0.5)
    ax.set_xlim(0, 118)
    ax.set_xticks(range(0, 101, 20), [f"{x}%" for x in range(0, 101, 20)])
    ax.grid(axis="x", color=t["grid"], lw=0.8)
    ax.set_axisbelow(True)
    for s in ("top", "right", "bottom"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_color(t["axis"])
    ax.tick_params(axis="y", length=0, colors=t["ink"], labelsize=10)
    ax.tick_params(axis="x", length=0, colors=t["muted"], labelsize=9)


def render(mode):
    t = THEMES[mode]
    plt.rcParams.update({"font.family": ["Helvetica Neue", "Helvetica", "Arial", "DejaVu Sans"]})
    fig = plt.figure(figsize=(11, 17), dpi=160, facecolor=t["surface"])
    gs = fig.add_gridspec(2, 1, height_ratios=[len(headline), len(per_class)], hspace=0.16,
                          left=0.21, right=0.97, top=0.89, bottom=0.025)
    a1, a2 = fig.add_subplot(gs[0]), fig.add_subplot(gs[1])
    for ax in (a1, a2):
        ax.set_facecolor(t["surface"])
    fig.text(0.02, 0.98, "Chest X-ray models: MedGemma 27B (base, CXR fine-tune) and Skanda run 2", fontsize=16, weight="bold", color=t["ink"])
    fig.text(0.02, 0.962, "ChestX-Det held-out test · 111 radiologist-labelled films · same prompts, parser and scorer · "
             "temperature 0.2 · Skanda read twice", fontsize=10, color=t["ink2"])
    for si, (label, _) in enumerate(RUNS):  # legend, always present for ≥ 2 series, in slot order, 3 per row
        x, y = 0.02 + 0.25 * (si % 3), 0.935 - 0.014 * (si // 3)
        fig.patches.append(plt.Rectangle((x, y - 0.004), 0.014, 0.008, transform=fig.transFigure, fc=t["series"][si], lw=0))
        fig.text(x + 0.02, y, label, fontsize=10, color=t["ink"], va="center")
    a1.set_title("Headline rates, with Wilson 95% intervals", loc="left", fontsize=11.5, color=t["ink"], pad=8,
                 weight="bold")
    a2.set_title("Sensitivity by radiologist label (film counted when a finding of that type is reported)", loc="left",
                 fontsize=11.5, color=t["ink"], pad=8, weight="bold")
    bars(a1, headline, t, ci=True)
    bars(a2, per_class, t, ci=False)
    out = f"../docs/benchmark/cxr-comparison-{mode}.png"
    os.makedirs(os.path.dirname(out), exist_ok=True)
    fig.savefig(out, facecolor=t["surface"])
    print(out)


for mode in THEMES:
    render(mode)

"""Stream Skanda's bf16 HF shards into a selective MLX affine INT4 checkpoint.

Run using model-runtime/.venv/bin/python. Does not publish or modify source weights.
The full-precision heads are retained; this converts the VLM, not the PyTorch server.
"""
import argparse
import gc
import hashlib
import json
from pathlib import Path
import shutil
import time

import mlx.core as mx


def mapped_weights(name, w, hidden, intermediate):
    name = name.replace("model.language_model.", "language_model.model.")
    name = name.replace("model.visual.", "vision_tower.")
    if name.startswith("lm_head."):
        name = "language_model." + name
    if name.endswith(".experts.gate_up_proj"):
        # Transformers versions have used both fused orientations.
        if w.shape[-2:] == (hidden, 2 * intermediate):
            w = w.transpose(0, 2, 1)
        if w.shape[-2:] != (2 * intermediate, hidden):
            raise ValueError(f"Unexpected fused expert shape: {name}: {w.shape}")
        prefix = name.removesuffix("experts.gate_up_proj") + "switch_mlp."
        yield prefix + "gate_proj.weight", w[:, :intermediate, :]
        yield prefix + "up_proj.weight", w[:, intermediate:, :]
    elif name.endswith(".experts.down_proj"):
        if w.shape[-2:] == (intermediate, hidden):
            w = w.transpose(0, 2, 1)
        if w.shape[-2:] != (hidden, intermediate):
            raise ValueError(f"Unexpected down expert shape: {name}: {w.shape}")
        yield name.removesuffix("experts.down_proj") + "switch_mlp.down_proj.weight", w
    else:
        if name.endswith("patch_embed.proj.weight") and w.ndim == 5:
            w = w.transpose(0, 2, 3, 4, 1)
        yield name, w


def quantized_layer(name):
    return name.startswith("language_model.model.layers.") and name.endswith(".weight") and (
        (".self_attn." in name and name.endswith(("q_proj.weight", "k_proj.weight", "v_proj.weight", "o_proj.weight")))
        or ".switch_mlp." in name
    )


def wait_for(path):
    while not path.is_file():
        print(f"Waiting for download: {path.name}", flush=True)
        time.sleep(30)
    return path


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def self_test(expert_bits=4):
    mx.set_default_device(mx.cpu)
    mx.random.seed(42)
    w = mx.random.normal((2, 128, 256)).astype(mx.bfloat16)
    q, scales, biases = mx.quantize(w, group_size=64, bits=expert_bits)
    restored = mx.dequantize(q, scales, biases, group_size=64, bits=expert_bits)
    relative = float(mx.sqrt(mx.mean((w.astype(mx.float32) - restored) ** 2) / mx.mean(w.astype(mx.float32) ** 2)))
    assert q.dtype == mx.uint32 and q.shape == (2, 128, 256 * expert_bits // 32)
    assert relative < (0.15 if expert_bits == 4 else 0.25), relative
    name = "model.language_model.layers.0.mlp.experts.gate_up_proj"
    a = dict(mapped_weights(name, w, 256, 64))
    b = dict(mapped_weights(name, w.transpose(0, 2, 1), 256, 64))
    assert a.keys() == b.keys()
    for key in a:
        assert bool(mx.array_equal(a[key], b[key]))
        assert quantized_layer(key)
    for key in ("language_model.model.layers.0.mlp.gate.weight",
                "language_model.model.layers.0.self_attn.q_norm.weight",
                "language_model.model.embed_tokens.weight", "language_model.lm_head.weight",
                "vision_tower.blocks.0.attn.qkv.weight"):
        assert not quantized_layer(key), key
    assert quantized_layer("language_model.model.layers.0.self_attn.q_proj.weight")
    print(f"Q{expert_bits} self-test passed: packing, both fused layouts, retained layers; relative RMSE {relative:.4f}", flush=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", type=Path)
    ap.add_argument("--output", type=Path)
    ap.add_argument("--revision")
    ap.add_argument("--self-test", action="store_true")
    ap.add_argument("--expert-bits", type=int, choices=(3, 4), default=4)
    args = ap.parse_args()
    if args.self_test:
        self_test(args.expert_bits)
        return
    if not all((args.source, args.output, args.revision)):
        ap.error("--source, --output and --revision are required for conversion")
    if args.output.exists():
        raise SystemExit("Output exists; use a new directory to avoid mixing checkpoints.")
    src = args.source / "vlm"
    cfg = json.loads(wait_for(src / "config.json").read_text())
    idx = json.loads(wait_for(src / "model.safetensors.index.json").read_text())
    if cfg["model_type"] != "qwen3_vl_moe":
        raise ValueError("This converter supports only Skanda's Qwen3-VL MoE architecture.")
    hidden = cfg["text_config"]["hidden_size"]
    intermediate = cfg["text_config"]["moe_intermediate_size"]
    cfg["vision_config"]["model_type"] = "qwen3_vl_moe"
    # HF 5.x renamed these fields; MLX uses the original Qwen field names.
    text = cfg["text_config"]
    text["num_experts"] = text.get("num_experts", text.get("num_local_experts"))
    rope = text.get("rope_parameters", {})
    text["rope_theta"] = text.get("rope_theta", rope.get("rope_theta", 5000000))
    if rope:
        text["rope_scaling"] = {k: v for k, v in rope.items() if k != "rope_theta"}
    # Skanda saves a separately trained [SEG] output row in lm_head.
    if "lm_head.weight" in idx["weight_map"]:
        text["tie_word_embeddings"] = False
    out = args.output / "vlm"
    out.mkdir(parents=True)
    (args.output / "INCOMPLETE").write_text("Conversion in progress; do not load.\n")
    mx.set_default_device(mx.cpu)
    weight_map, records, stats = {}, [], []
    quantization = {"group_size": 64, "bits": 4, "mode": "affine"}
    total_bytes = 0
    shards = sorted(set(idx["weight_map"].values()))
    for i, shard in enumerate(shards, 1):
        path = wait_for(src / shard)
        print(f"Converting {i}/{len(shards)}: {shard}", flush=True)
        weights = mx.load(str(path))
        expected = {k for k, v in idx["weight_map"].items() if v == shard}
        if set(weights) != expected:
            raise ValueError(f"Shard keys disagree with source index: {shard}")
        converted = {}
        for original in sorted(weights):
            w = weights.pop(original)
            for name, value in mapped_weights(original, w, hidden, intermediate):
                if quantized_layer(name):
                    bits = args.expert_bits if ".switch_mlp." in name else 4
                    q, scales, biases = mx.quantize(value, group_size=64, bits=bits)
                    mx.eval(q, scales, biases)
                    # Check representative rows against the original, not just file size.
                    sample = value.reshape(-1, value.shape[-1])[:8].astype(mx.float32)
                    restored = mx.dequantize(q.reshape(-1, q.shape[-1])[:8],
                        scales.reshape(-1, scales.shape[-1])[:8],
                        biases.reshape(-1, biases.shape[-1])[:8], group_size=64, bits=bits)
                    error = float(mx.sqrt(mx.mean((sample - restored) ** 2)))
                    rms = float(mx.sqrt(mx.mean(sample ** 2)))
                    if not (0 <= error < float("inf")):
                        raise ValueError(f"Non-finite quantization error: {name}")
                    stats.append({"name": name, "bits": bits, "rmse": error, "relative_rmse": error / max(rms, 1e-12)})
                    prefix = name.removesuffix(".weight")
                    quantization[prefix] = {"group_size": 64, "bits": bits, "mode": "affine"}
                    converted[name] = q
                    converted[prefix + ".scales"] = scales
                    converted[prefix + ".biases"] = biases
                else:
                    converted[name] = value
                mx.eval(*converted.values())
            del w
        target = out / f"model-{i:05d}-of-{len(shards):05d}.safetensors"
        mx.save_safetensors(str(target), converted, metadata={"format": "mlx"})
        for key, value in converted.items():
            if key in weight_map:
                raise ValueError(f"Duplicate mapped key: {key}")
            weight_map[key] = target.name
            total_bytes += value.nbytes
        records.append({"file": target.name, "bytes": target.stat().st_size, "sha256": sha256(target)})
        print(f"Saved {target.name}: {target.stat().st_size / 1e9:.2f} GB", flush=True)
        del converted, weights, value
        gc.collect()
        mx.clear_cache()
    cfg["quantization"] = quantization
    cfg["quantization_config"] = dict(cfg["quantization"])
    for name in ("tokenizer.json", "tokenizer_config.json", "processor_config.json", "chat_template.jinja", "generation_config.json"):
        shutil.copy2(wait_for(src / name), out / name)
    (out / "config.json").write_text(json.dumps(cfg, indent=2) + "\n")
    (out / "model.safetensors.index.json").write_text(json.dumps({"metadata": {"total_size": total_bytes}, "weight_map": weight_map}, indent=2) + "\n")
    for name in ("skanda_heads.pt", "skanda_config.json"):
        source = wait_for(args.source / name)
        shutil.copy2(source, args.output / name)
        if sha256(source) != sha256(args.output / name):
            raise ValueError(f"Copy checksum mismatch: {name}")
    manifest = {"source": "hitheshkaranth/skanda-grounding", "revision": args.revision,
        "format": f"mlx-affine-experts{args.expert_bits}-attention4", "group_size": 64,
        "expert_bits": args.expert_bits, "attention_bits": 4,
        "preserved": ["vision", "router", "embeddings", "lm_head", "SAM", "seg_proj", "score_head"],
        "calibration": "Original bf16 thresholds retained; Q4 recalibration and clinical benchmarks not performed.",
        "runtime": "MLX VLM; original PyTorch Skanda server needs an MLX adapter for grounding.",
        "shards": records, "quantized_tensors": stats}
    (args.output / "conversion.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (args.output / "INCOMPLETE").unlink()
    print(f"Conversion complete: {args.output}; {total_bytes / 1e9:.2f} GB VLM tensors", flush=True)


if __name__ == "__main__":
    main()

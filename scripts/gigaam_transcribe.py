#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "torch>=2.0",
#   # GigaAM-v3's trust_remote_code modeling fails on transformers >= 4.50:
#   # `Tensor on device cpu is not on the expected device meta` inside the
#   # FeatureExtractor constructor, due to meta-device default initialization
#   # changes. Pinning to 4.45.x sidesteps it. Revisit when upstream catches up.
#   "transformers>=4.40,<4.50",
#   "torchaudio>=2.0",
#   # Required by ai-sage/GigaAM-v3's trust_remote_code modeling file even for
#   # the e2e_rnnt head. pyannote.audio is needed at import time for the
#   # model's VAD utilities; we don't actually call it (simple time-chunking
#   # below in _transcribe_chunked).
#   "hydra-core",
#   "omegaconf",
#   "pyannote.audio",
#   "sentencepiece",
# ]
# ///
"""GigaAM transcription wrapper, called from src/engines/gigaam.ts.

Loads the model via `transformers.AutoModel.from_pretrained(...,
trust_remote_code=True)`. For audio longer than --chunk-threshold seconds,
chunks the input itself rather than relying on `transcribe_longform()` —
that method requires `pyannote.audio` plus an HF_TOKEN with the
pyannote/segmentation terms accepted, which is friction we'd rather not
impose at the default setup. Simple time-based chunking gives ~95% of the
quality with zero extra setup.

Args (all positional are file/dir paths or string identifiers; see --help):
  --audio              path to 16 kHz mono WAV (produced by audio.ts:preprocess)
  --output-stem        absolute path stem; the script writes <stem>.<format>
  --model-repo         HF repo id, e.g. "ai-sage/GigaAM-v3"
  --revision           HF branch / revision, e.g. "e2e_rnnt" or "e2e_ctc"
  --format             txt | json
  --chunk-threshold    seconds; >= → chunked, < → single-shot. Default 30.
  --chunk-seconds      window length per chunk. Default 30.
  --chunk-overlap      seconds of overlap between chunks. Default 2.
  --warm               load the model and exit; for setup cache warming.
"""
from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--audio", required=False)
    p.add_argument("--output-stem", required=False)
    p.add_argument("--model-repo", default="ai-sage/GigaAM-v3")
    p.add_argument("--revision", default="e2e_rnnt")
    p.add_argument("--format", default="txt", choices=["txt", "json"])
    # GigaAM-v3's transcribe() hard-limits to LONGFORM_THRESHOLD = 25 s. We
    # chunk smaller than that. The model's own transcribe_longform() does
    # VAD-based chunking but needs HF_TOKEN with pyannote/segmentation-3.0
    # terms accepted — friction we'd rather skip for v1.
    p.add_argument("--chunk-threshold", type=float, default=20.0)
    p.add_argument("--chunk-seconds", type=float, default=20.0)
    p.add_argument("--chunk-overlap", type=float, default=1.0)
    p.add_argument("--warm", action="store_true")
    args = p.parse_args()

    if not args.warm:
        if not args.audio or not args.output_stem:
            log("error: --audio and --output-stem are required unless --warm")
            return 1

    log(f"loading: {args.model_repo} @ {args.revision}")
    from transformers import AutoModel  # noqa: E402 — heavy import after arg parse

    # `low_cpu_mem_usage=False` forces eager weight allocation. transformers
    # >= 4.40 uses meta-device init by default, but GigaAM's FeatureExtractor
    # does work in __init__ that fails with
    # "Tensor on device cpu is not on the expected device meta".
    model = AutoModel.from_pretrained(
        args.model_repo,
        revision=args.revision,
        trust_remote_code=True,
        low_cpu_mem_usage=False,
    )
    # Model loads in fp16 by default but our input tensors from
    # torchaudio.load() are fp32, causing
    # "Input type (float) and bias type (c10::Half) should be the same".
    # Force fp32 for input/weight type consistency on CPU/MPS.
    model = model.float()

    if args.warm:
        log("warmed (model loaded; exiting before transcription)")
        return 0

    duration_s = _audio_duration_seconds(args.audio)
    log(f"audio: {duration_s:.1f}s (via ffprobe)")

    if duration_s < args.chunk_threshold:
        log("short audio → single-shot transcribe()")
        result = model.transcribe(args.audio)
        text, segments = _normalize(result)
    else:
        log(
            f"long audio → time-based chunking "
            f"({args.chunk_seconds}s windows, {args.chunk_overlap}s overlap)"
        )
        text, segments = _transcribe_chunked(
            model,
            args.audio,
            chunk_s=args.chunk_seconds,
            overlap_s=args.chunk_overlap,
        )

    out_path = Path(f"{args.output_stem}.{args.format}")
    if args.format == "txt":
        out_path.write_text(text.strip() + "\n", encoding="utf-8")
    elif args.format == "json":
        out_path.write_text(
            json.dumps(
                {"text": text, "segments": segments, "model": args.model_repo, "revision": args.revision},
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
    log(f"wrote: {out_path}")
    return 0


def _normalize(result) -> tuple[str, list | None]:
    if isinstance(result, str):
        return result, None
    if isinstance(result, dict):
        text = result.get("text") or result.get("transcription") or ""
        return text, result.get("segments")
    if isinstance(result, list):
        parts: list[str] = []
        segments: list = []
        for item in result:
            if isinstance(item, dict):
                t = item.get("text") or item.get("transcription") or ""
                parts.append(t)
                segments.append(item)
            else:
                parts.append(str(item))
        return " ".join(parts), segments or None
    return str(result), None


def _audio_duration_seconds(path: str) -> float:
    import subprocess

    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


def _transcribe_chunked(model, audio_path, *, chunk_s, overlap_s) -> tuple[str, list]:
    import torchaudio  # noqa: E402

    waveform, sr = torchaudio.load(audio_path)
    if sr != 16000:
        resampler = torchaudio.transforms.Resample(sr, 16000)
        waveform = resampler(waveform)
        sr = 16000
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)

    chunk_samples = int(chunk_s * sr)
    overlap_samples = int(overlap_s * sr)
    step_samples = max(1, chunk_samples - overlap_samples)
    total_samples = waveform.shape[1]

    texts: list[str] = []
    segments: list = []
    n_chunks = (total_samples + step_samples - 1) // step_samples
    for i, start in enumerate(range(0, total_samples, step_samples)):
        end = min(start + chunk_samples, total_samples)
        chunk = waveform[:, start:end]
        if chunk.shape[1] < sr:  # skip <1s tail
            continue
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            torchaudio.save(tmp.name, chunk, sr)
            tmp_path = tmp.name
        try:
            log(f"  chunk {i + 1}/{n_chunks}: {start / sr:.1f}s–{end / sr:.1f}s")
            result = model.transcribe(tmp_path)
            text, _ = _normalize(result)
            text = text.strip()
            if text:
                texts.append(text)
                segments.append({"start": start / sr, "end": end / sr, "text": text})
        finally:
            Path(tmp_path).unlink(missing_ok=True)

    return " ".join(texts), segments


if __name__ == "__main__":
    raise SystemExit(main())

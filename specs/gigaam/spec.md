# Add GigaAM Engine for Russian Quality

## 1. Meta Information

- **Branch:** TBD (e.g. `gigaam-engine`)
- **Epic:** Quality v3 — add Sber GigaAM as a third engine for Russian-only audio
- **PRD:** N/A (personal project)
- **Status:** **Implemented as opt-in only** (auto-routing reverted after
  measurement — see §11 Field findings)

## 2. Context

`specs/mlx-russian/spec.md` landed MLX + antony66/bond005 as Whisper-family
fine-tunes for Russian. Per the 2026 research review:

- Stock Whisper-large-v3: WER ~5.5% on CommonVoice ru
- antony66/whisper-large-v3-russian (current default): WER ~6.4%
- **GigaAM-v3 RNN-T (Sber, June 2025): WER ~0.8%**
- **GigaAM-v3 CTC: WER ~1.3%**

GigaAM is a 220–240M-param Conformer pretrained HuBERT-style on **700,000
hours** of Russian. MIT-licensed. The `e2e_rnnt` / `e2e_ctc` heads emit
punctuation, normalized text, **Latin characters, and digits natively** —
exactly what's needed for "MCP", "API", "ChatGPT", "ASAP", "CRUD" inside
Russian sentences.

The catch: **GigaAM is Russian-only**. Trained exclusively on Russian
audio. Would produce gibberish on English. So it adds alongside, not
replaces, the existing Whisper engines.

## 3. Key Technical Drivers

- **Driver 1 — Russian transcription quality**: a step-change improvement
  (~5–8× lower WER) for the project's primary use case. Worth the new
  Python dependency.
- **Driver 2 — Native Latin character output**: addresses the
  ru+en-acronym problem at the model level, not via `--prompt` workarounds.
- **Driver 3 — Same CLI, more options**: `transcribe foo.m4a` should pick
  the best engine for the language automatically. Russian → gigaam,
  everything else → mlx.
- **Driver 4 — Don't break the existing engines**: cpp and mlx stay.
  GigaAM is opt-in for Russian; explicit `--engine mlx`/`--engine cpp`
  always wins.

## 4. Current State

- `src/engines/types.ts`: `EngineName = "mlx" | "cpp"`.
- `src/cli.ts`: defaults to `mlx`; auto-picks `antony66-russian` model.
- Two engine wrappers, two model alias tables, two setup scripts.
- 42 tests pass.

## 5. Considered Options

### 5.1. Option 1: Replace mlx with gigaam for Russian

- **Description**: Drop the MLX engine for Russian recordings; route all
  `--language ru` to gigaam. Keep mlx for other languages only.
- **Pros**: simplest mental model.
- **Cons**: loses antony66/bond005 as a fallback; pyannote.audio + HF_TOKEN
  dependency for long-form is a real friction point during setup.

### 5.2. Option 2: Add gigaam as a third engine; auto-route on --language (CHOSEN)

- **Description**: `EngineName = "mlx" | "cpp" | "gigaam"`. Default engine
  inferred from `--language`: `ru` → `gigaam`, everything else → `mlx`.
  Explicit `--engine` always wins.
- **Pros**: best engine per use case; existing mlx + cpp paths unchanged
  for fallback; users who don't want Python at all can still opt out via
  `--engine mlx`.
- **Cons**: three engines to maintain. Mitigated by the `Engine` interface
  being thin and uniform.

### 5.3. Option 3: Keep status quo — antony66 as default

- **Description**: Don't add gigaam.
- **Pros**: no change.
- **Cons**: leave ~5× WER improvement on the table for the primary use case.

### 5.4. Comparison

| Criteria / Driver               | 1 Replace | 2 Add + auto-route (CHOSEN) | 3 Status quo |
| ------------------------------- | --------- | --------------------------- | ------------ |
| Russian WER improvement         | + (~5×)   | + (~5×)                     | -            |
| Non-Russian recordings work     | + (mlx)   | + (mlx)                     | + (mlx)      |
| Existing setup stays usable     | -         | +                           | +            |
| Code surface to maintain        | +         | -                           | +            |
| Latin acronyms preserved natively | +       | +                           | ~ (via prompt) |

## 6. Proposed Solution

### 6.1. Python wrapper (`scripts/gigaam_transcribe.py`)

GigaAM is loaded via `transformers.AutoModel.from_pretrained` with
`trust_remote_code=True`. No CLI binary ships with the model; we wrap it
in a Python script.

```python
# /// script  (PEP 723 inline deps — uv resolves these on first run)
# requires-python = ">=3.10"
# dependencies = ["torch", "transformers", "torchaudio"]
# ///
```

- Input: a 16 kHz mono WAV path (produced by `src/audio.ts:preprocess()`).
- For files > ~30 s, use `model.transcribe_longform()` if `HF_TOKEN` is set
  and pyannote is installed; otherwise simple time-based chunking (30 s
  windows, 2 s overlap) — slightly worse than VAD but no token needed.
- Output: `<stem>.txt` or `<stem>.json` (full result with segments).
- `--warm` flag: load model and exit (used by setup-all.sh to pre-cache).

Args: `--audio --output-stem --model-repo --revision --format --warm`.

### 6.2. TS engine (`src/engines/gigaam.ts`)

Same shape as `cpp.ts` and `mlx.ts`:

```ts
const MODEL_ALIASES: Record<string, { repo: string; revision: string }> = {
  "gigaam-v3":     { repo: "ai-sage/GigaAM-v3", revision: "e2e_rnnt" },
  "gigaam-v3-ctc": { repo: "ai-sage/GigaAM-v3", revision: "e2e_ctc"  },
  "gigaam-v2":     { repo: "ai-sage/GigaAM-v2", revision: "main"     },
};

export const gigaamEngine: Engine = {
  name: "gigaam",
  async transcribe(opts) {
    if (!["txt", "json"].includes(opts.format)) {
      throw new Error("gigaam v1: only txt/json formats supported");
    }
    if (opts.initialPrompt) console.warn("gigaam ignores --prompt");
    const wav = await preprocess({ input: opts.inputPath, keepWav: false });
    try {
      // spawn `uv run scripts/gigaam_transcribe.py ...`
    } finally { await wav.cleanup(); }
  },
};
```

Pure `gigaamArgv()` for unit testing.

### 6.3. CLI auto-routing (`src/cli.ts`)

Engine and model resolution become deferred:

```ts
function resolveEngine(explicit: EngineName | undefined, language: string): EngineName {
  if (explicit) return explicit;
  return language === "ru" ? "gigaam" : "mlx";
}

function resolveModel(explicit: string | undefined, engine: EngineName, language: string): string {
  if (explicit) return explicit;
  if (engine === "gigaam") return "gigaam-v3";
  if (engine === "cpp")    return "large-v3";
  return language === "ru" ? "antony66-russian" : "large-v3"; // mlx
}
```

Outcomes:

- `transcribe ru-memo.m4a`              → gigaam + gigaam-v3
- `transcribe en-meeting.m4a --language en` → mlx + large-v3
- `transcribe ru-memo.m4a --engine mlx`     → mlx + antony66-russian
- `transcribe en-meeting.m4a --engine gigaam` → **error** at runtime
  (gigaam produces gibberish on English) — CLI warns at parse time.

### 6.4. Format restriction

GigaAM v1 supports `txt` and `json` only. `--format srt|vtt|all` with
`--engine gigaam` is rejected at the CLI with a clear error
("gigaam engine doesn't produce subtitle formats; use --engine mlx or cpp").

Word-level timestamps from GigaAM-v3 RNN-T's beam search are emitted in
JSON; SRT/VTT support is a v1.1 follow-up.

### 6.5. Setup integration (`scripts/setup-all.sh`)

New section 6:

1. Pre-warm GigaAM cache via
   `uv run --script scripts/gigaam_transcribe.py --warm`.
2. This triggers uv to resolve and download torch + transformers
   (~2 GB) and HF auto-downloads the GigaAM checkpoint (~1 GB).
3. Idempotent (re-runs no-op if uv venv hash matches and HF cache hit).
4. Flag `--no-gigaam` skips this section.

### 6.6. Pros and Cons

- **Pros**:
  - ~5× lower WER on Russian — the primary use case.
  - Latin acronym preservation at the model level (no prompt needed).
  - Engine interface designed for this exact extension; ~150 LoC change.
- **Cons**:
  - New Python runtime dependency (uv handles it via PEP 723 inline deps).
  - First transcription is slow (download torch + GigaAM ~3 GB).
  - `transcribe_longform` requires pyannote + HF_TOKEN; we fall back to
    simple time chunking to avoid that for v1.

## 7. Testing Strategy

### 7.1. Unit Tests

- `gigaamArgv()`: pure argv construction; model alias resolution
  (gigaam-v3 → ai-sage/GigaAM-v3 @ e2e_rnnt).
- `cli.ts` auto-routing: `--language ru` → engine gigaam, model gigaam-v3;
  `--language en` → engine mlx, model large-v3; explicit `--engine` wins.
- Format restriction: `--engine gigaam --format srt` throws UserError.

### 7.2. Integration Tests (manual)

- Run `bun run transcribe PRD1.m4a` on the 48-min PRD memo;
  compare unique-line ratio + latin-acronym preservation vs v5 antony66.
- Acceptance: ≥97% unique lines; ≥20 Latin-acronym preservations;
  no hallucination loops longer than 3 repeats.

## 8. Definition of Done

### Universal (always required)

- [ ] Tests pass (`bun run test`)
- [ ] TypeScript compiles cleanly (`bun run typecheck`)
- [ ] Linter passes (`bun run lint`) — N/A until linter added.
- [ ] Spec updated if implementation diverges.

### Feature-Specific

- [ ] `scripts/gigaam_transcribe.py` runs end-to-end on a clean Mac,
      producing a non-empty txt file for a Russian sample.
- [ ] `src/engines/gigaam.ts` implements `gigaamArgv()` + `gigaamEngine`.
- [ ] `src/engines/types.ts` includes `"gigaam"` in `EngineName`.
- [ ] `src/cli.ts` auto-routes engine + model based on `--language`.
- [ ] `--engine gigaam --format srt` rejected with friendly message.
- [ ] `bun run setup` includes the gigaam warm step.
- [ ] `AGENTS.md` updated with engine table, layout, things-to-not-do.
- [ ] `specs/README.md` indexes this spec.

## 9. Alternatives Not Chosen

- **Run GigaAM via the upstream `gigaam` PyPI package** instead of HF
  AutoModel: same model, different loader. Sticking with `transformers`
  `AutoModel` because it's the standard pattern + less surface area.
- **Always use `transcribe_longform` (require pyannote + HF_TOKEN)**:
  better VAD-based chunking, but token + license acceptance is friction
  we'd rather defer to v1.1.
- **Replace MLX entirely for Russian**: see Option 1.
- **Add ensemble (run GigaAM + Whisper, vote per segment)**: meaningful
  quality lift per research, but >> v1 complexity. Future spec.

## 11. Field findings (post-implementation)

### Six real bugs hit during the v1 integration

| # | Symptom                                                          | Root cause                                                    | Fix                                       |
| - | ---------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| 1 | `ImportError: hydra, omegaconf, pyannote, sentencepiece`         | PEP 723 deps in `gigaam_transcribe.py` were incomplete         | Added all four to the inline header        |
| 2 | `huggingface_hub` parallel download stalls in `CLOSE_WAIT`       | Same bug as antony66/bond005 — multi-file Russian repo        | New `scripts/download-hf-model.sh` curls each file |
| 3 | `Tensor on device cpu is not on the expected device meta`        | `transformers ≥ 4.50` defaults to meta-device init; GigaAM's `FeatureExtractor.__init__` allocates real tensors and conflicts | Pinned `transformers>=4.40,<4.50` in PEP 723 deps |
| 4 | `module 'torchaudio' has no attribute 'info'`                    | `torchaudio.info()` removed/moved in recent versions          | Switched to `ffprobe` subprocess for duration |
| 5 | `ValueError: Too long wav file, use 'transcribe_longform'`       | `LONGFORM_THRESHOLD = 25 * SAMPLE_RATE` hardcoded in modeling | Reduced chunk size from 30 s → 20 s        |
| 6 | `RuntimeError: Input type (float) and bias type (c10::Half)`     | Model loads in `float16` by default; torchaudio loads input as `float32` | `model = model.float()` after `from_pretrained` |

Loud takeaway: **`trust_remote_code=True` models from HuggingFace are not
"just load it and go" engineering — they are research code with strong
implicit assumptions about transformers/torch versions, device init flow,
audio I/O backends, dtype propagation, and input chunking.** Budget time
accordingly for any future `trust_remote_code` engine.

### Auto-routing reverted

The spec's §6.3 proposed auto-routing `--language ru` → `gigaam`. After
running v7 (gigaam-v3) on the same 48-min PRD memo we'd benchmarked v5
(antony66) and v6 (bond005-turbo) against, **gigaam did not measurably
outperform antony66**:

| Metric                | v5 antony66 | v6 bond005 | v7 gigaam |
| --------------------- | ----------- | ---------- | --------- |
| Latin tech-words      | 16          | 19         | 19        |
| Unique-line ratio     | 97%         | 82%        | n/a (single-paragraph) |
| Readability           | sentence-segmented | over-fragmented | one huge paragraph     |
| "MCP" preservation    | "IMCP" (1 char drift) | exact            | exact                   |
| "permission"          | reasonable  | reasonable | bad transliteration loop ("Пир мишин", "Пир Мише") |
| "CRUD" → "крут"       | yes         | yes        | yes                     |

The Common Voice 19 ru WER claim of ~0.8% (gigaam) vs ~6.4% (antony66)
didn't transfer to this domain (hesitant brainstorming with English
acronyms). The single-paragraph output also makes the transcript harder
to skim than antony66's sentence-segmented output.

**Decision**: `resolveEngine()` reverted to always default to `mlx`. gigaam
stays opt-in via explicit `--engine gigaam`. Re-evaluate when:

1. **LLM post-correction** lands (a separate planned spec). gigaam's exact
   "MCP" + reduced false-acronyms might tip the balance after correction.
2. A **different recording type** is tested (cleaner speech, narrated
   content, less hesitation, less code-switching).
3. **GigaAM-v4** or community fine-tunes of gigaam-v3 surface with better
   conversational-Russian performance.

The `gigaam` engine is fully integrated and ready to use whenever any of
those conditions are met. Removing it would lose work — keeping it as a
selectable option costs nothing.

## 10. References

- GigaAM-v3 model card: <https://huggingface.co/ai-sage/GigaAM-v3>
- GigaAM GitHub + eval table: <https://github.com/salute-developers/GigaAM>
- GigaAM paper (InterSpeech 2025): <https://arxiv.org/abs/2506.01192>
- alphacephei 2025 Russian open-models comparison: <https://alphacephei.com/nsh/2025/04/18/russian-models.html>
- Russian ASR Leaderboard (Vikhrmodels): <https://huggingface.co/spaces/Vikhrmodels/Russian_ASR_Leaderboard>
- PEP 723 inline script dependencies: <https://peps.python.org/pep-0723/>
- uv scripts docs: <https://docs.astral.sh/uv/guides/scripts/>

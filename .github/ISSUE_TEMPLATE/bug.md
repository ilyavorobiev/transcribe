---
name: Bug report
about: Report a transcription or install bug
title: "[bug] "
labels: bug
assignees: ''
---

## Environment

- macOS version + chip (Apple Silicon M1/M2/M3/M4, or Intel):
- `bun --version`:
- `transcribe --version`:
- Engine: <!-- mlx | cpp | gigaam -->
- Model alias / repo: <!-- e.g. antony66-russian, large-v3, gigaam-v3 -->

## What I ran

```sh
transcribe <args>
```

## What happened

<!-- Paste the last ~20 lines of stderr. If the bug is "wrong transcript",
     include input language, expected text (1–2 sentences are enough), and
     what was produced. -->

## What I expected

<!-- One sentence. -->

## Workarounds I tried

- [ ] Reran with `--engine cpp` (or another engine)
- [ ] Reran with a different model (`--model large-v3-turbo`, etc.)
- [ ] Reran with `--language <code>`
- [ ] Ran `transcribe setup` to reinstall the model

## Reproducer

<!-- Tiny WAV/m4a (10–30 s) that reproduces the bug is the gold standard.
     Don't attach memos with personal content; trim with ffmpeg:
       ffmpeg -i input.m4a -ss 0 -t 30 -c copy clip.m4a
-->

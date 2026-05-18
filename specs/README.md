# specs

Technical specs for this project. Each subfolder is one self-contained piece
of work (an epic or version). The format is defined by
[`../guidelines/docs/spec.md`](../guidelines/docs/spec.md).

| Folder                                  | Status      | Summary                                                          |
| --------------------------------------- | ----------- | ---------------------------------------------------------------- |
| [`cli/`](./cli/spec.md)                 | implemented | Local CLI v0.1: `transcribe <file.m4a>` on macOS (whisper.cpp).  |
| [`publish/`](./publish/spec.md)         | proposed    | Public npm + GitHub release (`v0.1.0`).                          |
| [`mlx-russian/`](./mlx-russian/spec.md) | implemented | Add MLX engine alongside cpp; default to Russian fine-tune (~35% WER drop). |
| [`gigaam/`](./gigaam/spec.md)           | implemented | Add Sber GigaAM as third engine; auto-route Russian → gigaam (~5× WER drop). |

Each spec folder can hold related artifacts alongside `spec.md` (e.g.
`prd.md`, diagrams, decision notes, benchmark scripts).

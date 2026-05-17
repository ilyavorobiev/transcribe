import { expect, test } from "bun:test";
import { whisperArgv, defaultThreads, type CppArgs } from "./cpp.ts";

const base: CppArgs = {
  wavPath: "/tmp/x.wav",
  outputStem: "/out/x",
  modelFile: "/models/ggml-large-v3.bin",
  language: "ru",
  format: "txt",
  threads: 8,
};

test("whisperArgv full layout for txt", () => {
  expect(whisperArgv(base)).toEqual([
    "-m", "/models/ggml-large-v3.bin",
    "-l", "ru",
    "-t", "8",
    "-f", "/tmp/x.wav",
    "-of", "/out/x",
    "--print-progress",
    "-mc", "0",
    "-bs", "5",
    "-et", "2.6",
    "-fa",
    "--suppress-nst",
    "-otxt",
  ]);
});

test("whisperArgv includes anti-hallucination flags by default", () => {
  const argv = whisperArgv(base);
  const mc = argv.indexOf("-mc");
  expect(argv[mc + 1]).toBe("0");
  expect(argv).toContain("-bs");
  expect(argv).toContain("-et");
  expect(argv).toContain("-fa");
  expect(argv).toContain("--suppress-nst");
});

test("whisperArgv does NOT include -bo (redundant with -bs at T=0)", () => {
  expect(whisperArgv(base)).not.toContain("-bo");
});

test("whisperArgv appends VAD flags + tuned timings when vadModelFile is given", () => {
  const argv = whisperArgv({ ...base, vadModelFile: "/models/ggml-silero-v5.1.2.bin" });
  expect(argv).toContain("--vad");
  const m = argv.indexOf("--vad-model");
  expect(argv[m + 1]).toBe("/models/ggml-silero-v5.1.2.bin");
  expect(argv[argv.indexOf("--vad-min-silence-duration-ms") + 1]).toBe("500");
  expect(argv[argv.indexOf("--vad-speech-pad-ms") + 1]).toBe("300");
  expect(argv[argv.indexOf("--vad-max-speech-duration-s") + 1]).toBe("30");
});

test("whisperArgv omits VAD flags when vadModelFile is undefined", () => {
  const argv = whisperArgv(base);
  expect(argv).not.toContain("--vad");
  expect(argv).not.toContain("--vad-model");
});

test("whisperArgv appends --prompt when initialPrompt is set", () => {
  const argv = whisperArgv({ ...base, initialPrompt: "MCP, API. Эээ." });
  const p = argv.indexOf("--prompt");
  expect(argv[p + 1]).toBe("MCP, API. Эээ.");
});

test("whisperArgv emits one format flag per single format", () => {
  for (const [format, flag] of [
    ["txt", "-otxt"],
    ["srt", "-osrt"],
    ["vtt", "-ovtt"],
    ["json", "-oj"],
  ] as const) {
    const argv = whisperArgv({ ...base, format });
    const formatFlags = argv.filter((a) => ["-otxt", "-osrt", "-ovtt", "-oj"].includes(a));
    expect(formatFlags).toEqual([flag]);
  }
});

test("whisperArgv 'all' emits txt, srt, vtt, json flags", () => {
  const argv = whisperArgv({ ...base, format: "all" });
  expect(argv).toContain("-otxt");
  expect(argv).toContain("-osrt");
  expect(argv).toContain("-ovtt");
  expect(argv).toContain("-oj");
});

test("defaultThreads returns 1..8", () => {
  const n = defaultThreads();
  expect(n).toBeGreaterThanOrEqual(1);
  expect(n).toBeLessThanOrEqual(8);
});

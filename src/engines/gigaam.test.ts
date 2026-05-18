import { expect, test } from "bun:test";
import {
  gigaamArgv,
  GIGAAM_SUPPORTED_FORMATS,
  resolveGigaAmModel,
  type GigaAmArgs,
} from "./gigaam.ts";

const base: GigaAmArgs = {
  scriptPath: "/abs/scripts/gigaam_transcribe.py",
  audioPath: "/tmp/x.wav",
  outputStem: "/out/x",
  repo: "ai-sage/GigaAM-v3",
  revision: "e2e_rnnt",
  format: "txt",
};

test("gigaamArgv full layout for txt", () => {
  expect(gigaamArgv(base)).toEqual([
    "run",
    "--script",
    "/abs/scripts/gigaam_transcribe.py",
    "--audio", "/tmp/x.wav",
    "--output-stem", "/out/x",
    "--model-repo", "ai-sage/GigaAM-v3",
    "--revision", "e2e_rnnt",
    "--format", "txt",
  ]);
});

test("gigaamArgv passes through model repo + revision", () => {
  const argv = gigaamArgv({ ...base, repo: "some-other/repo", revision: "main" });
  const i = argv.indexOf("--model-repo");
  expect(argv[i + 1]).toBe("some-other/repo");
  const j = argv.indexOf("--revision");
  expect(argv[j + 1]).toBe("main");
});

test("gigaamArgv passes format through to --format", () => {
  for (const fmt of ["txt", "json"] as const) {
    const argv = gigaamArgv({ ...base, format: fmt });
    const i = argv.indexOf("--format");
    expect(argv[i + 1]).toBe(fmt);
  }
});

test("resolveGigaAmModel expands aliases to LOCAL paths (curl-downloaded by setup)", () => {
  const v3 = resolveGigaAmModel("gigaam-v3");
  expect(v3.repo).toMatch(/\/models\/gigaam-v3-e2e-rnnt$/);
  expect(v3.revision).toBe("main");

  const ctc = resolveGigaAmModel("gigaam-v3-ctc");
  expect(ctc.repo).toMatch(/\/models\/gigaam-v3-e2e-ctc$/);

  const v2 = resolveGigaAmModel("gigaam-v2");
  expect(v2.repo).toMatch(/\/models\/gigaam-v2$/);
});

test("resolveGigaAmModel passes raw HF repo ids through unchanged", () => {
  expect(resolveGigaAmModel("custom-user/custom-russian-asr")).toEqual({
    repo: "custom-user/custom-russian-asr",
    revision: "main",
  });
});

test("GIGAAM_SUPPORTED_FORMATS excludes srt/vtt/all (v1 limitation)", () => {
  expect(GIGAAM_SUPPORTED_FORMATS).toContain("txt");
  expect(GIGAAM_SUPPORTED_FORMATS).toContain("json");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("srt");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("vtt");
  expect(GIGAAM_SUPPORTED_FORMATS).not.toContain("all");
});

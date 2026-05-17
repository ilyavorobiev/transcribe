import { expect, test } from "bun:test";
import { ffmpegArgv } from "./audio.ts";

test("ffmpegArgv normalizes to 16kHz mono pcm_s16le", () => {
  expect(ffmpegArgv("/in/foo.m4a", "/out/foo.wav")).toEqual([
    "-y",
    "-i", "/in/foo.m4a",
    "-ar", "16000",
    "-ac", "1",
    "-c:a", "pcm_s16le",
    "/out/foo.wav",
  ]);
});

test("ffmpegArgv overwrites existing output (-y)", () => {
  const argv = ffmpegArgv("/a", "/b");
  expect(argv[0]).toBe("-y");
});

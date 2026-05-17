export type Format = "txt" | "srt" | "vtt" | "json" | "all";
export const FORMATS: readonly Format[] = ["txt", "srt", "vtt", "json", "all"];

export type EngineName = "mlx" | "cpp";
export const ENGINES: readonly EngineName[] = ["mlx", "cpp"];

export interface TranscribeOptions {
  inputPath: string;
  outputStem: string;
  model: string;
  language: string;
  format: Format;
  initialPrompt?: string;
  threads?: number;
  keepWav?: boolean;
}

export interface Engine {
  name: EngineName;
  transcribe(opts: TranscribeOptions): Promise<void>;
}

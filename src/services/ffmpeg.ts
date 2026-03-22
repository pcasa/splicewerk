import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import YAML from "yaml";
import type { FormatPreset } from "../edl/types.js";

const execFileAsync = promisify(execFile);

// ─── FFmpeg/FFprobe Path Resolution ──────────────────────────────────────────

const FFMPEG_SEARCH_PATHS = [
  "/opt/homebrew/bin/ffmpeg",
  "/usr/local/bin/ffmpeg",
  "/usr/bin/ffmpeg",
];

function resolveFFmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  for (const p of FFMPEG_SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }
  return "ffmpeg";
}

const FFMPEG_BIN = resolveFFmpegPath();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Result Type ───

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

// ─── Local Types ───

export interface SplitScreenOptions {
  layout?: "side-by-side" | "top-bottom";
  width?: number;
  height?: number;
}

export type TextPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface TextStyle {
  fontsize?: number;
  fontcolor?: string;
  fontfile?: string;
  box?: boolean;
  boxcolor?: string;
  boxborderw?: number;
}

// ─── Format Presets ───

interface RawFormat {
  label: string;
  width: number;
  height: number;
  fps?: number;
  aspect_ratio?: string;
  codec?: string;
  crf?: number;
  max_bitrate?: string;
  audio_bitrate?: string;
  pixel_format?: string;
  container?: string;
  max_duration?: number | null;
  crop_strategy?: string;
  notes?: string;
  format?: string;
  quality?: number;
}

function mapRawToPreset(raw: RawFormat): FormatPreset {
  return {
    label: raw.label,
    width: raw.width,
    height: raw.height,
    fps: raw.fps ?? 30,
    aspectRatio: raw.aspect_ratio ?? "16:9",
    codec: raw.codec ?? "h264",
    crf: raw.crf ?? 23,
    maxBitrate: raw.max_bitrate ?? "8M",
    audioBitrate: raw.audio_bitrate ?? "128k",
    pixelFormat: raw.pixel_format ?? "yuv420p",
    container: raw.container ?? "mp4",
    maxDuration: raw.max_duration ?? null,
    cropStrategy: (raw.crop_strategy as FormatPreset["cropStrategy"]) ?? "center",
    notes: raw.notes,
  };
}

let _cachedPresets: Record<string, FormatPreset> | null = null;

export function loadFormatPresets(): Record<string, FormatPreset> {
  if (_cachedPresets) return _cachedPresets;

  const yamlPath = join(__dirname, "../config/formats.yaml");
  const raw = readFileSync(yamlPath, "utf-8");
  const parsed = YAML.parse(raw) as { formats: Record<string, RawFormat> };

  const presets: Record<string, FormatPreset> = {};
  for (const [key, value] of Object.entries(parsed.formats)) {
    presets[key] = mapRawToPreset(value);
  }

  _cachedPresets = presets;
  return presets;
}

export function getFormatPreset(name: string): FormatPreset | undefined {
  const presets = loadFormatPresets();
  return presets[name];
}

// ─── Logger ───

function log(level: "info" | "debug", message: string, data?: Record<string, unknown>) {
  const entry = { level, message, ...data };
  if (level === "info") {
    console.log(JSON.stringify(entry));
  } else {
    if (process.env.DEBUG) {
      console.log(JSON.stringify(entry));
    }
  }
}

// ─── FFmpeg Runner ───

async function runFFmpeg(args: string[]): Promise<Result<string>> {
  log("info", "Running ffmpeg", { args });
  try {
    const { stdout, stderr } = await execFileAsync(FFMPEG_BIN, args);
    log("debug", "ffmpeg stdout", { stdout });
    log("debug", "ffmpeg stderr", { stderr });
    return { ok: true, value: stdout };
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string; code?: number };
    const message = error.stderr ?? error.message ?? "Unknown ffmpeg error";
    log("info", "ffmpeg failed", { error: message });
    return { ok: false, error: message };
  }
}

// ─── Functions ───

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function isImageFile(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return IMAGE_EXTENSIONS.has(`.${ext}`);
}

export async function imageToClip(
  input: string,
  durationSec: number,
  output: string,
  width = 1920,
  height = 1080
): Promise<Result<string>> {
  log("info", "imageToClip", { input, durationSec, output });

  const args = [
    "-y",
    "-loop", "1",
    "-i", input,
    "-t", String(durationSec),
    "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
    "-c:v", "h264_videotoolbox",
    "-allow_sw", "1",
    "-pix_fmt", "yuv420p",
    "-r", "30",
    output,
  ];

  return runFFmpeg(args);
}

export async function trimClip(
  input: string,
  startSec: number,
  endSec: number,
  output: string
): Promise<Result<string>> {
  log("info", "trimClip", { input, startSec, endSec, output });

  const args = [
    "-y",
    "-ss", String(startSec),
    "-to", String(endSec),
    "-i", input,
    "-c:v", "h264_videotoolbox",
    "-allow_sw", "1",
    "-c:a", "aac",
    output,
  ];

  return runFFmpeg(args);
}

export async function concatClips(
  inputs: string[],
  output: string
): Promise<Result<string>> {
  log("info", "concatClips", { inputs, output });

  // Write temp concat file — use absolute paths so ffmpeg can find them from /tmp
  const concatFile = join(tmpdir(), `splicewerk-concat-${Date.now()}.txt`);
  const lines = inputs.map((f) => `file '${resolve(f)}'`).join("\n");
  log("info", "concatClips file list", { concatFile, lines });
  writeFileSync(concatFile, lines, "utf-8");

  const args = [
    "-y",
    "-f", "concat",
    "-safe", "0",
    "-i", concatFile,
    "-c:v", "h264_videotoolbox",
    "-allow_sw", "1",
    "-c:a", "aac",
    output,
  ];

  const result = await runFFmpeg(args);

  try {
    unlinkSync(concatFile);
  } catch {
    // ignore cleanup error
  }

  return result;
}

export async function splitScreen(
  left: string,
  right: string,
  output: string,
  options?: SplitScreenOptions
): Promise<Result<string>> {
  const layout = options?.layout ?? "side-by-side";
  const width = options?.width ?? 1920;
  const height = options?.height ?? 1080;

  log("info", "splitScreen", { left, right, output, layout, width, height });

  let filterComplex: string;

  if (layout === "side-by-side") {
    const halfW = Math.floor(width / 2);
    filterComplex = [
      `[0:v]scale=${halfW}:${height}[left]`,
      `[1:v]scale=${halfW}:${height}[right]`,
      `[left][right]hstack=inputs=2[v]`,
    ].join(";");
  } else {
    // top-bottom
    const halfH = Math.floor(height / 2);
    filterComplex = [
      `[0:v]scale=${width}:${halfH}[top]`,
      `[1:v]scale=${width}:${halfH}[bottom]`,
      `[top][bottom]vstack=inputs=2[v]`,
    ].join(";");
  }

  const args = [
    "-y",
    "-i", left,
    "-i", right,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "0:a?",
    "-c:v", "h264_videotoolbox",
    "-c:a", "aac",
    output,
  ];

  return runFFmpeg(args);
}

export async function crossfade(
  clipA: string,
  clipB: string,
  durationSec: number,
  output: string
): Promise<Result<string>> {
  log("info", "crossfade", { clipA, clipB, durationSec, output });

  // xfade requires knowing the duration of clipA to compute offset
  // We use a filter_complex with xfade + acrossfade
  const filterComplex = [
    `[0:v][1:v]xfade=transition=fade:duration=${durationSec}:offset=0[v]`,
    `[0:a][1:a]acrossfade=d=${durationSec}[a]`,
  ].join(";");

  const args = [
    "-y",
    "-i", clipA,
    "-i", clipB,
    "-filter_complex", filterComplex,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "h264_videotoolbox",
    "-c:a", "aac",
    output,
  ];

  return runFFmpeg(args);
}

function resolveTextPosition(position: TextPosition): string {
  const map: Record<TextPosition, string> = {
    "top-left": "x=10:y=10",
    "top-center": "x=(w-text_w)/2:y=10",
    "top-right": "x=w-text_w-10:y=10",
    center: "x=(w-text_w)/2:y=(h-text_h)/2",
    "bottom-left": "x=10:y=h-text_h-10",
    "bottom-center": "x=(w-text_w)/2:y=h-text_h-10",
    "bottom-right": "x=w-text_w-10:y=h-text_h-10",
  };
  return map[position];
}

export async function addTextOverlay(
  input: string,
  text: string,
  position: TextPosition,
  style: TextStyle,
  output: string
): Promise<Result<string>> {
  log("info", "addTextOverlay", { input, text, position, output });

  const posExpr = resolveTextPosition(position);
  const escapedText = text.replace(/'/g, "\\'").replace(/:/g, "\\:");

  const drawtextParts: string[] = [`text='${escapedText}'`, posExpr];

  if (style.fontsize !== undefined) drawtextParts.push(`fontsize=${style.fontsize}`);
  if (style.fontcolor !== undefined) drawtextParts.push(`fontcolor=${style.fontcolor}`);
  if (style.fontfile !== undefined) drawtextParts.push(`fontfile='${style.fontfile}'`);
  if (style.box === true) drawtextParts.push("box=1");
  if (style.boxcolor !== undefined) drawtextParts.push(`boxcolor=${style.boxcolor}`);
  if (style.boxborderw !== undefined) drawtextParts.push(`boxborderw=${style.boxborderw}`);

  const filterComplex = `drawtext=${drawtextParts.join(":")}`;

  const args = [
    "-y",
    "-i", input,
    "-vf", filterComplex,
    "-c:v", "h264_videotoolbox",
    "-c:a", "aac",
    output,
  ];

  return runFFmpeg(args);
}

export async function mixAudio(
  videoInput: string,
  audioInput: string,
  volumes: { video: number; audio: number },
  output: string
): Promise<Result<string>> {
  log("info", "mixAudio", { videoInput, audioInput, volumes, output });

  const filterComplex = [
    `[0:a]volume=${volumes.video}[va]`,
    `[1:a]volume=${volumes.audio}[aa]`,
    `[va][aa]amix=inputs=2:duration=first[a]`,
  ].join(";");

  const args = [
    "-y",
    "-i", videoInput,
    "-i", audioInput,
    "-filter_complex", filterComplex,
    "-map", "0:v",
    "-map", "[a]",
    "-c:v", "copy",
    "-c:a", "aac",
    output,
  ];

  return runFFmpeg(args);
}

export async function reformat(
  input: string,
  formatName: string,
  output: string
): Promise<Result<string>> {
  log("info", "reformat", { input, formatName, output });

  const preset = getFormatPreset(formatName);
  if (!preset) {
    return { ok: false, error: `Unknown format preset: ${formatName}` };
  }

  const vfParts: string[] = [];

  // Scale and crop based on crop strategy
  if (preset.cropStrategy === "center") {
    // Scale to fill, then crop to target dimensions
    vfParts.push(
      `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=increase`,
      `crop=${preset.width}:${preset.height}`
    );
  } else if (preset.cropStrategy === "letterbox") {
    vfParts.push(
      `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease`,
      `pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2:black`
    );
  } else {
    vfParts.push(`scale=${preset.width}:${preset.height}`);
  }

  vfParts.push(`fps=${preset.fps}`);
  vfParts.push(`format=${preset.pixelFormat}`);

  const args = [
    "-y",
    "-i", input,
    "-vf", vfParts.join(","),
    "-c:v", "h264_videotoolbox",
    "-c:a", "aac",
    "-b:a", preset.audioBitrate,
    "-pix_fmt", preset.pixelFormat,
    output,
  ];

  return runFFmpeg(args);
}

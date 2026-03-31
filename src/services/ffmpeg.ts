import { execFile } from "child_process";
import { existsSync } from "fs";
import { promisify } from "util";
import { readFileSync, writeFileSync, unlinkSync } from "fs";
import { mkdir, readdir, rm, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { randomUUID } from "node:crypto";
import YAML from "yaml";
import sharp from "sharp";
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

const FFPROBE_SEARCH_PATHS = [
  "/opt/homebrew/bin/ffprobe",
  "/usr/local/bin/ffprobe",
  "/usr/bin/ffprobe",
];

function resolveFFprobePath(): string {
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  for (const p of FFPROBE_SEARCH_PATHS) {
    if (existsSync(p)) return p;
  }
  return "ffprobe";
}

const FFPROBE_BIN = resolveFFprobePath();

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

// ─── Encoder Selection ───

function chooseEncoder(): string {
  // Prefer Apple VideoToolbox hardware encoder on macOS; fall back to libx264
  return process.platform === "darwin" ? "h264_videotoolbox" : "libx264";
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
    const { stdout, stderr } = await execFileAsync(FFMPEG_BIN, args, { maxBuffer: 10 * 1024 * 1024 });
    log("debug", "ffmpeg stdout", { stdout });
    log("debug", "ffmpeg stderr", { stderr });
    return { ok: true, value: stdout };
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string; code?: number | string };
    const message = error.stderr ?? error.message ?? "Unknown ffmpeg error";
    log("info", "ffmpeg failed", { error: message, code: (error as { code?: unknown }).code });
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

  // Use filter_complex concat instead of the concat demuxer.
  // The demuxer requires identical stream parameters across all inputs (same
  // codec, fps, sample rate) — clips from different sources always mismatch.
  // filter_complex concat normalizes everything in a single pass.
  const inputArgs = inputs.flatMap((f) => ["-i", resolve(f)]);
  const filterStreams = inputs.map((_, i) => `[${i}:v][${i}:a]`).join("");
  const filterComplex = `${filterStreams}concat=n=${inputs.length}:v=1:a=1[vout][aout]`;

  const args = [
    "-y",
    ...inputArgs,
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", "[aout]",
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-ar", "44100",
    "-ac", "2",
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

/**
 * Renders text into a transparent PNG via SVG + Sharp.
 * No libfreetype or system font paths required.
 */
async function makeTextOverlay(
  text: string,
  width: number,
  height: number,
  fontSize = 80,
  fill = "#fff"
): Promise<{ overlayPath: string; requestDir: string }> {
  const requestDir = join(tmpdir(), `splicewerk-${randomUUID()}`);
  await mkdir(requestDir, { recursive: true });
  const overlayPath = join(requestDir, "overlay.png");
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <text
      x="${width / 2}" y="${height / 2}"
      dominant-baseline="middle" text-anchor="middle"
      font-family="Arial, Helvetica, sans-serif"
      font-size="${fontSize}"
      fill="${fill}"
      letter-spacing="4"
    >${escaped}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(overlayPath);
  return { overlayPath, requestDir };
}

/**
 * Generate a title card: text rendered via SVG/Sharp overlaid on a solid background.
 * No drawtext or libfreetype required.
 */
export async function generateTitleCard(
  text: string,
  durationSec: number,
  output: string,
  width = 1920,
  height = 1080,
  opts?: { fontSize?: number; color?: string; bgColor?: string }
): Promise<Result<string>> {
  log("info", "generateTitleCard", { text, durationSec, output });

  const { overlayPath, requestDir } = await makeTextOverlay(text, width, height, opts?.fontSize ?? 80, opts?.color ?? "#fff");
  const encoder = chooseEncoder();

  const args = [
    "-y",
    "-f", "lavfi",
    "-i", `color=c=${opts?.bgColor ?? "black"}:s=${width}x${height}:r=30:d=${durationSec}`,
    "-i", overlayPath,
    "-filter_complex", "[0:v][1:v]overlay=0:0",
    "-c:v", encoder,
    "-allow_sw", "1",
    "-pix_fmt", "yuv420p",
    "-t", String(durationSec),
    output,
  ];

  try {
    return await runFFmpeg(args);
  } finally {
    await rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Returns true if the local ffmpeg was built with --enable-libvidstab.
 */
async function isVidstabSupported(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(FFMPEG_BIN, ["-filters"], { timeout: 5000 })
    return stdout.includes("vidstab")
  } catch {
    return false
  }
}

/**
 * Stabilize a shaky video clip using the vidstab filter (two-pass).
 * Falls back to copying the source untouched if vidstab is not available.
 */
export async function stabilizeClip(
  input: string,
  output: string,
  opts?: { smoothing?: number; shakiness?: number }
): Promise<Result<string>> {
  log("info", "stabilizeClip", { input, output, opts });

  if (!(await isVidstabSupported())) {
    log("info", "stabilizeClip: vidstab not available, returning source as-is")
    return { ok: true, value: input }
  }

  const trfPath = output + ".vidstab.trf";

  // Pass 1 — motion detection
  const detectArgs = [
    "-y",
    "-i", input,
    "-vf", `vidstabdetect=result=${trfPath}:shakiness=${opts?.shakiness ?? 5}:accuracy=15`,
    "-f", "null", "-",
  ];
  const detectRes = await runFFmpeg(detectArgs);
  if (!detectRes.ok) return detectRes;

  // Pass 2 — stabilization transform
  // optzoom=0: do NOT auto-zoom — auto-zoom upscales the frame to hide borders
  // which causes visible pixelation on phone footage. Small black borders are
  // far less noticeable than a soft/pixelated image.
  const transformArgs = [
    "-y",
    "-i", input,
    "-vf", `vidstabtransform=input=${trfPath}:smoothing=${opts?.smoothing ?? 5}:zoom=0:optzoom=0`,
    "-c:v", "libx264",
    "-crf", "18",
    "-preset", "fast",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    output,
  ];
  const transformRes = await runFFmpeg(transformArgs);

  try { await unlink(trfPath); } catch { /* ignore */ }
  return transformRes;
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

// ─── applyEffects ───

export interface EffectsOptions {
  /** Contrast boost, default 1.15 (1.0 = no change) */
  contrast?: number
  /** Glow intensity 0–1, default 0.25 */
  glow?: number
  /** Colour grade: 'teal-orange' | 'cool' | 'warm' | none */
  grade?: 'teal-orange' | 'cool' | 'warm' | 'none'
}

export async function applyEffects(
  inputPath: string,
  outputPath: string,
  options: EffectsOptions = {}
): Promise<Result<string>> {
  log("info", "applyEffects", { inputPath, outputPath, options });

  const contrast = options.contrast ?? 1.15;
  const glow = options.glow ?? 0.25;
  const grade = options.grade ?? 'teal-orange';

  const filters: string[] = [];

  if (contrast !== 1.0) {
    filters.push(`eq=contrast=${contrast}`);
  }

  if (glow !== 0) {
    filters.push(`unsharp=5:5:${glow * 2}:5:5:0`);
  }

  if (grade === 'teal-orange') {
    filters.push(`curves=r='0/0 0.5/0.45 1/1':g='0/0 0.5/0.5 1/1':b='0/0 0.5/0.55 1/1'`);
  } else if (grade === 'cool') {
    filters.push(`colorbalance=bs=0.1`);
  } else if (grade === 'warm') {
    filters.push(`colorbalance=rs=0.1`);
  }

  try {
    if (filters.length === 0) {
      const args = ["-y", "-i", inputPath, "-c", "copy", "-c:a", "copy", outputPath];
      await execFileAsync(FFMPEG_BIN, args);
    } else {
      const args = ["-y", "-i", inputPath, "-vf", filters.join(","), "-c:a", "copy", outputPath];
      await execFileAsync(FFMPEG_BIN, args);
    }
    return { ok: true, value: outputPath };
  } catch (err: unknown) {
    const error = err as { message?: string; stderr?: string };
    const message = error.stderr ?? error.message ?? "Unknown ffmpeg error";
    return { ok: false, error: message };
  }
}

// ─── Frame Extraction ───

export async function extractFrames(
  videoPath: string,
  intervalSeconds: number,
  outputDir: string
): Promise<Result<string[]>> {
  log("info", "extractFrames", { videoPath, intervalSeconds, outputDir });

  try {
    await mkdir(outputDir, { recursive: true });
  } catch (err: unknown) {
    const error = err as { message?: string };
    return { ok: false, error: error.message ?? "Failed to create output directory" };
  }

  const args = [
    "-y",
    "-i", videoPath,
    "-vf", `fps=1/${intervalSeconds}`,
    "-q:v", "2",
    `${outputDir}/frame_%04d.jpg`,
  ];

  const ffmpegResult = await runFFmpeg(args);
  if (!ffmpegResult.ok) return ffmpegResult;

  try {
    const entries = await readdir(outputDir);
    const frames = entries
      .filter((f) => f.endsWith(".jpg"))
      .sort()
      .map((f) => `${outputDir}/${f}`);
    return { ok: true, value: frames };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return { ok: false, error: error.message ?? "Failed to read output directory" };
  }
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

// ─── getVideoDuration ─────────────────────────────────────────────────────────

export async function getVideoDuration(input: string): Promise<Result<number>> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      input,
    ], { timeout: 15000 });
    const data = JSON.parse(stdout) as { format?: { duration?: string } };
    const dur = parseFloat(data.format?.duration ?? "0");
    if (!dur) return { ok: false, error: "Could not read video duration" };
    return { ok: true, value: dur };
  } catch (err: unknown) {
    const error = err as { message?: string };
    return { ok: false, error: error.message ?? "ffprobe failed" };
  }
}

// ─── addFade ──────────────────────────────────────────────────────────────────

export async function addFade(
  input: string,
  output: string,
  fadeInSec = 1,
  fadeOutSec = 1
): Promise<Result<string>> {
  log("info", "addFade", { input, output, fadeInSec, fadeOutSec });

  const durRes = await getVideoDuration(input);
  if (!durRes.ok) return durRes;
  const duration = durRes.value;
  const fadeOutStart = Math.max(0, duration - fadeOutSec).toFixed(3);

  return runFFmpeg([
    "-y", "-i", input,
    "-vf", `fade=t=in:st=0:d=${fadeInSec},fade=t=out:st=${fadeOutStart}:d=${fadeOutSec}`,
    "-c:v", chooseEncoder(),
    "-allow_sw", "1",
    "-c:a", "aac",
    output,
  ]);
}

// ─── analyzeFrameBrightness ───────────────────────────────────────────────────

/**
 * Returns average luminance (0–255) of a video frame at timeSec.
 * Use to decide whether overlaid text needs a dark background box for legibility:
 *   brightness > 128 → light background, add dark box
 *   brightness <= 128 → dark background, text is fine as-is
 */
export async function analyzeFrameBrightness(
  videoPath: string,
  timeSec = 0
): Promise<Result<number>> {
  log("info", "analyzeFrameBrightness", { videoPath, timeSec });

  const requestDir = join(tmpdir(), `splicewerk-bright-${randomUUID()}`);
  await mkdir(requestDir, { recursive: true });
  const framePath = join(requestDir, "frame.png");

  try {
    const extractRes = await runFFmpeg([
      "-y",
      "-ss", String(timeSec),
      "-i", videoPath,
      "-frames:v", "1",
      "-q:v", "2",
      framePath,
    ]);
    if (!extractRes.ok) return extractRes;

    const { data, info } = await sharp(framePath)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    let total = 0;
    for (let i = 0; i < data.length; i++) total += data[i]!;
    const avg = total / (info.width * info.height);
    return { ok: true, value: Math.round(avg) };
  } finally {
    await rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── generateScrollingTitleCard ───────────────────────────────────────────────

export interface ScrollingTitleCardOptions {
  width?: number;
  height?: number;
  fontSize?: number;
  color?: string;
  bgColor?: string;
  lineSpacing?: number;
}

export async function generateScrollingTitleCard(
  lines: string[],
  durationSec: number,
  output: string,
  opts?: ScrollingTitleCardOptions
): Promise<Result<string>> {
  log("info", "generateScrollingTitleCard", { lines, durationSec, output });

  const W = opts?.width ?? 1920;
  const H = opts?.height ?? 1080;
  const fontSize = opts?.fontSize ?? 72;
  const color = opts?.color ?? "#F7F6F5";
  const bgColor = opts?.bgColor ?? "#2A2A2A";
  const lineSpacing = opts?.lineSpacing ?? 120;
  const textHeight = lines.length * lineSpacing;

  const svgLines = lines.map((line, i) => {
    const escaped = line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<text
      x="${W / 2}" y="${lineSpacing / 2 + i * lineSpacing}"
      dominant-baseline="middle" text-anchor="middle"
      font-family="Arial Black, Arial, Helvetica, sans-serif"
      font-size="${fontSize}" font-weight="800"
      fill="${color}" letter-spacing="3"
    >${escaped}</text>`;
  }).join("\n");

  const svg = `<svg width="${W}" height="${textHeight}" xmlns="http://www.w3.org/2000/svg">
    ${svgLines}
  </svg>`;

  const requestDir = join(tmpdir(), `splicewerk-scroll-${randomUUID()}`);
  await mkdir(requestDir, { recursive: true });
  const textPngPath = join(requestDir, "scroll-text.png");

  // Enforce a minimum readable duration — short durations make text unreadable
  const effectiveDuration = Math.max(durationSec, 8);

  try {
    await sharp(Buffer.from(svg)).png().toFile(textPngPath);

    // Scroll text upward at a fixed comfortable reading speed (~80px/s).
    // Text starts at the bottom edge of the frame (immediately visible) and
    // exits above the top. Total scroll distance = H + textHeight pixels.
    // Speed is fixed — we use effectiveDuration as the video length but derive
    // the scroll endpoint from pixels-per-second rather than fitting to duration.
    const scrollPxPerSec = 80;
    const totalScrollPx = H + textHeight;
    const scrollDuration = totalScrollPx / scrollPxPerSec; // actual time to scroll fully
    // y starts at bottom of frame, scrolls up
    const yExpr = `(main_h-overlay_h)-(${scrollPxPerSec}*t)`;
    const bgColorHex = bgColor.replace("#", "0x");

    // Use scrollDuration as the source length so the text fully exits the frame.
    // effectiveDuration caps the output if shorter than the full scroll.
    const videoDuration = Math.max(effectiveDuration, scrollDuration);
    // Include a silent audio track so this segment is stream-compatible with
    // audio-bearing clips during concat (mismatched streams break ffmpeg concat).
    return await runFFmpeg([
      "-y",
      "-f", "lavfi",
      "-i", `color=c=${bgColorHex}:s=${W}x${H}:r=30:d=${videoDuration}`,
      "-i", textPngPath,
      "-f", "lavfi",
      "-i", `anullsrc=r=44100:cl=stereo:d=${videoDuration}`,
      "-filter_complex", `[1:v]setpts=PTS-STARTPTS[txt];[0:v][txt]overlay=x=(main_w-overlay_w)/2:y='${yExpr}'[vout]`,
      "-map", "[vout]",
      "-map", "2:a",
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-c:a", "aac",
      "-ar", "44100",
      "-ac", "2",
      "-pix_fmt", "yuv420p",
      output,
    ]);
  } finally {
    await rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── generateAudioSting ───────────────────────────────────────────────────────

export async function generateAudioSting(
  output: string,
  durationSec = 1.5
): Promise<Result<string>> {
  log("info", "generateAudioSting", { output, durationSec });

  // Rising-frequency engine-rev tone: freq sweeps up while amplitude rises fast then decays
  const expr = `sin(2*PI*(80+200*t)*t)*min(1,t*8)*exp(-t*2.0)`;

  return runFFmpeg([
    "-y",
    "-f", "lavfi",
    "-i", `aevalsrc=${expr}:s=44100:c=stereo:d=${durationSec}`,
    "-c:a", "aac",
    "-b:a", "192k",
    output,
  ]);
}

// ─── generateEndCard ──────────────────────────────────────────────────────────

export interface EndCardOptions {
  titleText: string;
  statsText: string;
  output: string;
  brand?: {
    primary?: string;     // Autobahn Red  — default #E02828
    secondary?: string;   // Turbo Orange  — default #F46E2C
    text?: string;        // Off White     — default #F7F6F5
    background?: string;  // Graphite Gray — default #2A2A2A
  };
  durationSec?: number;
  audioStingPath?: string;
  width?: number;
  height?: number;
}

export async function generateEndCard(opts: EndCardOptions): Promise<Result<string>> {
  log("info", "generateEndCard", { titleText: opts.titleText, statsText: opts.statsText, output: opts.output });

  const W = opts.width ?? 1920;
  const H = opts.height ?? 1080;
  const dur = opts.durationSec ?? 4;
  const primary = opts.brand?.primary ?? "#E02828";
  const secondary = opts.brand?.secondary ?? "#F46E2C";
  const textColor = opts.brand?.text ?? "#F7F6F5";
  const bg = opts.brand?.background ?? "#2A2A2A";

  const requestDir = join(tmpdir(), `splicewerk-endcard-${randomUUID()}`);
  await mkdir(requestDir, { recursive: true });

  try {
    // ── 1. Background: graphite + radial speed lines ───────────────────────
    const cx = W / 2;
    const cy = H / 2;
    const lineLength = Math.sqrt(cx * cx + cy * cy) * 1.25;
    const speedLines = Array.from({ length: 28 }, (_, i) => {
      const angle = (i / 28) * 2 * Math.PI;
      const x2 = (cx + lineLength * Math.cos(angle)).toFixed(1);
      const y2 = (cy + lineLength * Math.sin(angle)).toFixed(1);
      const strokeW = (1 + (i % 3) * 0.8).toFixed(1);
      const opacity = (0.15 + (i % 5) * 0.05).toFixed(2);
      return `<line x1="${cx}" y1="${cy}" x2="${x2}" y2="${y2}" stroke="${secondary}" stroke-width="${strokeW}" opacity="${opacity}"/>`;
    }).join("\n");

    const bgSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${W}" height="${H}" fill="${bg}"/>
      <g>${speedLines}</g>
    </svg>`;
    const bgPath = join(requestDir, "bg.png");
    await sharp(Buffer.from(bgSvg)).png().toFile(bgPath);

    // ── 2. Title text PNG (centered, upper half) ──────────────────────────
    const titleEsc = opts.titleText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const titleSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <text x="${W / 2}" y="${H / 2 - 90}"
        dominant-baseline="middle" text-anchor="middle"
        font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="96" font-weight="900"
        fill="${textColor}" letter-spacing="8"
      >${titleEsc}</text>
    </svg>`;
    const titlePath = join(requestDir, "title.png");
    await sharp(Buffer.from(titleSvg)).png().toFile(titlePath);

    // ── 3. Stats text PNG with glow (centered, lower half) ────────────────
    const statsEsc = opts.statsText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const statsSvg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <filter id="glow" x="-15%" y="-50%" width="130%" height="200%">
          <feGaussianBlur stdDeviation="10" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <text x="${W / 2}" y="${H / 2 + 90}"
        dominant-baseline="middle" text-anchor="middle"
        font-family="Arial Black, Arial, Helvetica, sans-serif"
        font-size="80" font-weight="900"
        fill="${primary}" letter-spacing="4"
        filter="url(#glow)"
      >${statsEsc}</text>
    </svg>`;
    const statsPath = join(requestDir, "stats.png");
    await sharp(Buffer.from(statsSvg)).png().toFile(statsPath);

    // ── 4. Audio sting ─────────────────────────────────────────────────────
    const stingPath = opts.audioStingPath ?? join(requestDir, "sting.aac");
    if (!opts.audioStingPath) {
      const stingRes = await generateAudioSting(stingPath, 1.5);
      if (!stingRes.ok) log("info", "audio sting generation failed — proceeding without audio", { error: stingRes.error });
    }
    const hasAudio = existsSync(stingPath);

    // ── 5+6. Single-pass composite + audio ────────────────────────────────────
    // Build everything in one ffmpeg invocation so there is no intermediate
    // temp file that could be cleaned up before a second ffmpeg process opens it.
    //
    // Input layout:
    //   0  lavfi color  (video timing source)
    //   1  bgPath PNG
    //   2  titlePath PNG
    //   3  statsPath PNG
    //   4  lavfi anullsrc (silence base — always present)
    //   5  stingPath AAC (only when hasAudio)
    const bgColorHex = bg.replace("#", "0x");

    const videoFilter = [
      `[0:v]setsar=1[base]`,
      `[base][1:v]overlay=0:0[with_bg]`,
      `[2:v]fade=t=in:st=0:d=0.8:alpha=1[title_in]`,
      `[with_bg][title_in]overlay=0:0[with_title]`,
      `[3:v]fade=t=in:st=0.5:d=0.2:alpha=1[stats_in]`,
      `[with_title][stats_in]overlay=0:0[v2]`,
      `[v2]fade=t=out:st=${dur - 1}:d=1[vout]`,
    ];
    const audioFilter = hasAudio
      ? [`[5:a]adelay=500|500[sting_delayed]`, `[4:a][sting_delayed]amix=inputs=2:duration=first,alimiter=limit=0.9[aout]`]
      : [`[4:a]acopy[aout]`];

    const args: string[] = [
      "-y",
      "-f", "lavfi", "-i", `color=c=${bgColorHex}:s=${W}x${H}:r=30:d=${dur}`,
      "-loop", "1", "-t", String(dur), "-i", bgPath,
      "-loop", "1", "-t", String(dur), "-i", titlePath,
      "-loop", "1", "-t", String(dur), "-i", statsPath,
      "-f", "lavfi", "-i", `anullsrc=r=44100:cl=stereo:d=${dur}`,
      ...(hasAudio ? ["-i", stingPath] : []),
      "-filter_complex", [...videoFilter, ...audioFilter].join(";"),
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-crf", "18",
      "-preset", "fast",
      "-c:a", "aac",
      "-pix_fmt", "yuv420p",
      "-t", String(dur),
      opts.output,
    ];

    return await runFFmpeg(args);
  } finally {
    await rm(requestDir, { recursive: true, force: true }).catch(() => {});
  }
}

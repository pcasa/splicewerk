import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type sharp from "sharp";
import { AssetFile, AssetManifest } from "../edl/types.js";

// Promisify execFile for async/await usage
const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────────────

type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  r_frame_rate?: string;
}

interface FfprobeFormat {
  duration?: string;
  size?: string;
  tags?: {
    creation_time?: string;
  };
}

interface FfprobeOutput {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv"]);

// ─── FFprobe Path Resolution ──────────────────────────────────────────────────

const FFPROBE_SEARCH_PATHS = [
  "/opt/homebrew/bin/ffprobe",   // macOS Apple Silicon (Homebrew)
  "/usr/local/bin/ffprobe",      // macOS Intel (Homebrew)
  "/usr/bin/ffprobe",            // Linux system install
];

function resolveFfprobePath(): string {
  // Prefer explicit env override
  if (process.env.FFPROBE_PATH) return process.env.FFPROBE_PATH;
  for (const candidate of FFPROBE_SEARCH_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // Fallback: rely on PATH (may fail if not found)
  return "ffprobe";
}

const FFPROBE_BIN = resolveFfprobePath();
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".aac", ".m4a"]);

function getAssetType(ext: string): "video" | "image" | "audio" | null {
  const lower = ext.toLowerCase();
  if (VIDEO_EXTENSIONS.has(lower)) return "video";
  if (IMAGE_EXTENSIONS.has(lower)) return "image";
  if (AUDIO_EXTENSIONS.has(lower)) return "audio";
  return null;
}

// ─── FPS Parsing ─────────────────────────────────────────────────────────────

function parseFps(rFrameRate: string): number | undefined {
  // r_frame_rate is expressed as "numerator/denominator", e.g. "30/1" or "2997/100"
  const parts = rFrameRate.split("/");
  if (parts.length !== 2) return undefined;
  const num = parseFloat(parts[0]);
  const den = parseFloat(parts[1]);
  if (!den || isNaN(num) || isNaN(den)) return undefined;
  return Math.round((num / den) * 1000) / 1000;
}

// ─── FFprobe ─────────────────────────────────────────────────────────────────

async function runFfprobe(
  filePath: string
): Promise<Result<FfprobeOutput>> {
  try {
    const { stdout } = await execFileAsync(FFPROBE_BIN, [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_streams",
      "-show_format",
      filePath,
    ]);
    const parsed: unknown = JSON.parse(stdout);
    return { ok: true, value: parsed as FfprobeOutput };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `ffprobe failed: ${message}` };
  }
}

function extractFromFfprobe(
  ffprobeData: FfprobeOutput,
  type: "video" | "audio"
): Partial<AssetFile> {
  const result: Partial<AssetFile> = {};

  const format = ffprobeData.format;
  if (format) {
    if (format.duration !== undefined) {
      const dur = parseFloat(format.duration);
      if (!isNaN(dur)) result.duration = dur;
    }
    if (format.size !== undefined) {
      const size = parseInt(format.size, 10);
      if (!isNaN(size)) result.fileSize = size;
    }
    if (format.tags?.creation_time) {
      result.createdAt = format.tags.creation_time;
    }
  }

  if (type === "video" && ffprobeData.streams) {
    const videoStream = ffprobeData.streams.find(
      (s) => s.codec_type === "video"
    );
    if (videoStream) {
      if (videoStream.codec_name) result.codec = videoStream.codec_name;
      if (videoStream.width !== undefined) result.width = videoStream.width;
      if (videoStream.height !== undefined) result.height = videoStream.height;
      if (videoStream.r_frame_rate) {
        const fps = parseFps(videoStream.r_frame_rate);
        if (fps !== undefined) result.fps = fps;
      }
    }
  }

  return result;
}

// ─── Image Metadata (via sharp) ───────────────────────────────────────────────

// We import sharp dynamically so tests can easily mock it
async function extractImageMeta(
  filePath: string
): Promise<Result<Partial<AssetFile>>> {
  try {
    // Dynamic import so mocking in tests is straightforward
    const sharpModule = (await import("sharp")) as { default: typeof sharp };
    const sharpFn = sharpModule.default;
    const metadata = await sharpFn(filePath).metadata();
    const stat = fs.statSync(filePath);
    const result: Partial<AssetFile> = {
      fileSize: stat.size,
    };
    if (metadata.width !== undefined) result.width = metadata.width;
    if (metadata.height !== undefined) result.height = metadata.height;
    return { ok: true, value: result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `sharp failed: ${message}` };
  }
}

// ─── probeFile ────────────────────────────────────────────────────────────────

/**
 * Probes a single file and returns partial AssetFile metadata.
 * Returns partial data even on probe errors (graceful degradation).
 */
export async function probeFile(
  filePath: string
): Promise<Partial<AssetFile>> {
  const ext = path.extname(filePath);
  const type = getAssetType(ext);

  if (type === null) {
    console.debug(`[asset-catalog] Skipping unsupported file: ${filePath}`);
    return {};
  }

  if (type === "image") {
    const imageResult = await extractImageMeta(filePath);
    if (!imageResult.ok) {
      console.debug(
        `[asset-catalog] Image probe error for ${filePath}: ${imageResult.error}`
      );
      // Return fileSize from stat as fallback
      try {
        const stat = fs.statSync(filePath);
        return { fileSize: stat.size };
      } catch {
        return {};
      }
    }
    return imageResult.value;
  }

  // video or audio — use ffprobe
  const ffprobeResult = await runFfprobe(filePath);
  if (!ffprobeResult.ok) {
    console.debug(
      `[asset-catalog] ffprobe error for ${filePath}: ${ffprobeResult.error}`
    );
    // Graceful degradation: try to get fileSize from stat
    try {
      const stat = fs.statSync(filePath);
      return { fileSize: stat.size };
    } catch {
      return {};
    }
  }

  return extractFromFfprobe(ffprobeResult.value, type);
}

// ─── Directory Scanning ───────────────────────────────────────────────────────

function scanDirectory(dirPath: string): string[] {
  const results: string[] = [];

  function recurse(current: string): void {
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        recurse(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (getAssetType(ext) !== null) {
          results.push(fullPath);
        }
      }
    }
  }

  recurse(dirPath);
  return results;
}

// ─── catalogAssets ────────────────────────────────────────────────────────────

/**
 * Scans a directory recursively for media files and returns a typed AssetManifest.
 * Throws if the directory does not exist.
 */
export async function catalogAssets(dirPath: string): Promise<AssetManifest> {
  const resolved = path.resolve(dirPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory not found: ${resolved}`);
  }

  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Path is not a directory: ${resolved}`);
  }

  console.info(`[asset-catalog] Scanning directory: ${resolved}`);

  const filePaths = scanDirectory(resolved);

  console.info(
    `[asset-catalog] Found ${filePaths.length} media file(s) to catalog`
  );

  const files: AssetFile[] = await Promise.all(
    filePaths.map(async (filePath): Promise<AssetFile> => {
      console.debug(`[asset-catalog] Probing: ${filePath}`);

      const ext = path.extname(filePath);
      const type = getAssetType(ext)!; // guaranteed non-null since scanDirectory filters

      const meta = await probeFile(filePath);

      // Ensure fileSize always has a value
      let fileSize = meta.fileSize;
      if (fileSize === undefined) {
        try {
          fileSize = fs.statSync(filePath).size;
        } catch {
          fileSize = 0;
        }
      }

      const assetFile: AssetFile = {
        path: filePath,
        filename: path.basename(filePath),
        type,
        fileSize,
      };

      if (meta.duration !== undefined) assetFile.duration = meta.duration;
      if (meta.width !== undefined) assetFile.width = meta.width;
      if (meta.height !== undefined) assetFile.height = meta.height;
      if (meta.fps !== undefined) assetFile.fps = meta.fps;
      if (meta.codec !== undefined) assetFile.codec = meta.codec;
      if (meta.createdAt !== undefined) assetFile.createdAt = meta.createdAt;

      return assetFile;
    })
  );

  const manifest: AssetManifest = {
    rootDir: resolved,
    files,
    catalogedAt: new Date().toISOString(),
  };

  console.info(
    `[asset-catalog] Catalog complete: ${files.length} asset(s) indexed`
  );

  return manifest;
}

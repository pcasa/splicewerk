import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AssetManifest } from "../edl/types.js";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// Mock child_process — execFile will be overridden per-test via vi.mocked()
vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

// Mock node:util — promisify wraps a callback-style fn into a promise-returning fn
vi.mock("node:util", () => ({
  promisify:
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      new Promise((resolve, reject) => {
        fn(...args, (err: Error | null, result: unknown) => {
          if (err) reject(err);
          else resolve(result);
        });
      }),
}));

// Mock fs module — both default and named exports so `import * as fs` is covered
vi.mock("node:fs", () => {
  const existsSync = vi.fn();
  const statSync = vi.fn();
  const readdirSync = vi.fn();
  return {
    default: { existsSync, statSync, readdirSync },
    existsSync,
    statSync,
    readdirSync,
  };
});

// Mock sharp (dynamic import inside the service)
vi.mock("sharp", () => ({
  default: vi.fn(),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MOCK_FFPROBE_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1920,
      height: 1080,
      r_frame_rate: "30/1",
    },
  ],
  format: {
    duration: "15.033",
    size: "52428800",
    tags: { creation_time: "2024-01-15T10:30:00Z" },
  },
});

const MOCK_AUDIO_FFPROBE_OUTPUT = JSON.stringify({
  streams: [
    {
      codec_type: "audio",
      codec_name: "aac",
    },
  ],
  format: {
    duration: "120.5",
    size: "1024000",
    tags: { creation_time: "2024-02-01T08:00:00Z" },
  },
});

/** Build a mock Dirent-like object */
function mockDirent(name: string, isDir: boolean, isFile: boolean) {
  return {
    name,
    isDirectory: () => isDir,
    isFile: () => isFile,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("catalogAssets", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns correct AssetManifest shape", async () => {
    const fs = await import("node:fs");
    const { execFile } = await import("node:child_process");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 52428800,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("clip.mp4", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    vi.mocked(execFile).mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (
          callback as (
            err: null,
            result: { stdout: string; stderr: string }
          ) => void
        )(null, { stdout: MOCK_FFPROBE_OUTPUT, stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }
    );

    const { catalogAssets } = await import("./asset-catalog.js");

    const manifest: AssetManifest = await catalogAssets("/fake/dir");

    expect(manifest).toHaveProperty("rootDir");
    expect(manifest).toHaveProperty("files");
    expect(manifest).toHaveProperty("catalogedAt");
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(typeof manifest.rootDir).toBe("string");
    expect(typeof manifest.catalogedAt).toBe("string");
    // catalogedAt should be a valid ISO date
    expect(new Date(manifest.catalogedAt).toISOString()).toBe(
      manifest.catalogedAt
    );
  });

  it("classifies video files with type: video and metadata from ffprobe", async () => {
    const fs = await import("node:fs");
    const { execFile } = await import("node:child_process");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 52428800,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("clip.mp4", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    vi.mocked(execFile).mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (
          callback as (
            err: null,
            result: { stdout: string; stderr: string }
          ) => void
        )(null, { stdout: MOCK_FFPROBE_OUTPUT, stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }
    );

    const { catalogAssets } = await import("./asset-catalog.js");
    const manifest = await catalogAssets("/fake/dir");

    expect(manifest.files).toHaveLength(1);
    const file = manifest.files[0];
    expect(file.type).toBe("video");
    expect(file.duration).toBeCloseTo(15.033, 2);
    expect(file.width).toBe(1920);
    expect(file.height).toBe(1080);
    expect(file.fps).toBeCloseTo(30, 1);
    expect(file.codec).toBe("h264");
    expect(file.fileSize).toBe(52428800);
    expect(file.createdAt).toBe("2024-01-15T10:30:00Z");
    expect(file.filename).toBe("clip.mp4");
  });

  it("classifies audio files with type: audio", async () => {
    const fs = await import("node:fs");
    const { execFile } = await import("node:child_process");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 1024000,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("track.mp3", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    vi.mocked(execFile).mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (
          callback as (
            err: null,
            result: { stdout: string; stderr: string }
          ) => void
        )(null, { stdout: MOCK_AUDIO_FFPROBE_OUTPUT, stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }
    );

    const { catalogAssets } = await import("./asset-catalog.js");
    const manifest = await catalogAssets("/fake/dir");

    expect(manifest.files).toHaveLength(1);
    const file = manifest.files[0];
    expect(file.type).toBe("audio");
    expect(file.duration).toBeCloseTo(120.5, 1);
    expect(file.fileSize).toBe(1024000);
  });

  it("classifies image files with type: image", async () => {
    const fs = await import("node:fs");
    const sharpModule = await import("sharp");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 204800,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("photo.jpg", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    vi.mocked(sharpModule.default).mockReturnValue({
      metadata: vi.fn().mockResolvedValue({ width: 800, height: 600 }),
    } as unknown as ReturnType<typeof sharpModule.default>);

    const { catalogAssets } = await import("./asset-catalog.js");
    const manifest = await catalogAssets("/fake/dir");

    expect(manifest.files).toHaveLength(1);
    const file = manifest.files[0];
    expect(file.type).toBe("image");
    expect(file.width).toBe(800);
    expect(file.height).toBe(600);
  });

  it("skips files with unknown extensions", async () => {
    const fs = await import("node:fs");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 1000,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("notes.txt", false, true),
      mockDirent("document.pdf", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    const { catalogAssets } = await import("./asset-catalog.js");
    const manifest = await catalogAssets("/fake/dir");

    // No media files found — files array should be empty
    expect(manifest.files).toHaveLength(0);
  });

  it("handles ffprobe errors gracefully (file included with partial metadata)", async () => {
    const fs = await import("node:fs");
    const { execFile } = await import("node:child_process");

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => true,
      size: 9999,
    } as unknown as ReturnType<typeof fs.statSync>);
    vi.mocked(fs.readdirSync).mockReturnValue([
      mockDirent("broken.mp4", false, true),
    ] as unknown as ReturnType<typeof fs.readdirSync>);

    // Make ffprobe return an error via callback
    vi.mocked(execFile).mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (callback as (err: Error, result: null) => void)(
          new Error("ffprobe not found"),
          null
        );
        return {} as ReturnType<typeof execFile>;
      }
    );

    const { catalogAssets } = await import("./asset-catalog.js");
    const manifest = await catalogAssets("/fake/dir");

    // File should still be cataloged despite ffprobe failure
    expect(manifest.files).toHaveLength(1);
    const file = manifest.files[0];
    expect(file.filename).toBe("broken.mp4");
    expect(file.type).toBe("video");
    // fileSize should fall back to stat result
    expect(file.fileSize).toBe(9999);
    // No duration/width/height since ffprobe failed
    expect(file.duration).toBeUndefined();
    expect(file.width).toBeUndefined();
  });
});

describe("probeFile", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty object for unsupported file extensions", async () => {
    const { probeFile } = await import("./asset-catalog.js");
    const result = await probeFile("/some/path/notes.txt");
    expect(result).toEqual({});
  });

  it("returns video metadata for .mov files", async () => {
    const { execFile } = await import("node:child_process");

    vi.mocked(execFile).mockImplementation(
      (_cmd: unknown, _args: unknown, callback: unknown) => {
        (
          callback as (
            err: null,
            result: { stdout: string; stderr: string }
          ) => void
        )(null, { stdout: MOCK_FFPROBE_OUTPUT, stderr: "" });
        return {} as ReturnType<typeof execFile>;
      }
    );

    const { probeFile } = await import("./asset-catalog.js");
    const result = await probeFile("/path/to/video.mov");

    expect(result.duration).toBeCloseTo(15.033, 2);
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBeCloseTo(30, 1);
    expect(result.codec).toBe("h264");
    expect(result.fileSize).toBe(52428800);
  });
});

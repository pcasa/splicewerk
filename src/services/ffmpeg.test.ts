import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock child_process before importing the module under test
vi.mock("child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "child_process";
import {
  trimClip,
  concatClips,
  reformat,
  addTextOverlay,
  mixAudio,
  loadFormatPresets,
  getFormatPreset,
} from "./ffmpeg.js";

// Grab a typed reference to the mock
const mockExecFile = vi.mocked(execFile);

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void;

// Helper: make execFile invoke callback with success
// Handles both 3-arg (file, args, cb) and 4-arg (file, args, opts, cb) invocations
function mockSuccess(stdout = "", stderr = "") {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCallback;
    cb(null, stdout, stderr);
    return {} as ReturnType<typeof execFile>;
  });
}

// Helper: make execFile invoke callback with error
function mockFailure(message = "ffmpeg exited with code 1") {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCallback;
    const err = Object.assign(new Error(message), { stderr: message, code: 1 });
    cb(err, "", message);
    return {} as ReturnType<typeof execFile>;
  });
}

// Capture the args passed to execFile
function captureArgs(): string[] {
  const calls = mockExecFile.mock.calls;
  const lastCall = calls[calls.length - 1];
  // execFile(file, args, opts, callback) — args is index 1
  return lastCall[1] as unknown as string[];
}

beforeEach(() => {
  mockExecFile.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("trimClip", () => {
  it("builds correct FFmpeg args", async () => {
    mockSuccess();
    const result = await trimClip("input.mp4", 5, 15, "output.mp4");
    expect(result.ok).toBe(true);
    const args = captureArgs();
    expect(args).toContain("-ss");
    expect(args).toContain("5");
    expect(args).toContain("-to");
    expect(args).toContain("15");
    expect(args).toContain("-i");
    expect(args).toContain("input.mp4");
    expect(args).toContain("-c:v");
    expect(args).toContain("h264_videotoolbox");
    expect(args).toContain("-c:a");
    expect(args).toContain("aac");
    expect(args).toContain("output.mp4");
  });

  it("returns ok: false when FFmpeg exits with non-zero code", async () => {
    mockFailure("ffmpeg error: invalid input");
    const result = await trimClip("bad.mp4", 0, 10, "out.mp4");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ffmpeg error");
    }
  });
});

describe("concatClips", () => {
  it("creates a concat file and passes correct args", async () => {
    mockSuccess();
    const result = await concatClips(["clip1.mp4", "clip2.mp4", "clip3.mp4"], "output.mp4");
    expect(result.ok).toBe(true);
    const args = captureArgs();
    expect(args).toContain("-f");
    expect(args).toContain("concat");
    expect(args).toContain("-safe");
    expect(args).toContain("0");
    expect(args).toContain("-i");
    expect(args).toContain("-c:v");
    expect(args).toContain("h264_videotoolbox");
    // The concat file path should be somewhere in args (after -i)
    const iIdx = args.indexOf("-i");
    expect(iIdx).toBeGreaterThan(-1);
    const concatFilePath = args[iIdx + 1];
    expect(concatFilePath).toBeTruthy();
    expect(concatFilePath).toMatch(/\.txt$/);
  });

  it("returns ok: false when FFmpeg exits with non-zero code", async () => {
    mockFailure("concat failed");
    const result = await concatClips(["a.mp4"], "out.mp4");
    expect(result.ok).toBe(false);
  });
});

describe("reformat", () => {
  it("applies 1920x1080, fps 30, h264_videotoolbox for youtube format", async () => {
    mockSuccess();
    const result = await reformat("input.mp4", "youtube", "output.mp4");
    expect(result.ok).toBe(true);
    const args = captureArgs();
    // Video filter should include scale=1920:1080
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    const vfValue = args[vfIdx + 1];
    expect(vfValue).toContain("1920");
    expect(vfValue).toContain("1080");
    expect(vfValue).toContain("fps=30");
    expect(args).toContain("h264_videotoolbox");
  });

  it("applies 1080x1920 and center crop for instagram-reels format", async () => {
    mockSuccess();
    const result = await reformat("input.mp4", "instagram-reels", "output.mp4");
    expect(result.ok).toBe(true);
    const args = captureArgs();
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    const vfValue = args[vfIdx + 1];
    expect(vfValue).toContain("1080");
    expect(vfValue).toContain("1920");
    // center crop strategy uses crop filter
    expect(vfValue).toContain("crop=");
    expect(args).toContain("h264_videotoolbox");
  });

  it("returns ok: false for unknown format", async () => {
    const result = await reformat("input.mp4", "nonexistent-format", "output.mp4");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Unknown format preset");
    }
  });
});

describe("addTextOverlay", () => {
  it("includes drawtext in the filter chain", async () => {
    mockSuccess();
    const result = await addTextOverlay(
      "input.mp4",
      "Hello World",
      "center",
      { fontsize: 48, fontcolor: "white" },
      "output.mp4"
    );
    expect(result.ok).toBe(true);
    const args = captureArgs();
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    const vfValue = args[vfIdx + 1];
    expect(vfValue).toContain("drawtext=");
    expect(vfValue).toContain("Hello World");
    expect(vfValue).toContain("fontsize=48");
    expect(vfValue).toContain("fontcolor=white");
  });

  it("returns ok: false when FFmpeg exits with non-zero code", async () => {
    mockFailure("drawtext error");
    const result = await addTextOverlay("input.mp4", "text", "top-left", {}, "out.mp4");
    expect(result.ok).toBe(false);
  });
});

describe("mixAudio", () => {
  it("includes volume filter args", async () => {
    mockSuccess();
    const result = await mixAudio(
      "video.mp4",
      "music.mp3",
      { video: 1.0, audio: 0.3 },
      "output.mp4"
    );
    expect(result.ok).toBe(true);
    const args = captureArgs();
    const fcIdx = args.indexOf("-filter_complex");
    expect(fcIdx).toBeGreaterThan(-1);
    const fcValue = args[fcIdx + 1];
    expect(fcValue).toContain("volume=");
    expect(fcValue).toContain("amix");
  });

  it("returns ok: false when FFmpeg exits with non-zero code", async () => {
    mockFailure("audio mix error");
    const result = await mixAudio("v.mp4", "a.mp3", { video: 1, audio: 1 }, "out.mp4");
    expect(result.ok).toBe(false);
  });
});

describe("loadFormatPresets", () => {
  it("returns all 8 format keys", () => {
    const presets = loadFormatPresets();
    const keys = Object.keys(presets);
    expect(keys).toHaveLength(8);
    expect(keys).toContain("youtube");
    expect(keys).toContain("youtube-shorts");
    expect(keys).toContain("instagram-reels");
    expect(keys).toContain("instagram-feed");
    expect(keys).toContain("tiktok");
    expect(keys).toContain("facebook");
    expect(keys).toContain("twitter-x");
    expect(keys).toContain("thumbnail");
  });
});

describe("getFormatPreset", () => {
  it("returns correct preset for youtube", () => {
    const preset = getFormatPreset("youtube");
    expect(preset).toBeDefined();
    expect(preset?.width).toBe(1920);
    expect(preset?.height).toBe(1080);
    expect(preset?.fps).toBe(30);
    expect(preset?.codec).toBe("h264");
    expect(preset?.crf).toBe(18);
    expect(preset?.maxBitrate).toBe("20M");
    expect(preset?.audioBitrate).toBe("192k");
    expect(preset?.pixelFormat).toBe("yuv420p");
    expect(preset?.container).toBe("mp4");
    expect(preset?.maxDuration).toBeNull();
    expect(preset?.label).toBe("YouTube (16:9)");
  });

  it("returns undefined for unknown format", () => {
    const preset = getFormatPreset("nonexistent");
    expect(preset).toBeUndefined();
  });
});

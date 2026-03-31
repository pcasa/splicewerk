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
  generateTitleCard,
  stabilizeClip,
  applyEffects,
  extractFrames,
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

describe("generateTitleCard — concurrent requests", () => {
  // Mock sharp so it doesn't touch the filesystem
  vi.mock("sharp", () => {
    const chain = {
      png: () => chain,
      toFile: vi.fn().mockResolvedValue(undefined),
    };
    return { default: vi.fn(() => chain) };
  });

  // Mock fs/promises mkdir and rm so no real dirs are created
  vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("two simultaneous calls produce unique output paths without collision", async () => {
    // ffmpeg succeeds for both calls
    mockSuccess();

    const [r1, r2] = await Promise.all([
      generateTitleCard("Clip A", 5, "/tmp/seg1.mp4"),
      generateTitleCard("Clip B", 5, "/tmp/seg2.mp4"),
    ]);

    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Each call targets a different output file
    if (r1.ok && r2.ok) {
      expect(r1.value).toBe("/tmp/seg1.mp4");
      expect(r2.value).toBe("/tmp/seg2.mp4");
    }
  });
});

describe("stabilizeClip — vidstab availability", () => {
  it("returns source path unchanged when vidstab filter is missing", async () => {
    // ffmpeg -filters returns output without 'vidstab'
    mockSuccess("V.. scale               Scale the input video", "");

    const result = await stabilizeClip("input.mp4", "output.mp4");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("input.mp4"); // source returned as-is
    }
  });

  it("runs two-pass stabilization when vidstab is available", async () => {
    // First call: -filters probe (contains 'vidstab')
    // Subsequent calls: detect pass + transform pass
    let callCount = 0;
    mockExecFile.mockImplementation((...args: unknown[]) => {
      callCount++;
      const cb = args[args.length - 1] as ExecCallback;
      const stdout = callCount === 1 ? "V.. vidstabdetect  Video stabilization" : "";
      cb(null, stdout, "");
      return {} as ReturnType<typeof execFile>;
    });

    const result = await stabilizeClip("input.mp4", "output.mp4", { smoothing: 5 });
    expect(result.ok).toBe(true);
    expect(callCount).toBe(3); // probe + detect pass + transform pass
  });
});

describe("applyEffects", () => {
  it("applies teal-orange grade and contrast filter chain", async () => {
    mockSuccess();
    const result = await applyEffects("input.mp4", "output.mp4", {
      contrast: 1.15,
      glow: 0.25,
      grade: "teal-orange",
    });
    expect(result.ok).toBe(true);
    const args = captureArgs();
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    const vfValue = args[vfIdx + 1];
    expect(vfValue).toContain("curves=");
    expect(vfValue).toContain("eq=contrast=");
  });

  it("passes -c copy when no filters are active", async () => {
    mockSuccess();
    const result = await applyEffects("input.mp4", "output.mp4", {
      contrast: 1.0,
      glow: 0,
      grade: "none",
    });
    expect(result.ok).toBe(true);
    const args = captureArgs();
    expect(args).toContain("-c");
    expect(args).toContain("copy");
    expect(args.indexOf("-vf")).toBe(-1);
  });

  it("returns { ok: false } when ffmpeg exits non-zero", async () => {
    mockFailure("ffmpeg effects error");
    const result = await applyEffects("input.mp4", "output.mp4", { grade: "cool" });
    expect(result.ok).toBe(false);
  });
});

describe("extractFrames", () => {
  // Mock node:fs/promises for mkdir and readdir
  vi.mock("node:fs/promises", async (importOriginal) => {
    const actual = await importOriginal<typeof import("node:fs/promises")>();
    return {
      ...actual,
      mkdir: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      readdir: vi.fn().mockResolvedValue(["frame_0001.jpg", "frame_0002.jpg", "frame_0003.jpg"]),
    };
  });

  it("calls ffmpeg with correct -vf fps=1/2 args for intervalSeconds=2", async () => {
    mockSuccess();
    const result = await extractFrames("video.mp4", 2, "/tmp/frames");
    expect(result.ok).toBe(true);
    const args = captureArgs();
    const vfIdx = args.indexOf("-vf");
    expect(vfIdx).toBeGreaterThan(-1);
    expect(args[vfIdx + 1]).toBe("fps=1/2");
    expect(args).toContain("-i");
    expect(args).toContain("video.mp4");
  });

  it("returns the list of extracted frame paths sorted", async () => {
    mockSuccess();
    const result = await extractFrames("video.mp4", 5, "/tmp/frames");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        "/tmp/frames/frame_0001.jpg",
        "/tmp/frames/frame_0002.jpg",
        "/tmp/frames/frame_0003.jpg",
      ]);
    }
  });

  it("returns { ok: false } when ffmpeg fails", async () => {
    mockFailure("ffmpeg frame extraction error");
    const result = await extractFrames("video.mp4", 2, "/tmp/frames");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ffmpeg frame extraction error");
    }
  });
});

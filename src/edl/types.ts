// ─── Asset Manifest ───

export interface AssetFile {
  path: string;
  filename: string;
  type: "video" | "image" | "audio";
  duration?: number; // seconds (video/audio only)
  width?: number;
  height?: number;
  fps?: number;
  codec?: string;
  fileSize: number; // bytes
  createdAt?: string; // ISO date
}

export interface AssetManifest {
  rootDir: string;
  files: AssetFile[];
  catalogedAt: string;
}

// ─── Edit Decision List ───

export interface EDLProject {
  title: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  resolution: string;
  outputFormats: string[]; // ['youtube', 'instagram-reels', 'tiktok']
}

export interface MissingAsset {
  description: string;
  purpose: string;
  priority: "required" | "nice-to-have";
}

export interface TextOverlay {
  text: string;
  position: string;
  style: string;
  leftLabel?: string;
  rightLabel?: string;
}

export interface CropHint {
  format: string; // 'instagram-reels', 'tiktok', etc.
  focusPoint: "center" | "left" | "right" | "subject";
  offsetX?: number;
  offsetY?: number;
}

export interface TimelineSegment {
  id: string;
  type:
    | "intro"
    | "outro"
    | "title_card"
    | "before_after"
    | "montage"
    | "clip"
    | "transition"
    | "generated";
  processor: "ffmpeg" | "runway" | "elevenlabs";
  source?: string;
  sources?: { source: string; trim?: string }[];
  operation?: string;
  prompt?: string;
  durationSeconds?: number;
  trim?: string;
  transition?: string;
  textOverlay?: TextOverlay;
  cropHints?: CropHint[]; // per-format reframing hints
}

export interface AudioConfig {
  backgroundMusic?: {
    source: string;
    volume: number;
    fadeIn: number;
    fadeOut: number;
  };
  sfx?: {
    source: string;
    prompt?: string; // for AI-generated SFX
    timestamp: number;
    volume: number;
  }[];
  originalAudio?: {
    segments: string[];
    volume: number;
  };
}

export interface ThumbnailConfig {
  type: string;
  style: string;
  text?: string;
  leftFrame?: { source: string; timestamp: string };
  rightFrame?: { source: string; timestamp: string };
  frame?: { source: string; timestamp: string };
}

export interface EDL {
  project: EDLProject;
  missingAssets: MissingAsset[];
  timeline: TimelineSegment[];
  audio: AudioConfig;
  thumbnail: ThumbnailConfig;
}

// ─── Output Formats ───

export interface FormatPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  aspectRatio: string;
  codec: string;
  crf: number;
  maxBitrate: string;
  audioBitrate: string;
  pixelFormat: string;
  container: string;
  maxDuration: number | null;
  cropStrategy: "center" | "smart" | "letterbox" | "custom";
  notes?: string;
}

// ─── Processing Steps ───

export interface ProcessingStep {
  id: string;
  type: "ffmpeg" | "runway" | "elevenlabs" | "sharp" | "reformat";
  segmentId?: string;
  input: string | string[];
  output: string;
  params: Record<string, unknown>;
  estimatedDuration?: number;
  estimatedCost?: number; // USD, for cloud API calls
}

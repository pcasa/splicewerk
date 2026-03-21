import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ───

const mockSharpInstance = {
  resize: vi.fn().mockReturnThis(),
  composite: vi.fn().mockReturnThis(),
  jpeg: vi.fn().mockReturnThis(),
  png: vi.fn().mockReturnThis(),
  toFile: vi.fn().mockResolvedValue({ size: 12345 }),
  toBuffer: vi.fn().mockResolvedValue(Buffer.from('fake-image')),
}

const mockSharp = vi.fn().mockReturnValue(mockSharpInstance)

vi.mock('sharp', () => ({
  default: mockSharp,
}))

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}))

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
}))

// Import after mocks
import { execFile } from 'node:child_process'
import {
  extractFrame,
  beforeAfterSplit,
  singleFrame,
  collage,
} from './thumbnail.js'

const mockExecFile = vi.mocked(execFile)

type ExecCallback = (err: Error | null, stdout: string, stderr: string) => void

function mockExecSuccess() {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCallback
    cb(null, '', '')
    return {} as ReturnType<typeof execFile>
  })
}

function mockExecFailure(message = 'ffmpeg error') {
  mockExecFile.mockImplementation((...args: unknown[]) => {
    const cb = args[args.length - 1] as ExecCallback
    const err = Object.assign(new Error(message), { stderr: message, code: 1 })
    cb(err, '', message)
    return {} as ReturnType<typeof execFile>
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSharp.mockReturnValue(mockSharpInstance)
  mockSharpInstance.resize.mockReturnThis()
  mockSharpInstance.composite.mockReturnThis()
  mockSharpInstance.jpeg.mockReturnThis()
  mockSharpInstance.png.mockReturnThis()
  mockSharpInstance.toFile.mockResolvedValue({ size: 12345 })
  mockSharpInstance.toBuffer.mockResolvedValue(Buffer.from('fake-image'))
})

// ─── extractFrame ───

describe('extractFrame', () => {
  it('calls ffmpeg with -ss, -frames:v 1, and the video path', async () => {
    mockExecSuccess()
    const result = await extractFrame('video.mp4', 5.5)
    expect(result.ok).toBe(true)

    const calls = mockExecFile.mock.calls
    expect(calls.length).toBe(1)
    const [file, args] = calls[0] as [string, string[]]
    expect(file).toBe('ffmpeg')
    expect(args).toContain('-ss')
    expect(args).toContain('5.5')
    expect(args).toContain('-i')
    expect(args).toContain('video.mp4')
    expect(args).toContain('-frames:v')
    expect(args).toContain('1')
  })

  it('uses a custom outputPath when provided', async () => {
    mockExecSuccess()
    const result = await extractFrame('video.mp4', 0, '/tmp/custom-frame.jpg')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('/tmp/custom-frame.jpg')
    }
  })

  it('returns { ok: false } when ffmpeg fails', async () => {
    mockExecFailure('ffmpeg: no such file')
    const result = await extractFrame('video.mp4', 10)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('ffmpeg')
    }
  })
})

// ─── beforeAfterSplit ───

describe('beforeAfterSplit', () => {
  it('calls sharp for both left and right images', async () => {
    const result = await beforeAfterSplit('left.jpg', 'right.jpg')
    expect(result.ok).toBe(true)
    // sharp called for left image, right image, and divider (3 times minimum)
    expect(mockSharp).toHaveBeenCalledWith('left.jpg')
    expect(mockSharp).toHaveBeenCalledWith('right.jpg')
  })

  it('returns a file path ending in .jpg', async () => {
    const result = await beforeAfterSplit('left.jpg', 'right.jpg')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatch(/\.jpg$/)
    }
  })

  it('calls resize on each image (640x720)', async () => {
    await beforeAfterSplit('left.jpg', 'right.jpg')
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(640, 720, expect.objectContaining({ fit: 'cover' }))
  })

  it('calls composite to assemble the final image', async () => {
    await beforeAfterSplit('left.jpg', 'right.jpg')
    expect(mockSharpInstance.composite).toHaveBeenCalled()
  })

  it('with text option includes SVG composite call (more composites)', async () => {
    await beforeAfterSplit('left.jpg', 'right.jpg', { text: 'Before vs After' })
    const compositeCall = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    // Should include the SVG text overlay (Buffer from SVG) — more than 3 composites
    expect(compositeCall.length).toBeGreaterThan(3)
  })

  it('uses provided outputPath', async () => {
    const result = await beforeAfterSplit('left.jpg', 'right.jpg', { outputPath: '/tmp/thumb.jpg' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('/tmp/thumb.jpg')
    }
  })
})

// ─── singleFrame ───

describe('singleFrame', () => {
  it('resizes to 1280x720 with cover fit', async () => {
    await singleFrame('image.jpg')
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(1280, 720, expect.objectContaining({ fit: 'cover' }))
  })

  it('saves as JPG and returns a .jpg path', async () => {
    const result = await singleFrame('image.jpg')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatch(/\.jpg$/)
    }
    expect(mockSharpInstance.jpeg).toHaveBeenCalled()
    expect(mockSharpInstance.toFile).toHaveBeenCalled()
  })

  it('with text adds SVG overlay via composite', async () => {
    await singleFrame('image.jpg', { text: 'My Title' })
    expect(mockSharpInstance.composite).toHaveBeenCalled()
    const compositeArg = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    expect(compositeArg.length).toBeGreaterThan(0)
    // The SVG input should be a Buffer
    expect(Buffer.isBuffer(compositeArg[0].input)).toBe(true)
  })

  it('without text does not call composite', async () => {
    await singleFrame('image.jpg')
    expect(mockSharpInstance.composite).not.toHaveBeenCalled()
  })
})

// ─── collage ───

describe('collage', () => {
  it('returns error for fewer than 2 images', async () => {
    const result = await collage(['only-one.jpg'])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('at least 2')
    }
  })

  it('with 2 images creates side-by-side layout (640x720 each)', async () => {
    const result = await collage(['a.jpg', 'b.jpg'])
    expect(result.ok).toBe(true)
    // Each image should be resized to 640×720
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(640, 720, expect.objectContaining({ fit: 'cover' }))
    // Composite should receive 2 image composites
    const compositeArg = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    expect(compositeArg.length).toBe(2)
    expect(compositeArg[0]).toMatchObject({ left: 0, top: 0 })
    expect(compositeArg[1]).toMatchObject({ left: 640, top: 0 })
  })

  it('with 4 images creates 2x2 grid (640x360 quadrants)', async () => {
    const result = await collage(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'])
    expect(result.ok).toBe(true)
    // Each image should be resized to 640×360
    expect(mockSharpInstance.resize).toHaveBeenCalledWith(640, 360, expect.objectContaining({ fit: 'cover' }))
    const compositeArg = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    expect(compositeArg.length).toBe(4)
    expect(compositeArg[0]).toMatchObject({ left: 0, top: 0 })
    expect(compositeArg[1]).toMatchObject({ left: 640, top: 0 })
    expect(compositeArg[2]).toMatchObject({ left: 0, top: 360 })
    expect(compositeArg[3]).toMatchObject({ left: 640, top: 360 })
  })

  it('with 3 images creates top-left, top-right, bottom-center layout', async () => {
    const result = await collage(['a.jpg', 'b.jpg', 'c.jpg'])
    expect(result.ok).toBe(true)
    const compositeArg = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    expect(compositeArg.length).toBe(3)
    expect(compositeArg[0]).toMatchObject({ left: 0, top: 0 })
    expect(compositeArg[1]).toMatchObject({ left: 640, top: 0 })
    // Bottom center: left = (1280 - 640) / 2 = 320
    expect(compositeArg[2]).toMatchObject({ left: 320, top: 360 })
  })

  it('uses only first 4 images when more than 4 are provided', async () => {
    await collage(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'])
    // sharp should be called for canvas creation + 4 images = 5 total
    const imageOpenCalls = mockSharp.mock.calls.filter(
      (call) => typeof call[0] === 'string'
    )
    expect(imageOpenCalls.length).toBe(4)
  })

  it('with text option adds SVG overlay', async () => {
    await collage(['a.jpg', 'b.jpg'], { text: 'My Collage' })
    const compositeArg = mockSharpInstance.composite.mock.calls[0][0] as sharp.OverlayOptions[]
    // 2 images + 1 text overlay = 3
    expect(compositeArg.length).toBe(3)
    expect(Buffer.isBuffer(compositeArg[2].input)).toBe(true)
  })
})

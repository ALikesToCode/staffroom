import { findPossibleNames } from '../core/rules';
import { plainText } from '../core/text';
import { modelFor } from './routes';

const METADATA_LINE_RE = /^(?:subject|topic|date|teacher|school|class|grade|section|term|roll|period|time|phone|mobile|contact|tel|telephone|email|address|parent|guardian|notes?)\s*[:-]/i;
const HONORIFIC_BEFORE_RE = /\b(?:mr|mrs|ms|miss|dr|prof|shri|smt|kumari|rev|father|sister|mother|aunt|uncle)\.?\s+$/i;
const ADULT_ROLE_AFTER_RE = /^\s*(?:\(|,|-)\s*(?:mother|father|parent|guardian|grandmother|grandfather|aunt|uncle|doctor|teacher)\b/i;
const ROMAN_OR_SINGLE_RE = /^(?:[A-Z]|[IVXLCDM]{1,5})$/;

/**
 * Extract likely pupil names directly from a transcribed notebook page using local proper-name heuristics.
 * Filters places, adult honorifics/parentheticals, header metadata lines, and duplicates.
 */
export function extractScannedClassList(text: string): string[] {
  const cleanedLines = text
    .split('\n')
    .map((line) => (METADATA_LINE_RE.test(line.trim()) ? '' : line))
    .join('\n');
  const raw = findPossibleNames(cleanedLines, []);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const hit of raw) {
    if (hit.kind === 'place') continue;
    const candidate = hit.text.trim();
    if (!candidate || ROMAN_OR_SINGLE_RE.test(candidate)) continue;
    const before = cleanedLines.slice(Math.max(0, hit.start - 16), hit.start);
    if (HONORIFIC_BEFORE_RE.test(before)) continue;
    const after = cleanedLines.slice(hit.end, hit.end + 32);
    if (ADULT_ROLE_AFTER_RE.test(after)) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(candidate);
  }
  const multiWordFirsts = new Set(kept.filter((n) => n.includes(' ')).map((n) => n.split(/\s+/)[0].toLowerCase()));
  return kept.filter((n) => n.includes(' ') || !multiWordFirsts.has(n.toLowerCase()));
}

export const NOTEBOOK_SYSTEM =
  'You transcribe handwritten school register and teacher notebook pages into clean plain text. Copy every name, phone number, roll number, and detail verbatim line by line. Do not summarise or omit anything.';

export const NOTEBOOK_PROMPT =
  'Transcribe all handwritten teacher notes from this notebook page accurately as plain text. Keep every name, number, and detail verbatim.';

export interface PreparedImage {
  mimeType: 'image/jpeg' | 'image/png';
  data: string;
  previewUrl: string;
}

/** Max longest dimension when resizing a notebook photo locally before sending to Gemini Nano. */
export const NOTEBOOK_IMAGE_MAX_PX = 1024;

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the selected image.'));
    reader.readAsDataURL(blob);
  });
}

function loadBitmapOrImage(blob: Blob): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob).then((bmp) => ({
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp, 0, 0, w, h),
      close: () => bmp.close(),
    }));
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        width: img.naturalWidth || img.width,
        height: img.naturalHeight || img.height,
        draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
        close: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('The selected file could not be read as an image.'));
    };
    img.src = url;
  });
}

/**
 * Downscale a notebook image locally in the browser to JPEG (<= 1024 px) and extract base64 data.
 * Nothing leaves the device here.
 */
export async function prepareNotebookImage(file: Blob, maxPx = NOTEBOOK_IMAGE_MAX_PX): Promise<PreparedImage> {
  if (typeof document === 'undefined') {
    const dataUrl = await blobToDataUrl(file);
    const comma = dataUrl.indexOf(',');
    const mimeMatch = /^data:(image\/(?:jpeg|png));base64/i.exec(dataUrl.slice(0, comma));
    return {
      mimeType: mimeMatch?.[1].toLowerCase() === 'image/png' ? 'image/png' : 'image/jpeg',
      data: comma >= 0 ? dataUrl.slice(comma + 1) : '',
      previewUrl: dataUrl,
    };
  }
  const source = await loadBitmapOrImage(file);
  try {
    const scale = Math.min(1, maxPx / Math.max(source.width || 1, source.height || 1));
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser could not prepare the notebook image.');
    source.draw(ctx, width, height);
    const previewUrl = canvas.toDataURL('image/jpeg', 0.88);
    const comma = previewUrl.indexOf(',');
    return {
      mimeType: 'image/jpeg',
      data: comma >= 0 ? previewUrl.slice(comma + 1) : '',
      previewUrl,
    };
  } finally {
    source.close?.();
  }
}

export interface NotebookScanResult {
  text: string;
  onDevice: boolean;
}

/**
 * Transcribe a notebook page photo strictly on-device via the `scan` route (ONLY_ON_DEVICE).
 * Refuses to run when no on-device model is present and aborts if an answer did not come from the device.
 */
export async function transcribeNotebookOnDevice(image: Pick<PreparedImage, 'mimeType' | 'data'>): Promise<NotebookScanResult> {
  if (!image.data) throw new Error('No image data was loaded to transcribe.');
  const model = modelFor('scan', { system: NOTEBOOK_SYSTEM, multimodal: 'image' });
  const result = await model.generateContent([
    { type: 'text', text: NOTEBOOK_PROMPT },
    { type: 'inlineData', inlineData: { mimeType: image.mimeType, data: image.data } },
  ]);
  const onDevice = result.response.inferenceSource === 'on_device';
  if (!onDevice) {
    throw new Error('The notebook scan did not run on the device. Stopped.');
  }
  const text = plainText(result.response.text());
  if (!text) throw new Error('The on-device model returned no text from that image.');
  return { text, onDevice: true };
}

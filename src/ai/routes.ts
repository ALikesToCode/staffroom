import { getGenerativeModel, InferenceMode, type GenerativeModel } from 'firebase/ai';
import { ai } from './firebase';

/**
 * The routing table. Each job is given an inference mode by how sensitive
 * its input is, not by what happens to be available.
 */
export const ROUTES = [
  {
    id: 'guard',
    job: 'Find names and private details in the raw note',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'The raw note must never reach a server, so there is no cloud fallback. The app refuses to start this request unless the on-device model is present, and stops if a response did not come from the device. Without an on-device model it drops to rules and your own review.',
  },
  {
    id: 'draft',
    job: 'Write the draft from the redacted text',
    mode: InferenceMode.PREFER_IN_CLOUD,
    why: 'The larger cloud model writes better. The text is already redacted and approved by you. If the cloud call fails with a network error or an error response and the on-device model is ready, the draft is written on the device.',
  },
  {
    id: 'check',
    job: 'Check the draft against the private details',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'Only this device knows what was withheld, so only this device can check the draft against it. The same refusal applies: no on-device model, no request.',
  },
  {
    id: 'fit',
    job: 'Fit a step in conflict to the child',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'The fact that rules a step out is private, so the step is rewritten where the fact is: on this device. The same refusal applies: no on-device model, no request. The suggestion fills the rewrite box and nothing changes until you save it.',
  },
  {
    id: 'label',
    job: 'Name the receipt',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'A small job on redacted text: free, and needing no network, on the device when it can; in the cloud when it cannot.',
  },
] as const;

export type RouteId = (typeof ROUTES)[number]['id'];

const ENGLISH = [{ type: 'text' as const, languages: ['en'] }];

interface Options {
  /** Instructions that stay the same for every request. */
  system: string;
  /** JSON schema the answer must follow. Omit for plain text. */
  schema?: Record<string, unknown>;
  /** Cloud model name, from policy. */
  cloudModel?: string;
}

/** True when this browser has a built-in model the SDK can call. Asks nothing of any server. */
export function onDeviceModelPresent(): boolean {
  return typeof (globalThis as { LanguageModel?: unknown }).LanguageModel !== 'undefined';
}

/**
 * Build a Firebase AI Logic hybrid model for one route.
 *
 * An ONLY_ON_DEVICE route fails closed here, before any request exists. The
 * SDK itself calls the cloud when the browser has no built-in model,
 * whatever the mode, so the mode alone is not a guarantee. This function
 * refuses to build the model in that case, and it gives an ONLY_ON_DEVICE
 * route no cloud parameters at all.
 */
export function modelFor(route: RouteId, { system, schema, cloudModel }: Options): GenerativeModel {
  const mode = ROUTES.find((r) => r.id === route)!.mode;
  const onDevice = {
    createOptions: {
      expectedInputs: ENGLISH,
      expectedOutputs: ENGLISH,
      initialPrompts: [{ role: 'system' as const, content: [{ type: 'text' as const, value: system }] }],
    },
    promptOptions: schema ? { responseConstraint: schema } : undefined,
  };
  if (mode === InferenceMode.ONLY_ON_DEVICE) {
    if (!onDeviceModelPresent()) {
      throw new Error('This browser has no on-device model, so the request was not started. Nothing was sent.');
    }
    return getGenerativeModel(ai, { mode, onDeviceParams: onDevice });
  }
  return getGenerativeModel(ai, {
    mode,
    onDeviceParams: onDevice,
    inCloudParams: {
      model: cloudModel ?? 'gemini-3.5-flash-lite',
      systemInstruction: system,
      generationConfig: schema
        ? { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.4 }
        : { temperature: 0.4 },
    },
  });
}

// ---------------------------------------------------------------- device status

export type DeviceStatus = 'checking' | 'unsupported' | 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface PromptApi {
  availability(options?: object): Promise<Exclude<DeviceStatus, 'checking' | 'unsupported'>>;
}

/** Ask Chrome whether its built-in model can run here. This sends nothing anywhere. */
export async function deviceStatus(): Promise<DeviceStatus> {
  const api = (globalThis as { LanguageModel?: PromptApi }).LanguageModel;
  if (!api) return 'unsupported';
  try {
    return await api.availability({ expectedInputs: ENGLISH, expectedOutputs: ENGLISH });
  } catch {
    return 'unavailable';
  }
}

/**
 * Download and load the on-device model. Chrome requires this to follow a
 * click. Resolves when the model can answer.
 */
export async function prepareDevice(onProgress: (fraction: number) => void): Promise<void> {
  const model = modelFor('guard', { system: 'You are a careful assistant.' });
  await model.initializeDeviceModel(onProgress);
}

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
    why: 'The raw note must never reach a server, so there is no cloud fallback. Without an on-device model the app drops to rules and your own review.',
  },
  {
    id: 'draft',
    job: 'Write the draft from the redacted text',
    mode: InferenceMode.PREFER_IN_CLOUD,
    why: 'The larger cloud model writes better. The text is already redacted and approved by you. With no signal, the on-device model writes it instead.',
  },
  {
    id: 'check',
    job: 'Check the draft against the private details',
    mode: InferenceMode.ONLY_ON_DEVICE,
    why: 'Only this device knows what was withheld, so only this device can check the draft against it.',
  },
  {
    id: 'label',
    job: 'Name the receipt',
    mode: InferenceMode.PREFER_ON_DEVICE,
    why: 'A small job on redacted text: free and offline on the device when it can, in the cloud when it cannot.',
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

/** Build a Firebase AI Logic hybrid model for one route. */
export function modelFor(route: RouteId, { system, schema, cloudModel }: Options): GenerativeModel {
  const mode = ROUTES.find((r) => r.id === route)!.mode;
  const inCloud = mode !== InferenceMode.ONLY_ON_DEVICE;
  return getGenerativeModel(ai, {
    mode,
    onDeviceParams: {
      createOptions: {
        expectedInputs: ENGLISH,
        expectedOutputs: ENGLISH,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: system }] }],
      },
      promptOptions: schema ? { responseConstraint: schema } : undefined,
    },
    inCloudParams: inCloud
      ? {
          model: cloudModel ?? 'gemini-3.5-flash-lite',
          systemInstruction: system,
          generationConfig: schema
            ? { responseMimeType: 'application/json', responseJsonSchema: schema, temperature: 0.4 }
            : { temperature: 0.4 },
        }
      : undefined,
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

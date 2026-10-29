import { passwordEnabled } from "./auth";

export type ConfigStatus = {
  replicate: boolean;
  blob: boolean;
  password: boolean;
};

export function configStatus(): ConfigStatus {
  return {
    replicate: !!process.env.REPLICATE_API_TOKEN,
    blob: !!process.env.BLOB_READ_WRITE_TOKEN,
    password: passwordEnabled(),
  };
}

export const TRAIN_MODEL = process.env.REPLICATE_TRAIN_MODEL || "replicate/train-rvc-model";
export const COVER_MODEL = process.env.REPLICATE_COVER_MODEL || "zsxkib/realistic-voice-cloning";

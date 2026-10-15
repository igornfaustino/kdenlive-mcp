import { requireCondition } from "./errors.js";

export interface FrameRate {
  numerator: number;
  denominator: number;
}

export function frame(value: number): number {
  requireCondition(
    Number.isSafeInteger(value) && value >= 0,
    "INVALID_FRAME",
    "Frames must be nonnegative safe integers",
  );
  return value;
}

export function toFrames(value: string, fps: FrameRate): number {
  requireCondition(
    frame(fps.numerator) > 0 && frame(fps.denominator) > 0,
    "INVALID_FPS",
    "FPS must be positive",
  );
  if (/^\d+$/.test(value)) return frame(Number(value));
  const match = /^(\d+):([0-5]\d):([0-5]\d)\.(\d{1,9})$/.exec(value);
  requireCondition(match, "UNSUPPORTED_TIME", `Unsupported MLT time: ${value}`);
  const [, hours, minutes, seconds, fraction] = match as unknown as [
    string,
    string,
    string,
    string,
    string,
  ];
  const scale = 10n ** BigInt(fraction.length);
  const ticks =
    (BigInt(hours) * 3600n + BigInt(minutes) * 60n + BigInt(seconds)) * scale +
    BigInt(fraction);
  const numerator = ticks * BigInt(fps.numerator);
  const denominator = scale * BigInt(fps.denominator);
  return frame(Number((numerator * 2n + denominator) / (2n * denominator)));
}

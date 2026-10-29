// Shared by proxy.ts and route handlers, so only Web Crypto is used here.

export const AUTH_COOKIE = "avs_auth";

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function passwordEnabled(): boolean {
  return !!process.env.APP_PASSWORD;
}

/** Value stored in the auth cookie after a correct password. */
export async function authToken(): Promise<string> {
  return sha256Hex(`${process.env.APP_PASSWORD}:ai-voice-studio`);
}

export async function isAuthorized(cookieValue: string | undefined): Promise<boolean> {
  if (!passwordEnabled()) return true;
  return !!cookieValue && cookieValue === (await authToken());
}

/** Secret appended to Replicate webhook URLs so random callers can't fake results. */
export async function webhookSecret(): Promise<string> {
  const base = process.env.APP_PASSWORD || process.env.REPLICATE_API_TOKEN || "";
  return (await sha256Hex(`${base}:webhook`)).slice(0, 32);
}

// Facebook Messenger send API + webhook verification for the trainer page.
// Mirrors the customer bot's facebook.ts but reads from a separate FACEBOOK_PAGE_ACCESS_TOKEN
// because this bot lives on a different FB Page.
import crypto from "node:crypto";

const GRAPH = "https://graph.facebook.com/v21.0";

function token(): string {
  const t = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  if (!t) throw new Error("FACEBOOK_PAGE_ACCESS_TOKEN not set");
  return t;
}

export function verifySignature(rawBody: Buffer, signatureHeader?: string): boolean {
  const secret = process.env.FACEBOOK_APP_SECRET;
  if (!secret) {
    console.warn("[facebook] FACEBOOK_APP_SECRET not set — skipping signature check (NOT for prod)");
    return true;
  }
  if (!signatureHeader) return false;
  const [scheme, theirs] = signatureHeader.split("=");
  if (scheme !== "sha256" || !theirs) return false;
  const ours = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(ours, "hex"), Buffer.from(theirs, "hex"));
  } catch {
    return false;
  }
}

export function verifyWebhook(query: Record<string, string | undefined>):
  | { ok: true; challenge: string }
  | { ok: false; reason: string } {
  const mode = query["hub.mode"];
  const verifyToken = query["hub.verify_token"];
  const challenge = query["hub.challenge"];
  if (mode === "subscribe" && verifyToken === process.env.FACEBOOK_VERIFY_TOKEN) {
    return { ok: true, challenge: String(challenge ?? "") };
  }
  return { ok: false, reason: "verify_token mismatch" };
}

async function fbCall(path: string, body: unknown): Promise<void> {
  const url = `${GRAPH}${path}?access_token=${encodeURIComponent(token())}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("[facebook] send failed", res.status, text);
    throw new Error(`Facebook API ${res.status}: ${text}`);
  }
}

export async function sendTypingOn(psid: string): Promise<void> {
  await fbCall("/me/messages", {
    recipient: { id: psid },
    sender_action: "typing_on",
  }).catch(() => undefined);
}

export async function sendText(psid: string, text: string): Promise<void> {
  const chunks = chunkText(text, 1900);
  for (const chunk of chunks) {
    await fbCall("/me/messages", {
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message: { text: chunk },
    });
  }
}

function chunkText(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max));
  return out;
}

// PSID allowlist. Only the people listed in ALLOWED_PSIDS env var can talk to the
// trainer bot — the bot has write access to the production repo, so an unauthorized
// user is a real risk.
//
// First-run convenience: if ALLOWED_PSIDS is unset/empty, the bot logs the sender's
// PSID and rejects the message politely. The operator copies that PSID into the env
// var and redeploys.
const ALLOWED = (process.env.ALLOWED_PSIDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function isAuthorized(psid: string): boolean {
  if (ALLOWED.length === 0) return false;
  return ALLOWED.includes(psid);
}

export function hasAllowlist(): boolean {
  return ALLOWED.length > 0;
}

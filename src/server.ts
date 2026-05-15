// Express server for the Zaisan trainer Messenger bot.
//   GET  /          → liveness check
//   GET  /health    → JSON ok (Render health check)
//   GET  /webhook   → FB verify handshake
//   POST /webhook   → incoming messaging events
//
// Per-event flow:
//   1. Acknowledge 200 to FB immediately, process in background.
//   2. Auth-check the sender PSID against ALLOWED_PSIDS — if not on the allowlist,
//      log the PSID (so the operator can copy it into env) and reply with a polite
//      rejection. The trainer bot writes to the prod repo, so unauthorized senders
//      are a real risk.
//   3. Pass the text to the orchestrator. The orchestrator handles add/clear/apply
//      via Claude tool calls.
import "dotenv/config";
import express, { type Request, type Response } from "express";
import { runTrainerTurn } from "./claude.js";
import { getHistory, setHistory } from "./conversation.js";
import { hasAllowlist, isAuthorized } from "./auth.js";
import { sendText, sendTypingOn, verifySignature, verifyWebhook } from "./facebook.js";

const app = express();

app.use(
  "/webhook",
  express.raw({ type: "application/json", limit: "1mb" })
);
app.use(express.json());

const PORT = Number(process.env.PORT ?? 8080);

app.get("/", (_req, res) => {
  res.send("Zaisan trainer bot is running.");
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/webhook", (req: Request, res: Response) => {
  const result = verifyWebhook(req.query as Record<string, string | undefined>);
  if (result.ok) {
    res.status(200).send(result.challenge);
  } else {
    console.warn("[webhook] verify rejected", result.reason);
    res.sendStatus(403);
  }
});

app.post("/webhook", (req: Request, res: Response) => {
  const raw = req.body as Buffer;
  if (!verifySignature(raw, req.header("x-hub-signature-256") ?? undefined)) {
    console.warn("[webhook] bad signature, rejecting");
    res.sendStatus(403);
    return;
  }
  let body: WebhookBody;
  try {
    body = JSON.parse(raw.toString("utf8")) as WebhookBody;
  } catch {
    res.sendStatus(400);
    return;
  }

  res.sendStatus(200);

  if (body.object !== "page") return;
  for (const entry of body.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      handleEvent(event).catch((err) => {
        console.error("[handler] uncaught", err);
      });
    }
  }
});

interface WebhookBody {
  object?: string;
  entry?: { messaging?: MessagingEvent[] }[];
}

interface MessagingEvent {
  sender?: { id?: string };
  message?: {
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
  };
  postback?: { payload?: string };
}

async function handleEvent(event: MessagingEvent): Promise<void> {
  const psid = event.sender?.id;
  if (!psid) return;
  if (event.message?.is_echo) return;

  const text =
    event.message?.text ??
    event.message?.quick_reply?.payload ??
    event.postback?.payload;
  if (!text) return;

  console.log(`[msg in] ${psid}: ${text}`);

  if (!isAuthorized(psid)) {
    if (!hasAllowlist()) {
      console.warn(
        `[auth] ALLOWED_PSIDS empty — rejecting ${psid}. Copy this PSID into the env var and redeploy.`
      );
    } else {
      console.warn(`[auth] rejected unauthorized PSID ${psid}`);
    }
    await sendText(
      psid,
      `Уучлаарай, та эрхгүй байна.\nТаны Facebook ID: ${psid}\nХэрэв та админ бол энэ ID-г ALLOWED_PSIDS орчны хувьсагчид нэмээрэй.`
    ).catch(() => undefined);
    return;
  }

  await sendTypingOn(psid).catch(() => undefined);

  try {
    const history = getHistory(psid);
    const result = await runTrainerTurn(psid, history, text);
    setHistory(psid, result.history);
    if (result.reply) {
      await sendText(psid, result.reply).catch((err) =>
        console.error("[fb] sendText failed", err)
      );
    }
  } catch (err) {
    console.error("[trainer] runTrainerTurn failed", err);
    await sendText(
      psid,
      `Алдаа гарлаа: ${(err as Error).message}`
    ).catch(() => undefined);
  }
}

app.listen(PORT, () => {
  console.log(`[zaisan-trainer] listening on :${PORT}`);
  console.log(`[zaisan-trainer] allowlist=${hasAllowlist() ? "set" : "EMPTY"}`);
});

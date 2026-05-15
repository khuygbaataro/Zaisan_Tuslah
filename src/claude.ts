// Trainer-bot chat orchestrator. Each turn:
//   1. Build the system prompt with the current pending list embedded (so Claude
//      always knows what's queued)
//   2. Let Claude decide whether to add a change, clear the queue, or apply it,
//      and respond to the trainer with a short Mongolian acknowledgment
//
// The orchestrator is intentionally thin — the actual file editing happens inside
// the apply_changes tool implementation, which spawns a separate Claude call (see
// applyChanges.ts). Keeping these separate stops the trainer's chat history from
// bloating the editor context and vice versa.
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as pending from "./pending.js";
import { applyPendingChanges } from "./applyChanges.js";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
const MAX_TOOL_LOOPS = 4;

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_TEMPLATE: string = readFileSync(
  join(here, "prompts", "trainer-system-prompt.md"),
  "utf-8"
);

export type Msg = Anthropic.MessageParam;

export interface TrainerTurnResult {
  reply: string;
  history: Msg[];
}

const tools: Anthropic.Tool[] = [
  {
    name: "add_change",
    description:
      "Хэрэглэгчийн (trainer) тодорхойлсон засварыг хүлээгдэж буй жагсаалтад нэмнэ. description-д засварыг товч, тодорхой бичнэ.",
    input_schema: {
      type: "object",
      properties: {
        description: {
          type: "string",
          description:
            "Засварын товч тайлбар (нэг өгүүлбэр). Trainer-ийн хэлсэн зүйлийг тодорхой бичнэ — энэ нь дараа editor-руу очно.",
        },
      },
      required: ["description"],
    },
  },
  {
    name: "clear_pending",
    description:
      "Хүлээгдэж буй бүх засваруудыг устгана. Trainer 'арилгах', 'цэвэрлэх', 'clear' гэхэд дуудна.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "apply_changes",
    description:
      "Хүлээгдэж буй бүх засваруудыг customer bot-ийн файлуудад хэрэгжүүлж GitHub руу commit хийнэ. Trainer 'хэрэгжүүлэх', 'confirm', 'apply' гэхэд дуудна.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

export async function runTrainerTurn(
  psid: string,
  history: Msg[],
  userText: string
): Promise<TrainerTurnResult> {
  const messages: Msg[] = [...history, { role: "user", content: userText }];
  const systemPrompt = SYSTEM_TEMPLATE.replace(
    "{{PENDING_LIST}}",
    pending.format(psid)
  );

  let replyText = "";

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      temperature: 0.2,
      system: systemPrompt,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      replyText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      const result = await runTool(psid, block.name, block.input as Record<string, unknown>);
      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!replyText) {
    replyText = "Алдаа гарлаа. Дахин оролдоно уу.";
  }

  return { reply: replyText, history: messages };
}

async function runTool(
  psid: string,
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  switch (name) {
    case "add_change": {
      const desc = typeof input.description === "string" ? input.description.trim() : "";
      if (!desc) return "Error: description is required";
      const n = pending.add(psid, desc);
      return `Added. Pending count is now ${n}.`;
    }
    case "clear_pending": {
      pending.clear(psid);
      return "Cleared.";
    }
    case "apply_changes": {
      const changes = pending.list(psid);
      if (changes.length === 0) {
        return "No pending changes — nothing to apply.";
      }
      try {
        const result = await applyPendingChanges(changes);
        // Only clear the pending list if at least one commit landed; otherwise the
        // trainer can retry without re-typing instructions.
        if (result.commits.length > 0) pending.clear(psid);
        const commitLines = result.commits
          .map((c) => `${c.path}: ${c.commitUrl}`)
          .join("\n");
        return [
          result.report,
          commitLines || "(No files changed)",
          result.commits.length > 0
            ? "Render автоматаар 5–10 минутын дотор deploy хийнэ."
            : "Хүлээгдэж буй жагсаалт хэвээр үлдсэн.",
        ].join("\n\n");
      } catch (err) {
        return `Apply failed: ${(err as Error).message}`;
      }
    }
    default:
      return `Error: unknown tool '${name}'`;
  }
}

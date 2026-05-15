// Tiny in-memory rolling history per PSID. The trainer bot's chat is small (one or
// two operators) so an in-memory map is plenty — no Firestore dependency here.
import type Anthropic from "@anthropic-ai/sdk";

export type Msg = Anthropic.MessageParam;

interface Thread {
  messages: Msg[];
  lastSeen: number;
}

const MAX_TURNS = 12; // user+assistant pairs
const TTL_MS = 1000 * 60 * 60 * 24; // 24h idle drops the thread
const threads = new Map<string, Thread>();

function gc(): void {
  const cutoff = Date.now() - TTL_MS;
  for (const [k, v] of threads) if (v.lastSeen < cutoff) threads.delete(k);
}

export function getHistory(psid: string): Msg[] {
  gc();
  return threads.get(psid)?.messages ?? [];
}

export function setHistory(psid: string, messages: Msg[]): void {
  threads.set(psid, { messages: trim(messages, MAX_TURNS), lastSeen: Date.now() });
}

function trim(messages: Msg[], maxTurns: number): Msg[] {
  if (messages.length <= maxTurns * 2) return messages;
  const cut = messages.length - maxTurns * 2;
  for (let i = cut; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const content = messages[i].content;
      const isToolResult =
        Array.isArray(content) &&
        content.some(
          (b) => typeof b === "object" && (b as { type?: string }).type === "tool_result"
        );
      if (!isToolResult) return messages.slice(i);
    }
  }
  return messages;
}

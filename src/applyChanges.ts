// Takes the pending list of trainer-described changes and applies them to the
// Zaisan_Tusul repo by:
//   1. Reading both trainable files from GitHub
//   2. Running an "editor Claude" that decides which file(s) to rewrite and outputs
//      the full new contents via a write_file tool
//   3. Pushing each updated file back via the GitHub Contents API (one commit per file)
//
// Why a separate Claude call (not the orchestrator one): the editor needs a focused
// system prompt about being precise/minimal, plus a long context with both files,
// without polluting the trainer chat's working memory.
import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, TRAINABLE_PATHS, isTrainablePath, type TrainablePath } from "./github.js";
import type { PendingChange } from "./pending.js";

const client = new Anthropic();
const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
const MAX_TOOL_LOOPS = 6;

const EDITOR_SYSTEM_PROMPT = `Та Zaisan customer bot-ийн файлуудыг засдаг файл засагч AI.

Танд **хоёр файл** өгөгдөнө:
1. \`src/prompts/zaisan-system-prompt.md\` — Customer bot-ийн дүрэм, хариулах хэв маяг, жишээ
2. \`src/knowledge/zaisan-high-land.md\` — Бодит мэдээлэл (байршил, өрөөний м², утас, г.м.)

**Дүрэм:**
- Trainer-ийн засваруудыг ХАРЦАГА бөгөөд ЗӨВ хэрэгжүүлнэ.
- Бүх засварыг тохирох файлд нь ор. **Дүрэм/хэв маягийн өөрчлөлт** → system-prompt.md. **Бодит мэдээллийн өөрчлөлт** (утас, талбай, өрөөний тоо г.м.) → knowledge.md.
- Хэрэв засвар хоёр файлд хамаатай бол хоёуланд нь хий.
- Хэрэв нэг файл огт өөрчлөгдөхгүй бол түүнийг **бүү** дуудна.
- Файлын одоо байгаа дүр зураг, бүтэц, бусад хэсгийг хэвээр үлдээ — зөвхөн шаардлагатай мөрүүдийг засна.
- write_file tool-д **бүх файлын шинэ агуулгыг** дамжуулна (хэсэгчилсэн биш, бүхэлд нь).

**Ажиллах дараалал:**
1. Файлуудыг уншсан. Trainer-ийн засвар бүрд аль файлд хамаатайг шийдэх.
2. write_file tool-аар тохирох файлуудыг шинэчилнэ.
3. Засвар бүгд хэрэгжсний дараа богино тайлан гарга: "X файлд Y засвар хийлээ" гэх мэт.

Эмодзи, илүү тайлбар бүү бич. Шууд ажил руугаа ор.`;

export interface ApplyResult {
  commits: { path: string; commitUrl: string; commitSha: string }[];
  report: string;
}

export async function applyPendingChanges(changes: PendingChange[]): Promise<ApplyResult> {
  if (changes.length === 0) {
    return { commits: [], report: "Хүлээгдэж буй засвар байхгүй." };
  }

  // Pull current state of both files. We pass these to the editor as the starting point.
  const currentFiles = await Promise.all(
    TRAINABLE_PATHS.map((p) => readFile(p))
  );
  const fileMap = new Map(currentFiles.map((f) => [f.path, f]));

  const userMessage = [
    "Дараах trainer-ийн засваруудыг файлуудад хэрэгжүүл:",
    "",
    ...changes.map((c, i) => `${i + 1}. ${c.description}`),
    "",
    "Файлуудын одоогийн агуулга:",
    "",
    ...currentFiles.flatMap((f) => [
      `=== ${f.path} ===`,
      f.text,
      "",
    ]),
  ].join("\n");

  const tools: Anthropic.Tool[] = [
    {
      name: "write_file",
      description:
        "Файлын шинэ агуулгыг бичнэ. Зөвхөн засагдаж буй файлд дуудна. Бүх агуулгыг бүхэлд нь дамжуулна (хэсэгчилсэн биш).",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            enum: TRAINABLE_PATHS as unknown as string[],
            description: "Засах файлын зам.",
          },
          new_content: {
            type: "string",
            description: "Файлын шинэ бүрэн агуулга.",
          },
        },
        required: ["path", "new_content"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userMessage },
  ];

  const commits: ApplyResult["commits"] = [];
  let report = "";

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      temperature: 0,
      system: EDITOR_SYSTEM_PROMPT,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason !== "tool_use") {
      report = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      if (block.name !== "write_file") {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: unknown tool '${block.name}'`,
          is_error: true,
        });
        continue;
      }
      const input = block.input as { path?: string; new_content?: string };
      const path = input.path;
      const newContent = input.new_content;
      if (!path || !isTrainablePath(path)) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: path '${path}' is not in the trainable allowlist`,
          is_error: true,
        });
        continue;
      }
      if (typeof newContent !== "string" || newContent.length === 0) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: "Error: new_content must be a non-empty string",
          is_error: true,
        });
        continue;
      }
      const current = fileMap.get(path);
      if (!current) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Error: file '${path}' not loaded`,
          is_error: true,
        });
        continue;
      }
      if (newContent === current.text) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `No-op: '${path}' unchanged — skipping commit.`,
        });
        continue;
      }
      try {
        const commitMessage = buildCommitMessage(path as TrainablePath, changes);
        const { commitUrl, commitSha } = await writeFile(path, newContent, current.sha, commitMessage);
        commits.push({ path, commitUrl, commitSha });
        // Update local cache so further writes to the same file in the same loop use the new SHA.
        // (In practice Claude only writes each file once, but be safe.)
        fileMap.set(path, { path, text: newContent, sha: commitSha });
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `Committed ${path}: ${commitUrl}`,
        });
      } catch (err) {
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `GitHub error: ${(err as Error).message}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  if (!report) {
    report = commits.length
      ? `${commits.length} файл шинэчиллээ.`
      : "Файл өөрчлөгдсөнгүй.";
  }

  return { commits, report };
}

function buildCommitMessage(path: TrainablePath, changes: PendingChange[]): string {
  const short = path.split("/").pop() ?? path;
  const head = `trainer: update ${short}`;
  const body = changes.map((c, i) => `- ${i + 1}. ${c.description}`).join("\n");
  return `${head}\n\n${body}\n\nApplied via Zaisan Trainer bot.`;
}

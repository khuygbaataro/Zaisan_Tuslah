// Minimal GitHub Contents API client. We read the two trainable files from the
// Zaisan_Tusul repo, let Claude rewrite them, then PUT the new content back as a
// new commit on `main`. The Contents API takes care of the commit + tree internally
// so we don't have to deal with raw git plumbing.
//
// Token: GITHUB_TOKEN must be a PAT (classic, `repo` scope) or fine-grained PAT with
// Contents: read/write on the target repo.
const GITHUB_API = "https://api.github.com";

function owner(): string {
  return process.env.GITHUB_OWNER ?? "";
}
function repo(): string {
  return process.env.GITHUB_REPO ?? "";
}
function branch(): string {
  return process.env.GITHUB_BRANCH ?? "main";
}
function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN not set");
  return t;
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "zaisan-trainer-bot",
  };
}

export interface FileContent {
  path: string;
  text: string;
  sha: string; // current blob SHA, required to PUT a new version
}

/** Fetch a file's current text and blob SHA on the configured branch. */
export async function readFile(path: string): Promise<FileContent> {
  const url = `${GITHUB_API}/repos/${owner()}/${repo()}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(branch())}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub readFile ${path} failed: ${res.status} ${body}`);
  }
  const data = (await res.json()) as { content: string; sha: string; encoding: string };
  if (data.encoding !== "base64") {
    throw new Error(`Unexpected GitHub encoding: ${data.encoding}`);
  }
  const text = Buffer.from(data.content, "base64").toString("utf-8");
  return { path, text, sha: data.sha };
}

/**
 * Commit a new version of a file. The current SHA is required so GitHub can detect
 * lost updates (someone else committed in between read and write).
 * Returns the new commit's HTML URL so the trainer can review it in the browser.
 */
export async function writeFile(
  path: string,
  newText: string,
  prevSha: string,
  commitMessage: string
): Promise<{ commitUrl: string; commitSha: string }> {
  const url = `${GITHUB_API}/repos/${owner()}/${repo()}/contents/${encodeURIComponent(path)}`;
  const body = {
    message: commitMessage,
    content: Buffer.from(newText, "utf-8").toString("base64"),
    sha: prevSha,
    branch: branch(),
  };
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`GitHub writeFile ${path} failed: ${res.status} ${errBody}`);
  }
  const data = (await res.json()) as { commit: { sha: string; html_url: string } };
  return { commitUrl: data.commit.html_url, commitSha: data.commit.sha };
}

export const TRAINABLE_PATHS = [
  "src/prompts/zaisan-system-prompt.md",
  "src/knowledge/zaisan-high-land.md",
] as const;

export type TrainablePath = (typeof TRAINABLE_PATHS)[number];

export function isTrainablePath(p: string): p is TrainablePath {
  return (TRAINABLE_PATHS as readonly string[]).includes(p);
}

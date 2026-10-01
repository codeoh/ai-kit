import { profileToPromptBlock } from "./profile";
import type { AiLang, SceneDeclaration } from "./types";

export function truncateRecords(records: unknown[], limit: number): string {
  const s = JSON.stringify(records);
  if (s.length <= limit) return s;
  return s.slice(0, limit) + "…[已截断]";
}

/**
 * system prompt：角色 + 任务 + 七条强制不变量 + 输出契约 + 语义档案注入。
 * 七条不变量包内固定追加，消费方只能通过 extraRules 增量添加，不可关闭。
 */
export function buildSystemPrompt(scene: SceneDeclaration, lang: AiLang): string {
  const langName = lang === "zh" ? "中文" : "英文";
  const lines: string[] = [];
  lines.push(scene.prompt.role.trim());
  lines.push("");
  lines.push(scene.prompt.task.trim());
  lines.push("");
  lines.push("硬性规则（逐条遵守，不可违反）：");
  lines.push(`1. 输出语言必须是${langName}，与输入记录原文语言无关；原文为其他语言时必须翻译成${langName}。`);
  lines.push("2. 专有名词（人名/客户名/产品名/项目名/单号编号/数字）保持原文写法，禁止翻译改写。");
  lines.push("3. 统计数字不得由你编造或计算，只能原样引用输入中标注为程序统计的数字。");
  lines.push("4. refs 数组只能引用输入记录中出现的 id，禁止编造 id。");
  lines.push("5. 没有相关内容就输出空数组，禁止编造内容。");
  lines.push("6. 只输出一个紧凑 JSON 对象，不要输出任何解释、markdown 代码块或多余文本。");
  lines.push("7. 每条文本为一句话，不带序号、不带编号前缀。");
  if (scene.profile) {
    lines.push("");
    lines.push(profileToPromptBlock(scene.profile));
  }
  if (scene.prompt.extraRules?.length) {
    lines.push("");
    for (const rule of scene.prompt.extraRules) lines.push(`- ${rule}`);
  }
  lines.push("");
  lines.push(outputContract(scene));
  return lines.join("\n");
}

function outputContract(scene: SceneDeclaration): string {
  if (scene.output.kind === "sections") {
    const keys = JSON.stringify(scene.output.sections);
    return `输出格式：一个 JSON 对象，键固定为 ${keys}；每个键的值是对象数组，元素形如 {"text": string, "refs": string[]}。`;
  }
  const keys = JSON.stringify(scene.output.dims);
  return `输出格式：一个 JSON 对象，键固定为 ${keys}；每个键的值形如 {"score": number, "reason": string, "refs": string[]}。`;
}

/** user prompt：输入记录快照 + 程序统计结果（数字不经 LLM 产出） */
export function buildUserPrompt(
  scene: SceneDeclaration,
  records: unknown[],
  stats?: unknown,
): string {
  const limit = scene.limits?.inputTruncate ?? 20000;
  let s = `输入记录（其中的 id 是 refs 的唯一合法取值）：\n${truncateRecords(records, limit)}`;
  if (stats !== undefined) {
    s += `\n\n以下数字已由程序统计，直接引用、禁止改写：\n${JSON.stringify(stats)}`;
  }
  return s;
}

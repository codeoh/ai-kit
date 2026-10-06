import { profileToPromptBlock, type DataProfile } from "./profile";
import { fitRecords } from "./promptUtils";
import type { AiLang, Scene } from "./types";

/**
 * 7 条硬规则的中英双份。
 *
 * 早期实现只有中文，lang="en" 时实测 system prompt 454 字符里有 213 个是中文
 * —— 英文用户拿到的是中文指令，跨语言指令遵循率会下降。现在按lang 切换。
 */
function hardRules(lang: AiLang): string[] {
  if (lang === "zh") {
    return [
      "1. 输出语言必须是中文，与输入记录原文语言无关；原文为其他语言时必须翻译成中文。",
      "2. 专有名词（人名/客户名/产品名/项目名/单号编号/数字）保持原文写法，禁止翻译改写。",
      "3. 统计数字不得由你编造或计算，只能原样引用输入中标注为程序统计的数字。",
      "4. refs 数组只能引用输入记录中出现的 id，禁止编造 id。",
      "5. 没有相关内容就输出空数组，禁止编造内容。",
      "6. 只输出一个紧凑 JSON 对象，不要输出任何解释、markdown 代码块或多余文本。",
      "7. 每条文本为一句话，不带序号、不带编号前缀。",
    ];
  }
  return [
    "1. Output language must be English, regardless of the language of the input records; translate any other source language into English.",
    "2. Proper nouns (person names, customer names, product names, project names, ticket ids, numbers) must stay exactly as written; do not translate or reword them.",
    "3. Never invent or compute statistics yourself; only quote numbers that the input marks as program-computed.",
    "4. Every id in refs must be one that appears in the input records. Do not invent ids.",
    "5. When there is nothing to report, output an empty array. Do not fabricate content.",
    "6. Output one compact JSON object only — no explanation, no markdown code block, no surrounding text.",
    "7. Each text value is a single sentence, without numbering or list prefixes.",
  ];
}

function defaultRole(lang: AiLang): string {
  return lang === "zh"
    ? "你是一个严格遵守输出规则的助手。"
    : "You are a precise assistant that follows output rules strictly.";
}

function outputContract(scene: Scene, lang: AiLang): string {
  const keys = JSON.stringify(scene.output.keys);
  if (lang === "zh") {
    if (scene.output.kind === "sections") {
      return `输出格式：一个 JSON 对象，键固定为 ${keys}；每个键的值是对象数组，元素形如 {"text": string, "refs": string[]}。`;
    }
    return `输出格式：一个 JSON 对象，键固定为 ${keys}；每个键的值形如 {"score": number, "reason": string, "refs": string[]}。`;
  }
  if (scene.output.kind === "sections") {
    return `Output format: one JSON object with exactly the keys ${keys}; each value is an array of objects shaped {"text": string, "refs": string[]}.`;
  }
  return `Output format: one JSON object with exactly the keys ${keys}; each value shaped {"score": number, "reason": string, "refs": string[]}.`;
}

/** 语义契约块也随lang 切换，否则 en 用户的整段提示词里夹着中文术语 */
function profileBlock(p: DataProfile, lang: AiLang): string {
  if (lang === "en") {
    const lines: string[] = [`[Data contract - entity: ${p.entity}]`];
    for (const f of p.fields) {
      let line = `- ${f.name}: ${f.meaning}`;
      if (f.dict) line += ` (dictionary: ${f.dict})`;
      if (f.authoritative) line += " (authoritative field)";
      if (f.pii) line += " (sensitive field)";
      if (f.fallback) line += `; when missing: ${f.fallback}`;
      lines.push(line);
    }
    if (p.unavailable?.length) {
      lines.push(`- Not available yet (never attribute or advise based on these): ${p.unavailable.join(", ")}`);
    }
    if (p.localeFacts?.length) {
      lines.push(`- Locale facts: ${p.localeFacts.join("; ")}`);
    }
    return lines.join("\n");
  }
  return profileToPromptBlock(p);
}

/**
 * system prompt：角色 + 任务 + 7 条硬规则 + 语义契约 + 追加规则 + 输出契约。
 * 7 条规则由包固定注入，消费方只能通过 extraRules 追加，不可关闭。
 */
export function buildSystemPrompt(scene: Scene, lang: AiLang): string {
  const lines: string[] = [];
  lines.push(scene.role?.trim() || defaultRole(lang));
  lines.push("");
  lines.push(scene.task.trim());
  lines.push("");
  lines.push(lang === "zh" ? "硬性规则（逐条遵守，不可违反）：" : "Hard rules (follow every one):");
  lines.push(...hardRules(lang));
  if (scene.profile) {
    lines.push("");
    lines.push(profileBlock(scene.profile, lang));
  }
  if (scene.extraRules?.length) {
    lines.push("");
    for (const rule of scene.extraRules) lines.push(`- ${rule}`);
  }
  lines.push("");
  lines.push(outputContract(scene, lang));
  return lines.join("\n");
}

/**
 * user prompt：输入记录 + 程序统计结果。
 * 记录超长时按整条丢弃，并明确告知模型还有多少条没纳入——
 * 让模型知道自己的视野边界，而不是对着半截JSON 猜。
 */
export function buildUserPrompt(
  scene: Scene,
  records: unknown[],
  stats?: unknown,
  lang: AiLang = "en",
): string {
  const zh = lang === "zh";
  const limit = scene.limits?.inputTruncate ?? 20000;
  const { kept, dropped } = fitRecords(records, limit);
  const json = JSON.stringify(kept);
  let s: string;
  if (dropped > 0) {
    s = zh
      ? `输入记录（共 ${records.length} 条，以下 ${kept.length} 条；其中的 id 是 refs 的唯一合法取值）：\n${json}\n\n注意：另有 ${dropped} 条记录因长度限制未纳入，请勿推测它们的内容。`
      : `Input records (${kept.length} of ${records.length}; the id field is the only legal value for refs):\n${json}\n\nNote: ${dropped} more records were omitted due to length limits. Do not speculate about their content.`;
  } else {
    s = zh
      ? `输入记录（其中的 id 是 refs 的唯一合法取值）：\n${json}`
      : `Input records (the id field is the only legal value for refs):\n${json}`;
  }
  if (stats !== undefined) {
    s += zh
      ? `\n\n以下数字已由程序统计，直接引用、禁止改写：\n${JSON.stringify(stats)}`
      : `\n\nThe numbers below were computed by code. Quote them as they are; do not rewrite them:\n${JSON.stringify(stats)}`;
  }
  return s;
}

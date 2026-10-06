/**
 * 输入记录裁剪。
 *
 * 早期实现按字符硬切（slice(0, limit) + "…[已截断]"），实测送出的是一段
 * 语法错误的 JSON：JSON.parse 报 Unterminated string。模型收到坏 JSON 却
 * 不知道自己看的是残缺数据，于是基于残缺输入凭空编造；而引用白名单用的是
 * 未截断的完整记录，模型看不到后半部分的记录也就不会引用它们。
 *
 * 现在改成按记录整条丢弃：留下的一定是合法 JSON，且明确告知模型
 * "还有 N 条没纳入"，让它知道视野边界在哪。
 */
export interface FittedRecords {
  /** 留下的记录（一定是完整记录） */
  kept: unknown[];
  /** 因超长被丢弃的记录数 */
  dropped: number;
}

/** 把 kept 完整序列化后的字符数（用于判断还能不能再塞一条） */
function serializedLength(items: unknown[], sumOfLens: number): number {
  return 2 + sumOfLens + Math.max(0, items.length - 1);
}

export function fitRecords(records: unknown[], limit: number): FittedRecords {
  if (records.length === 0) return { kept: [], dropped: 0 };
  if (JSON.stringify(records).length <= limit) return { kept: records, dropped: 0 };

  const kept: unknown[] = [];
  let sum = 0;
  for (const r of records) {
    const len = JSON.stringify(r).length;
    // 已有一条时，还要算上分隔用的逗号
    if (kept.length > 0 && serializedLength([...kept, r], sum + len) > limit) break;
    kept.push(r);
    sum += len;
  }
  // 单条记录本身就超限时不能丢干净——否则模型拿到空输入，
  // 只能凭空编。宁可超限也要给它这一条。
  if (kept.length === 0) kept.push(records[0]);
  return { kept, dropped: records.length - kept.length };
}

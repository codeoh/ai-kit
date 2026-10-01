/** 输入记录 JSON 截断 */
export function truncateRecords(records: unknown[], limit: number): string {
  const s = JSON.stringify(records);
  if (s.length <= limit) return s;
  return s.slice(0, limit) + "…[已截断]";
}

/** FNV-1a 32 位哈希，够用于缓存键；不承担安全职责 */
export function hashContent(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export interface CacheKeyInput {
  sceneId: string;
  /** 登录人（只进缓存键隔离身份，不进 prompt） */
  identity: string;
  /** 范围名（客户名等） */
  scope: string;
  contentHash: string;
  lang: string;
  schemaVersion: number;
}

/** 缓存键：登录人 | 范围 | 内容哈希 | 语言 | schema 版本——数据/语言变化自然换键，契约改版靠 schemaVersion 换键 */
export function buildCacheKey(o: CacheKeyInput): string {
  return `ai:${o.sceneId}:${o.identity}:${o.scope}:${o.contentHash}:${o.lang}:v${o.schemaVersion}`;
}

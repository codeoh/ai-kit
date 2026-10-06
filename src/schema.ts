import type { Scene } from "./types";

/** JSON Schema 节点（只用到结构化输出需要的子集） */
export interface JsonSchemaNode {
  type: "object" | "array" | "string" | "number";
  properties?: Record<string, JsonSchemaNode>;
  items?: JsonSchemaNode;
  required?: string[];
  additionalProperties?: boolean;
}

const refsArray: JsonSchemaNode = {
  type: "array",
  items: { type: "string" },
};

/**
 * 从 scene 声明推导结构化输出用的 JSON Schema。
 * 两种输出形状都能机械推导出来，消费方不需要手写 schema。
 *
 * 注意：schema 只能约束形状，约束不了"refs 里的 id 是否真实存在"
 * ——引用白名单由 filterRefIds 负责，两者互补，不可互相替代。
 */
export function sceneToJsonSchema(scene: Scene): JsonSchemaNode {
  if (scene.output.kind === "sections") {
    return {
      type: "object",
      additionalProperties: false,
      required: [...scene.output.keys],
      properties: Object.fromEntries(
        scene.output.keys.map((key) => [
          key,
          {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["text", "refs"],
              properties: {
                text: { type: "string" },
                refs: refsArray,
              },
            },
          },
        ]),
      ),
    };
  }
  return {
    type: "object",
    additionalProperties: false,
    required: [...scene.output.keys],
    properties: Object.fromEntries(
      scene.output.keys.map((key) => [
        key,
        {
          type: "object",
          additionalProperties: false,
          required: ["score", "reason", "refs"],
          properties: {
            score: { type: "number" },
            reason: { type: "string" },
            refs: refsArray,
          },
        },
      ]),
    ),
  };
}

/** schema 的稳定名字：OpenAI 要求 json_schema.name 匹配 ^[A-Za-z0-9_-]+$ */
export function schemaName(scene: Scene): string {
  const raw = scene.id.replace(/[^A-Za-z0-9_-]/g, "_");
  return raw.length > 0 ? raw : "scene_output";
}

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "evals/**/*.test.ts"],
    // 单进程 fork：本机沙箱对 vitest worker 的 Temp 写入不稳定，会随机丢测试文件
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
});

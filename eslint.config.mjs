// eslint-config-next 16 exports native flat config — no FlatCompat needed.
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import boundaries from "eslint-plugin-boundaries";

const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { boundaries },
    settings: {
      "boundaries/elements": [
        { type: "kernel", pattern: "src/kernel", mode: "folder" },
        { type: "module", pattern: "src/modules/*", mode: "folder", capture: ["module"] },
        { type: "lib", pattern: "src/lib", mode: "folder" },
        { type: "app", pattern: "src/app", mode: "folder" },
        // 미들웨어는 src 루트 파일이라 별도 분류(edge). 미분류면 no-unknown이 잡는다.
        { type: "edge", pattern: "src/middleware.ts", mode: "file" },
        { type: "ui", pattern: "src/components", mode: "folder" },
      ],
    },
    rules: {
      // src 안의 모든 파일이 한 element로 분류돼야 한다(분류 누락 = 경계 미적용 사각지대 차단).
      "boundaries/no-unknown": 2,
      "boundaries/element-types": [
        2,
        {
          default: "disallow",
          rules: [
            { from: ["lib"], allow: ["lib"] },
            { from: ["kernel"], allow: ["kernel", "lib"] },
            { from: ["module"], allow: ["kernel", "lib", ["module", { module: "${from.module}" }]] },
            // admin 모듈은 leave 공통 메일 드레인 트리거를 재사용한다(S8 — 공통 MailDelivery 워커).
            { from: [["module", { module: "admin" }]], allow: [["module", { module: "leave" }]] },
            { from: ["app"], allow: ["app", "kernel", "lib", "module", "ui"] },
            { from: ["ui"], allow: ["ui", "lib"] },
            // 미들웨어(edge)는 lib만 — 단, lib/auth/index(node) import 금지는 element 단위로는
            // 강제 못 한다(SC-7). 그 한 줄은 authConfig 분리 + Next 빌드가 막는다.
            { from: ["edge"], allow: ["lib"] },
          ],
        },
      ],
    },
  },
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        2,
        {
          paths: [
            {
              name: "@/kernel/settings",
              message: "modules must import settings only via @/kernel/settings/reader",
            },
          ],
          patterns: [
            {
              group: [
                "@/kernel/settings/service",
                "@/kernel/settings/index",
                "@/kernel/settings/catalog",
                "@/kernel/settings/repository",
                "@/kernel/settings/registry",
              ],
              message: "modules must import settings only via @/kernel/settings/reader",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;

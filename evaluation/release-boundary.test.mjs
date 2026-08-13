// @vitest-environment node

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  assertAllowedBuildModule,
  assertAllowedPackageFile,
  assertNoEvaluationArtifacts,
  assertNoRemoteStylesheetResources,
  collectLocalPageAssets,
} from "../scripts/lib/release-boundary.mjs";
import {
  createPackageInputManifest,
  hashPackageInput,
} from "../scripts/lib/package-input-hash.mjs";

describe("release evaluation boundary", () => {
  it("rejects evaluation paths and markers even inside hashed page assets", () => {
    expect(() =>
      assertNoEvaluationArtifacts({
        packagePath: "assets/index-abc123.js",
        source: "const applicationVersion = '0.1.0';",
      }),
    ).not.toThrow();

    expect(() =>
      assertNoEvaluationArtifacts({
        packagePath: "assets/evaluation-loader.js",
        source: "export const load = () => null;",
      }),
    ).toThrow(/评测目录或加载器/u);

    expect(() =>
      assertNoEvaluationArtifacts({
        packagePath: "assets/index-abc123.js",
        source: "const schemaVersion = 'evaluation-case.v1'; writeEvaluationCache(schemaVersion);",
      }),
    ).toThrow(/评测用例、报告或缓存代码/u);

    expect(() =>
      assertNoEvaluationArtifacts({
        packagePath: "assets/index-abc123.js",
        source: "const evidenceVersion = 'evaluation-evidence-manifest.v1';",
      }),
    ).toThrow(/评测用例、报告或缓存代码/u);
  });

  it("rejects every file that was not produced by the explicit package allowlist", () => {
    const allowedPaths = new Set(["index.html", "assets/index-abc123.js"]);

    expect(() =>
      assertAllowedPackageFile({ packagePath: "assets/index-abc123.js", allowedPaths }),
    ).not.toThrow();
    expect(() =>
      assertAllowedPackageFile({ packagePath: "assets/customer.txt", allowedPaths }),
    ).toThrow(/发布白名单/u);
    expect(() =>
      assertAllowedPackageFile({ packagePath: "assets/private.bin", allowedPaths }),
    ).toThrow(/发布白名单/u);
  });

  it("allows only local hashed page resources and no inline host access", () => {
    expect(
      collectLocalPageAssets(
        '<script type="module" src="./assets/index-abc123.js"></script><link href="./assets/index-abc123.css">',
      ),
    ).toEqual(new Set(["assets/index-abc123.js", "assets/index-abc123.css"]));
    expect(() => collectLocalPageAssets('<script src="https://example.test/app.js"></script>')).toThrow(
      /非本地/u,
    );
    expect(() => collectLocalPageAssets("<script>window.utools.showNotification('x')</script>")).toThrow(
      /内联脚本|宿主/u,
    );
  });

  it("rejects remote resources imported by bundled stylesheets", () => {
    expect(() =>
      assertNoRemoteStylesheetResources(".card { background: url('./local.svg'); }", "assets/app.css"),
    ).not.toThrow();
    expect(() =>
      assertNoRemoteStylesheetResources("@import url('https://evil.test/app.css');", "assets/app.css"),
    ).toThrow(/远程或内嵌资源/u);
  });

  it("rejects page modules imported from evaluation or other project directories", () => {
    const projectRoot = "C:/workspace/translate";

    expect(() =>
      assertAllowedBuildModule({ moduleId: "C:/workspace/translate/src/main.tsx", projectRoot }),
    ).not.toThrow();
    expect(() =>
      assertAllowedBuildModule({
        moduleId: "C:/workspace/translate/evaluation/private/customer.jsonl",
        projectRoot,
      }),
    ).toThrow(/源码边界之外/u);
    expect(() =>
      assertAllowedBuildModule({
        moduleId: "file:///C:/workspace/translate/evaluation/private/customer.jsonl",
        projectRoot,
      }),
    ).toThrow(/源码边界之外/u);
    expect(() =>
      assertAllowedBuildModule({ moduleId: "../evaluation/private/customer.jsonl", projectRoot }),
    ).toThrow(/无法归属/u);
  });

  it("binds the UPXS input digest to every staged file and relative path", async () => {
    const directory = await mkdtemp(resolve(tmpdir(), "ruyi-package-input-"));
    try {
      await mkdir(resolve(directory, "lib"));
      await writeFile(resolve(directory, "index.html"), "page", "utf8");
      await writeFile(resolve(directory, "lib/runtime.cjs"), "runtime", "utf8");
      const manifest = await createPackageInputManifest(directory);
      const digest = createHash("sha256").update(manifest).digest("hex");
      expect(await hashPackageInput(directory)).toBe(digest);
      await writeFile(resolve(directory, "lib/runtime.cjs"), "changed", "utf8");
      expect(await hashPackageInput(directory)).not.toBe(digest);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

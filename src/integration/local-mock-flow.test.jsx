/** @vitest-environment jsdom */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { App } from "../app/App";
import { translateWithPreload } from "../translation/browser-translation-adapter";

const projectRoot = resolve(import.meta.dirname, "../..");
const mockServicePath = resolve(projectRoot, "scripts/mock-translation-server.mjs");
const preloadPath = resolve(projectRoot, "public/preload.js");

let mockService;

beforeAll(async () => {
  mockService = spawn(process.execPath, [mockServicePath], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  await new Promise((ready, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("本地模拟服务未能按时启动。")),
      5_000,
    );
    let stderr = "";

    mockService.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    mockService.stdout.on("data", (chunk) => {
      if (chunk.toString("utf8").includes("模拟服务已启动")) {
        clearTimeout(timeout);
        ready();
      }
    });
    mockService.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`本地模拟服务提前退出（${code}）：${stderr}`));
    });
  });

  const preloadSource = await readFile(preloadPath, "utf8");
  const preloadWindow = {};
  runInNewContext(
    preloadSource,
    {
      Buffer,
      require: createRequire(preloadPath),
      window: preloadWindow,
    },
    { filename: preloadPath },
  );
  window.ruyiTranslation = preloadWindow.ruyiTranslation;
});

afterAll(async () => {
  delete window.ruyiTranslation;
  if (!mockService || mockService.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolveExit) => mockService.once("exit", resolveExit));
  mockService.kill();
  await exited;
});

describe("controlled local translation flow", () => {
  it("shows the plain translation returned through UI, preload and HTTP", async () => {
    const sourceText = "  source line\n    indented line  ";

    render(
      <App
        intent={{ page: "translation", sourceText, autoStart: false }}
        translate={translateWithPreload}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "开始翻译" }));

    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "这是受控本地模拟服务返回的纯译文。",
    );
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(sourceText);
  });
});

/** @vitest-environment jsdom */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { App } from "../app/App";

const projectRoot = resolve(import.meta.dirname, "../..");
const mockServicePath = resolve(projectRoot, "scripts/mock-translation-server.mjs");
const preloadPath = resolve(projectRoot, "public/preload.js");
const nativeRequire = createRequire(preloadPath);
const plainValues = new Map();
const cryptoValues = new Map();
const credentialFixture = `fixture-${randomUUID()}-1234`;

function memoryStorage(values) {
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, structuredClone(value)),
    removeItem: (key) => values.delete(key),
  };
}

let mockService;
let runtime;

beforeAll(async () => {
  mockService = spawn(process.execPath, [mockServicePath], {
    cwd: projectRoot,
    env: { ...process.env, RUYI_MOCK_CREDENTIAL: credentialFixture },
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

  const runtimeModule = nativeRequire("./lib/ruyi-runtime.cjs");
  const preloadRequire = (id) => {
    if (id === "./lib/ruyi-runtime.cjs") {
      return {
        ...runtimeModule,
        createRuyiRuntime(options) {
          return runtimeModule.createRuyiRuntime({
            ...options,
            servicePreset: {
              id: "deepseek-flash",
              name: "DeepSeek Flash",
              type: "deepseek-official",
              protocol: "chat-completions",
              translationUrl: "http://127.0.0.1:43120/chat/completions",
              modelListUrl: "http://127.0.0.1:43120/models",
              authentication: "bearer",
              model: "deepseek-v4-flash",
              stream: true,
            },
          });
        },
      };
    }
    return nativeRequire(id);
  };
  const preloadSource = await readFile(preloadPath, "utf8");
  const preloadWindow = {
    utools: {
      dbStorage: memoryStorage(plainValues),
      dbCryptoStorage: memoryStorage(cryptoValues),
    },
  };
  runInNewContext(
    preloadSource,
    {
      require: preloadRequire,
      window: preloadWindow,
    },
    { filename: preloadPath },
  );
  runtime = preloadWindow.ruyiTranslation;
});

afterAll(async () => {
  if (!mockService || mockService.exitCode !== null) {
    return;
  }

  const exited = new Promise((resolveExit) => mockService.once("exit", resolveExit));
  mockService.kill();
  await exited;
});

describe("controlled local translation flow", () => {
  it("runs UI, preload runtime and HTTP without exposing or persisting source text", async () => {
    const user = userEvent.setup();
    const sourceText = "  source line\n    indented line  ";

    render(
      <App
        intent={{ page: "translation", sourceText, autoStart: true }}
        runtime={runtime}
      />,
    );
    const apiKeyInput = await screen.findByLabelText("API Key");
    await user.type(apiKeyInput, credentialFixture);
    await user.click(screen.getByRole("button", { name: "保存密钥" }));
    expect(
      await screen.findByRole("dialog", { name: "确认发送翻译数据" }),
    ).toHaveTextContent("http://127.0.0.1:43120/chat/completions");
    await user.click(screen.getByRole("button", { name: "同意并发送" }));

    expect(await screen.findByRole("region", { name: "译文" })).toHaveTextContent(
      "这是受控本地模拟服务返回的纯译文。",
    );
    expect(screen.getByRole("textbox", { name: "源文本" })).toHaveValue(sourceText);
    expect(screen.queryByText(credentialFixture)).not.toBeInTheDocument();
    expect([...cryptoValues.values()]).toEqual([credentialFixture]);
    expect(JSON.stringify([...plainValues.values()])).not.toContain(sourceText);
    expect(JSON.stringify([...plainValues.values()])).not.toContain(
      credentialFixture,
    );
  });
});

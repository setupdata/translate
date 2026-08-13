import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { getBrowserRuntime } from "./runtime/browser-runtime";
import "./styles.css";
import { resolveEntryIntent } from "./utools/entry-intent";

const rootElement = document.querySelector<HTMLDivElement>("#root");

if (!rootElement) {
  throw new Error("找不到应用挂载节点。");
}

const root = createRoot(rootElement);
const runtime = getBrowserRuntime();
let renderSequence = 0;
let receivedPluginEntry = false;

function render(intent: ReturnType<typeof resolveEntryIntent>): void {
  renderSequence += 1;
  root.render(
    <App key={renderSequence} intent={intent} runtime={runtime} />,
  );
}

runtime.subscribePluginEntry?.((action) => {
  if (action.code !== "translate" && action.code !== "settings") {
    return;
  }

  receivedPluginEntry = true;
  render(
    resolveEntryIntent({
      code: action.code,
      type: action.type,
      payload: action.payload,
    }),
  );
});

if (!receivedPluginEntry) {
  render(resolveEntryIntent({ code: "translate", type: "text", payload: "" }));
}

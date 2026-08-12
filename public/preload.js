const { createNodeChatTransport } = require("./lib/node-chat-transport.cjs");
const { createRuyiRuntime } = require("./lib/ruyi-runtime.cjs");

function createMemoryStorage() {
  const values = new Map();
  return Object.freeze({
    getItem(key) {
      return values.get(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  });
}

function createUnavailableCryptoStorage() {
  return Object.freeze({
    getItem() {
      return undefined;
    },
    setItem() {
      throw new Error("uTools 加密存储不可用，API Key 未保存。");
    },
    removeItem() {
      throw new Error("uTools 加密存储不可用，无法删除 API Key。");
    },
  });
}

const host = window.utools;
const plainStorage = host && host.dbStorage ? host.dbStorage : createMemoryStorage();
const cryptoStorage =
  host && host.dbCryptoStorage
    ? host.dbCryptoStorage
    : createUnavailableCryptoStorage();

window.ruyiTranslation = createRuyiRuntime({
  plainStorage,
  cryptoStorage,
  transport: createNodeChatTransport(),
  hostActions: {
    copyText(text) {
      return Boolean(host && typeof host.copyText === "function" && host.copyText(text));
    },
    pasteText(text) {
      return Boolean(
        host &&
          typeof host.hideMainWindowPasteText === "function" &&
          host.hideMainWindowPasteText(text),
      );
    },
  },
});

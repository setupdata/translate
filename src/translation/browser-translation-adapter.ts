export async function translateWithPreload(sourceText: string): Promise<string> {
  const bridge = window.ruyiTranslation;

  if (!bridge) {
    throw new Error("翻译服务尚未就绪，请在 uTools 中打开插件。");
  }

  return bridge.translate(sourceText);
}

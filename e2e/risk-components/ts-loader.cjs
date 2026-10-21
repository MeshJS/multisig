// Webpack bundled with Next is reused; no test bundler dependency is added.
const ts = require("typescript");
/** @param {string} source @this {{ resourcePath: string }} */
module.exports = function (source) {
  return ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: this.resourcePath,
  }).outputText;
};

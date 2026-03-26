if (!globalThis.__consoleLogFilterInstalled) {
  console.log = () => {};
  console.info = () => {};
  console.warn = () => {};
  console.debug = () => {};

  globalThis.__consoleLogFilterInstalled = true;
}

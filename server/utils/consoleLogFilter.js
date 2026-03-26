const ALLOWED_PREFIXES = [
  "message received :",
  "message from :",
  "was auto replied? :",
  "name of the auto reply triggered :",
];

if (!globalThis.__consoleLogFilterInstalled) {
  const shouldAllow = (args) => {
    if (!args.length) return;

    const firstArg = typeof args[0] === "string" ? args[0].trimStart() : "";
    return ALLOWED_PREFIXES.some((prefix) => firstArg.startsWith(prefix));
  };

  const rawConsoleLog = console.log.bind(console);
  const rawConsoleInfo = console.info.bind(console);
  const rawConsoleWarn = console.warn.bind(console);
  const rawConsoleDebug = console.debug.bind(console);

  console.log = (...args) => {
    if (shouldAllow(args)) rawConsoleLog(...args);
  };
  console.info = (...args) => {
    if (shouldAllow(args)) rawConsoleInfo(...args);
  };
  console.warn = (...args) => {
    if (shouldAllow(args)) rawConsoleWarn(...args);
  };
  console.debug = (...args) => {
    if (shouldAllow(args)) rawConsoleDebug(...args);
  };

  globalThis.__consoleLogFilterInstalled = true;
}

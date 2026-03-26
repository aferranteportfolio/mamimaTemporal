const ALLOWED_PREFIXES = [
  "message received :",
  "message from :",
  "was auto replied? :",
  "name of the auto reply triggered :",
];

if (!globalThis.__consoleLogFilterInstalled) {
  const allow = (args) => {
    if (!args.length) return false;
    if (typeof args[0] !== "string") return false;
    const text = args[0].trimStart();
    return ALLOWED_PREFIXES.some((prefix) => text.startsWith(prefix));
  };

  const rawLog = console.log.bind(console);
  const rawInfo = console.info.bind(console);
  const rawWarn = console.warn.bind(console);
  const rawDebug = console.debug.bind(console);

  console.log = (...args) => {
    if (allow(args)) rawLog(...args);
  };
  console.info = (...args) => {
    if (allow(args)) rawInfo(...args);
  };
  console.warn = (...args) => {
    if (allow(args)) rawWarn(...args);
  };
  console.debug = (...args) => {
    if (allow(args)) rawDebug(...args);
  };

  globalThis.__consoleLogFilterInstalled = true;
}

const ALLOWED_PREFIXES = [
  "message received :",
  "message from :",
  "was auto replied? :",
  "name of the auto reply triggered :",
];

if (!globalThis.__consoleLogFilterInstalled) {
  const rawConsoleLog = console.log.bind(console);

  console.log = (...args) => {
    if (!args.length) return;

    const firstArg = typeof args[0] === "string" ? args[0].trimStart() : "";
    const isAllowed = ALLOWED_PREFIXES.some((prefix) => firstArg.startsWith(prefix));

    if (isAllowed) {
      rawConsoleLog(...args);
    }
  };

  globalThis.__consoleLogFilterInstalled = true;
}

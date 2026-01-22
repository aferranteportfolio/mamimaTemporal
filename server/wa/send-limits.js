export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Token bucket: allow N tokens, refills over time.
export function createTokenBucket({ ratePerSec = 5, burst = 10 }) {
  let tokens = burst;
  let last = Date.now();

  function refill() {
    const now = Date.now();
    const elapsed = (now - last) / 1000;
    last = now;
    tokens = Math.min(burst, tokens + elapsed * ratePerSec);
  }

  return {
    async take(n = 1) {
      while (true) {
        refill();
        if (tokens >= n) {
          tokens -= n;
          return;
        }
        await sleep(50);
      }
    }
  };
}

// Per-recipient minimum gap (prevents 131056 when same "to" is hammered)
export function createPairLimiter({ minGapMs = 6000 }) {
  const lastSentAt = new Map(); // to -> ms

  return {
    async waitTurn(to) {
      if (!minGapMs) return;
      while (true) {
        const last = lastSentAt.get(to) || 0;
        const wait = last + minGapMs - Date.now();
        if (wait <= 0) return;
        await sleep(Math.min(wait, 250));
      }
    },
    markSent(to) {
      lastSentAt.set(to, Date.now());
    }
  };
}

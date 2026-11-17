// What the server does when the host tells it to stop (SIGTERM on every deploy, SIGINT on Ctrl+C):
// stop taking new work, let what is running finish, and leave. Without a handler Node exits at once
// and drops every open request and socket; with one that waits for ever, the host kills the process
// after its own grace period anyway, so the wait has its own limit.

export interface ShutdownOptions {
  /** Stops everything the process runs and resolves when it has stopped. */
  close: () => Promise<void>;
  /** How long to wait for `close` before giving up and leaving with an error. */
  timeoutMs?: number;
  /** Leaves the process; process.exit unless a test says otherwise. */
  exit?: (code: number) => void;
  signals?: NodeJS.Signals[];
}

/** Listens for the stop signals and returns the function that stops listening. A second signal while stopping changes nothing. */
export function installShutdownHandlers({
  close,
  timeoutMs = 10_000,
  exit = (code) => process.exit(code),
  signals = ['SIGTERM', 'SIGINT'],
}: ShutdownOptions): () => void {
  let stopping = false;

  const onSignal = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: shutting down`);

    const giveUp = setTimeout(() => {
      console.error(`Shutdown took longer than ${timeoutMs} ms: leaving anyway`);
      exit(1);
    }, timeoutMs);
    giveUp.unref();

    close().then(
      () => {
        clearTimeout(giveUp);
        exit(0);
      },
      (error) => {
        clearTimeout(giveUp);
        console.error('Error while shutting down:', error);
        exit(1);
      },
    );
  };

  for (const signal of signals) process.on(signal, onSignal);
  return () => {
    for (const signal of signals) process.off(signal, onSignal);
  };
}

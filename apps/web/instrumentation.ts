export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundRuntime } = await import("@/lib/background-runtime");
    startBackgroundRuntime();
  }
}

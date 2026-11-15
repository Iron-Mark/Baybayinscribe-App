/** Start one question countdown. The caller owns cancellation on question changes. */
export function startQuestionTimer(
  duration: number,
  onTick: (remaining: number) => void,
  onEnd: () => void,
) {
  let remaining = Math.max(0, duration);
  onTick(remaining);
  if (remaining === 0) {
    onEnd();
    return () => {};
  }
  const timer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    onTick(remaining);
    if (remaining === 0) {
      clearInterval(timer);
      onEnd();
    }
  }, 1000);
  return () => clearInterval(timer);
}

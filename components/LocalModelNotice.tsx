"use client";

import { InferenceStatus, useInferenceStore } from "@/app/store/store.inference";
import { Button } from "@/components/ui/button";

export default function LocalModelNotice() {
  const status = useInferenceStore((state) => state.status);
  const initLocalModel = useInferenceStore((state) => state.initLocalModel);
  if (status === InferenceStatus.READY || status === InferenceStatus.IDLE) return null;
  return (
    <div className="m-4 rounded-lg border border-blue-400 bg-blue-900 p-4 text-blue-200">
      {status === InferenceStatus.ERROR ? (
        <div role="alert">
          <p>Recognition could not start. Check your connection and retry. You can still draw or leave this page.</p>
          <Button className="mt-2" onClick={() => void initLocalModel()}>Retry recognition</Button>
        </div>
      ) : (
        <p role="status">
          {status === InferenceStatus.WARMING_UP ? "Preparing recognition…" : "Loading recognition…"}
          {" "}First use can take a little while. You can draw or explore other pages while it loads.
        </p>
      )}
    </div>
  );
}

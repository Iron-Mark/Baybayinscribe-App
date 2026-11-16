"use client";
import React, { useState, useEffect } from "react";
import StandaloneSketchpad from "@/components/sketchpad/StandaloneSketchpad";
import { SketchpadProvider } from "@/app/contexts/SketchpadContext";
import LocalModelNotice from "@/components/LocalModelNotice";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const Sketchpad = () => {
  // show accuracy notice once
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("agreedAccuracyNotice")) {
      setInfoOpen(true);
    }
  }, []);

  return (
    <>
      <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Model Accuracy Notice</DialogTitle>
            <DialogDescription className="text-blue-200">
              The AI model may not be 100% accurate. Expect occasional misreads
              and always verify the output.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                localStorage.setItem("agreedAccuracyNotice", "true");
                setInfoOpen(false);
              }}
            >
              I Understand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <LocalModelNotice />
      <div className="w-full h-full min-h-screen bg-gradient-to-br from-[#e0e7ff] via-[#f0f4ff] to-[#c7d2fe] flex items-center justify-center">
        <SketchpadProvider>
          <StandaloneSketchpad />
        </SketchpadProvider>
      </div>
    </>
  );
};

export default Sketchpad;

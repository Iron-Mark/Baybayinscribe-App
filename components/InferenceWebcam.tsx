"use client";
import React, {
  forwardRef,
  useImperativeHandle,
  useRef,
  useEffect,
  useState,
} from "react";
import Image from "next/image";
import {
  useInferenceStore,
  InferenceStatus,
} from "../app/store/store.inference";
import { InferenceResult } from "@/types/type.inference";
import { SendToBack } from "lucide-react";
import { Button } from "./ui/button";

interface InferenceWebcamProps {
  sizeClass?: string;
  onDetect?: (result: InferenceResult[]) => void;
  imageOnly?: boolean;
  showScannerGrid?: boolean;
  setModelLoading?: (loading: boolean) => void;
}

export interface InferenceWebcamHandle {
  setCameraFacing: (mode: string) => void;
  setCameraDevice: (deviceId: string) => void;
}

const InferenceWebcam = forwardRef<InferenceWebcamHandle, InferenceWebcamProps>(
  function InferenceWebcam(
    {
      sizeClass = "w-96 h-96",
      onDetect,
      imageOnly,
      showScannerGrid,
      setModelLoading,
    },
    ref
  ) {
    const inference = useInferenceStore();
    const imageRef = useRef<HTMLImageElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const secondFileInputRef = useRef<HTMLInputElement>(null);
    const currentStream = useRef<MediaStream | null>(null);

    const [facingMode, setFacingMode] = useState("environment");
    const [cameraDevice, setCameraDeviceState] = useState<string | null>(null);
    const [imageSrc, setImageSrc] = useState<string | null>(null);

    useImperativeHandle(ref, () => ({
      setCameraFacing: (mode: string) => {
        if (currentStream.current) {
          currentStream.current.getTracks().forEach((track) => track.stop());
        }
        setFacingMode(mode);
        setCameraDeviceState(null);
      },
      setCameraDevice: (deviceId: string) => {
        if (currentStream.current) {
          currentStream.current.getTracks().forEach((track) => track.stop());
        }
        setCameraDeviceState(deviceId);
      },
      killWebcam: () => {
        if (currentStream.current) {
          currentStream.current.getTracks().forEach((track) => track.stop());
        }
      },
    }));

    const { initLocalModel, inferLocal, status, localInferenceResult } = inference;

    // trigger loading when model init starts
    useEffect(() => {
      setModelLoading?.(true);
      initLocalModel();
    }, [initLocalModel, setModelLoading]);

    // Pre-initialize canvas size for better LCP
    useEffect(() => {
      if (canvasRef.current) {
        canvasRef.current.width = 640;
        canvasRef.current.height = 640;
        canvasRef.current.style.width = "100%";
        canvasRef.current.style.height = "100%";
      }
    }, []);

    // once model is ready, stop loading and continue
    useEffect(() => {
      if (status === InferenceStatus.READY) {
        setModelLoading?.(false);
        if (imageOnly && imageSrc && imageRef.current) {
          inferLocal(
            imageRef.current,
            canvasRef.current!,
            showScannerGrid
          );
        }
      }
    }, [status, imageSrc, imageOnly, showScannerGrid, inferLocal, setModelLoading]);

    useEffect(() => {
      onDetect?.(localInferenceResult ?? []);
    }, [localInferenceResult, onDetect]);

    useEffect(() => {
      if (imageOnly || status !== InferenceStatus.READY) return;
      let cancelled = false;
      let ownedStream: MediaStream | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const video = videoRef.current;
      const videoConstraints = cameraDevice
        ? { deviceId: { exact: cameraDevice } }
        : { facingMode: facingMode };
      const constraints = {
        audio: false,
        video: {
          width: { ideal: 640 },
          height: { ideal: 640 },
          ...videoConstraints,
        },
      };

      navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        ownedStream = stream;
        currentStream.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            // Set canvas size to match video size
            if (videoRef.current && canvasRef.current) {
              const video = videoRef.current;
              const canvas = canvasRef.current;
              canvas.width = video.videoWidth;
              canvas.height = video.videoHeight;
              canvas.style.width = "100%";
              canvas.style.height = "100%";
            }
            videoRef.current?.play();
          };

          videoRef.current.onplay = () => {
            if (imageOnly) return;
            const ctx = canvasRef.current?.getContext("2d");
            const height = videoRef.current?.videoHeight;
            const width = videoRef.current?.videoWidth;
            if (
              videoRef.current &&
              canvasRef.current &&
              width &&
              height &&
              ctx
            ) {
              videoRef.current.width = width;
              videoRef.current.height = height;
              canvasRef.current.width = width;
              canvasRef.current.height = height;
              canvasRef.current.style.width = "100%";
              canvasRef.current.style.height = "100%";
              ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset any transforms

              const inferLoop = () => {
                // Stop if video is paused or ended
                if (
                  cancelled || !videoRef.current ||
                  videoRef.current.paused ||
                  videoRef.current.ended
                )
                  return;
                ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
                inferLocal(
                  videoRef.current!,
                  canvasRef.current!, // always render to canvas for bounding box
                  showScannerGrid,
                  false
                );
                timer = setTimeout(inferLoop, 200);
              };
              if (!imageOnly) inferLoop();
            }
          };
        }
      }).catch((error: unknown) => {
        if (!cancelled) console.error("Unable to start camera:", error);
      });
      return () => {
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
        ownedStream?.getTracks().forEach((track) => track.stop());
        if (currentStream.current === ownedStream) currentStream.current = null;
        if (video) {
          video.onloadedmetadata = null;
          video.onplay = null;
          video.srcObject = null;
        }
      };
    }, [cameraDevice, facingMode, imageOnly, status, inferLocal, showScannerGrid]);

    useEffect(() => {
      return () => {
        if (imageSrc) URL.revokeObjectURL(imageSrc);
      };
    }, [imageSrc]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        const url = URL.createObjectURL(file);
        setImageSrc(url);

      }
    };

    // Add this helper function inside the component
    const clearCanvas = () => {
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext("2d");
        if (ctx) {
          ctx.clearRect(
            0,
            0,
            canvasRef.current.width,
            canvasRef.current.height
          );
        }
      }
    };

    return (
      <div className={`${sizeClass} relative`}>
        {imageOnly ? (
          <div className="flex flex-col items-center justify-center w-full h-full relative space-y-2">
            {!imageSrc && (
              <div className="w-full h-full flex flex-col items-center justify-center gap-4 bg-black/50 rounded-xl">
                <div className="flex flex-row gap-4 ">
                  <SendToBack color="#fff" size={40} />
                  <span className="text-3xl font-bold text-white">
                    Upload an image
                  </span>
                </div>
                <div className="flex flex-col gap-2 *:text-center ">
                  <span className="text-white text-xs sm:text-sm md:text-base">
                    Got a Baybayin Image? Let&apos;s scan it!
                  </span>
                  <span className="text-white text-xs sm:text-sm md:text-base">
                    Accepts image formats: PNG, JPG (max 5 MB)
                  </span>
                </div>
                <div className="flex flex-row gap-4">
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    className="btn"
                  >
                    Upload an image
                  </Button>

                  {/* <Button variant={"outline"} onClick={() => showScannerGrid()}>
                    Go real-time
                  </Button> */}
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  ref={fileInputRef}
                />
              </div>
            )}

            {imageSrc && (
              <div className="w-full h-full relative">
                <div className="absolute h-full w-full">
                  <Image
                    ref={imageRef}
                    src={imageSrc}
                    alt="Uploaded image for Baybayin recognition"
                    fill
                    priority
                    quality={90}
                    className="object-contain"
                    sizes="(max-width: 768px) 100vw, 640px"
                    onLoad={() => {
                      // Set canvas size to match image size
                      if (imageRef.current && canvasRef.current) {
                        const img = imageRef.current;
                        const canvas = canvasRef.current;
                        // Use naturalWidth/naturalHeight for actual image size
                        canvas.width = img.naturalWidth;
                        canvas.height = img.naturalHeight;
                        canvas.style.width = "100%";
                        canvas.style.height = "100%";
                      }
                      // Clear canvas before inference
                      clearCanvas();
                      // Run inference after sizing
                      if (inference.status === InferenceStatus.READY) {
                        inference.inferLocal(
                          imageRef.current!,
                          canvasRef.current!,
                          true, // always render to canvas for bounding box
                          showScannerGrid
                        );
                      }
                    }}
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      target.src = "/images/error-fallback.webp";
                    }}
                  />
                </div>
                <canvas
                  ref={canvasRef}
                  className="absolute top-0 left-0 w-full h-full z-50 rounded-md shadow-lg pointer-events-none"
                  style={{ pointerEvents: "none" }}
                ></canvas>

                <div className="absolute bottom-4 -translate-x-1/2 left-1/2 z-10">
                  <Button
                    onClick={() => secondFileInputRef.current?.click()}
                    className=""
                  >
                    {imageSrc ? "Retry Scan" : "Upload an Image"}
                  </Button>
                </div>

                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                  ref={secondFileInputRef}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="w-full h-full relative">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              className="absolute top-0 left-0 w-full h-full -z-10 rounded-md shadow-lg"
              onLoadedMetadata={() => {
                // Set canvas size to match video size
                if (videoRef.current && canvasRef.current) {
                  const video = videoRef.current;
                  const canvas = canvasRef.current;
                  canvas.width = video.videoWidth;
                  canvas.height = video.videoHeight;
                  canvas.style.width = "100%";
                  canvas.style.height = "100%";
                }
              }}
            />
            <canvas
              ref={canvasRef}
              className="absolute top-0 left-0 w-full h-full z-50 rounded-md shadow-lg pointer-events-none"
              style={{ pointerEvents: "none" }}
            />
          </div>
        )}
      </div>
    );
  }
);

export default InferenceWebcam;

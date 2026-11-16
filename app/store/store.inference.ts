"use client"

import * as tf from "@tensorflow/tfjs";
import { create } from "zustand";
import { LABELS } from "@/constants";

import { InferenceResult } from "@/types/type.inference";
import "@tensorflow/tfjs-backend-webgl"
import { InferenceEngine, CVImage } from "inferencejs";

interface WorkerPrediction {
  color: string;
  bbox: { x: number; y: number; width: number; height: number };
  class: string;
  confidence: number;
}

function isWorkerPredictions(value: unknown): value is WorkerPrediction[] {
  return Array.isArray(value) && value.every((item: unknown) => {
    if (typeof item !== "object" || item === null ||
        !("color" in item) || typeof item.color !== "string" ||
        !("class" in item) || typeof item.class !== "string" ||
        !("confidence" in item) || typeof item.confidence !== "number" ||
        !Number.isFinite(item.confidence) || !("bbox" in item) ||
        typeof item.bbox !== "object" || item.bbox === null) return false;
    const bbox = item.bbox;
    return ["x", "y", "width", "height"].every((key) =>
      key in bbox && typeof Reflect.get(bbox, key) === "number" && Number.isFinite(Reflect.get(bbox, key))
    );
  });
}

export enum InferenceStatus {
  IDLE,
  LOADING,
  WARMING_UP,
  READY,
  ERROR,
}

export interface InferenceState {
  status: InferenceStatus;
  modelWorkerId: string | undefined;
  inferEngine: InferenceEngine | undefined;
  localModel: tf.GraphModel | undefined;
  localInferenceResult: InferenceResult[] | undefined;
  isInferring: boolean;
  init: () => void;
  initLocalModel: () => Promise<void>;
  inferLocal: (
    image: HTMLVideoElement | HTMLImageElement | undefined,
    canvas: HTMLCanvasElement,
    renderToCanvas?: boolean,
    isSketch?: boolean
  ) => void;

  renderToCanvas: (
    inferenceResult: InferenceResult[],
    canvas: HTMLCanvasElement
  ) => void;

  infer: (image: HTMLImageElement) => void;
  detect: (video: HTMLVideoElement, canvas: HTMLCanvasElement) => void;
  cleanup: () => void;
  clearResults: () => void;
}

let localModelInitialization: Promise<void> | undefined;

export const useInferenceStore = create<InferenceState>()((set, get) => ({
  status: InferenceStatus.IDLE,
  modelWorkerId: undefined,
  inferEngine: undefined,
  localModel: undefined,
  localInferenceResult: undefined,
  isInferring: false,
  
  inferLocal: async (image, canvas, renderToCanvas = false, isSketch = false) => {
    const state = get();
    
    // Prevent concurrent inference calls
    if (state.isInferring) {
      console.log("Inference already in progress, skipping...");
      return;
    }
    
    if (!state.localModel) {
      console.error("Model not initialized. Call initLocalModel() first.");
      return;
    }
    
    if (!state.localModel.inputs[0].shape) {
      console.error("Model input shape is undefined!");
      return;
    }

    set({ isInferring: true });
    let input: tf.Tensor | undefined;
    let output: tf.Tensor | tf.Tensor[] | undefined;

    try {
      // Ensure TensorFlow is ready
      await tf.ready();

      const [modelWidth, modelHeight] = state.localModel.inputs[0].shape.slice(1, 3);
      console.log("Model input dimensions:", modelWidth, modelHeight);

      if (isSketch) {
        // For sketches, handle canvas preprocessing
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error("Cannot get canvas context");
        }
        
        // Create a temporary canvas with white background
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = canvas.width;
        tempCanvas.height = canvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        if (!tempCtx) {
          throw new Error("Cannot get temp canvas context");
        }
        
        // Fill with white background
        tempCtx.fillStyle = 'white';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        
        // Draw the original canvas content
        tempCtx.drawImage(canvas, 0, 0);
        
        input = tf.tidy(() => {
          return tf.browser
            .fromPixels(tempCanvas)
            .resizeBilinear([modelWidth, modelHeight])
            .mean(2) // Convert to grayscale
            .expandDims(2) // Add channel dimension back
            .tile([1, 1, 3]) // Convert back to 3 channels
            .div(255.0)
            .expandDims(0);
        });
      } else {
        input = tf.tidy(() => {
          return tf.browser
            .fromPixels(image ? image : canvas)
            .resizeBilinear([modelWidth, modelHeight])
            .div(255.0)
            .expandDims(0);
        });
      }

      console.log("Input tensor shape:", input.shape);
      
      // Execute model
      output = await state.localModel.executeAsync(input);
      const resultTensor = Array.isArray(output) ? output[0] : output;
      if (!resultTensor) throw new Error("Model returned no output tensor");
      
      console.log("Raw model output shape:", resultTensor.shape);
      
      // Get the data and dispose the result tensor immediately after
      const inferenceData: number[][][] = await resultTensor.data().then(data => {
        const shape = resultTensor.shape;
        const result = Array.from(data);
        // Reshape the flat array based on the tensor shape
        const reshaped: number[][][] = [];
        const batchSize = shape[0];
        const numDetections = shape[1];
        const numClasses = shape[2];
        if (shape.length !== 3 || batchSize === undefined || batchSize < 1 ||
            numDetections === undefined || numClasses === undefined || numClasses < 6 ||
            result.length !== batchSize * numDetections * numClasses) {
          throw new Error("Expected model output shaped [batch, detections, at least 6 values]");
        }
        
        for (let b = 0; b < batchSize; b++) {
          const batch = [];
          for (let d = 0; d < numDetections; d++) {
            const detection = [];
            for (let c = 0; c < numClasses; c++) {
              const index = b * numDetections * numClasses + d * numClasses + c;
              detection.push(result[index]);
            }
            batch.push(detection);
          }
          reshaped.push(batch);
        }
        return reshaped;
      });
      
      console.log("Raw inference result:", inferenceData[0]);
      
      // Lower confidence threshold for sketches
      const confidenceThreshold = isSketch ? 0.3 : 0.5;
      
      const filteredResult = inferenceData[0]
        .filter((item, index) => {
          console.log(`Detection ${index}: confidence=${item[4]}, class=${item[5]}`);
          return item[4] > confidenceThreshold;
        })
        .map((item) => {
          const className = LABELS[Math.floor(item[5])] || `Unknown_${Math.floor(item[5])}`;
          console.log(`Mapped class: ${className} (index: ${Math.floor(item[5])})`);

          return {
            x: item[0],
            y: item[1],
            width: item[2],
            height: item[3],
            confidence: item[4],
            className: className,
          } as InferenceResult;
        })
        .sort((a, b) => {
          return a.x - b.x;
        });

      console.log("Filtered results:", filteredResult);
      set({ localInferenceResult: filteredResult });

      if (renderToCanvas) {
        get().renderToCanvas(filteredResult, canvas);
      }

    } catch (err) {
      console.error("Inference error:", err);
      set({ status: InferenceStatus.ERROR });
    } finally {
      input?.dispose();
      if (Array.isArray(output)) output.forEach((tensor) => tensor.dispose());
      else output?.dispose();
      set({ isInferring: false });
    }
  },
  
  initLocalModel: () => {
    if (get().status === InferenceStatus.READY && get().localModel) return Promise.resolve();
    if (localModelInitialization) return localModelInitialization;
    localModelInitialization = (async () => {
      let model: tf.GraphModel | undefined;
      set({ status: InferenceStatus.LOADING });
      try {
        get().localModel?.dispose();
        set({ localModel: undefined });
        await tf.ready();
        try {
          await tf.setBackend("webgl");
          await tf.ready();
        } catch (webglError) {
          console.warn("WebGL backend failed, falling back to CPU:", webglError);
          await tf.setBackend("cpu");
          await tf.ready();
        }

        model = await tf.loadGraphModel("/models/model.json");
        set({ status: InferenceStatus.WARMING_UP });
        if (model.inputs[0].shape) {
          const dummy = tf.ones(model.inputs[0].shape);
          let response: tf.Tensor | tf.Tensor[] | undefined;
          try {
            response = await model.executeAsync(dummy);
          } finally {
            dummy.dispose();
            if (Array.isArray(response)) response.forEach(tensor => tensor.dispose());
            else response?.dispose();
          }
        }

        set({ status: InferenceStatus.READY, localModel: model });
        console.log("Model ready for inference!");
      } catch (error) {
        model?.dispose();
        console.error("Failed to initialize model:", error);
        set({ status: InferenceStatus.ERROR });
      }
    })().finally(() => { localModelInitialization = undefined; });
    return localModelInitialization;
  },
  
  clearResults: () => {
    set({ localInferenceResult: undefined });
  },
  
  cleanup: () => {
    const state = get();
    if (state.localModel) {
      state.localModel.dispose();
    }
    set({ 
      localModel: undefined, 
      status: InferenceStatus.IDLE,
      localInferenceResult: undefined,
      isInferring: false
    });
  },
  init: async () => {
    set({ status: InferenceStatus.LOADING });
    const inferEngine = new InferenceEngine();

    const modelWorkerId = await inferEngine.startWorker(
      "baybayinscribe",
      2,
      "rf_PMVs0s2FKsdITA4ivOJljFQAzrF3"
    );
    set({ status: InferenceStatus.READY, modelWorkerId, inferEngine });
  },
  infer: async (image) => {
    const { inferEngine, modelWorkerId } = get();
    if (inferEngine === undefined || modelWorkerId === undefined) {
      return;
    }
    set({ status: InferenceStatus.LOADING });
    const result = await inferEngine.infer(modelWorkerId, new CVImage(image));
    console.log(result);
    set({ status: InferenceStatus.READY });
  },
  detect: (video, canvas) => {
    const detectFrame = async () => {
      const modelWorkerId = get().modelWorkerId;
      if (!modelWorkerId) {
        setTimeout(detectFrame, 100 / 3);
        return;
      }
      if (!video || !canvas) return;
      const img = new CVImage(video);
      const inferEngine = get().inferEngine;
      if (inferEngine) {
        inferEngine
          .infer(modelWorkerId, img)
          .then((predictions) => {
            if (!isWorkerPredictions(predictions)) throw new Error("Invalid object-detection response");
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            for (let i = 0; i < predictions.length; i++) {
              const prediction = predictions[i];
              ctx.strokeStyle = prediction.color;
              const x = prediction.bbox.x - prediction.bbox.width / 2;
              const y = prediction.bbox.y - prediction.bbox.height / 2;
              const width = prediction.bbox.width;
              const height = prediction.bbox.height;
              ctx.rect(x, y, width, height);
              ctx.fillStyle = "rgba(0, 0, 0, 0)";
              ctx.fill();
              ctx.fillStyle = ctx.strokeStyle;
              ctx.lineWidth = 4;
              ctx.strokeRect(x, y, width, height);
              const textMetrics = ctx.measureText(
                prediction.class +
                  " " +
                  Math.round(prediction.confidence * 100) +
                  "%"
              );
              ctx.fillStyle = ctx.strokeStyle;
              ctx.fillRect(x - 2, y - 30, textMetrics.width + 4, 30);
              ctx.font = "15px monospace";
              ctx.fillStyle = "black";
              ctx.fillText(
                prediction.class +
                  " " +
                  Math.round(prediction.confidence * 100) +
                  "%",
                x,
                y - 10
              );
            }
          })
          .catch((error: unknown) => console.error("Worker inference failed:", error));
      }
      setTimeout(detectFrame, 100 / 3);
    };
    detectFrame();
  },
  renderToCanvas: (inferenceResult, canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    
    // Create overlay canvas to avoid clearing the drawing
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = canvas.width;
    overlayCanvas.height = canvas.height;
    const overlayCtx = overlayCanvas.getContext('2d');
    if (!overlayCtx) return;
    
    overlayCtx.font = "14px sans-serif";
    overlayCtx.textBaseline = "top";

    if (!inferenceResult || inferenceResult.length === 0) {
      // Show "No detection" message
      overlayCtx.fillStyle = "rgba(255, 0, 0, 0.8)";
      overlayCtx.fillRect(10, 10, 120, 30);
      overlayCtx.fillStyle = "white";
      overlayCtx.fillText("No detection", 15, 20);
    } else {
      const scaleX = canvas.width / 640;
      const scaleY = canvas.height / 640;

      // Draw individual detections
      inferenceResult.forEach((item) => {
        const x = item.x * scaleX;
        const y = item.y * scaleY;
        const width = item.width * scaleX;
        const height = item.height * scaleY;

        // Draw bounding box
        overlayCtx.strokeStyle = "lime";
        overlayCtx.lineWidth = 2;
        overlayCtx.strokeRect(x, y, width, height);

        // Draw label with background
        const label = `${item.className} (${Math.round(item.confidence * 100)}%)`;
        const textMetrics = overlayCtx.measureText(label);
        const textWidth = textMetrics.width + 8;
        
        overlayCtx.fillStyle = "rgba(0, 255, 0, 0.8)";
        overlayCtx.fillRect(x, Math.max(0, y - 25), textWidth, 22);
        overlayCtx.fillStyle = "black";
        overlayCtx.fillText(label, x + 4, Math.max(0, y - 20));
      });
    }

    // Draw overlay on top of the main canvas
    ctx.drawImage(overlayCanvas, 0, 0);
  },
}));

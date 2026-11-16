// inferencejs 1.0.21 ships declarations but omits them from its exports map.
// Its worker supports multiple models, so validate model-specific output at use.
declare module "inferencejs" {
  export const CVImage: typeof import("../node_modules/inferencejs/dist/utils/image").default;
  export type CVImage = import("../node_modules/inferencejs/dist/utils/image").default;
  export type YOLOOptions = import("../node_modules/inferencejs/dist/models/yolov8").YOLOOptions;

  export class InferenceEngine {
    constructor(url?: string);
    startWorker(modelName: string, modelVersion: number, publishableKey: string, options?: YOLOOptions[]): Promise<string>;
    stopWorker(workerId: string): Promise<boolean>;
    infer(workerId: string, image: ImageBitmap | CVImage, options?: YOLOOptions[] | null): Promise<unknown>;
  }
}

import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ImageIcon from "#/icons/image.svg?react";
import UploadIcon from "#/icons/u-download.svg?react";
import { cn } from "#/utils/utils";
import {
  generateImage,
  transformImage,
  inpaintImage,
  batchGenerateImages,
  generateWithControlNet,
  checkImageGenerationHealth,
  ImageGenerationResponse,
  BatchImageGenerationResponse,
  STYLE_PRESETS,
  IMAGE_RESOLUTIONS,
  CONTROLNET_TYPES,
  ControlNetRequest,
  ImageToImageRequest,
  InpaintingRequest,
  BatchImageGenerationRequest,
  // New API functions for Faza 2
  upscaleImage,
  applyStyleTransfer,
  captionImage,
  detectObjects,
  removeBackground,
  addToQueue,
  getQueueStatus,
  listStorage,
  deleteStorageFile,
  getCacheStats,
  clearCache,
  getHealthStatus,
  UpscaleImageRequest,
  StyleTransferRequest,
  CaptionImageRequest,
  ObjectDetectionRequest,
  RemoveBackgroundRequest,
  QueueJobRequest,
  StorageItem,
} from "#/api/generation-service";

type GenerationMode = "txt2img" | "img2img" | "inpaint" | "batch" | "controlnet" | "upscale" | "style-transfer" | "caption" | "detect-objects" | "remove-bg";
type GenerationState =
  | "idle"
  | "pending"
  | "generating"
  | "finished"
  | "failed";

const MODE_OPTIONS: { value: GenerationMode; label: string; icon: string }[] = [
  { value: "txt2img", label: "Text to Image", icon: "T2I" },
  { value: "img2img", label: "Image to Image", icon: "I2I" },
  { value: "inpaint", label: "Inpainting", icon: "INP" },
  { value: "batch", label: "Batch", icon: "BATCH" },
  { value: "controlnet", label: "ControlNet", icon: "CN" },
  { value: "upscale", label: "Upscale", icon: "UPSCALE" },
  { value: "style-transfer", label: "Style Transfer", icon: "STYLE" },
  { value: "caption", label: "Caption", icon: "CAPTION" },
  { value: "detect-objects", label: "Detect Objects", icon: "DETECT" },
  { value: "remove-bg", label: "Remove BG", icon: "BG" },
];

// New state variables for Faza 2 features
const [generatedImages, setGeneratedImages] = useState<string[]>([]);
const [generatedImageIds, setGeneratedImageIds] = useState<string[]>([]);
const [error, setError] = useState<string | null>(null);
const [healthStatus, setHealthStatus] = useState<"loading" | "healthy" | "unhealthy">("loading");
const progressIntervalRef = useRef<number | null>(null);
const fileInputRef = useRef<HTMLInputElement>(null);
const maskInputRef = useRef<HTMLInputElement>(null);
const controlImageInputRef = useRef<HTMLInputElement>(null);

// New state for Faza 2 features
const [imageHistory, setImageHistory] = useState<StorageItem[]>([]);
const [promptHistory, setPromptHistory] = useState<string[]>([]);
const [selectedModel, setSelectedModel] = useState("black-forest-labs/FLUX.1-schnell");
const [showComparison, setShowComparison] = useState(false);
const [comparisonImage, setComparisonImage] = useState<string | null>(null);
const [queueJobId, setQueueJobId] = useState<string | null>(null);
const [queueStatus, setQueueStatus] = useState<any>(null);
const [cacheStats, setCacheStats] = useState<any>(null);

  // Cleanup interval on unmount
  useEffect(
    () => () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    },
    [],
  );

  // Check health status on mount
  useEffect(() => {
    const checkHealth = async () => {
      try {
        await checkImageGenerationHealth();
        setHealthStatus("healthy");
      } catch {
        setHealthStatus("unhealthy");
      }
    };
    checkHealth();
  }, []);

  // Convert File to base64 data URL for preview
  const fileToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // Handle file selection
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedImage(file);
    }
  };

  const handleMaskUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedMask(file);
    }
  };

  const handleControlImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedControlImage(file);
    }
  };

  // Handle mode change - reset relevant state
  const handleModeChange = (mode: GenerationMode) => {
    setGenerationMode(mode);
    setGeneratedImages([]);
    setGeneratedImageIds([]);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
  };

  const handleGenerate = async () => {
    // Validate based on mode
    if (generationMode === "txt2img" && !prompt.trim()) {
      setError(t("PHOTO_TAB$ERROR_NO_PROMPT", "Please enter a prompt"));
      return;
    }
    if (generationMode === "img2img" && (!prompt.trim() || !uploadedImage)) {
      setError(t("PHOTO_TAB$ERROR_NO_IMAGE", "Please upload an image and enter a prompt"));
      return;
    }
    if (generationMode === "inpaint" && (!prompt.trim() || !uploadedImage || !uploadedMask)) {
      setError(t("PHOTO_TAB$ERROR_NO_INPAINT", "Please upload an image, mask, and enter a prompt"));
      return;
    }
    if (generationMode === "batch" && !batchPrompts.trim()) {
      setError(t("PHOTO_TAB$ERROR_NO_BATCH", "Please enter prompts for batch generation"));
      return;
    }
    if (generationMode === "controlnet" && (!prompt.trim() || !uploadedControlImage)) {
      setError(t("PHOTO_TAB$ERROR_NO_CONTROL", "Please upload a control image and enter a prompt"));
      return;
    }

    setGenerationState("pending");
    setProgress(0);
    setError(null);
    setGeneratedImages([]);
    setGeneratedImageIds([]);

    // Simulate progress for UX
    progressIntervalRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
          }
          return prev;
        }
        return prev + Math.random() * 15;
      });
    }, 500);

    try {
      setGenerationState("generating");
      let data: ImageGenerationResponse | BatchImageGenerationResponse;

      switch (generationMode) {
        case "txt2img": {
          data = await generateImage({
            prompt,
            resolution,
            style,
          });
          const imageUrl = `/api/v1/generated-images/${data.image_id}`;
          setGeneratedImages([imageUrl]);
          setGeneratedImageIds([data.image_id]);
          break;
        }
        case "img2img": {
          const img2imgRequest: ImageToImageRequest = {
            image_path: uploadedImage ? await fileToDataUrl(uploadedImage) : "",
            prompt,
            strength: imageStrength,
            resolution,
            style,
          };
          data = await transformImage(img2imgRequest);
          const imageUrl = `/api/v1/generated-images/${data.image_id}`;
          setGeneratedImages([imageUrl]);
          setGeneratedImageIds([data.image_id]);
          break;
        }
        case "inpaint": {
          const inpaintRequest: InpaintingRequest = {
            image_path: uploadedImage ? await fileToDataUrl(uploadedImage) : "",
            mask_path: uploadedMask ? await fileToDataUrl(uploadedMask) : "",
            prompt,
            resolution,
          };
          data = await inpaintImage(inpaintRequest);
          const imageUrl = `/api/v1/generated-images/${data.image_id}`;
          setGeneratedImages([imageUrl]);
          setGeneratedImageIds([data.image_id]);
          break;
        }
        case "batch": {
          const prompts = batchPrompts.split("\n").filter((p) => p.trim());
          
          // Validate batch size
          if (prompts.length > 10) {
            setError(t("PHOTO_TAB$ERROR_BATCH_LIMIT", "Maximum 10 prompts allowed per batch"));
            setGenerationState("failed");
            return;
          }
          
          if (prompts.length === 0) {
            setError(t("PHOTO_TAB$ERROR_NO_BATCH", "Please enter prompts for batch generation"));
            setGenerationState("failed");
            return;
          }
          
          const batchRequest: BatchImageGenerationRequest = {
            prompts,
            resolution,
            style,
          };
          data = await batchGenerateImages(batchRequest);
          const images = (data as BatchImageGenerationResponse).images.map(
            (img) => `/api/v1/generated-images/${img.image_id}`,
          );
          const ids = (data as BatchImageGenerationResponse).images.map((img) => img.image_id);
          setGeneratedImages(images);
          setGeneratedImageIds(ids);
          break;
        }
        case "controlnet": {
          const controlnetRequest: ControlNetRequest = {
            prompt,
            control_image_path: uploadedControlImage ? await fileToDataUrl(uploadedControlImage) : "",
            controlnet_type: controlnetType as ControlNetRequest["controlnet_type"],
            resolution,
          };
          data = await generateWithControlNet(controlnetRequest);
          const imageUrl = `/api/v1/generated-images/${data.image_id}`;
          setGeneratedImages([imageUrl]);
          setGeneratedImageIds([data.image_id]);
          break;
        }
      }

      setGenerationState("finished");
      setProgress(100);

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } catch (err) {
      setGenerationState("failed");
      let errorMessage = t("PHOTO_TAB$ERROR_GENERIC", "An error occurred");
      
      if (err instanceof Error) {
        errorMessage = err.message;
      } else if (err && typeof err === 'object') {
        // Handle API error responses (e.g., Axios errors)
        const anyErr = err as Record<string, unknown>;
        const response = anyErr.response as Record<string, unknown> | undefined;
        const data = response?.data as Record<string, unknown> | undefined;
        
        if (typeof data?.detail === 'string') {
          errorMessage = data.detail;
        } else if (typeof anyErr.message === 'string') {
          errorMessage = anyErr.message;
        } else {
          // Fallback: try to stringify (but avoid [object Object])
          try {
            const serialized = JSON.stringify(err);
            if (serialized && serialized !== '{}') {
              errorMessage = serialized;
            }
          } catch {
            // Keep the default error message
          }
        }
      }
      
      setError(errorMessage);
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    }
  };

  const handleDownload = (imageUrl?: string) => {
    const urlToDownload = imageUrl || generatedImages[0];
    if (urlToDownload) {
      window.open(urlToDownload, "_blank");
    }
  };

  const handleClear = () => {
    setPrompt("");
    setBatchPrompts("");
    setUploadedImage(null);
    setUploadedMask(null);
    setUploadedControlImage(null);
    setGeneratedImages([]);
    setGeneratedImageIds([]);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
    // Reset file inputs
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (maskInputRef.current) maskInputRef.current.value = "";
    if (controlImageInputRef.current) controlImageInputRef.current.value = "";
  };

  const isGenerating =
    generationState === "generating" || generationState === "pending";

  // Check if generate button should be disabled
  const canGenerate = () => {
    if (isGenerating) return false;
    switch (generationMode) {
      case "txt2img":
        return !!prompt.trim();
      case "img2img":
        return !!prompt.trim() && !!uploadedImage;
      case "inpaint":
        return !!prompt.trim() && !!uploadedImage && !!uploadedMask;
      case "batch":
        return !!batchPrompts.trim();
      case "controlnet":
        return !!prompt.trim() && !!uploadedControlImage;
      default:
        return false;
    }
  };

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <ImageIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">
          {t("PHOTO_TAB$TITLE", "Photo Generation")}
        </h2>
        {healthStatus === "loading" && (
          <span className="text-sm text-gray-500">Checking service...</span>
        )}
        {healthStatus === "unhealthy" && (
          <span className="text-sm text-red-500">Service unavailable</span>
        )}
        {healthStatus === "healthy" && (
          <span className="text-sm text-green-500">Service ready</span>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {/* Mode Selector */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-gray-700">
            {t("PHOTO_TAB$MODE_LABEL", "Generation Mode")}
          </label>
          <div className="flex flex-wrap gap-2">
            {MODE_OPTIONS.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => handleModeChange(mode.value)}
                disabled={isGenerating}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  generationMode === mode.value
                    ? "bg-blue-600 text-white shadow-md"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                  isGenerating && "opacity-50 cursor-not-allowed",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn(
                    "px-1.5 py-0.5 text-xs rounded",
                    generationMode === mode.value ? "bg-blue-500" : "bg-gray-300"
                  )}>
                    {mode.icon}
                  </span>
                  {mode.label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Mode-specific inputs */}
        {generationMode === "txt2img" && (
          <>
            {/* Prompt Input */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="photo-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="photo-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "PHOTO_TAB$PROMPT_PLACEHOLDER",
                  "Describe the image you want to generate...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
            </div>

            {/* Options Row */}
            <div className="flex gap-4">
              {/* Resolution */}
              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="photo-resolution"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$RESOLUTION_LABEL", "Resolution")}
                </label>
                <select
                  id="photo-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {IMAGE_RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Style */}
              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="photo-style"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$STYLE_LABEL", "Style")}
                </label>
                <select
                  id="photo-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {generationMode === "img2img" && (
          <>
            {/* Image Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("PHOTO_TAB$UPLOAD_IMAGE_LABEL", "Upload Image")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="image-upload"
                />
                <label
                  htmlFor="image-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedImage ? uploadedImage.name : t("PHOTO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedImage(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("PHOTO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="img2img-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="img2img-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "PHOTO_TAB$PROMPT_PLACEHOLDER",
                  "Describe the changes you want to make...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
            </div>

            {/* Strength */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("PHOTO_TAB$STRENGTH_LABEL", "Transformation Strength")}: {imageStrength}
              </label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={imageStrength}
                onChange={(e) => setImageStrength(parseFloat(e.target.value))}
                className="w-full"
                disabled={isGenerating}
              />
              <div className="flex justify-between text-xs text-gray-500">
                <span>Subtle</span>
                <span>Strong</span>
              </div>
            </div>

            {/* Options Row */}
            <div className="flex gap-4">
              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="img2img-resolution"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$RESOLUTION_LABEL", "Resolution")}
                </label>
                <select
                  id="img2img-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {IMAGE_RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="img2img-style"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$STYLE_LABEL", "Style")}
                </label>
                <select
                  id="img2img-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {generationMode === "inpaint" && (
          <>
            {/* Image Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("PHOTO_TAB$UPLOAD_IMAGE_LABEL", "Upload Image")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="inpaint-image-upload"
                />
                <label
                  htmlFor="inpaint-image-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedImage ? uploadedImage.name : t("PHOTO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedImage(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("PHOTO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Mask Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("PHOTO_TAB$UPLOAD_MASK_LABEL", "Upload Mask")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={maskInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleMaskUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="mask-upload"
                />
                <label
                  htmlFor="mask-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedMask ? uploadedMask.name : t("PHOTO_TAB$CHOOSE_FILE", "Choose mask file")}
                </label>
                {uploadedMask && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedMask(null);
                      if (maskInputRef.current) maskInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("PHOTO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
              <p className="text-xs text-gray-500">
                {t("PHOTO_TAB$MASK_HELP", "Upload a mask image (white = keep, black = regenerate)")}
              </p>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="inpaint-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="inpaint-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "PHOTO_TAB$INPAINT_PROMPT_PLACEHOLDER",
                  "Describe what you want to inpaint...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
            </div>

            {/* Resolution */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="inpaint-resolution"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$RESOLUTION_LABEL", "Resolution")}
              </label>
              <select
                id="inpaint-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              >
                {IMAGE_RESOLUTIONS.map((res) => (
                  <option key={res.value} value={res.value}>
                    {res.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {generationMode === "batch" && (
          <>
            {/* Batch Prompts */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="batch-prompts"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$BATCH_PROMPTS_LABEL", "Prompts (one per line)")}
              </label>
              <textarea
                id="batch-prompts"
                value={batchPrompts}
                onChange={(e) => setBatchPrompts(e.target.value)}
                placeholder={t(
                  "PHOTO_TAB$BATCH_PROMPTS_PLACEHOLDER",
                  "Enter one prompt per line...\nA beautiful sunset\nA futuristic city\nA magical forest",
                )}
                className="w-full h-40 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
              <p className="text-xs text-gray-500">
                {t("PHOTO_TAB$BATCH_COUNT", "{{count}} prompts", { count: batchPrompts.split("\n").filter(p => p.trim()).length })}
              </p>
            </div>

            {/* Options Row */}
            <div className="flex gap-4">
              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="batch-resolution"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$RESOLUTION_LABEL", "Resolution")}
                </label>
                <select
                  id="batch-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {IMAGE_RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2 flex-1">
                <label
                  htmlFor="batch-style"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("PHOTO_TAB$STYLE_LABEL", "Style")}
                </label>
                <select
                  id="batch-style"
                  value={style}
                  onChange={(e) => setStyle(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isGenerating}
                >
                  {STYLE_PRESETS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {generationMode === "controlnet" && (
          <>
            {/* Control Image Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("PHOTO_TAB$UPLOAD_CONTROL_IMAGE_LABEL", "Upload Control Image")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={controlImageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleControlImageUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="control-image-upload"
                />
                <label
                  htmlFor="control-image-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedControlImage ? uploadedControlImage.name : t("PHOTO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedControlImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedControlImage(null);
                      if (controlImageInputRef.current) controlImageInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("PHOTO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* ControlNet Type */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="controlnet-type"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$CONTROLNET_TYPE_LABEL", "ControlNet Type")}
              </label>
              <select
                id="controlnet-type"
                value={controlnetType}
                onChange={(e) => setControlnetType(e.target.value)}
                className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              >
                {CONTROLNET_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">
                {t("PHOTO_TAB$CONTROLNET_HELP", "Select the type of control to apply to the generation")}
              </p>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="controlnet-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="controlnet-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "PHOTO_TAB$CONTROLNET_PROMPT_PLACEHOLDER",
                  "Describe the image you want to generate guided by the control image...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              />
            </div>

            {/* Resolution */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="controlnet-resolution"
                className="text-sm font-medium text-gray-700"
              >
                {t("PHOTO_TAB$RESOLUTION_LABEL", "Resolution")}
              </label>
              <select
                id="controlnet-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                disabled={isGenerating}
              >
                {IMAGE_RESOLUTIONS.map((res) => (
                  <option key={res.value} value={res.value}>
                    {res.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate()}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg font-medium text-white",
              !canGenerate()
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {isGenerating
              ? t("PHOTO_TAB$GENERATING", "Generating...")
              : t("PHOTO_TAB$GENERATE", "Generate Image")}
          </button>

          {generatedImages.length > 0 && generationState === "finished" && (
            <>
              <button
                type="button"
                onClick={() => handleDownload()}
                className="py-2 px-4 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700"
              >
                {t("PHOTO_TAB$DOWNLOAD", "Download")}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
              >
                {t("PHOTO_TAB$CLEAR", "Clear")}
              </button>
            </>
          )}
        </div>

        {/* Progress Bar */}
        {isGenerating && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-xs text-gray-500">
              <span>
                {generationState === "pending"
                  ? t("PHOTO_TAB$STATUS_PENDING", "Preparing...")
                  : t("PHOTO_TAB$STATUS_GENERATING", "Generating image...")}
              </span>
              <span>{Math.min(Math.round(progress), 100)}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{ width: `${Math.min(progress, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Preview */}
        {generatedImages.length > 0 && generationState === "finished" && (
          <div className="flex flex-col gap-3 mt-4">
            <h3 className="text-sm font-medium text-gray-700">
              {t("PHOTO_TAB$PREVIEW", "Preview")}
            </h3>
            <div className={cn(
              "grid gap-4",
              generatedImages.length === 1 ? "grid-cols-1" : "grid-cols-2 md:grid-cols-3"
            )}>
              {generatedImages.map((imageUrl, index) => (
                <div key={index} className="border border-gray-300 rounded-lg overflow-hidden">
                  <img
                    src={imageUrl}
                    alt={`Generated ${index + 1}`}
                    className="w-full h-auto max-h-96 object-contain bg-gray-100"
                  />
                  <div className="p-2 bg-gray-50 flex justify-between items-center">
                    <span className="text-xs text-gray-500">
                      #{index + 1}: {generatedImageIds[index]}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDownload(imageUrl)}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {t("PHOTO_TAB$DOWNLOAD", "Download")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!generatedImages.length && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <ImageIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>
              {t(
                "PHOTO_TAB$EMPTY_MESSAGE",
                "Select a mode, enter a prompt and click Generate to create an image",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  // ============================================================================
  // NEW FUNCTIONS - Faza 2 Frontend Enhancement
  // ============================================================================

  /**
   * Load image history from storage
   */
  const loadImageHistory = async () => {
    try {
      const items = await listStorage();
      setImageHistory(items);
    } catch (err) {
      console.error("Failed to load image history:", err);
    }
  };

  /**
   * Save prompt to history
   */
  const savePromptToHistory = (newPrompt: string) => {
    setPromptHistory(prev => {
      const updated = [newPrompt, ...prev.filter(p => p !== newPrompt)].slice(0, 20);
      return updated;
    });
  };

  /**
   * Upscale image
   */
  const handleUpscaleImage = async () => {
    if (!uploadedImage) {
      setError("Please upload an image first");
      return;
    }

    setGenerationState("generating");
    try {
      // Convert file to base64 and save temporarily (simplified for demo)
      const dataUrl = await fileToDataUrl(uploadedImage);
      
      const response = await upscaleImage({
        image_path: dataUrl,
        scale_factor: 2.0,
        method: 'real-esrgan',
      });

      setGeneratedImages(prev => [...prev, response.image_path]);
      setGeneratedImageIds(prev => [...prev, response.image_id]);
      setGenerationState("finished");
      
      // Reload history
      loadImageHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upscale failed");
      setGenerationState("failed");
    }
  };

  /**
   * Apply style transfer
   */
  const handleStyleTransfer = async () => {
    if (!uploadedImage || !uploadedControlImage) {
      setError("Please upload both content and style images");
      return;
    }

    setGenerationState("generating");
    try {
      const contentDataUrl = await fileToDataUrl(uploadedImage);
      const styleDataUrl = await fileToDataUrl(uploadedControlImage);

      const response = await applyStyleTransfer({
        content_image_path: contentDataUrl,
        style_image_path: styleDataUrl,
        style_strength: 0.7,
      });

      setGeneratedImages(prev => [...prev, response.image_path]);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Style transfer failed");
      setGenerationState("failed");
    }
  };

  /**
   * Generate caption for image
   */
  const handleCaptionImage = async () => {
    if (!uploadedImage) {
      setError("Please upload an image first");
      return;
    }

    setGenerationState("generating");
    try {
      const dataUrl = await fileToDataUrl(uploadedImage);

      const response = await captionImage({
        image_path: dataUrl,
      });

      alert(`Caption: ${response.caption}\nConfidence: ${(response.confidence * 100).toFixed(1)}%`);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Captioning failed");
      setGenerationState("failed");
    }
  };

  /**
   * Detect objects in image
   */
  const handleDetectObjects = async () => {
    if (!uploadedImage) {
      setError("Please upload an image first");
      return;
    }

    setGenerationState("generating");
    try {
      const dataUrl = await fileToDataUrl(uploadedImage);

      const response = await detectObjects({
        image_path: dataUrl,
      });

      if (response.objects.length > 0) {
        const objectList = response.objects.map(o => 
          `${o.label} (${(o.confidence * 100).toFixed(1)}%): [${o.x}, ${o.y}, ${o.width}, ${o.height}]`
        ).join('\n');
        alert(`Detected objects:\n${objectList}`);
      } else {
        alert("No objects detected");
      }

      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Object detection failed");
      setGenerationState("failed");
    }
  };

  /**
   * Remove background from image
   */
  const handleRemoveBackground = async () => {
    if (!uploadedImage) {
      setError("Please upload an image first");
      return;
    }

    setGenerationState("generating");
    try {
      const dataUrl = await fileToDataUrl(uploadedImage);

      const response = await removeBackground({
        image_path: dataUrl,
      });

      setGeneratedImages(prev => [...prev, response.image_path]);
      setComparisonImage(response.image_path);
      setShowComparison(true);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Background removal failed");
      setGenerationState("failed");
    }
  };

  /**
   * Add job to queue
   */
  const handleAddToQueue = async () => {
    if (!prompt) {
      setError("Please enter a prompt first");
      return;
    }

    try {
      const response = await addToQueue({
        job_type: 'image',
        prompt: prompt,
        priority: 5,
      });

      setQueueJobId(response.job_id);
      setQueueStatus(response);
      
      // Start polling for status
      pollQueueStatus(response.job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add to queue");
    }
  };

  /**
   * Poll queue status
   */
  const pollQueueStatus = async (jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const status = await getQueueStatus(jobId);
        setQueueStatus(status);

        if (status.status === 'completed') {
          clearInterval(interval);
        } else if (status.status === 'failed') {
          setError('Job failed');
          clearInterval(interval);
        }
      } catch (err) {
        console.error("Failed to poll queue status:", err);
        clearInterval(interval);
      }
    }, 2000);

    progressIntervalRef.current = interval as unknown as number;
  };

  /**
   * Load cache stats
   */
  const loadCacheStats = async () => {
    try {
      const stats = await getCacheStats();
      setCacheStats(stats);
    } catch (err) {
      console.error("Failed to load cache stats:", err);
    }
  };

  /**
   * Clear cache
   */
  const handleClearCache = async () => {
    try {
      await clearCache();
      setGenerationState("finished");
      alert("Cache cleared successfully");
      loadCacheStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to clear cache");
    }
  };

  /**
   * Delete image from storage
   */
  const handleDeleteImage = async (fileId: string, filename: string) => {
    try {
      await deleteStorageFile(fileId);
      setImageHistory(prev => prev.filter(item => item.file_id !== fileId));
      alert(`Deleted ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete image");
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-2">
          {t("PHOTO_TAB$TITLE", "Photo Generation")}
        </h2>

        {/* Mode Selection */}
        <div className="flex flex-wrap gap-2 mb-4">
          {MODE_OPTIONS.map((mode) => (
            <button
              key={mode.value}
              onClick={() => setGenerationMode(mode.value)}
              className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                generationMode === mode.value
                  ? "bg-blue-600 text-white"
                  : "bg-gray-700 text-gray-300 hover:bg-gray-600",
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* System Status */}
        <div className="flex gap-4 text-xs text-gray-400">
          <span>Health: {healthStatus}</span>
          {cacheStats && (
            <>
              <span>Cached Models: {cacheStats.pipeline_cache_size + cacheStats.controlnet_cache_size}</span>
              <span>Redis: {cacheStats.redis_available ? '✓' : '✗'}</span>
            </>
          )}
        </div>

        {/* Cache Stats Button */}
        <button
          onClick={loadCacheStats}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300"
        >
          Refresh Cache Stats
        </button>
      </div>

      {/* Main Content */}
      <div className="flex-1 p-4 overflow-auto">
        {/* Input Section */}
        <div className="mb-6 space-y-4">
          {generationMode === 'txt2img' && (
            <>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt..."
                className="w-full h-24 p-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />

              {/* Prompt History */}
              {promptHistory.length > 0 && (
                <div className="mt-2">
                  <p className="text-sm text-gray-400 mb-1">Recent prompts:</p>
                  <div className="flex flex-wrap gap-2">
                    {promptHistory.slice(0, 5).map((p, i) => (
                      <button
                        key={i}
                        onClick={() => setPrompt(p)}
                        className="px-2 py-1 bg-gray-700 rounded text-xs text-gray-300 hover:bg-gray-600"
                      >
                        {p.substring(0, 50)}...
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Selection */}
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full p-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
              >
                <option value="black-forest-labs/FLUX.1-schnell">FLUX.1-schnell</option>
                <option value="stabilityai/stable-diffusion-xl-base-1.0">SDXL 1.0</option>
                <option value="runwayml/stable-diffusion-v1-5">Stable Diffusion v1.5</option>
              </select>

              {/* Queue Status */}
              {queueJobId && queueStatus && (
                <div className="p-3 bg-blue-900/20 border border-blue-700 rounded-lg">
                  <p className="text-sm text-blue-300 font-medium mb-1">Queue Status</p>
                  <p className="text-xs text-gray-400">Job ID: {queueJobId}</p>
                  <p className="text-xs text-gray-400">Status: {queueStatus.status}</p>
                  <p className="text-xs text-gray-400">Position: {queueStatus.position_in_queue}</p>
                </div>
              )}

              {/* Generate Button */}
              <button
                onClick={() => {
                  savePromptToHistory(prompt);
                  handleAddToQueue();
                }}
                disabled={generationState === "generating" || !prompt.trim()}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
              >
                {generationState === "generating" ? "Generating..." : "Generate Image"}
              </button>

              {/* Cache Clear Button */}
              <button
                onClick={handleClearCache}
                className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Clear Cache
              </button>
            </>
          )}

          {/* Upscale Mode */}
          {generationMode === 'upscale' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                Upload Image to Upscale
              </button>
              {uploadedImage && (
                <div className="flex gap-2">
                  <select
                    value="2.0"
                    className="p-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
                  >
                    <option value="1.5">1.5x</option>
                    <option value="2.0">2x</option>
                    <option value="4.0">4x</option>
                  </select>
                  <button
                    onClick={handleUpscaleImage}
                    disabled={generationState === "generating"}
                    className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                  >
                    Upscale
                  </button>
                </div>
              )}
            </>
          )}

          {/* Style Transfer Mode */}
          {generationMode === 'style-transfer' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <input
                type="file"
                ref={controlImageInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedControlImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                >
                  Upload Content Image
                </button>
                <button
                  onClick={() => controlImageInputRef.current?.click()}
                  className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
                >
                  Upload Style Image
                </button>
              </div>
              {uploadedImage && uploadedControlImage && (
                <button
                  onClick={handleStyleTransfer}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Apply Style Transfer
                </button>
              )}
            </>
          )}

          {/* Caption Mode */}
          {generationMode === 'caption' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Upload Image to Caption
              </button>
              {uploadedImage && (
                <button
                  onClick={handleCaptionImage}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Generate Caption
                </button>
              )}
            </>
          )}

          {/* Detect Objects Mode */}
          {generationMode === 'detect-objects' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Upload Image for Detection
              </button>
              {uploadedImage && (
                <button
                  onClick={handleDetectObjects}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Detect Objects
                </button>
              )}
            </>
          )}

          {/* Remove Background Mode */}
          {generationMode === 'remove-bg' && (
            <>
              <input
                type="file"
                ref={fileInputRef}
                onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
                className="hidden"
                accept="image/*"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Upload Image to Remove Background
              </button>
              {uploadedImage && (
                <button
                  onClick={handleRemoveBackground}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Remove Background
                </button>
              )}
            </>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 bg-red-900/20 border border-red-700 rounded-lg">
              <p className="text-sm text-red-400">{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-2 text-xs text-red-300 hover:text-red-200"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* Image History */}
          {imageHistory.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-white mb-3">Generated Images</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {imageHistory.slice(0, 8).map((item) => (
                  <div key={item.file_id} className="relative group">
                    <img
                      src={`file://${item.path}`}
                      alt={item.filename}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                      <a
                        href={`file://${item.path}`}
                        download={item.filename}
                        className="px-3 py-1 bg-blue-600 text-white text-sm rounded hover:bg-blue-700"
                      >
                        Download
                      </a>
                    </div>
                    <button
                      onClick={() => handleDeleteImage(item.file_id, item.filename)}
                      className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded opacity-0 group-hover:opacity-100"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Comparison View */}
          {showComparison && comparisonImage && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold text-white mb-3">Before/After Comparison</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-400 mb-2">Original</p>
                  {uploadedImage && (
                    <img
                      src={URL.createObjectURL(uploadedImage)}
                      alt="Original"
                      className="w-full h-auto rounded-lg"
                    />
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-400 mb-2">Processed</p>
                  <img
                    src={comparisonImage}
                    alt="Processed"
                    className="w-full h-auto rounded-lg"
                  />
                </div>
              </div>
              <button
                onClick={() => setShowComparison(false)}
                className="mt-4 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Close Comparison
              </button>
            </div>
          )}

          {/* Empty State */}
          {!generatedImages.length && !isGenerating && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-gray-400">
              <ImageIcon width={64} height={64} className="mb-4 opacity-50" />
              <p>
                {t(
                  "PHOTO_TAB$EMPTY_MESSAGE",
                  "Select a mode, enter a prompt and click Generate to create an image",
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
export default PhotoTab;

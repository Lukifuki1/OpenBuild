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
} from "#/api/generation-service";

type GenerationMode = "txt2img" | "img2img" | "inpaint" | "batch" | "controlnet";
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
];

function PhotoTab() {
  const { t } = useTranslation();
  const [generationMode, setGenerationMode] = useState<GenerationMode>("txt2img");
  const [prompt, setPrompt] = useState("");
  const [controlnetType, setControlnetType] = useState<string>("canny");
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedMask, setUploadedMask] = useState<File | null>(null);
  const [uploadedControlImage, setUploadedControlImage] = useState<File | null>(null);
  const [imageStrength, setImageStrength] = useState(0.7);
  const [batchPrompts, setBatchPrompts] = useState<string>("");
  const [resolution, setResolution] = useState("1024x1024");
  const [style, setStyle] = useState("default");
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [progress, setProgress] = useState(0);
  const [generatedImages, setGeneratedImages] = useState<string[]>([]);
  const [generatedImageIds, setGeneratedImageIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "healthy" | "unhealthy">("loading");
  const progressIntervalRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const maskInputRef = useRef<HTMLInputElement>(null);
  const controlImageInputRef = useRef<HTMLInputElement>(null);

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
}

export default PhotoTab;

import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import ImageIcon from "#/icons/image.svg?react";
import { cn } from "#/utils/utils";
import {
  generateImage,
  transformImage,
  inpaintImage,
  batchGenerateImages,
  generateWithControlNet,
  ImageGenerationResponse,
  STYLE_PRESETS,
  IMAGE_RESOLUTIONS,
  CONTROLNET_TYPES,
} from "#/api/generation-service";

type GenerationMode = "txt2img" | "img2img" | "inpaint" | "batch" | "controlnet";
type GenerationState =
  | "idle"
  | "pending"
  | "generating"
  | "finished"
  | "failed";

function PhotoTab() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [resolution, setResolution] = useState("1024x1024");
  const [style, setStyle] = useState("default");
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [progress, setProgress] = useState(0);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedImageId, setGeneratedImageId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const progressIntervalRef = useRef<number | null>(null);

  // Cleanup interval on unmount
  useEffect(
    () => () => {
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    },
    [],
  );

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError(t("PHOTO_TAB$ERROR_NO_PROMPT", "Please enter a prompt"));
      return;
    }

    setGenerationState("pending");
    setProgress(0);
    setError(null);

    // Simulate progress for UX (real implementation would use WebSocket or polling)
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

      const data: ImageGenerationResponse = await generateImage({
        prompt,
        resolution,
        style,
      });

      // Use the backend endpoint for serving the image
      const imageUrl = `/api/v1/generated-images/${data.image_id}`;
      setGeneratedImage(imageUrl);
      setGeneratedImageId(data.image_id);
      setGenerationState("finished");
      setProgress(100);

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } catch (err) {
      setGenerationState("failed");
      setError(
        err instanceof Error
          ? err.message
          : t("PHOTO_TAB$ERROR_GENERIC", "An error occurred"),
      );
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    }
  };

  const handleDownload = () => {
    if (generatedImage) {
      window.open(generatedImage, "_blank");
    }
  };

  const handleClear = () => {
    setPrompt("");
    setGeneratedImage(null);
    setGeneratedImageId(null);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
  };

  const isGenerating =
    generationState === "generating" || generationState === "pending";

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <ImageIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">
          {t("PHOTO_TAB$TITLE", "Photo Generation")}
        </h2>
      </div>

      <div className="flex flex-col gap-4">
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

        {/* Action Buttons */}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={isGenerating || !prompt.trim()}
            className={cn(
              "flex-1 py-2 px-4 rounded-lg font-medium text-white",
              isGenerating || !prompt.trim()
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {isGenerating
              ? t("PHOTO_TAB$GENERATING", "Generating...")
              : t("PHOTO_TAB$GENERATE", "Generate Image")}
          </button>

          {generatedImage && generationState === "finished" && (
            <>
              <button
                type="button"
                onClick={handleDownload}
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

        {/* Show Generate Another button after completion */}
        {generationState === "finished" && !generatedImage && (
          <button
            type="button"
            onClick={() => {
              setGenerationState("idle");
              setProgress(0);
            }}
            disabled={isGenerating}
            className={cn(
              "w-full py-2 px-4 rounded-lg font-medium text-white",
              isGenerating
                ? "bg-gray-400 cursor-not-allowed"
                : "bg-blue-600 hover:bg-blue-700",
            )}
          >
            {t("PHOTO_TAB$GENERATE_ANOTHER", "Generate Another")}
          </button>
        )}

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
        {generatedImage && generationState === "finished" && (
          <div className="flex flex-col gap-3 mt-4">
            <h3 className="text-sm font-medium text-gray-700">
              {t("PHOTO_TAB$PREVIEW", "Preview")}
            </h3>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <img
                src={generatedImage}
                alt="Generated"
                className="w-full h-auto max-h-96 object-contain bg-gray-100"
              />
            </div>
            {generatedImageId && (
              <div className="flex justify-between text-xs text-gray-500">
                <span>
                  <span className="text-gray-500">
                    {t("PHOTO_TAB$PATH_LABEL", "Path")}:
                  </span>
                  <span className="ml-1 font-mono break-all">
                    {generatedImage}
                  </span>
                </span>
                <span>
                  <span className="text-gray-500">
                    {t("PHOTO_TAB$IMAGE_ID", "ID")}:
                  </span>
                  <span className="ml-1 font-mono">{generatedImageId}</span>
                </span>
              </div>
            )}
          </div>
        )}

        {/* Empty State */}
        {!generatedImage && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <ImageIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>
              {t(
                "PHOTO_TAB$EMPTY_MESSAGE",
                "Enter a prompt and click Generate to create an image",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PhotoTab;

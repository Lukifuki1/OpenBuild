import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import PlayIcon from "#/icons/play.svg?react";
import UploadIcon from "#/icons/u-download.svg?react";
import { cn } from "#/utils/utils";
import {
  generateVideo,
  generateVideoFromImage,
  transformVideo,
  editVideo,
  enhanceVideo,
  checkVideoGenerationHealth,
  VideoGenerationResponse,
  VIDEO_RESOLUTIONS,
  VideoToVideoRequest,
  VideoEditingRequest,
  VideoEnhancementRequest,
  ImageToVideoRequest,
  // New API functions for Faza 2
  addAudioToVideo,
  mergeVideos,
  extractFrames,
  generateThumbnails,
  extractVideoMetadata,
  listStorage,
  deleteStorageFile,
  StorageItem,
} from "#/api/generation-service";

type VideoGenerationMode = "txt2v" | "img2v" | "v2v" | "edit" | "enhance" | "add-audio" | "merge" | "extract-frames" | "generate-thumbnails" | "metadata";
type GenerationState =
  | "idle"
  | "pending"
  | "generating"
  | "finished"
  | "failed";

const VIDEO_MODE_OPTIONS: { value: VideoGenerationMode; label: string; icon: string }[] = [
  { value: "txt2v", label: "Text to Video", icon: "T2V" },
  { value: "img2v", label: "Image to Video", icon: "I2V" },
  { value: "v2v", label: "Video to Video", icon: "V2V" },
  { value: "edit", label: "Edit Video", icon: "EDIT" },
  { value: "enhance", label: "Enhance Video", icon: "ENH" },
  { value: "add-audio", label: "Add Audio", icon: "AUDIO" },
  { value: "merge", label: "Merge Videos", icon: "MERGE" },
  { value: "extract-frames", label: "Extract Frames", icon: "FRAMES" },
  { value: "generate-thumbnails", label: "Thumbnails", icon: "THUMB" },
  { value: "metadata", label: "Metadata", icon: "META" },
];

const RESOLUTIONS = [
  { value: "1024x576", label: "1024x576 (Landscape)" },
  { value: "768x1024", label: "768x1024 (Portrait)" },
  { value: "576x1024", label: "576x1024 (Portrait)" },
  { value: "1024x1024", label: "1024x1024 (Square)" },
];

const FPS_OPTIONS = [
  { value: 24, label: "24 fps (Cinematic)" },
  { value: 30, label: "30 fps (Standard)" },
  { value: 60, label: "60 fps (Smooth)" },
];

const VIDEO_OPERATIONS = [
  { value: "trim", label: "Trim" },
  { value: "crop", label: "Crop" },
  { value: "reverse", label: "Reverse" },
  { value: "loop", label: "Loop" },
  { value: "slow", label: "Slow Motion" },
  { value: "fast", label: "Speed Up" },
];

const DURATION_MIN = 2;
const DURATION_MAX = 30;
const DURATION_DEFAULT = 5;

// New state variables for Faza 2 features
const [videoHistory, setVideoHistory] = useState<StorageItem[]>([]);
const [audioFile, setAudioFile] = useState<File | null>(null);
const [metadata, setMetadata] = useState<any>(null);
const [thumbnailsDir, setThumbnailsDir] = useState<string>("");
const [framesCount, setFramesCount] = useState<number>(0);

function VideoTab() {
  const { t } = useTranslation();
  const [videoMode, setVideoMode] = useState<VideoGenerationMode>("txt2v");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [fps, setFps] = useState(24);
  const [resolution, setResolution] = useState("1024x576");
  const [uploadedImage, setUploadedImage] = useState<File | null>(null);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [editOperation, setEditOperation] = useState<string>("trim");
  const [enhanceUpscale, setEnhanceUpscale] = useState<number>(1);
  const [enhanceDenoise, setEnhanceDenoise] = useState<boolean>(false);
  const [enhanceTargetFps, setEnhanceTargetFps] = useState<number>(30);
  const [generationState, setGenerationState] =
    useState<GenerationState>("idle");
  const [progress, setProgress] = useState(0);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [generatedVideoId, setGeneratedVideoId] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{
    duration: number;
    fps: number;
    resolution: string;
    model: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [healthStatus, setHealthStatus] = useState<"loading" | "healthy" | "unhealthy">("loading");
  const progressIntervalRef = useRef<number | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

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
        await checkVideoGenerationHealth();
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

  const handleVideoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploadedVideo(file);
    }
  };

  // Handle mode change - reset relevant state
  const handleModeChange = (mode: VideoGenerationMode) => {
    setVideoMode(mode);
    setGeneratedVideo(null);
    setGeneratedVideoId(null);
    setVideoMetadata(null);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
  };

  const handleGenerate = async () => {
    // Validate based on mode
    if (videoMode === "txt2v" && !prompt.trim()) {
      setError(t("VIDEO_TAB$ERROR_NO_PROMPT", "Please enter a prompt"));
      return;
    }
    if (videoMode === "img2v" && (!prompt.trim() || !uploadedImage)) {
      setError(t("VIDEO_TAB$ERROR_NO_IMAGE", "Please upload an image and enter a prompt"));
      return;
    }
    if (videoMode === "v2v" && (!prompt.trim() || !uploadedVideo)) {
      setError(t("VIDEO_TAB$ERROR_NO_VIDEO", "Please upload a video and enter a prompt"));
      return;
    }
    if (videoMode === "edit" && !uploadedVideo) {
      setError(t("VIDEO_TAB$ERROR_NO_VIDEO_EDIT", "Please upload a video to edit"));
      return;
    }
    if (videoMode === "enhance" && !uploadedVideo) {
      setError(t("VIDEO_TAB$ERROR_NO_VIDEO_ENHANCE", "Please upload a video to enhance"));
      return;
    }

    setGenerationState("pending");
    setProgress(0);
    setError(null);
    setGeneratedVideo(null);
    setGeneratedVideoId(null);
    setVideoMetadata(null);

    // Simulate progress for UX (video generation takes longer)
    progressIntervalRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
          }
          return prev;
        }
        return prev + Math.random() * 8;
      });
    }, 800);

    try {
      setGenerationState("generating");
      let data: VideoGenerationResponse;

      switch (videoMode) {
        case "txt2v": {
          data = await generateVideo({
            prompt,
            duration,
            fps,
            resolution,
          });
          break;
        }
        case "img2v": {
          const img2vRequest: ImageToVideoRequest = {
            image_path: uploadedImage ? await fileToDataUrl(uploadedImage) : "",
            prompt,
            duration,
            fps,
            resolution,
          };
          data = await generateVideoFromImage(img2vRequest);
          break;
        }
        case "v2v": {
          const v2vRequest: VideoToVideoRequest = {
            video_path: uploadedVideo ? await fileToDataUrl(uploadedVideo) : "",
            prompt,
            duration,
            fps,
          };
          data = await transformVideo(v2vRequest);
          break;
        }
        case "edit": {
          const editRequest: VideoEditingRequest = {
            video_path: uploadedVideo ? await fileToDataUrl(uploadedVideo) : "",
            operation: editOperation as VideoEditingRequest["operation"],
          };
          data = await editVideo(editRequest);
          break;
        }
        case "enhance": {
          const enhanceRequest: VideoEnhancementRequest = {
            video_path: uploadedVideo ? await fileToDataUrl(uploadedVideo) : "",
            upscale_factor: enhanceUpscale,
            denoise: enhanceDenoise,
            target_fps: enhanceTargetFps,
          };
          data = await enhanceVideo(enhanceRequest);
          break;
        }
      }

      // Use the backend endpoint for serving the video
      const videoUrl = `/api/v1/generated-videos/${data.video_id}`;
      setGeneratedVideo(videoUrl);
      setGeneratedVideoId(data.video_id);
      setVideoMetadata({
        duration: data.duration,
        fps: data.fps,
        resolution: data.resolution,
        model: data.model,
      });
      setGenerationState("finished");
      setProgress(100);

      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
      }
    } catch (err) {
      setGenerationState("failed");
      let errorMessage = t("VIDEO_TAB$ERROR_GENERIC", "An error occurred");
      
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

  const handleDownload = () => {
    if (generatedVideo) {
      window.open(generatedVideo, "_blank");
    }
  };

  const handleClear = () => {
    setPrompt("");
    setUploadedImage(null);
    setUploadedVideo(null);
    setGeneratedVideo(null);
    setGeneratedVideoId(null);
    setVideoMetadata(null);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
    // Reset file inputs
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (videoInputRef.current) videoInputRef.current.value = "";
  };

  const isGenerating =
    generationState === "generating" || generationState === "pending";

  // Check if generate button should be disabled
  const canGenerate = () => {
    if (isGenerating) return false;
    switch (videoMode) {
      case "txt2v":
        return !!prompt.trim();
      case "img2v":
        return !!prompt.trim() && !!uploadedImage;
      case "v2v":
        return !!prompt.trim() && !!uploadedVideo;
      case "edit":
        return !!uploadedVideo;
      case "enhance":
        return !!uploadedVideo;
      default:
        return false;
    }
  };

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <PlayIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">
          {t("VIDEO_TAB$TITLE", "Video Generation")}
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
            {t("VIDEO_TAB$MODE_LABEL", "Generation Mode")}
          </label>
          <div className="flex flex-wrap gap-2">
            {VIDEO_MODE_OPTIONS.map((mode) => (
              <button
                key={mode.value}
                type="button"
                onClick={() => handleModeChange(mode.value)}
                disabled={isGenerating}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-medium transition-all",
                  videoMode === mode.value
                    ? "bg-purple-600 text-white shadow-md"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                  isGenerating && "opacity-50 cursor-not-allowed",
                )}
              >
                <span className="flex items-center gap-2">
                  <span className={cn(
                    "px-1.5 py-0.5 text-xs rounded",
                    videoMode === mode.value ? "bg-purple-500" : "bg-gray-300"
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
        {videoMode === "txt2v" && (
          <>
            {/* Prompt Input */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="video-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("VIDEO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="video-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "VIDEO_TAB$PROMPT_PLACEHOLDER",
                  "Describe the motion and action you want to see in the video...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isGenerating}
              />
            </div>

            {/* Options Grid */}
            <div className="grid grid-cols-3 gap-4">
              {/* Duration */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="video-duration"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("VIDEO_TAB$DURATION_LABEL", "Duration (seconds)")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    id="video-duration"
                    min={DURATION_MIN}
                    max={DURATION_MAX}
                    step={0.5}
                    value={duration}
                    onChange={(e) => setDuration(parseFloat(e.target.value))}
                    className="flex-1"
                    disabled={isGenerating}
                  />
                  <span className="w-12 text-sm text-gray-600 text-right">
                    {t("VIDEO_TAB$DURATION_DISPLAY", "{{duration}}s", { duration })}
                  </span>
                </div>
              </div>

              {/* FPS */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="video-fps"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("VIDEO_TAB$FPS_LABEL", "Frame Rate")}
                </label>
                <select
                  id="video-fps"
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value, 10))}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={isGenerating}
                >
                  {FPS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Resolution */}
              <div className="flex flex-col gap-2">
                <label
                  htmlFor="video-resolution"
                  className="text-sm font-medium text-gray-700"
                >
                  {t("VIDEO_TAB$RESOLUTION_LABEL", "Resolution")}
                </label>
                <select
                  id="video-resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                  disabled={isGenerating}
                >
                  {RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {videoMode === "img2v" && (
          <>
            {/* Image Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("VIDEO_TAB$UPLOAD_IMAGE_LABEL", "Upload Image")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="img2v-image-upload"
                />
                <label
                  htmlFor="img2v-image-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedImage ? uploadedImage.name : t("VIDEO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedImage && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedImage(null);
                      if (imageInputRef.current) imageInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("VIDEO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="img2v-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("VIDEO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="img2v-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "VIDEO_TAB$IMG2V_PROMPT_PLACEHOLDER",
                  "Describe the motion and action you want to create from this image...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isGenerating}
              />
            </div>

            {/* Options Grid */}
            <div className="grid grid-cols-3 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$DURATION_LABEL", "Duration (seconds)")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={DURATION_MIN}
                    max={DURATION_MAX}
                    step={0.5}
                    value={duration}
                    onChange={(e) => setDuration(parseFloat(e.target.value))}
                    className="flex-1"
                    disabled={isGenerating}
                  />
                  <span className="w-12 text-sm text-gray-600 text-right">{duration}s</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$FPS_LABEL", "Frame Rate")}
                </label>
                <select
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value, 10))}
                  className="p-2 border border-gray-300 rounded-lg"
                  disabled={isGenerating}
                >
                  {FPS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$RESOLUTION_LABEL", "Resolution")}
                </label>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="p-2 border border-gray-300 rounded-lg"
                  disabled={isGenerating}
                >
                  {RESOLUTIONS.map((res) => (
                    <option key={res.value} value={res.value}>
                      {res.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {videoMode === "v2v" && (
          <>
            {/* Video Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("VIDEO_TAB$UPLOAD_VIDEO_LABEL", "Upload Video")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="v2v-video-upload"
                />
                <label
                  htmlFor="v2v-video-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedVideo ? uploadedVideo.name : t("VIDEO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedVideo && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedVideo(null);
                      if (videoInputRef.current) videoInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("VIDEO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Prompt */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="v2v-prompt"
                className="text-sm font-medium text-gray-700"
              >
                {t("VIDEO_TAB$PROMPT_LABEL", "Prompt")}
              </label>
              <textarea
                id="v2v-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={t(
                  "VIDEO_TAB$V2V_PROMPT_PLACEHOLDER",
                  "Describe the transformation you want to apply to the video...",
                )}
                className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                disabled={isGenerating}
              />
            </div>

            {/* Options Grid */}
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$DURATION_LABEL", "Duration (seconds)")}
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={DURATION_MIN}
                    max={DURATION_MAX}
                    step={0.5}
                    value={duration}
                    onChange={(e) => setDuration(parseFloat(e.target.value))}
                    className="flex-1"
                    disabled={isGenerating}
                  />
                  <span className="w-12 text-sm text-gray-600 text-right">{duration}s</span>
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$FPS_LABEL", "Frame Rate")}
                </label>
                <select
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value, 10))}
                  className="p-2 border border-gray-300 rounded-lg"
                  disabled={isGenerating}
                >
                  {FPS_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}

        {videoMode === "edit" && (
          <>
            {/* Video Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("VIDEO_TAB$UPLOAD_VIDEO_LABEL", "Upload Video")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="edit-video-upload"
                />
                <label
                  htmlFor="edit-video-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedVideo ? uploadedVideo.name : t("VIDEO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedVideo && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedVideo(null);
                      if (videoInputRef.current) videoInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("VIDEO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Edit Operation */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("VIDEO_TAB$EDIT_OPERATION_LABEL", "Edit Operation")}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {VIDEO_OPERATIONS.map((op) => (
                  <button
                    key={op.value}
                    type="button"
                    onClick={() => setEditOperation(op.value)}
                    disabled={isGenerating}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium transition-all",
                      editOperation === op.value
                        ? "bg-purple-600 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200",
                      isGenerating && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                {t("VIDEO_TAB$EDIT_OPERATION_HELP", "Select the editing operation to apply to the video")}
              </p>
            </div>
          </>
        )}

        {videoMode === "enhance" && (
          <>
            {/* Video Upload */}
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-gray-700">
                {t("VIDEO_TAB$UPLOAD_VIDEO_LABEL", "Upload Video")}
              </label>
              <div className="flex items-center gap-4">
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoUpload}
                  disabled={isGenerating}
                  className="hidden"
                  id="enhance-video-upload"
                />
                <label
                  htmlFor="enhance-video-upload"
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg cursor-pointer hover:bg-gray-50",
                    isGenerating && "opacity-50 cursor-not-allowed"
                  )}
                >
                  <UploadIcon width={20} height={20} />
                  {uploadedVideo ? uploadedVideo.name : t("VIDEO_TAB$CHOOSE_FILE", "Choose file")}
                </label>
                {uploadedVideo && (
                  <button
                    type="button"
                    onClick={() => {
                      setUploadedVideo(null);
                      if (videoInputRef.current) videoInputRef.current.value = "";
                    }}
                    className="text-red-500 hover:text-red-700 text-sm"
                  >
                    {t("VIDEO_TAB$REMOVE", "Remove")}
                  </button>
                )}
              </div>
            </div>

            {/* Enhancement Options */}
            <div className="flex flex-col gap-4">
              {/* Upscale */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$UPSCALE_LABEL", "Upscale Factor")}: {enhanceUpscale}x
                </label>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="1"
                  value={enhanceUpscale}
                  onChange={(e) => setEnhanceUpscale(parseInt(e.target.value, 10))}
                  className="w-full"
                  disabled={isGenerating}
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>None</span>
                  <span>2x</span>
                  <span>4x</span>
                </div>
              </div>

              {/* Denoise */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="enhance-denoise"
                  checked={enhanceDenoise}
                  onChange={(e) => setEnhanceDenoise(e.target.checked)}
                  disabled={isGenerating}
                  className="w-4 h-4"
                />
                <label htmlFor="enhance-denoise" className="text-sm text-gray-700">
                  {t("VIDEO_TAB$DENOISE_LABEL", "Denoise")}
                </label>
              </div>

              {/* Target FPS */}
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium text-gray-700">
                  {t("VIDEO_TAB$TARGET_FPS_LABEL", "Target Frame Rate")}
                </label>
                <select
                  value={enhanceTargetFps}
                  onChange={(e) => setEnhanceTargetFps(parseInt(e.target.value, 10))}
                  className="p-2 border border-gray-300 rounded-lg"
                  disabled={isGenerating}
                >
                  <option value={24}>24 fps (Cinematic)</option>
                  <option value={30}>30 fps (Standard)</option>
                  <option value={60}>60 fps (Smooth)</option>
                </select>
              </div>
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
                : "bg-purple-600 hover:bg-purple-700",
            )}
          >
            {isGenerating
              ? t(
                  "VIDEO_TAB$GENERATING",
                  "Generating... (this may take a while)",
                )
              : t("VIDEO_TAB$GENERATE", "Generate Video")}
          </button>

          {generatedVideo && generationState === "finished" && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                className="py-2 px-4 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700"
              >
                {t("VIDEO_TAB$DOWNLOAD", "Download")}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
              >
                {t("VIDEO_TAB$CLEAR", "Clear")}
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
                  ? t("VIDEO_TAB$STATUS_PENDING", "Preparing...")
                  : t("VIDEO_TAB$STATUS_GENERATING", "Generating video...")}
              </span>
              <span>{Math.min(Math.round(progress), 100)}%</span>
            </div>
            <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-purple-600 transition-all duration-300"
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
        {generatedVideo && generationState === "finished" && (
          <div className="flex flex-col gap-3 mt-4">
            <h3 className="text-sm font-medium text-gray-700">
              {t("VIDEO_TAB$PREVIEW", "Preview")}
            </h3>

            {/* Video Player */}
            <div className="border border-gray-300 rounded-lg overflow-hidden bg-black">
              <video
                src={generatedVideo}
                controls
                className="w-full h-auto max-h-96 object-contain"
              >
                <track kind="captions" />
              </video>
            </div>

            {/* Video Metadata Block */}
            {videoMetadata && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                  {t("VIDEO_TAB$METADATA_TITLE", "Video Details")}
                </h4>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-gray-500">
                      {t("VIDEO_TAB$DURATION_LABEL", "Duration")}:
                    </span>
                    <span className="ml-1 font-medium">
                      {videoMetadata.duration}
                      {t("VIDEO_TAB$DURATION_UNIT", "s")}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">
                      {t("VIDEO_TAB$FPS_LABEL", "Frame Rate")}:
                    </span>
                    <span className="ml-1 font-medium">
                      {videoMetadata.fps}
                      {t("VIDEO_TAB$FPS_UNIT", " fps")}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">
                      {t("VIDEO_TAB$RESOLUTION_LABEL", "Resolution")}:
                    </span>
                    <span className="ml-1 font-medium">
                      {videoMetadata.resolution}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">
                      {t("VIDEO_TAB$MODEL_LABEL", "Model")}:
                    </span>
                    <span className="ml-1 font-medium">
                      {videoMetadata.model}
                    </span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-gray-500">
                      {t("VIDEO_TAB$PATH_LABEL", "Path")}:
                    </span>
                    <span className="ml-1 font-mono text-xs break-all">
                      {generatedVideo}
                    </span>
                  </div>
                  {generatedVideoId && (
                    <div className="col-span-2">
                      <span className="text-gray-500">
                        {t("VIDEO_TAB$VIDEO_ID", "ID")}:
                      </span>
                      <span className="ml-1 font-mono text-xs">
                        {generatedVideoId}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Download Link */}
            <div className="flex justify-end">
              <a
                href={generatedVideo}
                download={`video_${generatedVideoId || "generated"}.mp4`}
                className="inline-flex items-center gap-2 px-3 py-2 text-sm text-white bg-green-600 hover:bg-green-700 rounded-lg"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                  />
                </svg>
                {t("VIDEO_TAB$DOWNLOAD_VIDEO", "Download Video")}
              </a>
            </div>
          </div>
        )}

        {/* Add Audio Mode */}
        {videoMode === 'add-audio' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => e.target.files?.[0] && setSelectedVideo(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <input
              type="file"
              onChange={(e) => e.target.files?.[0] && setAudioFile(e.target.files[0])}
              className="hidden"
              accept="audio/*"
            />
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => videoInputRef.current?.click()}
                className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Upload Video
              </button>
              <button
                onClick={() => document.querySelector('input[type="file"]')?.click()}
                className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Upload Audio
              </button>
            </div>
            {selectedVideo && audioFile && (
              <button
                onClick={handleAddAudio}
                disabled={generationState === "generating"}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                Add Audio to Video
              </button>
            )}
          </div>
        )}

        {/* Merge Videos Mode */}
        {videoMode === 'merge' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => e.target.files?.[0] && setSelectedVideo(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <input
              type="file"
              ref={imageInputRef}
              onChange={(e) => e.target.files?.[0] && setUploadedImage(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => videoInputRef.current?.click()}
                className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Video 1
              </button>
              <button
                onClick={() => imageInputRef.current?.click()}
                className="py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
              >
                Video 2
              </button>
            </div>
            {selectedVideo && uploadedImage && (
              <button
                onClick={handleMergeVideos}
                disabled={generationState === "generating"}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                Merge Videos
              </button>
            )}
          </div>
        )}

        {/* Extract Frames Mode */}
        {videoMode === 'extract-frames' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => e.target.files?.[0] && setSelectedVideo(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <button
              onClick={() => videoInputRef.current?.click()}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              Upload Video to Extract Frames
            </button>
            {selectedVideo && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Extract every Nth frame:</label>
                <select className="w-full p-2 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="1">Every frame</option>
                  <option value="5">Every 5th frame</option>
                  <option value="10" selected>Every 10th frame</option>
                  <option value="30">Every 30th frame</option>
                </select>
                <button
                  onClick={handleExtractFrames}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Extract Frames
                </button>
              </div>
            )}
          </div>
        )}

        {/* Generate Thumbnails Mode */}
        {videoMode === 'generate-thumbnails' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => e.target.files?.[0] && setSelectedVideo(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <button
              onClick={() => videoInputRef.current?.click()}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              Upload Video for Thumbnails
            </button>
            {selectedVideo && (
              <div className="space-y-2">
                <label className="text-sm text-gray-400">Number of thumbnails:</label>
                <select className="w-full p-2 bg-gray-800 border border-gray-700 rounded-lg text-white">
                  <option value="3">3 thumbnails</option>
                  <option value="5" selected>5 thumbnails</option>
                  <option value="10">10 thumbnails</option>
                </select>
                <button
                  onClick={handleGenerateThumbnails}
                  disabled={generationState === "generating"}
                  className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  Generate Thumbnails
                </button>
              </div>
            )}
          </div>
        )}

        {/* Metadata Mode */}
        {videoMode === 'metadata' && (
          <div className="space-y-4">
            <input
              type="file"
              ref={videoInputRef}
              onChange={(e) => e.target.files?.[0] && setSelectedVideo(e.target.files[0])}
              className="hidden"
              accept="video/*"
            />
            <button
              onClick={() => videoInputRef.current?.click()}
              className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
            >
              Upload Video for Metadata
            </button>
            {selectedVideo && (
              <button
                onClick={handleLoadMetadata}
                disabled={generationState === "generating"}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
              >
                Extract Metadata
              </button>
            )}
            {metadata && (
              <div className="p-4 bg-gray-800 rounded-lg">
                <h4 className="text-sm font-semibold text-white mb-2">Video Metadata</h4>
                <div className="space-y-1 text-xs text-gray-400">
                  <p>Duration: {metadata.duration.toFixed(2)}s</p>
                  <p>FPS: {metadata.fps}</p>
                  <p>Resolution: {metadata.resolution}</p>
                  <p>Width: {metadata.width}px</p>
                  <p>Height: {metadata.height}px</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Video History */}
        {videoHistory.length > 0 && (
          <div className="mt-6">
            <h3 className="text-lg font-semibold text-white mb-3">Generated Videos</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {videoHistory.slice(0, 8).map((item) => (
                <div key={item.file_id} className="relative group">
                  <video
                    src={`file://${item.path}`}
                    controls
                    className="w-full h-32 object-cover rounded-lg"
                  />
                  <button
                    onClick={() => handleDeleteVideo(item.file_id, item.filename)}
                    className="absolute top-1 right-1 p-1 bg-red-600 text-white rounded opacity-0 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {!generatedVideo && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <PlayIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>
              {t(
                "VIDEO_TAB$EMPTY_MESSAGE",
                "Select a mode, enter a prompt and click Generate to create a video",
              )}
            </p>
            <p className="text-xs mt-2">
              {t(
                "VIDEO_TAB$EMPTY_NOTE",
                "Video generation may take longer than image generation",
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );

  // ============================================================================
  // NEW FUNCTIONS - Faza 2 Frontend Enhancement (Video)
  // ============================================================================

  /**
   * Add audio to video
   */
  const handleAddAudio = async () => {
    if (!selectedVideo || !audioFile) {
      setError("Please upload both video and audio files");
      return;
    }

    setGenerationState("generating");
    try {
      const videoDataUrl = await fileToDataUrl(selectedVideo);
      const audioDataUrl = await fileToDataUrl(audioFile);

      const response = await addAudioToVideo({
        video_path: videoDataUrl,
        audio_path: audioDataUrl,
        volume: 1.0,
      });

      setGeneratedVideo(response.video_path);
      setGeneratedVideoId(response.video_id);
      setGenerationState("finished");
      
      // Reload history
      const items = await listStorage();
      setVideoHistory(items.filter(item => item.filename.endsWith('.mp4')));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audio addition failed");
      setGenerationState("failed");
    }
  };

  /**
   * Merge videos
   */
  const handleMergeVideos = async () => {
    if (!selectedVideo || !uploadedImage) {
      setError("Please upload at least two videos");
      return;
    }

    setGenerationState("generating");
    try {
      const video1DataUrl = await fileToDataUrl(selectedVideo);
      const video2DataUrl = await fileToDataUrl(uploadedImage);

      const response = await mergeVideos({
        video_paths: [video1DataUrl, video2DataUrl],
        transition_type: 'fade',
      });

      setGeneratedVideo(response.video_path);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Video merging failed");
      setGenerationState("failed");
    }
  };

  /**
   * Extract frames from video
   */
  const handleExtractFrames = async () => {
    if (!selectedVideo) {
      setError("Please upload a video first");
      return;
    }

    setGenerationState("generating");
    try {
      const dataUrl = await fileToDataUrl(selectedVideo);

      const response = await extractFrames({
        video_path: dataUrl,
        interval: 10,
        start_frame: 0,
      });

      setFramesCount(response.frames_count);
      alert(`Extracted ${response.frames_count} frames from video`);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Frame extraction failed");
      setGenerationState("failed");
    }
  };

  /**
   * Generate thumbnails from video
   */
  const handleGenerateThumbnails = async () => {
    if (!selectedVideo) {
      setError("Please upload a video first");
      return;
    }

    setGenerationState("generating");
    try {
      const dataUrl = await fileToDataUrl(selectedVideo);

      const response = await generateThumbnails({
        video_path: dataUrl,
        num_thumbnails: 5,
        start_frame: 0,
      });

      setThumbnailsDir(response.output_directory);
      alert(`Generated ${response.thumbnails_count} thumbnails`);
      setGenerationState("finished");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thumbnail generation failed");
      setGenerationState("failed");
    }
  };

  /**
   * Load video metadata
   */
  const handleLoadMetadata = async () => {
    if (!selectedVideo) {
      setError("Please upload a video first");
      return;
    }

    try {
      const dataUrl = await fileToDataUrl(selectedVideo);
      const meta = await extractVideoMetadata({ video_path: dataUrl });
      setMetadata(meta);
      
      alert(`Duration: ${meta.duration.toFixed(2)}s\nFPS: ${meta.fps}\nResolution: ${meta.resolution}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Metadata extraction failed");
    }
  };

  /**
   * Delete video from storage
   */
  const handleDeleteVideo = async (fileId: string, filename: string) => {
    try {
      await deleteStorageFile(fileId);
      setVideoHistory(prev => prev.filter(item => item.file_id !== fileId));
      alert(`Deleted ${filename}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete video");
    }
  };

  return (export default VideoTab;

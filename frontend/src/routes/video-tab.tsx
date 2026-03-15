import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import PlayIcon from "#/icons/play.svg?react";
import { cn } from "#/utils/utils";
import {
  generateVideo,
  VideoGenerationResponse,
} from "#/api/generation-service";

type GenerationState =
  | "idle"
  | "pending"
  | "generating"
  | "finished"
  | "failed";

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

const DURATION_MIN = 2;
const DURATION_MAX = 10;
const DURATION_DEFAULT = 5;

function VideoTab() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [fps, setFps] = useState(24);
  const [resolution, setResolution] = useState("1024x576");
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
      setError(t("VIDEO_TAB$ERROR_NO_PROMPT", "Please enter a prompt"));
      return;
    }

    setGenerationState("pending");
    setProgress(0);
    setError(null);

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

      const data: VideoGenerationResponse = await generateVideo({
        prompt,
        duration,
        fps,
        resolution,
      });

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
      setError(
        err instanceof Error
          ? err.message
          : t("VIDEO_TAB$ERROR_GENERIC", "An error occurred"),
      );
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
    setGeneratedVideo(null);
    setGeneratedVideoId(null);
    setVideoMetadata(null);
    setError(null);
    setGenerationState("idle");
    setProgress(0);
  };

  const isGenerating =
    generationState === "generating" || generationState === "pending";

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <PlayIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">
          {t("VIDEO_TAB$TITLE", "Video Generation")}
        </h2>
      </div>

      <div className="flex flex-col gap-4">
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
            className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
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

        {/* Empty State */}
        {!generatedVideo && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <PlayIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>
              {t(
                "VIDEO_TAB$EMPTY_MESSAGE",
                "Enter a prompt and click Generate to create a video",
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
}

export default VideoTab;

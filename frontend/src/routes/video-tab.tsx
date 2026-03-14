import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import PlayIcon from '#/icons/play.svg?react';
import { cn } from '#/utils/utils';

interface VideoGenerationOptions {
  duration: number;
  fps: number;
  resolution: string;
}

const RESOLUTIONS = [
  { value: '1024x576', label: '1024x576 (Landscape)' },
  { value: '768x1024', label: '768x1024 (Portrait)' },
  { value: '576x1024', label: '576x1024 (Portrait)' },
  { value: '1024x1024', label: '1024x1024 (Square)' },
];

const FPS_OPTIONS = [
  { value: 24, label: '24 fps (Cinematic)' },
  { value: 30, label: '30 fps (Standard)' },
  { value: 60, label: '60 fps (Smooth)' },
];

const DURATION_MIN = 2;
const DURATION_MAX = 10;
const DURATION_DEFAULT = 5;

function VideoTab() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [duration, setDuration] = useState(DURATION_DEFAULT);
  const [fps, setFps] = useState(24);
  const [resolution, setResolution] = useState('1024x576');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<{
    duration: number;
    fps: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/generate-video', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          duration,
          fps,
          resolution,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate video');
      }

      const data = await response.json();
      setGeneratedVideo(data.video_path);
      setVideoMetadata({
        duration: data.duration,
        fps: data.fps,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (generatedVideo) {
      window.open(generatedVideo, '_blank');
    }
  };

  const handleClear = () => {
    setPrompt('');
    setGeneratedVideo(null);
    setVideoMetadata(null);
    setError(null);
  };

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <PlayIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">{t('VIDEO_TAB$TITLE', 'Video Generation')}</h2>
      </div>

      <div className="flex flex-col gap-4">
        {/* Prompt Input */}
        <div className="flex flex-col gap-2">
          <label htmlFor="video-prompt" className="text-sm font-medium text-gray-700">
            {t('VIDEO_TAB$PROMPT_LABEL', 'Prompt')}
          </label>
          <textarea
            id="video-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t(
              'VIDEO_TAB$PROMPT_PLACEHOLDER',
              'Describe the motion and action you want to see in the video...'
            )}
            className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isGenerating}
          />
        </div>

        {/* Options Grid */}
        <div className="grid grid-cols-3 gap-4">
          {/* Duration */}
          <div className="flex flex-col gap-2">
            <label htmlFor="video-duration" className="text-sm font-medium text-gray-700">
              {t('VIDEO_TAB$DURATION_LABEL', 'Duration (seconds)')}
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
              <span className="w-12 text-sm text-gray-600 text-right">{duration}s</span>
            </div>
          </div>

          {/* FPS */}
          <div className="flex flex-col gap-2">
            <label htmlFor="video-fps" className="text-sm font-medium text-gray-700">
              {t('VIDEO_TAB$FPS_LABEL', 'Frame Rate')}
            </label>
            <select
              id="video-fps"
              value={fps}
              onChange={(e) => setFps(parseInt(e.target.value))}
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
            <label htmlFor="video-resolution" className="text-sm font-medium text-gray-700">
              {t('VIDEO_TAB$RESOLUTION_LABEL', 'Resolution')}
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
              'flex-1 py-2 px-4 rounded-lg font-medium text-white',
              isGenerating || !prompt.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {isGenerating
              ? t('VIDEO_TAB$GENERATING', 'Generating... (this may take a while)')
              : t('VIDEO_TAB$GENERATE', 'Generate Video')}
          </button>

          {generatedVideo && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                className="py-2 px-4 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700"
              >
                {t('VIDEO_TAB$DOWNLOAD', 'Download')}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
              >
                {t('VIDEO_TAB$CLEAR', 'Clear')}
              </button>
            </>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Preview */}
        {generatedVideo && (
          <div className="flex flex-col gap-2 mt-4">
            <h3 className="text-sm font-medium text-gray-700">
              {t('VIDEO_TAB$PREVIEW', 'Preview')}
            </h3>
            <div className="border border-gray-300 rounded-lg overflow-hidden bg-black">
              <video
                src={generatedVideo}
                controls
                className="w-full h-auto max-h-96 object-contain"
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <p>Path: {generatedVideo}</p>
              {videoMetadata && (
                <p>
                  {videoMetadata.duration}s • {videoMetadata.fps} fps
                </p>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!generatedVideo && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <PlayIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>
              {t(
                'VIDEO_TAB$EMPTY_MESSAGE',
                'Enter a prompt and click Generate to create a video'
              )}
            </p>
            <p className="text-xs mt-2">
              {t('VIDEO_TAB$EMPTY_NOTE', 'Video generation may take longer than image generation')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoTab;

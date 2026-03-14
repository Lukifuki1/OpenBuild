import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ImageIcon from '#/icons/image.svg?react';
import { cn } from '#/utils/utils';

interface GenerationOptions {
  resolution: string;
  style: string;
}

const RESOLUTIONS = [
  { value: '512x512', label: '512x512 (Square)' },
  { value: '1024x1024', label: '1024x1024 (Square)' },
  { value: '1024x768', label: '1024x768 (Landscape)' },
  { value: '768x1024', label: '768x1024 (Portrait)' },
];

const STYLES = [
  { value: 'default', label: 'Default (FLUX)' },
  { value: 'sdxl', label: 'SDXL (Stable Diffusion XL)' },
  { value: 'realistic', label: 'Realistic' },
];

function PhotoTab() {
  const { t } = useTranslation();
  const [prompt, setPrompt] = useState('');
  const [resolution, setResolution] = useState('1024x1024');
  const [style, setStyle] = useState('default');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please enter a prompt');
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/generate-image', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          resolution,
          style,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to generate image');
      }

      const data = await response.json();
      setGeneratedImage(data.image_path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (generatedImage) {
      window.open(generatedImage, '_blank');
    }
  };

  const handleClear = () => {
    setPrompt('');
    setGeneratedImage(null);
    setError(null);
  };

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-auto">
      <div className="flex items-center gap-2 mb-4">
        <ImageIcon width={24} height={24} className="text-gray-500" />
        <h2 className="text-lg font-semibold">{t('PHOTO_TAB$TITLE', 'Photo Generation')}</h2>
      </div>

      <div className="flex flex-col gap-4">
        {/* Prompt Input */}
        <div className="flex flex-col gap-2">
          <label htmlFor="photo-prompt" className="text-sm font-medium text-gray-700">
            {t('PHOTO_TAB$PROMPT_LABEL', 'Prompt')}
          </label>
          <textarea
            id="photo-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={t('PHOTO_TAB$PROMPT_PLACEHOLDER', 'Describe the image you want to generate...')}
            className="w-full h-32 p-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isGenerating}
          />
        </div>

        {/* Options Row */}
        <div className="flex gap-4">
          {/* Resolution */}
          <div className="flex flex-col gap-2 flex-1">
            <label htmlFor="photo-resolution" className="text-sm font-medium text-gray-700">
              {t('PHOTO_TAB$RESOLUTION_LABEL', 'Resolution')}
            </label>
            <select
              id="photo-resolution"
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

          {/* Style */}
          <div className="flex flex-col gap-2 flex-1">
            <label htmlFor="photo-style" className="text-sm font-medium text-gray-700">
              {t('PHOTO_TAB$STYLE_LABEL', 'Style')}
            </label>
            <select
              id="photo-style"
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="p-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isGenerating}
            >
              {STYLES.map((s) => (
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
              'flex-1 py-2 px-4 rounded-lg font-medium text-white',
              isGenerating || !prompt.trim()
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700'
            )}
          >
            {isGenerating
              ? t('PHOTO_TAB$GENERATING', 'Generating...')
              : t('PHOTO_TAB$GENERATE', 'Generate Image')}
          </button>

          {generatedImage && (
            <>
              <button
                type="button"
                onClick={handleDownload}
                className="py-2 px-4 rounded-lg font-medium text-white bg-green-600 hover:bg-green-700"
              >
                {t('PHOTO_TAB$DOWNLOAD', 'Download')}
              </button>
              <button
                type="button"
                onClick={handleClear}
                className="py-2 px-4 rounded-lg font-medium text-gray-700 bg-gray-200 hover:bg-gray-300"
              >
                {t('PHOTO_TAB$CLEAR', 'Clear')}
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
        {generatedImage && (
          <div className="flex flex-col gap-2 mt-4">
            <h3 className="text-sm font-medium text-gray-700">
              {t('PHOTO_TAB$PREVIEW', 'Preview')}
            </h3>
            <div className="border border-gray-300 rounded-lg overflow-hidden">
              <img
                src={generatedImage}
                alt="Generated"
                className="w-full h-auto max-h-96 object-contain bg-gray-100"
              />
            </div>
            <p className="text-xs text-gray-500 break-all">{generatedImage}</p>
          </div>
        )}

        {/* Empty State */}
        {!generatedImage && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <ImageIcon width={64} height={64} className="mb-4 opacity-50" />
            <p>{t('PHOTO_TAB$EMPTY_MESSAGE', 'Enter a prompt and click Generate to create an image')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default PhotoTab;

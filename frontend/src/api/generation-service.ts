/**
 * Generation Service API Client
 *
 * Provides methods for image and video generation via the OpenHands backend API.
 */

import { openHands } from "./open-hands-axios";

export interface ImageGenerationRequest {
  prompt: string;
  resolution?: string;
  style?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface ImageGenerationResponse {
  image_path: string;
  image_id: string;
  resolution: string;
  model: string;
}

export interface VideoGenerationRequest {
  prompt: string;
  duration?: number;
  fps?: number;
  resolution?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface VideoGenerationResponse {
  video_path: string;
  video_id: string;
  duration: number;
  fps: number;
  resolution: string;
  model: string;
}

export interface ImageToVideoRequest {
  image_path: string;
  prompt: string;
  duration?: number;
  fps?: number;
  resolution?: string;
}

export interface ImageToImageRequest {
  image_path: string;
  prompt: string;
  strength?: number;
  resolution?: string;
  style?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface InpaintingRequest {
  image_path: string;
  mask_path: string;
  prompt: string;
  resolution?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface BatchImageGenerationRequest {
  prompts: string[];
  resolution?: string;
  style?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
}

export interface BatchImageGenerationResponse {
  images: ImageGenerationResponse[];
  total_count: number;
  successful_count: number;
  failed_count: number;
}

export interface VideoToVideoRequest {
  video_path: string;
  prompt: string;
  duration?: number;
  fps?: number;
  negative_prompt?: string;
}

export interface VideoEditingRequest {
  video_path: string;
  operation: 'trim' | 'crop' | 'reverse' | 'loop' | 'slow' | 'fast';
  params?: Record<string, any>;
}

export interface VideoEnhancementRequest {
  video_path: string;
  upscale_factor?: number;
  denoise?: boolean;
  target_fps?: number;
}

export interface ControlNetRequest {
  prompt: string;
  control_image_path: string;
  controlnet_type: 'canny' | 'depth' | 'pose' | 'seg' | 'normal' | 'inpaint' | 'lineart' | 'anime' | 'scribble' | 'softedge';
  resolution?: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
  controlnet_conditioning_scale?: number;
}

export interface ImageHealthResponse {
  status: string;
  diffusers_available: boolean;
  controlnet_available: boolean;
  gpu_available: boolean;
  gpu_memory_allocated_mb?: number;
  gpu_memory_total_mb?: number;
  cached_models: string[];
  cached_controlnet_models?: string[];
  redis_rate_limiting: boolean;
}

export interface VideoHealthResponse {
  status: string;
  cv2_available: boolean;
  diffusers_video_available: boolean;
  gpu_available: boolean;
  gpu_memory_allocated_mb?: number;
  gpu_memory_total_mb?: number;
  cached_models: string[];
  redis_rate_limiting: boolean;
}

// Style presets
export const STYLE_PRESETS = [
  { value: 'default', label: 'Default' },
  { value: 'realistic', label: 'Realistic' },
  { value: 'anime', label: 'Anime' },
  { value: 'photorealistic', label: 'Photorealistic' },
  { value: 'abstract', label: 'Abstract' },
  { value: 'portrait', label: 'Portrait' },
  { value: 'landscape', label: 'Landscape' },
] as const;

// Resolution presets
export const IMAGE_RESOLUTIONS = [
  { value: '512x512', label: '512x512' },
  { value: '1024x1024', label: '1024x1024' },
  { value: '1024x768', label: '1024x768 (Landscape)' },
  { value: '768x1024', label: '768x1024 (Portrait)' },
] as const;

export const VIDEO_RESOLUTIONS = [
  { value: '1024x576', label: '1024x576 (Landscape)' },
  { value: '768x1024', label: '768x1024 (Portrait)' },
  { value: '576x1024', label: '576x1024 (Portrait)' },
  { value: '1024x1024', label: '1024x1024 (Square)' },
] as const;

// ControlNet types
export const CONTROLNET_TYPES = [
  { value: 'canny', label: 'Canny Edge' },
  { value: 'depth', label: 'Depth Map' },
  { value: 'pose', label: 'Human Pose' },
  { value: 'seg', label: 'Segmentation' },
  { value: 'normal', label: 'Normal Map' },
  { value: 'inpaint', label: 'Inpainting' },
  { value: 'lineart', label: 'Line Art' },
  { value: 'anime', label: 'Anime Lineart' },
  { value: 'scribble', label: 'Scribble' },
  { value: 'softedge', label: 'Soft Edge' },
] as const;

/**
 * Generate an image from a text prompt
 * @param request - Image generation parameters
 * @returns Promise resolving to the generated image response
 */
export async function generateImage(
  request: ImageGenerationRequest,
): Promise<ImageGenerationResponse> {
  const response = await openHands.post<ImageGenerationResponse>(
    "/api/v1/generate-image",
    request,
  );
  return response.data;
}

/**
 * Transform an image using img2img
 * @param request - Image transformation parameters
 * @returns Promise resolving to the transformed image response
 */
export async function transformImage(
  request: ImageToImageRequest,
): Promise<ImageGenerationResponse> {
  const response = await openHands.post<ImageGenerationResponse>(
    "/api/v1/transform-image",
    request,
  );
  return response.data;
}

/**
 * Inpaint an image using a mask
 * @param request - Inpainting parameters
 * @returns Promise resolving to the inpainted image response
 */
export async function inpaintImage(
  request: InpaintingRequest,
): Promise<ImageGenerationResponse> {
  const response = await openHands.post<ImageGenerationResponse>(
    "/api/v1/inpaint",
    request,
  );
  return response.data;
}

/**
 * Generate multiple images in batch
 * @param request - Batch generation parameters
 * @returns Promise resolving to the batch generation response
 */
export async function batchGenerateImages(
  request: BatchImageGenerationRequest,
): Promise<BatchImageGenerationResponse> {
  const response = await openHands.post<BatchImageGenerationResponse>(
    "/api/v1/batch-generate-images",
    request,
  );
  return response.data;
}

/**
 * Generate a video from a text prompt
 * @param request - Video generation parameters
 * @returns Promise resolving to the generated video response
 */
export async function generateVideo(
  request: VideoGenerationRequest,
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    "/api/v1/generate-video",
    request,
  );
  return response.data;
}

/**
 * Generate a video from an image (image-to-video)
 * @param request - Image-to-video generation parameters
 * @returns Promise resolving to the generated video response
 */
export async function generateVideoFromImage(
  request: ImageToVideoRequest,
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    "/api/v1/generate-video-from-image",
    request,
  );
  return response.data;
}

/**
 * Transform a video using a text prompt (video-to-video)
 * @param request - Video transformation parameters
 * @returns Promise resolving to the transformed video response
 */
export async function transformVideo(
  request: VideoToVideoRequest,
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    "/api/v1/transform-video",
    request,
  );
  return response.data;
}

/**
 * Edit a video with various operations
 * @param request - Video editing parameters
 * @returns Promise resolving to the edited video response
 */
export async function editVideo(
  request: VideoEditingRequest,
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    "/api/v1/edit-video",
    request,
  );
  return response.data;
}

/**
 * Enhance a video (upscale, denoise, frame interpolation)
 * @param request - Video enhancement parameters
 * @returns Promise resolving to the enhanced video response
 */
export async function enhanceVideo(
  request: VideoEnhancementRequest,
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    "/api/v1/enhance-video",
    request,
  );
  return response.data;
}

/**
 * Check the health status of image generation service
 */
export async function checkImageGenerationHealth(): Promise<ImageHealthResponse> {
  const response = await openHands.get<ImageHealthResponse>("/api/v1/image-generation/health");
  return response.data;
}

/**
 * Check the health status of video generation service
 */
export async function checkVideoGenerationHealth(): Promise<VideoHealthResponse> {
  const response = await openHands.get<VideoHealthResponse>("/api/v1/video-generation/health");
  return response.data;
}

/**
 * Generate an image using ControlNet for conditional generation
 * @param request - ControlNet generation parameters
 * @returns Promise resolving to the generated image response
 */
export async function generateWithControlNet(
  request: ControlNetRequest,
): Promise<ImageGenerationResponse> {
  const response = await openHands.post<ImageGenerationResponse>(
    "/api/v1/controlnet-generate",
    request,
  );
  return response.data;
}

// ============================================================================
// NEW API FUNCTIONS - Faza 2 Frontend Enhancement
// ============================================================================

/**
 * Upscale an existing image
 */
export interface UpscaleImageRequest {
  image_path: string;
  scale_factor?: number;
  method?: 'real-esrgan' | 'swinir' | 'bicubic';
}

export interface UpscaleImageResponse {
  image_path: string;
  image_id: string;
  original_resolution: string;
  upscaled_resolution: string;
  scale_factor: number;
}

export async function upscaleImage(
  request: UpscaleImageRequest,
): Promise<UpscaleImageResponse> {
  const response = await openHands.post<UpscaleImageResponse>(
    "/api/v1/image-generation/upscale-image",
    request,
  );
  return response.data;
}

/**
 * Apply style transfer to an image
 */
export interface StyleTransferRequest {
  content_image_path: string;
  style_image_path: string;
  style_strength?: number;
}

export interface StyleTransferResponse {
  image_path: string;
  image_id: string;
  content_resolution: string;
  style_resolution: string;
}

export async function applyStyleTransfer(
  request: StyleTransferRequest,
): Promise<StyleTransferResponse> {
  const response = await openHands.post<StyleTransferResponse>(
    "/api/v1/image-generation/style-transfer",
    request,
  );
  return response.data;
}

/**
 * Generate caption for an image
 */
export interface CaptionImageRequest {
  image_path: string;
}

export interface CaptionImageResponse {
  image_id: string;
  caption: string;
  confidence: number;
}

export async function captionImage(
  request: CaptionImageRequest,
): Promise<CaptionImageResponse> {
  const response = await openHands.post<CaptionImageResponse>(
    "/api/v1/image-generation/caption-image",
    request,
  );
  return response.data;
}

/**
 * Detect objects in an image
 */
export interface BoundingBox {
  label: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ObjectDetectionRequest {
  image_path: string;
}

export interface ObjectDetectionResponse {
  image_id: string;
  objects: BoundingBox[];
  resolution: string;
}

export async function detectObjects(
  request: ObjectDetectionRequest,
): Promise<ObjectDetectionResponse> {
  const response = await openHands.post<ObjectDetectionResponse>(
    "/api/v1/image-generation/detect-objects",
    request,
  );
  return response.data;
}

/**
 * Remove background from an image
 */
export interface RemoveBackgroundRequest {
  image_path: string;
}

export interface RemoveBackgroundResponse {
  image_path: string;
  image_id: string;
  resolution: string;
}

export async function removeBackground(
  request: RemoveBackgroundRequest,
): Promise<RemoveBackgroundResponse> {
  const response = await openHands.post<RemoveBackgroundResponse>(
    "/api/v1/image-generation/remove-background",
    request,
  );
  return response.data;
}

/**
 * Add audio to a video
 */
export interface AddAudioToVideoRequest {
  video_path: string;
  audio_path: string;
  volume?: number;
}

export interface AddAudioToVideoResponse {
  video_path: string;
  video_id: string;
  duration: number;
  fps: number;
  resolution: string;
}

export async function addAudioToVideo(
  request: AddAudioToVideoRequest,
): Promise<AddAudioToVideoResponse> {
  const response = await openHands.post<AddAudioToVideoResponse>(
    "/api/v1/video-generation/add-audio-to-video",
    request,
  );
  return response.data;
}

/**
 * Merge multiple videos
 */
export interface MergeVideosRequest {
  video_paths: string[];
  transition_type?: 'fade' | 'dissolve' | 'cut';
}

export interface MergeVideosResponse {
  video_path: string;
  video_id: string;
  duration: number;
  fps: number;
  resolution: string;
}

export async function mergeVideos(
  request: MergeVideosRequest,
): Promise<MergeVideosResponse> {
  const response = await openHands.post<MergeVideosResponse>(
    "/api/v1/video-generation/merge-videos",
    request,
  );
  return response.data;
}

/**
 * Extract frames from a video
 */
export interface ExtractFramesRequest {
  video_path: string;
  interval?: number;
  start_frame?: number;
}

export interface ExtractFramesResponse {
  video_id: string;
  frames_count: number;
  output_directory: string;
}

export async function extractFrames(
  request: ExtractFramesRequest,
): Promise<ExtractFramesResponse> {
  const response = await openHands.post<ExtractFramesResponse>(
    "/api/v1/video-generation/extract-frames",
    request,
  );
  return response.data;
}

/**
 * Generate thumbnails from a video
 */
export interface GenerateThumbnailRequest {
  video_path: string;
  num_thumbnails?: number;
  start_frame?: number;
}

export interface GenerateThumbnailResponse {
  video_id: string;
  thumbnails_count: number;
  output_directory: string;
}

export async function generateThumbnails(
  request: GenerateThumbnailRequest,
): Promise<GenerateThumbnailResponse> {
  const response = await openHands.post<GenerateThumbnailResponse>(
    "/api/v1/video-generation/generate-thumbnail",
    request,
  );
  return response.data;
}

/**
 * Extract metadata from a video
 */
export interface ExtractVideoMetadataRequest {
  video_path: string;
}

export interface VideoMetadata {
  duration: number;
  fps: number;
  resolution: string;
  width: number;
  height: number;
  codec?: string;
  bitrate?: number;
}

export async function extractVideoMetadata(
  request: ExtractVideoMetadataRequest,
): Promise<VideoMetadata> {
  const response = await openHands.post<VideoMetadata>(
    "/api/v1/video-generation/extract-video-metadata",
    request,
  );
  return response.data;
}

/**
 * Add job to queue
 */
export interface QueueJobRequest {
  job_type: 'image' | 'video';
  prompt: string;
  priority?: number;
}

export interface QueueJobResponse {
  job_id: string;
  status: string;
  position_in_queue: number;
  estimated_wait_time: number;
}

export async function addToQueue(
  request: QueueJobRequest,
): Promise<QueueJobResponse> {
  const response = await openHands.post<QueueJobResponse>(
    "/api/v1/image-generation/queue/add",
    request,
  );
  return response.data;
}

/**
 * Get queue status
 */
export interface QueueStatusResponse {
  job_id: string;
  status: string;
  progress: number;
  message?: string;
  result_path?: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
}

export async function getQueueStatus(jobId: string): Promise<QueueStatusResponse> {
  const response = await openHands.get<QueueStatusResponse>(
    `/api/v1/image-generation/queue/status/${jobId}`,
  );
  return response.data;
}

/**
 * List storage files
 */
export interface StorageItem {
  file_id: string;
  filename: string;
  path: string;
  size_bytes: number;
  created_at: number;
  content_type: string;
}

export async function listStorage(): Promise<StorageItem[]> {
  const response = await openHands.get<StorageItem[]>(
    "/api/v1/image-generation/storage/list",
  );
  return response.data;
}

/**
 * Delete storage file
 */
export interface StorageDeleteResponse {
  file_id: string;
  filename: string;
  success: boolean;
  message: string;
}

export async function deleteStorageFile(fileId: string): Promise<StorageDeleteResponse> {
  const response = await openHands.delete<StorageDeleteResponse>(
    `/api/v1/image-generation/storage/delete/${fileId}`,
  );
  return response.data;
}

/**
 * Get cache statistics
 */
export interface CacheStatsResponse {
  pipeline_cache_size: number;
  controlnet_cache_size: number;
  video_pipeline_cache_size: number;
  rate_limit_storage_size: number;
  redis_available: boolean;
}

export async function getCacheStats(): Promise<CacheStatsResponse> {
  const response = await openHands.get<CacheStatsResponse>(
    "/api/v1/image-generation/cache/stats",
  );
  return response.data;
}

/**
 * Clear cache
 */
export interface CacheClearResponse {
  message: string;
}

export async function clearCache(): Promise<CacheClearResponse> {
  const response = await openHands.post<CacheClearResponse>(
    "/api/v1/image-generation/cache/clear",
  );
  return response.data;
}

/**
 * Get health status
 */
export interface HealthStatusResponse {
  status: string;
  redis_available: boolean;
  diffusers_available: boolean;
  controlnet_available: boolean;
  cv2_available: boolean;
  gpu_enabled: boolean;
  output_dir: string;
  rate_limit: number;
  image_rate_limit: number;
  video_rate_limit: number;
}

export async function getHealthStatus(): Promise<HealthStatusResponse> {
  const response = await openHands.get<HealthStatusResponse>(
    "/api/v1/image-generation/health",
  );
  return response.data;
}

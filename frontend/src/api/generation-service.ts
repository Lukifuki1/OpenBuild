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
  { value: 'sdxl', label: 'SDXL' },
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
  { value: '256x256', label: '256x256' },
  { value: '512x512', label: '512x512' },
  { value: '1024x576', label: '1024x576 (SD)' },
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

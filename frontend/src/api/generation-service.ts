/**
 * Generation Service API Client
 * 
 * Provides methods for image and video generation via the OpenHands backend API.
 */

import { openHands } from './open-hands-axios';

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
}

/**
 * Generate an image from a text prompt
 * @param request - Image generation parameters
 * @returns Promise resolving to the generated image response
 */
export async function generateImage(
  request: ImageGenerationRequest
): Promise<ImageGenerationResponse> {
  const response = await openHands.post<ImageGenerationResponse>(
    '/api/v1/generate-image',
    request
  );
  return response.data;
}

/**
 * Generate a video from a text prompt
 * @param request - Video generation parameters
 * @returns Promise resolving to the generated video response
 */
export async function generateVideo(
  request: VideoGenerationRequest
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    '/api/v1/generate-video',
    request
  );
  return response.data;
}

/**
 * Generate a video from an image (image-to-video)
 * @param request - Image-to-video generation parameters
 * @returns Promise resolving to the generated video response
 */
export async function generateVideoFromImage(
  request: ImageToVideoRequest
): Promise<VideoGenerationResponse> {
  const response = await openHands.post<VideoGenerationResponse>(
    '/api/v1/generate-video-from-image',
    request
  );
  return response.data;
}

/**
 * Check the health status of image generation service
 */
export async function checkImageGenerationHealth(): Promise<{
  status: string;
  diffusers_available: boolean;
  gpu_available: boolean;
  cached_models: string[];
}> {
  const response = await openHands.get('/api/v1/image-generation/health');
  return response.data;
}

/**
 * Check the health status of video generation service
 */
export async function checkVideoGenerationHealth(): Promise<{
  status: string;
  cv2_available: boolean;
  diffusers_video_available: boolean;
  gpu_available: boolean;
  cached_models: string[];
}> {
  const response = await openHands.get('/api/v1/video-generation/health');
  return response.data;
}

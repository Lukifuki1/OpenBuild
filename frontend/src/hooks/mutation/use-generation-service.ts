/**
 * Generation Service Mutation Hooks
 *
 * React Mutation hooks for image and video generation services.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  generateImage,
  transformImage,
  inpaintImage,
  batchGenerateImages,
  generateVideo,
  generateVideoFromImage,
  transformVideo,
  editVideo,
  enhanceVideo,
  generateWithControlNet,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageToImageRequest,
  InpaintingRequest,
  BatchImageGenerationRequest,
  BatchImageGenerationResponse,
  VideoGenerationRequest,
  VideoGenerationResponse,
  ImageToVideoRequest,
  VideoToVideoRequest,
  VideoEditingRequest,
  VideoEnhancementRequest,
  ControlNetRequest,
} from "../api/generation-service";

/**
 * Hook to generate an image from a text prompt
 */
export function useGenerateImage() {
  const queryClient = useQueryClient();
  
  return useMutation<ImageGenerationResponse, Error, ImageGenerationRequest>({
    mutationFn: generateImage,
    onSuccess: () => {
      // Invalidate generation history if you have one
      queryClient.invalidateQueries({ queryKey: ["image-history"] });
    },
  });
}

/**
 * Hook to transform an image (img2img)
 */
export function useTransformImage() {
  const queryClient = useQueryClient();
  
  return useMutation<ImageGenerationResponse, Error, ImageToImageRequest>({
    mutationFn: transformImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-history"] });
    },
  });
}

/**
 * Hook to inpaint an image using a mask
 */
export function useInpaintImage() {
  const queryClient = useQueryClient();
  
  return useMutation<ImageGenerationResponse, Error, InpaintingRequest>({
    mutationFn: inpaintImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-history"] });
    },
  });
}

/**
 * Hook to generate multiple images in batch
 */
export function useBatchGenerateImages() {
  const queryClient = useQueryClient();
  
  return useMutation<BatchImageGenerationResponse, Error, BatchImageGenerationRequest>({
    mutationFn: batchGenerateImages,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-history"] });
    },
  });
}

/**
 * Hook to generate a video from a text prompt
 */
export function useGenerateVideo() {
  const queryClient = useQueryClient();
  
  return useMutation<VideoGenerationResponse, Error, VideoGenerationRequest>({
    mutationFn: generateVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-history"] });
    },
  });
}

/**
 * Hook to generate a video from an image (image-to-video)
 */
export function useGenerateVideoFromImage() {
  const queryClient = useQueryClient();
  
  return useMutation<VideoGenerationResponse, Error, ImageToVideoRequest>({
    mutationFn: generateVideoFromImage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-history"] });
    },
  });
}

/**
 * Hook to transform a video (video-to-video)
 */
export function useTransformVideo() {
  const queryClient = useQueryClient();
  
  return useMutation<VideoGenerationResponse, Error, VideoToVideoRequest>({
    mutationFn: transformVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-history"] });
    },
  });
}

/**
 * Hook to edit a video
 */
export function useEditVideo() {
  const queryClient = useQueryClient();
  
  return useMutation<VideoGenerationResponse, Error, VideoEditingRequest>({
    mutationFn: editVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-history"] });
    },
  });
}

/**
 * Hook to enhance a video
 */
export function useEnhanceVideo() {
  const queryClient = useQueryClient();
  
  return useMutation<VideoGenerationResponse, Error, VideoEnhancementRequest>({
    mutationFn: enhanceVideo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["video-history"] });
    },
  });
}

/**
 * Hook to generate an image using ControlNet
 */
export function useGenerateWithControlNet() {
  const queryClient = useQueryClient();
  
  return useMutation<ImageGenerationResponse, Error, ControlNetRequest>({
    mutationFn: generateWithControlNet,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["image-history"] });
    },
  });
}

/**
 * Generation Service Query Hooks
 *
 * React Query hooks for image and video generation services.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  checkImageGenerationHealth,
  checkVideoGenerationHealth,
  ImageHealthResponse,
  VideoHealthResponse,
} from "../api/generation-service";

const IMAGE_HEALTH_KEY = "image-generation-health";
const VIDEO_HEALTH_KEY = "video-generation-health";

/**
 * Hook to check image generation service health
 */
export function useImageGenerationHealth() {
  return useQuery<ImageHealthResponse>({
    queryKey: [IMAGE_HEALTH_KEY],
    queryFn: checkImageGenerationHealth,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Hook to check video generation service health
 */
export function useVideoGenerationHealth() {
  return useQuery<VideoHealthResponse>({
    queryKey: [VIDEO_HEALTH_KEY],
    queryFn: checkVideoGenerationHealth,
    staleTime: 30000, // 30 seconds
    refetchInterval: 60000, // Refresh every minute
  });
}

/**
 * Hook to refresh image generation health
 */
export function useRefreshImageHealth() {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.invalidateQueries({ queryKey: [IMAGE_HEALTH_KEY] });
  };
}

/**
 * Hook to refresh video generation health
 */
export function useRefreshVideoHealth() {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.invalidateQueries({ queryKey: [VIDEO_HEALTH_KEY] });
  };
}

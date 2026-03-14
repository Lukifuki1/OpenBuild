"""Image Generation Service for OpenHands.

This module provides image generation capabilities using state-of-the-art
diffusion models (FLUX, SDXL) via the diffusers library.
"""

import os
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

# Try to import diffusers - may not be available in all environments
try:
    from diffusers import DiffusionPipeline
    import torch
    DIFFUSERS_AVAILABLE = True
except ImportError:
    DIFFUSERS_AVAILABLE = False


router = APIRouter(prefix='/api/v1', tags=['image-generation'])

# Output directory for generated images
OUTPUT_DIR = os.environ.get('WORKSPACE_OUTPUT_DIR', '/workspace/output')

# Configuration from environment
IMAGE_MODEL = os.environ.get('IMAGE_MODEL', 'black-forest-labs/FLUX.1-schnell')
GPU_ENABLED = os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
MAX_IMAGE_SIZE = int(os.environ.get('MAX_IMAGE_SIZE', '1024'))


class ImageGenerationRequest(BaseModel):
    """Request model for image generation."""
    prompt: str
    resolution: str = "1024x1024"
    style: str = "default"
    negative_prompt: Optional[str] = None
    num_inference_steps: int = 28
    guidance_scale: float = 3.5


class ImageGenerationResponse(BaseModel):
    """Response model for image generation."""
    image_path: str
    image_id: str
    resolution: str
    model: str


# Model cache
_pipeline_cache: dict = {}


def _get_resolution_tuple(resolution: str) -> tuple[int, int]:
    """Parse resolution string to tuple."""
    try:
        width, height = resolution.split('x')
        return int(width), int(height)
    except (ValueError, AttributeError):
        return 1024, 1024


def _load_pipeline(model_name: str, device: str = 'cuda'):
    """Load the diffusion pipeline with caching."""
    if model_name in _pipeline_cache:
        return _pipeline_cache[model_name]

    if not DIFFUSERS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Image generation is not available. Please install diffusers: pip install diffusers"
        )

    try:
        pipeline = DiffusionPipeline.from_pretrained(
            model_name,
            torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
        )

        # Try to move to GPU if available
        if device == 'cuda' and torch.cuda.is_available():
            pipeline = pipeline.to('cuda')
        else:
            pipeline = pipeline.to('cpu')

        _pipeline_cache[model_name] = pipeline
        return pipeline
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to load image generation model: {str(e)}"
        )


@router.post('/generate-image', response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """Generate an image from a text prompt.

    Args:
        request: ImageGenerationRequest containing prompt and parameters

    Returns:
        ImageGenerationResponse with the generated image path
    """
    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Parse resolution
    width, height = _get_resolution_tuple(request.resolution)

    # Select model based on style/quality
    if request.style == 'sdxl':
        model_name = 'stabilityai/stable-diffusion-xl-base-1.0'
    elif request.style == 'realistic':
        model_name = 'stabilityai/stable-diffusion-2-1'
    else:
        # Default to FLUX (faster, high quality)
        model_name = 'black-forest-labs/FLUX.1-schnell'

    # Determine device
    device = 'cuda' if (DIFFUSERS_AVAILABLE and os.environ.get('GPU_ENABLED', 'true').lower() == 'true') else 'cpu'

    try:
        # Load pipeline
        pipeline = _load_pipeline(model_name, device)

        # Generate image
        result = pipeline(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
            height=height,
            width=width,
        )

        # Save image
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        result.images[0].save(image_path)

        return ImageGenerationResponse(
            image_path=image_path,
            image_id=image_id,
            resolution=request.resolution,
            model=model_name
        )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Image generation failed: {str(e)}"
        )


@router.get('/image-generation/health')
async def health_check():
    """Health check endpoint for image generation service."""
    return {
        "status": "healthy",
        "diffusers_available": DIFFUSERS_AVAILABLE,
        "gpu_available": torch.cuda.is_available() if DIFFUSERS_AVAILABLE else False,
        "cached_models": list(_pipeline_cache.keys())
    }

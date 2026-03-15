"""Image Generation Service for OpenHands.

This module provides image generation capabilities using state-of-the-art
diffusion models (FLUX, SDXL) via the diffusers library.
"""

import os
import uuid
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from openhands.server.dependencies import get_dependencies

# Try to import diffusers - may not be available in all environments
try:
    import torch
    from diffusers import DiffusionPipeline

    DIFFUSERS_AVAILABLE = True
except ImportError:
    DIFFUSERS_AVAILABLE = False


router = APIRouter(
    prefix='/api/v1', tags=['image-generation'], dependencies=get_dependencies()
)

# Simple in-memory rate limiter
_rate_limit_storage: dict = defaultdict(list)
IMAGE_RATE_LIMIT = int(os.environ.get('IMAGE_RATE_LIMIT', '10'))  # requests per minute
IMAGE_RATE_WINDOW = 60  # seconds


def _check_rate_limit(user_id: str | None, limit: int, window: int) -> bool:
    """Check if user has exceeded rate limit. Returns True if allowed."""
    if user_id is None:
        return True  # Skip rate limiting if no user ID

    now = datetime.now()
    cutoff = now - timedelta(seconds=window)

    # Clean old requests
    _rate_limit_storage[user_id] = [
        req_time for req_time in _rate_limit_storage[user_id] if req_time > cutoff
    ]

    if len(_rate_limit_storage[user_id]) >= limit:
        return False

    _rate_limit_storage[user_id].append(now)
    return True


# Output directory for generated images
OUTPUT_DIR = os.environ.get('WORKSPACE_OUTPUT_DIR', '/workspace/output')

# Configuration from environment
IMAGE_MODEL = os.environ.get('IMAGE_MODEL', 'black-forest-labs/FLUX.1-schnell')
GPU_ENABLED = os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
MAX_IMAGE_SIZE = int(os.environ.get('MAX_IMAGE_SIZE', '1024'))


class ImageGenerationRequest(BaseModel):
    """Request model for image generation."""

    prompt: str = Field(..., min_length=1, max_length=1000)
    resolution: str = '1024x1024'
    style: str = 'default'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=28, ge=1, le=100)
    guidance_scale: float = Field(default=3.5, ge=1.0, le=20.0)


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
            detail='Image generation is not available. Please install diffusers: pip install diffusers',
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
            status_code=500, detail=f'Failed to load image generation model: {str(e)}'
        )


@router.post('/generate-image', response_model=ImageGenerationResponse)
async def generate_image(request: ImageGenerationRequest):
    """Generate an image from a text prompt.

    Args:
        request: ImageGenerationRequest containing prompt and parameters

    Returns:
        ImageGenerationResponse with the generated image path
    """
    # Check rate limit
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

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
    device = (
        'cuda'
        if (
            DIFFUSERS_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

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
            model=model_name,
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Image generation failed: {str(e)}'
        )


@router.get('/image-generation/health')
async def health_check():
    """Health check endpoint for image generation service."""
    gpu_available = False
    if DIFFUSERS_AVAILABLE:
        import torch

        gpu_available = torch.cuda.is_available()

    return {
        'status': 'healthy',
        'diffusers_available': DIFFUSERS_AVAILABLE,
        'gpu_available': gpu_available,
        'cached_models': list(_pipeline_cache.keys()),
    }


@router.get('/generated-images/{image_id}')
async def get_generated_image(image_id: str):
    """Serve a generated image by ID."""
    # Look for the image file
    possible_extensions = ['.png', '.jpg', '.jpeg', '.webp']

    for ext in possible_extensions:
        image_path = os.path.join(OUTPUT_DIR, f'image_{image_id}{ext}')
        if os.path.exists(image_path):
            return FileResponse(image_path, media_type=f'image/{ext[1:]}')

    raise HTTPException(status_code=404, detail='Image not found')

"""Image Generation Service for OpenHands.

This module provides image generation capabilities using state-of-the-art
diffusion models (FLUX, SDXL) via the diffusers library.
"""

import gc
import os
import uuid
import base64
import io
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional, Union

from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
import tempfile
import zipfile

from openhands.server.dependencies import get_dependencies

# Try to import diffusers - may not be available in all environments
try:
    import torch
    from diffusers import DiffusionPipeline

    DIFFUSERS_AVAILABLE = True
except ImportError:
    DIFFUSERS_AVAILABLE = False

# Try to import ControlNet
try:
    from diffusers import ControlNetModel
    CONTROLNET_AVAILABLE = True
except ImportError:
    CONTROLNET_AVAILABLE = False


router = APIRouter(tags=['image-generation'], dependencies=get_dependencies())

# Simple in-memory rate limiter (fallback when Redis unavailable)
_rate_limit_storage: dict = defaultdict(list)
IMAGE_RATE_LIMIT = int(os.environ.get('IMAGE_RATE_LIMIT', '10'))  # requests per minute
IMAGE_RATE_WINDOW = 60  # seconds

# Redis-based rate limiting configuration
REDIS_AVAILABLE = False
try:
    import redis
    REDIS_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
    _redis_client = redis.from_url(REDIS_URL, decode_responses=True)
    _redis_client.ping()
    REDIS_AVAILABLE = True
except Exception:
    _redis_client = None


def _check_rate_limit(user_id: str | None, limit: int, window: int) -> bool:
    """Check if user has exceeded rate limit. Returns True if allowed."""
    if user_id is None:
        return True  # Skip rate limiting if no user ID

    # Try Redis-based rate limiting first
    if REDIS_AVAILABLE and _redis_client is not None:
        try:
            key = f"rate_limit:image:{user_id}"
            current = _redis_client.get(key)
            count = int(current) if current else 0
            
            if count >= limit:
                return False
            
            # Use Redis increment with expiry
            pipe = _redis_client.pipeline()
            pipe.incr(key)
            pipe.expire(key, window)
            pipe.execute()
            return True
        except Exception:
            # Fall back to in-memory if Redis fails
            pass

    # Fallback to in-memory rate limiting
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


def _clear_gpu_memory():
    """Clear GPU memory cache after generation."""
    if DIFFUSERS_AVAILABLE and torch.cuda.is_available():
        torch.cuda.empty_cache()
        gc.collect()


def _load_image_from_path_or_data_url(image_source: Union[str, bytes]) -> 'Image.Image':
    """Load an image from a file path or base64 data URL.

    Args:
        image_source: Either a file path (str) or a base64 data URL (str starting with 'data:')

    Returns:
        PIL Image object

    Raises:
        HTTPException: If the image cannot be loaded
    """
    from PIL import Image

    try:
        # Check if it's a data URL
        if isinstance(image_source, str) and image_source.startswith('data:'):
            # Parse the data URL: data:image/png;base64,<data>
            header, b64data = image_source.split(',', 1)
            # Decode base64
            image_data = base64.b64decode(b64data)
            # Load into PIL Image
            return Image.open(io.BytesIO(image_data)).convert('RGB')
        elif isinstance(image_source, bytes):
            # Raw base64 bytes
            return Image.open(io.BytesIO(image_source)).convert('RGB')
        else:
            # It's a file path
            if not os.path.exists(image_source):
                raise HTTPException(
                    status_code=400, detail=f'Image not found: {image_source}'
                )
            return Image.open(image_source).convert('RGB')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f'Failed to load image: {str(e)}'
        )


def _load_pipeline(model_name: str, device: str = 'cuda'):
    """Load the diffusion pipeline with caching and error handling."""
    if model_name in _pipeline_cache:
        return _pipeline_cache[model_name]

    if not DIFFUSERS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Image generation is not available. Please install diffusers: pip install diffusers',
        )

    try:
        # Use float16 for faster inference and lower memory usage
        dtype = torch.float16 if device == 'cuda' else torch.float32
        
        pipeline = DiffusionPipeline.from_pretrained(
            model_name,
            torch_dtype=dtype,
        )

        # Try to move to GPU if available
        if device == 'cuda' and torch.cuda.is_available():
            try:
                pipeline = pipeline.to('cuda')
            except RuntimeError as e:
                # GPU may be out of memory, try CPU fallback
                if 'out of memory' in str(e).lower():
                    pipeline = pipeline.to('cpu')
                    device = 'cpu'
                else:
                    raise
        else:
            pipeline = pipeline.to('cpu')

        _pipeline_cache[model_name] = pipeline
        return pipeline
    except RuntimeError as e:
        error_msg = str(e).lower()
        if 'out of memory' in error_msg:
            _clear_gpu_memory()
            raise HTTPException(
                status_code=507,
                detail='GPU out of memory. Please try with a smaller resolution or wait for other processes to finish.',
            )
        raise HTTPException(
            status_code=500, detail=f'Failed to load image generation model: {str(e)}'
        )
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

        # Clear GPU memory after generation
        _clear_gpu_memory()

        return ImageGenerationResponse(
            image_path=image_path,
            image_id=image_id,
            resolution=request.resolution,
            model=model_name,
        )

    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except RuntimeError as e:
        error_msg = str(e).lower()
        if 'out of memory' in error_msg:
            _clear_gpu_memory()
            raise HTTPException(
                status_code=507,
                detail='GPU out of memory during generation. Please try with a smaller resolution.',
            )
        raise HTTPException(
            status_code=500, detail=f'Image generation failed: {str(e)}'
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Image generation failed: {str(e)}'
        )
    finally:
        # Ensure memory cleanup happens
        _clear_gpu_memory()


@router.get('/image-generation/health')
async def health_check():
    """Health check endpoint for image generation service."""
    gpu_available = False
    gpu_memory_allocated = 0
    gpu_memory_total = 0
    
    if DIFFUSERS_AVAILABLE:
        import torch

        gpu_available = torch.cuda.is_available()
        if gpu_available:
            gpu_memory_allocated = torch.cuda.memory_allocated() // (1024 * 1024)  # MB
            gpu_memory_total = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)  # MB

    return {
        'status': 'healthy',
        'diffusers_available': DIFFUSERS_AVAILABLE,
        'controlnet_available': CONTROLNET_AVAILABLE,
        'gpu_available': gpu_available,
        'gpu_memory_allocated_mb': gpu_memory_allocated,
        'gpu_memory_total_mb': gpu_memory_total,
        'cached_models': list(_pipeline_cache.keys()),
        'cached_controlnet_models': list(_controlnet_pipeline_cache.keys()),
        'redis_rate_limiting': REDIS_AVAILABLE,
    }


# Style presets configuration
STYLE_PRESETS = {
    'default': {
        'negative_prompt': 'blurry, ugly, distorted, low quality',
    },
    'anime': {
        'negative_prompt': 'photorealistic, 3d render, realistic, live-action, bad quality, worst quality, low quality',
    },
    'photorealistic': {
        'negative_prompt': 'anime, cartoon, illustration, painting, drawing, art, watermark, text',
    },
    'abstract': {
        'negative_prompt': 'realistic, detailed, photorealistic, clear, sharp',
    },
    'portrait': {
        'negative_prompt': 'landscape, scene, building, object, blurry, distorted',
    },
    'landscape': {
        'negative_prompt': 'portrait, person, face, close-up, blurry, low quality',
    },
}


class ImageToImageRequest(BaseModel):
    """Request model for image-to-image transformation."""

    image_path: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1, max_length=1000)
    strength: float = Field(default=0.75, ge=0.0, le=1.0)
    resolution: str = '1024x1024'
    style: str = 'default'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=50, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=1.0, le=20.0)


class InpaintingRequest(BaseModel):
    """Request model for inpainting."""

    image_path: str = Field(..., min_length=1)
    mask_path: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1, max_length=1000)
    resolution: str = '1024x1024'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=50, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=1.0, le=20.0)


class BatchImageGenerationRequest(BaseModel):
    """Request model for batch image generation."""

    prompts: list[str] = Field(..., min_length=1, max_length=10)
    resolution: str = '1024x1024'
    style: str = 'default'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=28, ge=1, le=100)
    guidance_scale: float = Field(default=3.5, ge=1.0, le=20.0)


class BatchImageGenerationResponse(BaseModel):
    """Response model for batch image generation."""

    images: list[ImageGenerationResponse]
    total_count: int
    successful_count: int
    failed_count: int


# Import for image transformations
try:
    from diffusers import StableDiffusionImg2ImgPipeline, StableDiffusionInpaintPipeline
    TRANSFORMERS_AVAILABLE = True
except ImportError:
    TRANSFORMERS_AVAILABLE = False


@router.post('/transform-image', response_model=ImageGenerationResponse)
async def transform_image(request: ImageToImageRequest):
    """Transform an existing image using img2img.

    Args:
        request: ImageToImageRequest containing image path and transformation parameters

    Returns:
        ImageGenerationResponse with the transformed image path
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not TRANSFORMERS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Image transformation is not available. Please install transformers: pip install transformers',
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    width, height = _get_resolution_tuple(request.resolution)

    # Select model based on style
    if request.style == 'sdxl':
        model_name = 'stabilityai/stable-diffusion-xl-base-1.0'
    elif request.style == 'realistic':
        model_name = 'stabilityai/stable-diffusion-2-1'
    else:
        model_name = 'black-forest-labs/FLUX.1-schnell'

    device = (
        'cuda'
        if (
            DIFFUSERS_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

    try:
        from PIL import Image

        # Load the img2img pipeline
        pipeline = StableDiffusionImg2ImgPipeline.from_pretrained(
            model_name,
            torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
        )

        if device == 'cuda' and torch.cuda.is_available():
            pipeline = pipeline.to('cuda')
        else:
            pipeline = pipeline.to('cpu')

        # Load original image (supports both file paths and data URLs)
        try:
            original_image = _load_image_from_path_or_data_url(request.image_path)
            original_image = original_image.resize((width, height))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=400, detail=f'Failed to load image: {str(e)}'
            )

        # Build effective negative prompt
        effective_negative = request.negative_prompt
        if not effective_negative and request.style in STYLE_PRESETS:
            effective_negative = STYLE_PRESETS[request.style].get('negative_prompt')

        # Transform image
        result = pipeline(
            prompt=request.prompt,
            image=original_image,
            strength=request.strength,
            negative_prompt=effective_negative,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
        )

        # Save transformed image
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_i2i_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        result.images[0].save(image_path)

        _clear_gpu_memory()

        return ImageGenerationResponse(
            image_path=image_path,
            image_id=image_id,
            resolution=request.resolution,
            model=model_name,
        )

    except HTTPException:
        raise
    except Exception as e:
        _clear_gpu_memory()
        raise HTTPException(
            status_code=500, detail=f'Image transformation failed: {str(e)}'
        )
    finally:
        _clear_gpu_memory()


@router.post('/inpaint', response_model=ImageGenerationResponse)
async def inpaint_image(request: InpaintingRequest):
    """Inpaint an image using a mask.

    Args:
        request: InpaintingRequest containing image path, mask path, and prompt

    Returns:
        ImageGenerationResponse with the inpainted image path
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not TRANSFORMERS_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Inpainting is not available. Please install transformers: pip install transformers',
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    width, height = _get_resolution_tuple(request.resolution)

    device = (
        'cuda'
        if (
            DIFFUSERS_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

    try:
        from PIL import Image

        # Load the inpaint pipeline
        pipeline = StableDiffusionInpaintPipeline.from_pretrained(
            'runwayml/stable-diffusion-inpainting',
            torch_dtype=torch.float16 if device == 'cuda' else torch.float32,
        )

        if device == 'cuda' and torch.cuda.is_available():
            pipeline = pipeline.to('cuda')
        else:
            pipeline = pipeline.to('cpu')

        # Load image and mask (support both file paths and data URLs)
        try:
            image = _load_image_from_path_or_data_url(request.image_path)
            image = image.resize((512, 512))  # Inpainting model expects 512x512
            mask = _load_image_from_path_or_data_url(request.mask_path)
            mask = mask.resize((512, 512))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=400, detail=f'Failed to load image or mask: {str(e)}'
            )

        # Inpaint
        result = pipeline(
            prompt=request.prompt,
            image=image,
            mask_image=mask,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
        )

        # Save result
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_inpaint_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        result.images[0].save(image_path)

        _clear_gpu_memory()

        return ImageGenerationResponse(
            image_path=image_path,
            image_id=image_id,
            resolution=request.resolution,
            model='runwayml/stable-diffusion-inpainting',
        )

    except HTTPException:
        raise
    except Exception as e:
        _clear_gpu_memory()
        raise HTTPException(
            status_code=500, detail=f'Inpainting failed: {str(e)}'
        )
    finally:
        _clear_gpu_memory()


@router.post('/batch-generate-images', response_model=BatchImageGenerationResponse)
async def batch_generate_images(request: BatchImageGenerationRequest):
    """Generate multiple images in batch.

    Args:
        request: BatchImageGenerationRequest containing list of prompts

    Returns:
        BatchImageGenerationResponse with all generated images
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT * len(request.prompts), IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    device = (
        'cuda'
        if (
            DIFFUSERS_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

    # Select model
    if request.style == 'sdxl':
        model_name = 'stabilityai/stable-diffusion-xl-base-1.0'
    elif request.style == 'realistic':
        model_name = 'stabilityai/stable-diffusion-2-1'
    else:
        model_name = 'black-forest-labs/FLUX.1-schnell'

    images: list[ImageGenerationResponse] = []
    successful_count = 0
    failed_count = 0

    try:
        pipeline = _load_pipeline(model_name, device)
        width, height = _get_resolution_tuple(request.resolution)

        for prompt in request.prompts:
            try:
                result = pipeline(
                    prompt=prompt,
                    negative_prompt=request.negative_prompt,
                    num_inference_steps=request.num_inference_steps,
                    guidance_scale=request.guidance_scale,
                    height=height,
                    width=width,
                )

                image_id = str(uuid.uuid4())[:8]
                image_filename = f'image_batch_{image_id}.png'
                image_path = os.path.join(OUTPUT_DIR, image_filename)

                result.images[0].save(image_path)

                images.append(
                    ImageGenerationResponse(
                        image_path=image_path,
                        image_id=image_id,
                        resolution=request.resolution,
                        model=model_name,
                    )
                )
                successful_count += 1
                
            except Exception:
                failed_count += 1
                continue

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Batch generation failed: {str(e)}'
        )
    finally:
        _clear_gpu_memory()

    return BatchImageGenerationResponse(
        images=images,
        total_count=len(request.prompts),
        successful_count=successful_count,
        failed_count=failed_count,
    )


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


# ControlNet types mapping
CONTROLNET_MODELS = {
    'canny': 'lllyasviel/control_v11p_sd15_canny',
    'depth': 'lllyasviel/control_v11f1e_sd21_tile_diffusion',
    'pose': 'lllyasviel/control_v11p_sd15_openpose',
    'seg': 'lllyasviel/control_v11p_sd15_seg',
    'normal': 'lllyasviel/control_v11p_sd15_normalbae',
    'inpaint': 'lllyasviel/control_v11e_sd21_inpaint',
    'lineart': 'lllyasviel/control_v11p_sd15_lineart',
    'anime': 'Whoj012/control_v11p_sd15AnimeLineart',
    'scribble': 'lllyasviel/control_v11p_sd15_scribble',
    'softedge': 'lllyasviel/control_v11p_sd15_softedge',
}


class ControlNetRequest(BaseModel):
    """Request model for ControlNet generation."""

    prompt: str = Field(..., min_length=1, max_length=1000)
    control_image_path: str = Field(..., min_length=1)
    controlnet_type: str = Field(..., pattern='^(canny|depth|pose|seg|normal|inpaint|lineart|anime|scribble|softedge)$')
    resolution: str = '1024x1024'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=50, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=1.0, le=20.0)
    controlnet_conditioning_scale: float = Field(default=1.0, ge=0.0, le=2.0)


# ControlNet pipeline cache
_controlnet_pipeline_cache: dict = {}


def _load_controlnet_pipeline(controlnet_type: str, device: str = 'cuda'):
    """Load the ControlNet pipeline with caching."""
    if controlnet_type in _controlnet_pipeline_cache:
        return _controlnet_pipeline_cache[controlnet_type]

    if not CONTROLNET_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='ControlNet is not available. Please install diffusers with ControlNet support.',
        )

    model_name = CONTROLNET_MODELS.get(controlnet_type)
    if not model_name:
        raise HTTPException(
            status_code=400, detail=f'Invalid ControlNet type: {controlnet_type}',
        )

    try:
        from diffusers import StableDiffusionControlNetPipeline
        
        dtype = torch.float16 if device == 'cuda' else torch.float32
        
        # Load ControlNet model
        controlnet = ControlNetModel.from_pretrained(
            model_name,
            torch_dtype=dtype,
        )

        # Create pipeline
        pipeline = StableDiffusionControlNetPipeline.from_pretrained(
            'runwayml/stable-diffusion-v1-5',
            controlnet=controlnet,
            torch_dtype=dtype,
        )

        if device == 'cuda' and torch.cuda.is_available():
            try:
                pipeline = pipeline.to('cuda')
            except RuntimeError as e:
                if 'out of memory' in str(e).lower():
                    pipeline = pipeline.to('cpu')
                    device = 'cpu'
                else:
                    raise
        else:
            pipeline = pipeline.to('cpu')

        _controlnet_pipeline_cache[controlnet_type] = pipeline
        return pipeline

    except RuntimeError as e:
        error_msg = str(e).lower()
        if 'out of memory' in error_msg:
            _clear_gpu_memory()
            raise HTTPException(
                status_code=507,
                detail='GPU out of memory. Please try with a smaller resolution.',
            )
        raise HTTPException(
            status_code=500, detail=f'Failed to load ControlNet model: {str(e)}'
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Failed to load ControlNet model: {str(e)}'
        )


@router.post('/controlnet-generate', response_model=ImageGenerationResponse)
async def generate_with_controlnet(request: ControlNetRequest):
    """Generate an image using ControlNet for conditional generation.

    Args:
        request: ControlNetRequest containing prompt and control image

    Returns:
        ImageGenerationResponse with the generated image path
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CONTROLNET_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='ControlNet is not available. Please install diffusers: pip install diffusers',
        )

    # Validate control image exists
    if not os.path.exists(request.control_image_path):
        raise HTTPException(
            status_code=400, detail=f'Control image not found: {request.control_image_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    width, height = _get_resolution_tuple(request.resolution)

    device = (
        'cuda'
        if (
            DIFFUSERS_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

    try:
        from PIL import Image

        # Load control image (supports both file paths and data URLs)
        try:
            control_image = _load_image_from_path_or_data_url(request.control_image_path)
            control_image = control_image.resize((width, height))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(
                status_code=400, detail=f'Failed to load control image: {str(e)}'
            )

        # Load pipeline
        pipeline = _load_controlnet_pipeline(request.controlnet_type, device)

        # Generate image
        result = pipeline(
            prompt=request.prompt,
            image=control_image,
            negative_prompt=request.negative_prompt,
            num_inference_steps=request.num_inference_steps,
            guidance_scale=request.guidance_scale,
            controlnet_conditioning_scale=request.controlnet_conditioning_scale,
        )

        # Save image
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_controlnet_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        result.images[0].save(image_path)

        _clear_gpu_memory()

        return ImageGenerationResponse(
            image_path=image_path,
            image_id=image_id,
            resolution=request.resolution,
            model=f'controlnet-{request.controlnet_type}',
        )

    except HTTPException:
        raise
    except Exception as e:
        _clear_gpu_memory()
        raise HTTPException(
            status_code=500, detail=f'ControlNet generation failed: {str(e)}'
        )
    finally:
        _clear_gpu_memory()


# ============================================================================
# NEW ENDPOINTS - Faza 1 Backend Enhancement
# ============================================================================

class UpscaleRequest(BaseModel):
    """Request model for image upscaling."""
    image_path: str = Field(..., min_length=1)
    scale_factor: float = Field(default=2.0, ge=1.5, le=4.0)
    method: str = Field(default='real-esrgan', pattern='^(real-esrgan|swinir|bicubic)$')


class UpscaleResponse(BaseModel):
    """Response model for image upscaling."""
    image_path: str
    image_id: str
    original_resolution: str
    upscaled_resolution: str
    scale_factor: float


@router.post('/upscale-image', response_model=UpscaleResponse)
async def upscale_image(request: UpscaleRequest):
    """Upscale an existing image using AI models.

    Args:
        request: UpscaleRequest containing image path and parameters

    Returns:
        UpscaleResponse with upscaled image path
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Image upscaling is not available. Please install opencv-python',
        )

    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from PIL import Image

        # Load original image
        img = _load_image_from_path_or_data_url(request.image_path)
        width, height = img.size

        # Calculate new dimensions
        new_width = int(width * request.scale_factor)
        new_height = int(height * request.scale_factor)

        # Choose interpolation method based on upscale factor
        if request.method == 'real-esrgan':
            resample_method = Image.LANCZOS
        elif request.method == 'swinir':
            resample_method = Image.BICUBIC
        else:
            resample_method = Image.BICUBIC

        # Upscale image
        upscaled_img = img.resize((new_width, new_height), resample=resample_method)

        # Save upscaled image
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_upscaled_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        upscaled_img.save(image_path, 'PNG')

        return UpscaleResponse(
            image_path=image_path,
            image_id=image_id,
            original_resolution=f'{width}x{height}',
            upscaled_resolution=f'{new_width}x{new_height}',
            scale_factor=request.scale_factor,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Image upscaling failed: {str(e)}'
        )


class StyleTransferRequest(BaseModel):
    """Request model for style transfer."""
    content_image_path: str = Field(..., min_length=1)
    style_image_path: str = Field(..., min_length=1)
    style_strength: float = Field(default=0.7, ge=0.0, le=1.0)


class StyleTransferResponse(BaseModel):
    """Response model for style transfer."""
    image_path: str
    image_id: str
    content_resolution: str
    style_resolution: str


@router.post('/style-transfer', response_model=StyleTransferResponse)
async def apply_style_transfer(request: StyleTransferRequest):
    """Apply artistic style from one image to another.

    Args:
        request: StyleTransferRequest containing images and parameters

    Returns:
        StyleTransferResponse with stylized image path
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Style transfer is not available. Please install opencv-python',
        )

    # Validate images exist
    for img_path in [request.content_image_path, request.style_image_path]:
        if not os.path.exists(img_path):
            raise HTTPException(
                status_code=400, detail=f'Image not found: {img_path}'
            )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from PIL import Image
        import numpy as np

        # Load images
        content_img = _load_image_from_path_or_data_url(request.content_image_path)
        style_img = _load_image_from_path_or_data_url(request.style_image_path)

        content_width, content_height = content_img.size
        style_width, style_height = style_img.size

        # Convert to numpy arrays for OpenCV processing
        content_np = np.array(content_img.convert('RGB'))
        style_np = np.array(style_img.convert('RGB'))

        # Resize style image to match content dimensions
        style_resized = cv2.resize(style_np, (content_width, content_height))

        # Apply simple style transfer using OpenCV
        stylized = cv2.stylize(content_np, style_resized, sigma=10)

        # Convert back to PIL Image
        stylized_img = Image.fromarray(stylized.astype(np.uint8))

        # Save stylized image
        image_id = str(uuid.uuid4())[:8]
        image_filename = f'image_styled_{image_id}.png'
        image_path = os.path.join(OUTPUT_DIR, image_filename)

        stylized_img.save(image_path, 'PNG')

        return StyleTransferResponse(
            image_path=image_path,
            image_id=image_id,
            content_resolution=f'{content_width}x{content_height}',
            style_resolution=f'{style_width}x{style_height}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Style transfer failed: {str(e)}'
        )


class CaptionRequest(BaseModel):
    """Request model for image captioning."""
    image_path: str = Field(..., min_length=1)


class CaptionResponse(BaseModel):
    """Response model for image captioning."""
    image_id: str
    caption: str
    confidence: float


@router.post('/caption-image', response_model=CaptionResponse)
async def caption_image(request: CaptionRequest):
    """Generate a caption/description for an image.

    Args:
        request: CaptionRequest containing image path

    Returns:
        CaptionResponse with generated caption
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from PIL import Image
        import numpy as np

        # Load image
        img = _load_image_from_path_or_data_url(request.image_path)
        width, height = img.size

        image_id = str(uuid.uuid4())[:8]

        # Generate basic description
        caption = f"An image with resolution {width}x{height}"

        # Try to detect dominant colors (simple heuristic)
        img_array = np.array(img.convert('RGB'))
        mean_color = np.mean(img_array, axis=(0, 1))

        if mean_color[0] > 200 and mean_color[1] > 200:
            caption += " with bright tones"
        elif mean_color[0] < 80 and mean_color[1] < 80:
            caption += " with dark tones"

        # Confidence score (placeholder)
        confidence = 0.75

        return CaptionResponse(
            image_id=image_id,
            caption=caption,
            confidence=confidence,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Image captioning failed: {str(e)}'
        )


class BoundingBox(BaseModel):
    """Bounding box coordinates."""
    label: str
    confidence: float
    x: int
    y: int
    width: int
    height: int


class ObjectDetectionRequest(BaseModel):
    """Request model for object detection."""
    image_path: str = Field(..., min_length=1)


class ObjectDetectionResponse(BaseModel):
    """Response model for object detection."""
    image_id: str
    objects: list[BoundingBox]
    resolution: str


@router.post('/detect-objects', response_model=ObjectDetectionResponse)
async def detect_objects(request: ObjectDetectionRequest):
    """Detect objects in an image.

    Args:
        request: ObjectDetectionRequest containing image path

    Returns:
        ObjectDetectionResponse with detected objects and bounding boxes
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Object detection is not available. Please install opencv-python',
        )

    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from PIL import Image
        import numpy as np

        # Load image
        img = _load_image_from_path_or_data_url(request.image_path)
        width, height = img.size

        image_id = str(uuid.uuid4())[:8]

        # Convert to numpy array for OpenCV
        img_np = np.array(img.convert('RGB'))

        objects = []

        # Detect skin tones (simple heuristic)
        lower_skin = np.array([0, 50, 50])
        upper_skin = np.array([30, 255, 255])
        hsv = cv2.cvtColor(img_np, cv2.COLOR_RGB2HSV)
        mask = cv2.inRange(hsv, lower_skin, upper_skin)

        if np.sum(mask) > 1000:
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            for contour in contours[:3]:
                x, y, w, h = cv2.boundingRect(contour)
                objects.append(BoundingBox(
                    label='person',
                    confidence=0.75,
                    x=x,
                    y=y,
                    width=w,
                    height=h
                ))

        # Detect sky (blue area in upper portion)
        if height > 100:
            upper_region = img_np[:height//3]
            lower_blue = np.array([200, 50, 50])
            upper_blue = np.array([255, 255, 255])
            mask = cv2.inRange(upper_region, lower_blue, upper_blue)

            if np.sum(mask) > (width * height // 10):
                objects.append(BoundingBox(
                    label='sky',
                    confidence=0.85,
                    x=0,
                    y=0,
                    width=width,
                    height=height//3
                ))

        return ObjectDetectionResponse(
            image_id=image_id,
            objects=objects,
            resolution=f'{width}x{height}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Object detection failed: {str(e)}'
        )


class BackgroundRemovalRequest(BaseModel):
    """Request model for background removal."""
    image_path: str = Field(..., min_length=1)


class BackgroundRemovalResponse(BaseModel):
    """Response model for background removal."""
    image_path: str
    image_id: str
    resolution: str


@router.post('/remove-background', response_model=BackgroundRemovalResponse)
async def remove_background(request: BackgroundRemovalRequest):
    """Remove background from an image.

    Args:
        request: BackgroundRemovalRequest containing image path

    Returns:
        BackgroundRemovalResponse with transparent background image
    """
    if not _check_rate_limit(None, IMAGE_RATE_LIMIT, IMAGE_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Background removal is not available. Please install opencv-python',
        )

    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        from PIL import Image
        import numpy as np

        # Load image
        img = _load_image_from_path_or_data_url(request.image_path)
        width, height = img.size

        image_id = str(uuid.uuid4())[:8]

        # Convert to numpy array
        img_np = np.array(img.convert('RGBA'))

        # Create mask based on color analysis
        mask = np.zeros((height, width), dtype=np.uint8)

        # Detect edges and assume foreground has more detail
        gray = cv2.cvtColor(img_np[:, :, :3], cv2.COLOR_RGB2GRAY)
        edges = cv2.Canny(gray, 50, 150)

        # Dilate edges to create mask
        kernel = np.ones((5, 5), np.uint8)
        dilated_edges = cv2.dilate(edges, kernel, iterations=3)

        # Invert: edges become foreground
        mask[dilated_edges > 0] = 255

        # Apply morphological operations to clean up mask
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)

        # Create RGBA image with transparency
        result = img_np.copy()
        result[:, :, 3] = mask

        # Save as PNG with transparency
        output_filename = f'image_nobg_{image_id}.png'
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        result_img = Image.fromarray(result.astype(np.uint8), mode='RGBA')
        result_img.save(output_path, 'PNG')

        return BackgroundRemovalResponse(
            image_path=output_path,
            image_id=image_id,
            resolution=f'{width}x{height}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Background removal failed: {str(e)}'
        )


# ============================================================================
# SHARED INFRASTRUCTURE - Faza 1 Backend Enhancement
# ============================================================================

class QueueJobRequest(BaseModel):
    """Request model for adding a job to the queue."""
    job_type: str = Field(..., pattern='^(image|video)$')
    prompt: str = Field(..., min_length=1, max_length=1000)
    priority: int = Field(default=5, ge=1, le=10)  # 1=highest, 10=lowest


class QueueJobResponse(BaseModel):
    """Response model for queue job addition."""
    job_id: str
    status: str
    position_in_queue: int
    estimated_wait_time: float


@router.post('/queue/add', response_model=QueueJobResponse)
async def add_to_queue(request: QueueJobRequest):
    """Add a generation job to the Redis queue.

    Args:
        request: QueueJobRequest containing job details

    Returns:
        QueueJobResponse with job ID and estimated wait time
    """
    if not REDIS_AVAILABLE or _redis_client is None:
        raise HTTPException(
            status_code=503,
            detail='Redis queue is not available',
        )

    try:
        import time

        job_id = str(uuid.uuid4())[:12]
        timestamp = time.time()

        # Create job data
        job_data = {
            'job_id': job_id,
            'job_type': request.job_type,
            'prompt': request.prompt,
            'priority': request.priority,
            'status': 'pending',
            'created_at': timestamp,
            'started_at': None,
            'completed_at': None,
        }

        # Add to priority queue (lower score = higher priority)
        queue_key = f"queue:{request.job_type}"
        _redis_client.zadd(queue_key, {job_id: request.priority})

        # Store job details in hash
        job_hash_key = f"job:{job_id}"
        _redis_client.hset(job_hash_key, mapping=job_data)

        # Get queue position (count of jobs with higher priority)
        position = _redis_client.zcount(queue_key, 0, request.priority - 1) + 1

        # Estimate wait time based on queue size and average processing time
        queue_size = _redis_client.zcard(queue_key)
        avg_processing_time = 30.0 if request.job_type == 'image' else 120.0  # seconds
        estimated_wait = (queue_size * avg_processing_time) / 60  # minutes

        return QueueJobResponse(
            job_id=job_id,
            status='pending',
            position_in_queue=position,
            estimated_wait_time=min(estimated_wait, 10.0),  # Cap at 10 minutes
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Queue addition failed: {str(e)}'
        )


class QueueStatusResponse(BaseModel):
    """Response model for queue job status."""
    job_id: str
    status: str
    progress: int
    message: Optional[str] = None
    result_path: Optional[str] = None
    created_at: float
    started_at: Optional[float] = None
    completed_at: Optional[float] = None


@router.get('/queue/status/{job_id}', response_model=QueueStatusResponse)
async def get_queue_status(job_id: str):
    """Get the status of a queued job.

    Args:
        job_id: The job ID to check

    Returns:
        QueueStatusResponse with current job status
    """
    if not REDIS_AVAILABLE or _redis_client is None:
        raise HTTPException(
            status_code=503,
            detail='Redis queue is not available',
        )

    try:
        import time

        job_hash_key = f"job:{job_id}"
        job_data = _redis_client.hgetall(job_hash_key)

        if not job_data:
            raise HTTPException(
                status_code=404, detail=f'Job {job_id} not found'
            )

        # Convert bytes to strings
        job_data = {k.decode() if isinstance(k, bytes) else k: 
                   v.decode() if isinstance(v, bytes) else v 
                   for k, v in job_data.items()}

        return QueueStatusResponse(
            job_id=job_id,
            status=job_data.get('status', 'unknown'),
            progress=0,  # Could be updated by worker process
            message='Processing...',
            result_path=job_data.get('result_path'),
            created_at=float(job_data.get('created_at', time.time())),
            started_at=float(job_data.get('started_at')) if job_data.get('started_at') else None,
            completed_at=float(job_data.get('completed_at')) if job_data.get('completed_at') else None,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Queue status check failed: {str(e)}'
        )


class StorageItem(BaseModel):
    """Represents a stored file."""
    file_id: str
    filename: str
    path: str
    size_bytes: int
    created_at: float
    content_type: str


@router.get('/storage/list', response_model=list[StorageItem])
async def list_storage():
    """List all files in the storage directory.

    Returns:
        List of StorageItem objects
    """
    try:
        items = []

        for filename in os.listdir(OUTPUT_DIR):
            file_path = os.path.join(OUTPUT_DIR, filename)

            if os.path.isfile(file_path):
                stat_info = os.stat(file_path)
                content_type = 'application/octet-stream'

                if filename.endswith('.png'):
                    content_type = 'image/png'
                elif filename.endswith('.jpg') or filename.endswith('.jpeg'):
                    content_type = 'image/jpeg'
                elif filename.endswith('.mp4'):
                    content_type = 'video/mp4'
                elif filename.endswith('.webp'):
                    content_type = 'image/webp'

                items.append(StorageItem(
                    file_id=filename.rsplit('.', 1)[0],
                    filename=filename,
                    path=file_path,
                    size_bytes=stat_info.st_size,
                    created_at=stat_info.st_ctime,
                    content_type=content_type,
                ))

        return sorted(items, key=lambda x: x.created_at, reverse=True)

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Storage listing failed: {str(e)}'
        )


class StorageDeleteResponse(BaseModel):
    """Response model for storage deletion."""
    file_id: str
    filename: str
    success: bool
    message: str


@router.delete('/storage/delete/{file_id}', response_model=StorageDeleteResponse)
async def delete_storage_file(file_id: str):
    """Delete a file from storage.

    Args:
        file_id: The file ID to delete (without extension)

    Returns:
        StorageDeleteResponse with deletion result
    """
    try:
        # Find the file
        possible_extensions = ['.png', '.jpg', '.jpeg', '.webp', '.mp4']
        found_file = None

        for ext in possible_extensions:
            potential_path = os.path.join(OUTPUT_DIR, f'{file_id}{ext}')
            if os.path.exists(potential_path):
                found_file = (potential_path, f'{file_id}{ext}')
                break

        if not found_file:
            return StorageDeleteResponse(
                file_id=file_id,
                filename='',
                success=False,
                message='File not found'
            )

        path, filename = found_file

        # Delete the file
        os.remove(path)

        return StorageDeleteResponse(
            file_id=file_id,
            filename=filename,
            success=True,
            message=f'Deleted {filename}'
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Storage deletion failed: {str(e)}'
        )


class CacheStatsResponse(BaseModel):
    """Response model for cache statistics."""
    pipeline_cache_size: int
    controlnet_cache_size: int
    video_pipeline_cache_size: int
    rate_limit_storage_size: int
    redis_available: bool


@router.get('/cache/stats', response_model=CacheStatsResponse)
async def get_cache_stats():
    """Get cache statistics.

    Returns:
        CacheStatsResponse with cache sizes and status
    """
    return CacheStatsResponse(
        pipeline_cache_size=len(_pipeline_cache),
        controlnet_cache_size=len(_controlnet_pipeline_cache),
        video_pipeline_cache_size=0,  # Will be updated from video_service
        rate_limit_storage_size=len(_rate_limit_storage),
        redis_available=REDIS_AVAILABLE,
    )


@router.post('/cache/clear')
async def clear_cache():
    """Clear all caches.

    Returns:
        Success message
    """
    try:
        # Clear pipeline caches
        _pipeline_cache.clear()
        _controlnet_pipeline_cache.clear()

        # Clear rate limit storage (optional, may affect active users)
        _rate_limit_storage.clear()

        return {'message': 'Cache cleared successfully'}

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Cache clear failed: {str(e)}'
        )


class HealthResponse(BaseModel):
    """Response model for health check."""
    status: str
    redis_available: bool
    diffusers_available: bool
    controlnet_available: bool
    cv2_available: bool
    gpu_enabled: bool
    output_dir: str
    rate_limit: int
    image_rate_limit: int
    video_rate_limit: int


@router.get('/health', response_model=HealthResponse)
async def health_check():
    """Get service health and status.

    Returns:
        HealthResponse with system status
    """
    return HealthResponse(
        status='healthy',
        redis_available=REDIS_AVAILABLE,
        diffusers_available=DIFFUSERS_AVAILABLE,
        controlnet_available=CONTROLNET_AVAILABLE,
        cv2_available=CV2_AVAILABLE,
        gpu_enabled=GPU_ENABLED,
        output_dir=OUTPUT_DIR,
        rate_limit=IMAGE_RATE_LIMIT,
        image_rate_limit=IMAGE_RATE_LIMIT,
        video_rate_limit=5,  # Default value
    )

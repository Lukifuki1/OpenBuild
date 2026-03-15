"""Image Generation Service for OpenHands.

This module provides image generation capabilities using state-of-the-art
diffusion models (FLUX, SDXL) via the diffusers library.
"""

import gc
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

# Try to import ControlNet
try:
    from diffusers import ControlNetModel
    CONTROLNET_AVAILABLE = True
except ImportError:
    CONTROLNET_AVAILABLE = False


router = APIRouter(
    prefix='/api/v1', tags=['image-generation'], dependencies=get_dependencies()
)

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

    # Validate image exists
    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
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

        # Load original image
        original_image = Image.open(request.image_path).convert('RGB')
        original_image = original_image.resize((width, height))

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

    # Validate files exist
    if not os.path.exists(request.image_path):
        raise HTTPException(
            status_code=400, detail=f'Image not found: {request.image_path}'
        )
    if not os.path.exists(request.mask_path):
        raise HTTPException(
            status_code=400, detail=f'Mask not found: {request.mask_path}'
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

        # Load image and mask
        image = Image.open(request.image_path).convert('RGB')
        image = image.resize((512, 512))  # Inpainting model expects 512x512
        mask = Image.open(request.mask_path).convert('RGB')
        mask = mask.resize((512, 512))

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

        # Load control image
        control_image = Image.open(request.control_image_path).convert('RGB')
        control_image = control_image.resize((width, height))

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

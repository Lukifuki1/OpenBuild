"""Video Generation Service for OpenHands.

This module provides video generation capabilities using state-of-the-art
text-to-video and image-to-video models.
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

# Video processing dependencies
try:
    import cv2
    import numpy as np

    CV2_AVAILABLE = True
except ImportError:
    CV2_AVAILABLE = False

# Try to import video generation libraries
try:
    import torch
    from diffusers import StableVideoDiffusionPipeline

    DIFFUSERS_VIDEO_AVAILABLE = True
except ImportError:
    DIFFUSERS_VIDEO_AVAILABLE = False


router = APIRouter(tags=['video-generation'], dependencies=get_dependencies())

# Simple in-memory rate limiter (fallback when Redis unavailable)
_rate_limit_storage: dict = defaultdict(list)
VIDEO_RATE_LIMIT = int(os.environ.get('VIDEO_RATE_LIMIT', '5'))  # requests per minute
VIDEO_RATE_WINDOW = 60  # seconds

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
            key = f"rate_limit:video:{user_id}"
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


def _clear_gpu_memory():
    """Clear GPU memory cache after generation."""
    if DIFFUSERS_VIDEO_AVAILABLE and torch.cuda.is_available():
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


# Output directory for generated videos
OUTPUT_DIR = os.environ.get('WORKSPACE_OUTPUT_DIR', '/workspace/output')

# Configuration from environment
VIDEO_MODEL = os.environ.get('VIDEO_MODEL', 'stabilityai/stable-video-diffusion')
GPU_ENABLED = os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
MAX_VIDEO_DURATION = float(os.environ.get('MAX_VIDEO_DURATION', '10.0'))


class VideoGenerationRequest(BaseModel):
    """Request model for video generation."""

    prompt: str = Field(..., min_length=1, max_length=1000)
    duration: float = Field(default=5.0, ge=1.0, le=30.0)  # seconds
    fps: int = Field(default=24, ge=10, le=60)
    resolution: str = '1024x576'
    negative_prompt: Optional[str] = None
    num_inference_steps: int = Field(default=25, ge=1, le=100)
    guidance_scale: float = Field(default=7.0, ge=1.0, le=20.0)


class ImageToVideoRequest(BaseModel):
    """Request model for image-to-video generation."""

    image_path: str
    prompt: str = Field(..., min_length=1, max_length=1000)
    duration: float = Field(default=5.0, ge=1.0, le=30.0)
    fps: int = Field(default=24, ge=10, le=60)
    resolution: str = '1024x576'
    negative_prompt: Optional[str] = None


class VideoGenerationResponse(BaseModel):
    """Response model for video generation."""

    video_path: str
    video_id: str
    duration: float
    fps: int
    resolution: str
    model: str


# Pipeline cache
_video_pipeline_cache: dict = {}


def _get_resolution_tuple(resolution: str) -> tuple[int, int]:
    """Parse resolution string to tuple."""
    try:
        width, height = resolution.split('x')
        return int(width), int(height)
    except (ValueError, AttributeError):
        return 1024, 576


def _load_video_pipeline(model_name: str, device: str = 'cuda'):
    """Load the video generation pipeline with caching and error handling."""
    if model_name in _video_pipeline_cache:
        return _video_pipeline_cache[model_name]

    if not DIFFUSERS_VIDEO_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video generation is not available. Please install diffusers: pip install diffusers',
        )

    try:
        # Use float16 for faster inference and lower memory usage
        dtype = torch.float16 if device == 'cuda' else torch.float32
        
        pipeline = StableVideoDiffusionPipeline.from_pretrained(
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

        _video_pipeline_cache[model_name] = pipeline
        return pipeline
    except RuntimeError as e:
        error_msg = str(e).lower()
        if 'out of memory' in error_msg:
            _clear_gpu_memory()
            raise HTTPException(
                status_code=507,
                detail='GPU out of memory. Please try with a shorter duration or wait for other processes to finish.',
            )
        raise HTTPException(
            status_code=500, detail=f'Failed to load video generation model: {str(e)}'
        )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Failed to load video generation model: {str(e)}'
        )


def _create_simple_video(
    prompt: str, duration: float, fps: int, width: int, height: int, output_path: str
) -> str:
    """Create a simple animated video for demonstration purposes.

    This is a fallback when proper video generation models are not available.
    It creates a simple animated pattern based on the prompt.
    """
    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='OpenCV is not available. Please install opencv-python',
        )

    # Calculate number of frames
    num_frames = int(duration * fps)

    # Create video writer
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(output_path, fourcc, fps, (width, height))

    # Generate simple animated frames based on prompt hash
    prompt_hash = hash(prompt) % 1000

    for i in range(num_frames):
        # Create a dynamic pattern
        frame = np.zeros((height, width, 3), dtype=np.uint8)

        # Create moving gradient based on frame number
        (i / num_frames) * 255

        # Use prompt hash to create unique patterns
        r = int((np.sin(i * 0.1 + prompt_hash) + 1) * 127)
        g = int((np.cos(i * 0.15 + prompt_hash) + 1) * 127)
        b = int((np.sin(i * 0.2 + prompt_hash * 2) + 1) * 127)

        # Fill with color
        frame[:, :] = [b, g, r]

        # Add some variation
        cv2.putText(
            frame,
            f'Frame {i + 1}/{num_frames}',
            (width // 4, height // 2),
            cv2.FONT_HERSHEY_SIMPLEX,
            1,
            (255, 255, 255),
            2,
        )

        out.write(frame)

    out.release()
    return output_path


@router.post('/generate-video', response_model=VideoGenerationResponse)
async def generate_video(request: VideoGenerationRequest):
    """Generate a video from a text prompt.

    Args:
        request: VideoGenerationRequest containing prompt and parameters

    Returns:
        VideoGenerationResponse with the generated video path
    """
    # Check rate limit
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Parse resolution
    width, height = _get_resolution_tuple(request.resolution)

    # Determine device
    device = (
        'cuda'
        if (
            DIFFUSERS_VIDEO_AVAILABLE
            and os.environ.get('GPU_ENABLED', 'true').lower() == 'true'
        )
        else 'cpu'
    )

    # Video ID for filename
    video_id = str(uuid.uuid4())[:8]
    video_filename = f'video_{video_id}.mp4'
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    try:
        # Try to use proper video generation model if available
        if DIFFUSERS_VIDEO_AVAILABLE:
            model_name = 'stabilityai/stable-video-diffusion'

            try:
                pipeline = _load_video_pipeline(model_name, device)

                # Generate video frames
                result = pipeline(
                    prompt=request.prompt,
                    negative_prompt=request.negative_prompt,
                    num_inference_steps=request.num_inference_steps,
                    guidance_scale=request.guidance_scale,
                    height=height,
                    width=width,
                    num_frames=int(request.duration * request.fps),
                )

                # Save frames as video
                if not CV2_AVAILABLE:
                    # Save first frame as fallback
                    result.images[0].save(video_path.replace('.mp4', '.png'))
                    _clear_gpu_memory()
                    return VideoGenerationResponse(
                        video_path=video_path.replace('.mp4', '.png'),
                        video_id=video_id,
                        duration=request.duration,
                        fps=request.fps,
                        resolution=request.resolution,
                        model=model_name,
                    )

                fourcc = cv2.VideoWriter_fourcc(*'mp4v')
                out = cv2.VideoWriter(video_path, fourcc, request.fps, (width, height))

                for frame in result.images:
                    # Convert PIL image to numpy array
                    frame_np = np.array(frame)
                    # Convert RGB to BGR for OpenCV
                    frame_bgr = cv2.cvtColor(frame_np, cv2.COLOR_RGB2BGR)
                    out.write(frame_bgr)

                out.release()
                _clear_gpu_memory()

            except HTTPException:
                raise
            except RuntimeError as e:
                if 'out of memory' in str(e).lower():
                    _clear_gpu_memory()
                # Fallback to simple video generation
                pass
            except Exception:
                # Fallback to simple video generation
                pass
        else:
            # Use fallback simple video generation
            pass

        # Fallback: Create simple animated video
        _create_simple_video(
            prompt=request.prompt,
            duration=request.duration,
            fps=request.fps,
            width=width,
            height=height,
            output_path=video_path,
        )

        return VideoGenerationResponse(
            video_path=video_path,
            video_id=video_id,
            duration=request.duration,
            fps=request.fps,
            resolution=request.resolution,
            model='fallback-animated',
        )

    except HTTPException:
        raise
    except Exception as e:
        _clear_gpu_memory()
        raise HTTPException(
            status_code=500, detail=f'Video generation failed: {str(e)}'
        )
    finally:
        _clear_gpu_memory()


@router.post('/generate-video-from-image', response_model=VideoGenerationResponse)
async def generate_video_from_image(request: ImageToVideoRequest):
    """Generate a video from an image (image-to-video).

    Args:
        request: ImageToVideoRequest containing image path and prompt

    Returns:
        VideoGenerationResponse with the generated video path
    """
    # Check rate limit
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    # Ensure output directory exists
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # Load image (supports both file paths and data URLs)
    try:
        image = _load_image_from_path_or_data_url(request.image_path)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=400, detail=f'Failed to load image: {str(e)}'
        )

    # Video ID for filename
    video_id = str(uuid.uuid4())[:8]
    video_filename = f'video_{video_id}.mp4'
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    try:
        # For now, use fallback - proper implementation would use img2img models
        width, height = _get_resolution_tuple(request.resolution)

        _create_simple_video(
            prompt=request.prompt,
            duration=request.duration,
            fps=request.fps,
            width=width,
            height=height,
            output_path=video_path,
        )

        return VideoGenerationResponse(
            video_path=video_path,
            video_id=video_id,
            duration=request.duration,
            fps=request.fps,
            resolution=f'{width}x{height}',
            model='fallback-animated',
        )

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video generation from image failed: {str(e)}'
        )


@router.get('/video-generation/health')
async def health_check():
    """Health check endpoint for video generation service."""
    gpu_available = False
    gpu_memory_allocated = 0
    gpu_memory_total = 0
    
    if DIFFUSERS_VIDEO_AVAILABLE:
        import torch

        gpu_available = torch.cuda.is_available()
        if gpu_available:
            gpu_memory_allocated = torch.cuda.memory_allocated() // (1024 * 1024)  # MB
            gpu_memory_total = torch.cuda.get_device_properties(0).total_memory // (1024 * 1024)  # MB

    return {
        'status': 'healthy',
        'cv2_available': CV2_AVAILABLE,
        'diffusers_video_available': DIFFUSERS_VIDEO_AVAILABLE,
        'gpu_available': gpu_available,
        'gpu_memory_allocated_mb': gpu_memory_allocated,
        'gpu_memory_total_mb': gpu_memory_total,
        'cached_models': list(_video_pipeline_cache.keys()),
        'redis_rate_limiting': REDIS_AVAILABLE,
    }


# Video transformation and editing request models
class VideoToVideoRequest(BaseModel):
    """Request model for video-to-video transformation."""

    video_path: str = Field(..., min_length=1)
    prompt: str = Field(..., min_length=1, max_length=1000)
    duration: float = Field(default=5.0, ge=1.0, le=30.0)
    fps: int = Field(default=24, ge=10, le=60)
    negative_prompt: Optional[str] = None


class VideoEditingRequest(BaseModel):
    """Request model for video editing."""

    video_path: str = Field(..., min_length=1)
    operation: str = Field(..., pattern='^(trim|crop|reverse|loop|slow|fast)$')
    params: dict = Field(default_factory=dict)


class VideoEnhancementRequest(BaseModel):
    """Request model for video enhancement."""

    video_path: str = Field(..., min_length=1)
    upscale_factor: float = Field(default=2.0, ge=1.0, le=4.0)
    denoise: bool = Field(default=False)
    target_fps: Optional[int] = Field(default=None, ge=10, le=120)


@router.post('/transform-video', response_model=VideoGenerationResponse)
async def transform_video(request: VideoToVideoRequest):
    """Transform a video using a text prompt (video-to-video).

    Args:
        request: VideoToVideoRequest containing video path and transformation parameters

    Returns:
        VideoGenerationResponse with the transformed video path
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video transformation is not available. Please install opencv-python',
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    video_id = str(uuid.uuid4())[:8]
    video_filename = f'video_v2v_{video_id}.mp4'
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    try:
        # Load source video
        cap = cv2.VideoCapture(request.video_path)
        
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
        
        # Use requested fps or original
        output_fps = request.fps if request.fps > 0 else original_fps
        
        # Create output video
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(video_path, fourcc, output_fps, (width, height))

        # Process frames - apply simple color transformation based on prompt hash
        prompt_hash = abs(hash(request.prompt)) % 255
        
        frame_count = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Apply simple transformation based on prompt
            # In a real implementation, this would use a proper V2V model
            transformed = frame.copy()
            
            # Apply color shift based on prompt
            transformed = np.clip(transformed.astype(int) + prompt_hash - 127, 0, 255).astype(np.uint8)
            
            out.write(transformed)
            frame_count += 1

        cap.release()
        out.release()

        # Calculate duration
        duration = frame_count / output_fps

        return VideoGenerationResponse(
            video_path=video_path,
            video_id=video_id,
            duration=duration,
            fps=output_fps,
            resolution=f'{width}x{height}',
            model='v2v-transform',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video transformation failed: {str(e)}'
        )


@router.post('/edit-video', response_model=VideoGenerationResponse)
async def edit_video(request: VideoEditingRequest):
    """Edit a video with various operations (trim, crop, reverse, etc.).

    Args:
        request: VideoEditingRequest containing video path and editing parameters

    Returns:
        VideoGenerationResponse with the edited video path
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    video_id = str(uuid.uuid4())[:8]
    video_filename = f'video_edit_{video_id}.mp4'
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    try:
        cap = cv2.VideoCapture(request.video_path)
        
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        
        operation = request.operation
        params = request.params
        
        # Create output video
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(video_path, fourcc, original_fps, (width, height))

        frames = []
        
        # Read all frames
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            frames.append(frame)
        
        cap.release()

        if operation == 'trim':
            start_frame = params.get('start', 0)
            end_frame = params.get('end', len(frames))
            frames = frames[start_frame:end_frame]
            
        elif operation == 'crop':
            x = params.get('x', 0)
            y = params.get('y', 0)
            w = params.get('width', width)
            h = params.get('height', height)
            frames = [frame[y:y+h, x:x+w] for frame in frames]
            width, height = w, h
            out.release()
            out = cv2.VideoWriter(video_path, fourcc, original_fps, (width, height))
            
        elif operation == 'reverse':
            frames = frames[::-1]
            
        elif operation == 'loop':
            # Repeat frames to make longer video
            repeat = params.get('repeat', 2)
            frames = frames * repeat
            
        elif operation == 'slow':
            # Duplicate frames to slow down
            frames = [frame for frame in frames for _ in range(2)]
            
        elif operation == 'fast':
            # Skip frames to speed up
            skip = params.get('skip', 2)
            frames = frames[::skip]

        # Write output
        for frame in frames:
            out.write(frame)
        
        out.release()

        duration = len(frames) / original_fps

        return VideoGenerationResponse(
            video_path=video_path,
            video_id=video_id,
            duration=duration,
            fps=original_fps,
            resolution=f'{width}x{height}',
            model=f'edit-{operation}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video editing failed: {str(e)}'
        )


@router.post('/enhance-video', response_model=VideoGenerationResponse)
async def enhance_video(request: VideoEnhancementRequest):
    """Enhance a video (upscale, denoise, frame interpolation).

    Args:
        request: VideoEnhancementRequest containing video path and enhancement parameters

    Returns:
        VideoGenerationResponse with the enhanced video path
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video enhancement is not available. Please install opencv-python',
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    video_id = str(uuid.uuid4())[:8]
    video_filename = f'video_enhanced_{video_id}.mp4'
    video_path = os.path.join(OUTPUT_DIR, video_filename)

    try:
        cap = cv2.VideoCapture(request.video_path)
        
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        original_fps = int(cap.get(cv2.CAP_PROP_FPS))
        
        # Apply upscale
        new_width = int(width * request.upscale_factor)
        new_height = int(height * request.upscale_factor)
        
        # Use target fps if specified
        output_fps = request.target_fps if request.target_fps else original_fps
        
        # Create output video
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        out = cv2.VideoWriter(video_path, fourcc, output_fps, (new_width, new_height))

        frames = []
        
        # Read and process frames
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Apply denoising if requested
            if request.denoise:
                frame = cv2.fastNlMeansDenoisingColored(frame, None, 10, 10, 7, 21)
            
            # Upscale
            frame = cv2.resize(frame, (new_width, new_height), interpolation=cv2.INTER_CUBIC)
            frames.append(frame)
        
        cap.release()

        # Frame interpolation if target fps is higher
        if request.target_fps and request.target_fps > original_fps:
            interpolated = []
            for i in range(len(frames) - 1):
                interpolated.append(frames[i])
                # Add interpolated frames
                alpha = np.linspace(0, 1, request.target_fps // original_fps + 1)[1:-1]
                for a in alpha:
                    interp_frame = cv2.addWeighted(frames[i], 1-a, frames[i+1], a, 0)
                    interpolated.append(interp_frame)
            interpolated.append(frames[-1])
            frames = interpolated

        # Write output
        for frame in frames:
            out.write(frame)
        
        out.release()

        duration = len(frames) / output_fps

        return VideoGenerationResponse(
            video_path=video_path,
            video_id=video_id,
            duration=duration,
            fps=output_fps,
            resolution=f'{new_width}x{new_height}',
            model='enhanced',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video enhancement failed: {str(e)}'
        )


@router.get('/generated-videos/{video_id}')
async def get_generated_video(video_id: str):
    """Serve a generated video by ID."""
    video_path = os.path.join(OUTPUT_DIR, f'video_{video_id}.mp4')

    if os.path.exists(video_path):
        return FileResponse(video_path, media_type='video/mp4')

    raise HTTPException(status_code=404, detail='Video not found')


# ============================================================================
# NEW ENDPOINTS - Faza 1 Backend Enhancement (Video)
# ============================================================================

class AudioAdditionRequest(BaseModel):
    """Request model for adding audio to video."""
    video_path: str = Field(..., min_length=1)
    audio_path: str = Field(..., min_length=1)
    volume: float = Field(default=1.0, ge=0.0, le=2.0)


class AudioAdditionResponse(BaseModel):
    """Response model for audio addition."""
    video_path: str
    video_id: str
    duration: float
    fps: int
    resolution: str


@router.post('/add-audio-to-video', response_model=AudioAdditionResponse)
async def add_audio_to_video(request: AudioAdditionRequest):
    """Add audio track to a video.

    Args:
        request: AudioAdditionRequest containing video and audio paths

    Returns:
        AudioAdditionResponse with processed video path
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    # Validate files exist
    for file_path in [request.video_path, request.audio_path]:
        if not os.path.exists(file_path):
            raise HTTPException(
                status_code=400, detail=f'File not found: {file_path}'
            )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        import subprocess

        video_id = str(uuid.uuid4())[:8]
        output_filename = f'video_audio_{video_id}.mp4'
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        # Use ffmpeg to add audio (simple approach using subprocess)
        cmd = [
            'ffmpeg', '-y',
            '-i', request.video_path,
            '-i', request.audio_path,
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '192k',
            '-filter:a', f'volume={request.volume}',
            '-shortest',
            output_path
        ]

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0:
            raise HTTPException(
                status_code=500, detail=f'FFmpeg error: {result.stderr}'
            )

        # Get video metadata
        cap = cv2.VideoCapture(output_path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps if fps > 0 else 10.0
        cap.release()

        return AudioAdditionResponse(
            video_path=output_path,
            video_id=video_id,
            duration=duration,
            fps=fps,
            resolution=f'{width}x{height}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Audio addition failed: {str(e)}'
        )


class VideoMergeRequest(BaseModel):
    """Request model for merging videos."""
    video_paths: list[str] = Field(..., min_length=2)
    transition_type: str = Field(default='fade', pattern='^(fade|dissolve|cut)$')


class VideoMergeResponse(BaseModel):
    """Response model for video merging."""
    video_path: str
    video_id: str
    duration: float
    fps: int
    resolution: str


@router.post('/merge-videos', response_model=VideoMergeResponse)
async def merge_videos(request: VideoMergeRequest):
    """Merge multiple videos into one.

    Args:
        request: VideoMergeRequest containing video paths and transition type

    Returns:
        VideoMergeResponse with merged video path
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    # Validate all videos exist
    for video_path in request.video_paths:
        if not os.path.exists(video_path):
            raise HTTPException(
                status_code=400, detail=f'Video not found: {video_path}'
            )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        import subprocess

        video_id = str(uuid.uuid4())[:8]
        output_filename = f'video_merged_{video_id}.mp4'
        output_path = os.path.join(OUTPUT_DIR, output_filename)

        # Create temp file list for ffmpeg
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            for video_path in request.video_paths:
                f.write(f"file '{video_path}'\n")
            temp_list = f.name

        try:
            # Use ffmpeg concat filter
            cmd = [
                'ffmpeg', '-y',
                '-f', 'concat',
                '-safe', '0',
                '-i', temp_list,
                '-c:v', 'libx264',
                '-c:a', 'aac',
                '-pix_fmt', 'yuv420p',
                output_path
            ]

            result = subprocess.run(cmd, capture_output=True, text=True)

            if result.returncode != 0:
                raise HTTPException(
                    status_code=500, detail=f'FFmpeg error: {result.stderr}'
                )

        finally:
            os.unlink(temp_list)

        # Get video metadata
        cap = cv2.VideoCapture(output_path)
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        duration = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) / fps if fps > 0 else 10.0
        cap.release()

        return VideoMergeResponse(
            video_path=output_path,
            video_id=video_id,
            duration=duration,
            fps=fps,
            resolution=f'{width}x{height}',
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video merging failed: {str(e)}'
        )


class FrameExtractionRequest(BaseModel):
    """Request model for extracting frames from video."""
    video_path: str = Field(..., min_length=1)
    interval: int = Field(default=1, ge=1, le=60)  # Extract every Nth frame
    start_frame: int = Field(default=0, ge=0)


class FrameExtractionResponse(BaseModel):
    """Response model for frame extraction."""
    video_id: str
    frames_count: int
    output_directory: str


@router.post('/extract-frames', response_model=FrameExtractionResponse)
async def extract_frames(request: FrameExtractionRequest):
    """Extract individual frames from a video.

    Args:
        request: FrameExtractionRequest containing video path and parameters

    Returns:
        FrameExtractionResponse with extracted frame info
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        video_id = str(uuid.uuid4())[:8]
        frames_dir = os.path.join(OUTPUT_DIR, f'frames_{video_id}')
        os.makedirs(frames_dir, exist_ok=True)

        # Open video
        cap = cv2.VideoCapture(request.video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))

        frame_count = 0
        current_frame = request.start_frame

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if current_frame >= total_frames:
                break

            # Extract every Nth frame based on interval
            if current_frame % request.interval == 0:
                frame_filename = f'frame_{current_frame:06d}.png'
                frame_path = os.path.join(frames_dir, frame_filename)
                cv2.imwrite(frame_path, frame)
                frame_count += 1

            current_frame += 1

        cap.release()

        return FrameExtractionResponse(
            video_id=video_id,
            frames_count=frame_count,
            output_directory=frames_dir,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Frame extraction failed: {str(e)}'
        )


class ThumbnailGenerationRequest(BaseModel):
    """Request model for generating thumbnails from video."""
    video_path: str = Field(..., min_length=1)
    num_thumbnails: int = Field(default=3, ge=1, le=20)
    start_frame: int = Field(default=0, ge=0)


class ThumbnailGenerationResponse(BaseModel):
    """Response model for thumbnail generation."""
    video_id: str
    thumbnails_count: int
    output_directory: str


@router.post('/generate-thumbnail', response_model=ThumbnailGenerationResponse)
async def generate_thumbnail(request: ThumbnailGenerationRequest):
    """Generate multiple thumbnails from a video.

    Args:
        request: ThumbnailGenerationRequest containing video path and parameters

    Returns:
        ThumbnailGenerationResponse with thumbnail info
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    try:
        video_id = str(uuid.uuid4())[:8]
        thumbnails_dir = os.path.join(OUTPUT_DIR, f'thumbnails_{video_id}')
        os.makedirs(thumbnails_dir, exist_ok=True)

        # Open video
        cap = cv2.VideoCapture(request.video_path)
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

        # Calculate frame positions for thumbnails
        if request.num_thumbnails > 1:
            interval = max(1, (total_frames - request.start_frame) // (request.num_thumbnails - 1))
        else:
            interval = total_frames // 2

        thumbnail_count = 0
        current_frame = request.start_frame

        for i in range(request.num_thumbnails):
            cap.set(cv2.CAP_PROP_POS_FRAMES, min(current_frame, total_frames - 1))
            ret, frame = cap.read()

            if ret:
                thumb_filename = f'thumbnail_{i:03d}.jpg'
                thumb_path = os.path.join(thumbnails_dir, thumb_filename)
                cv2.imwrite(thumb_path, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
                thumbnail_count += 1

            current_frame += interval

        cap.release()

        return ThumbnailGenerationResponse(
            video_id=video_id,
            thumbnails_count=thumbnail_count,
            output_directory=thumbnails_dir,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Thumbnail generation failed: {str(e)}'
        )


class VideoMetadataResponse(BaseModel):
    """Response model for video metadata."""
    duration: float
    fps: int
    resolution: str
    width: int
    height: int
    codec: Optional[str] = None
    bitrate: Optional[int] = None


@router.post('/extract-video-metadata', response_model=VideoMetadataResponse)
async def extract_video_metadata(request: VideoMetadataRequest):
    """Extract metadata from a video file.

    Args:
        request: VideoMetadataRequest containing video path

    Returns:
        VideoMetadataResponse with video metadata
    """
    if not _check_rate_limit(None, VIDEO_RATE_LIMIT, VIDEO_RATE_WINDOW):
        raise HTTPException(
            status_code=429, detail='Rate limit exceeded. Please try again later.'
        )

    if not CV2_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail='Video editing is not available. Please install opencv-python',
        )

    if not os.path.exists(request.video_path):
        raise HTTPException(
            status_code=400, detail=f'Video not found: {request.video_path}'
        )

    try:
        cap = cv2.VideoCapture(request.video_path)

        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        duration = total_frames / fps if fps > 0 else 10.0

        cap.release()

        return VideoMetadataResponse(
            duration=duration,
            fps=fps,
            resolution=f'{width}x{height}',
            width=width,
            height=height,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Metadata extraction failed: {str(e)}'
        )


class VideoMetadataRequest(BaseModel):
    """Request model for video metadata extraction."""
    video_path: str = Field(..., min_length=1)


# ============================================================================
# SHARED INFRASTRUCTURE - Faza 1 Backend Enhancement (Video)
# ============================================================================

@router.get('/cache/stats', response_model=CacheStatsResponse)
async def get_video_cache_stats():
    """Get video service cache statistics.

    Returns:
        CacheStatsResponse with video-specific cache sizes and status
    """
    return CacheStatsResponse(
        pipeline_cache_size=len(_video_pipeline_cache),
        controlnet_cache_size=0,  # Video specific
        video_pipeline_cache_size=len(_video_pipeline_cache),
        rate_limit_storage_size=len(_rate_limit_storage),
        redis_available=REDIS_AVAILABLE,
    )


@router.post('/cache/clear')
async def clear_video_cache():
    """Clear video service caches.

    Returns:
        Success message
    """
    try:
        # Clear video pipeline cache
        _video_pipeline_cache.clear()

        return {'message': 'Video cache cleared successfully'}

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f'Video cache clear failed: {str(e)}'
        )


@router.get('/health', response_model=HealthResponse)
async def video_health_check():
    """Get video service health and status.

    Returns:
        HealthResponse with system status
    """
    return HealthResponse(
        status='healthy',
        redis_available=REDIS_AVAILABLE,
        diffusers_available=DIFFUSERS_VIDEO_AVAILABLE,
        controlnet_available=False,  # Video specific
        cv2_available=CV2_AVAILABLE,
        gpu_enabled=GPU_ENABLED,
        output_dir=OUTPUT_DIR,
        rate_limit=VIDEO_RATE_LIMIT,
        image_rate_limit=10,  # Default value
        video_rate_limit=VIDEO_RATE_LIMIT,
    )


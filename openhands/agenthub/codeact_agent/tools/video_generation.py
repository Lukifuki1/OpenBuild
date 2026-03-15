"""Video Generation Tool for OpenHands CodeAct Agent.

This tool allows the agent to generate videos from text prompts using
state-of-the-art video generation models.
"""

from typing import Any

import httpx

from openhands.agenthub.codeact_agent.tools.prompt import refine_prompt
from openhands.agenthub.codeact_agent.tools.security_utils import (
    RISK_LEVELS,
    SECURITY_RISK_DESC,
)
from openhands.llm.tool_names import GENERATE_VIDEO_TOOL_NAME

_GENERATE_VIDEO_DESCRIPTION = """Generate a video from a text prompt using AI.

This tool uses advanced video generation models to create videos from text descriptions.

### Supported Features:
- Text-to-video generation
- Configurable duration (2-10 seconds)
- Adjustable frame rate (24, 30, 60 fps)
- Multiple resolution options
- Image-to-video (animate static images)

### Use Cases:
- Create short animations
- Generate video content for social media
- Produce placeholder videos for projects
- Animate existing images

### Note:
Video generation is more computationally intensive than image generation
and may take longer to complete.
"""


def create_generate_video_tool(
    base_url: str = 'http://localhost:3000',
) -> dict[str, Any]:
    """Create the video generation tool definition.

    Args:
        base_url: The base URL for the API endpoint

    Returns:
        Tool definition compatible with LiteLLM
    """
    return {
        'type': 'function',
        'function': {
            'name': GENERATE_VIDEO_TOOL_NAME,
            'description': refine_prompt(_GENERATE_VIDEO_DESCRIPTION),
            'parameters': {
                'type': 'object',
                'properties': {
                    'prompt': {
                        'type': 'string',
                        'description': refine_prompt(
                            'The text description of the video to generate. '
                            'Describe the motion and action you want to see.'
                        ),
                    },
                    'duration': {
                        'type': 'number',
                        'description': refine_prompt(
                            'Duration of the video in seconds. '
                            'Range: 2-10 seconds. Default: 5 seconds'
                        ),
                    },
                    'fps': {
                        'type': 'integer',
                        'description': refine_prompt(
                            'Frames per second for the video. '
                            'Options: 24, 30, 60. Default: 24'
                        ),
                        'enum': [24, 30, 60],
                    },
                    'resolution': {
                        'type': 'string',
                        'description': refine_prompt(
                            'The resolution of the generated video. '
                            'Options: "1024x576" (landscape), "768x1024" (portrait), '
                            '"576x1024" (portrait), "1024x1024" (square). '
                            'Default: "1024x576"'
                        ),
                        'enum': ['1024x576', '768x1024', '576x1024', '1024x1024'],
                    },
                    'negative_prompt': {
                        'type': 'string',
                        'description': refine_prompt(
                            'Things to avoid in the video. '
                            'For example: "blurry, jittery, low quality"'
                        ),
                    },
                    'num_inference_steps': {
                        'type': 'integer',
                        'description': refine_prompt(
                            'Number of inference steps. Higher = better quality but slower. '
                            'Range: 1-50, Default: 25'
                        ),
                    },
                    'guidance_scale': {
                        'type': 'number',
                        'description': refine_prompt(
                            'How closely to follow the prompt. '
                            'Higher = more faithful to prompt. Range: 1-20, Default: 7.0'
                        ),
                    },
                    'security_risk': {
                        'type': 'string',
                        'description': SECURITY_RISK_DESC,
                        'enum': RISK_LEVELS,
                    },
                },
                'required': ['prompt', 'security_risk'],
            },
        },
    }


async def execute_generate_video(
    prompt: str,
    duration: float = 5.0,
    fps: int = 24,
    resolution: str = '1024x576',
    negative_prompt: str | None = None,
    num_inference_steps: int = 25,
    guidance_scale: float = 7.0,
    base_url: str = 'http://localhost:3000',
) -> str:
    """Execute video generation via API.

    Args:
        prompt: Text description of the video to generate
        duration: Video duration in seconds
        fps: Frames per second
        resolution: Video resolution
        negative_prompt: Things to avoid in the video
        num_inference_steps: Number of inference steps
        guidance_scale: Guidance scale for generation
        base_url: Base URL for API

    Returns:
        Path to the generated video or error message
    """
    url = f'{base_url}/api/v1/generate-video'

    payload = {
        'prompt': prompt,
        'duration': duration,
        'fps': fps,
        'resolution': resolution,
    }

    if negative_prompt:
        payload['negative_prompt'] = negative_prompt

    if num_inference_steps:
        payload['num_inference_steps'] = num_inference_steps

    if guidance_scale:
        payload['guidance_scale'] = guidance_scale

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            result = response.json()

            return f'Video generated successfully!\nPath: {result.get("video_path", "unknown")}\nVideo ID: {result.get("video_id", "unknown")}\nDuration: {result.get("duration", duration)}s\nFPS: {result.get("fps", fps)}\nResolution: {result.get("resolution", resolution)}\nModel: {result.get("model", "unknown")}'

    except httpx.TimeoutException:
        return 'Error: Video generation timed out. This is expected for longer videos. Please try again with a shorter duration or simpler prompt.'
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            return 'Error: Video generation service is not available. Please ensure the service is running and dependencies are installed.'
        return f'Error: Failed to generate video - {e.response.status_code}: {e.response.text}'
    except Exception as e:
        return f'Error: Video generation failed - {str(e)}'


async def execute_generate_video_from_image(
    image_path: str,
    prompt: str,
    duration: float = 5.0,
    fps: int = 24,
    base_url: str = 'http://localhost:3000',
) -> str:
    """Execute image-to-video generation via API.

    Args:
        image_path: Path to the source image
        prompt: Text description of the motion desired
        duration: Video duration in seconds
        fps: Frames per second
        base_url: Base URL for API

    Returns:
        Path to the generated video or error message
    """
    url = f'{base_url}/api/v1/generate-video-from-image'

    payload = {
        'image_path': image_path,
        'prompt': prompt,
        'duration': duration,
        'fps': fps,
    }

    try:
        async with httpx.AsyncClient(timeout=180.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            result = response.json()

            return f'Video generated from image successfully!\nPath: {result.get("video_path", "unknown")}\nVideo ID: {result.get("video_id", "unknown")}\nDuration: {result.get("duration", duration)}s\nFPS: {result.get("fps", fps)}'

    except httpx.TimeoutException:
        return 'Error: Video generation timed out. This is expected for longer videos. Please try again with a shorter duration.'
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            return 'Error: Video generation service is not available.'
        return f'Error: Failed to generate video - {e.response.status_code}: {e.response.text}'
    except Exception as e:
        return f'Error: Video generation failed - {str(e)}'

"""Image Generation Tool for OpenHands CodeAct Agent.

This tool allows the agent to generate images from text prompts using
state-of-the-art diffusion models.
"""

from typing import Any

import httpx

from openhands.agenthub.codeact_agent.tools.prompt import refine_prompt
from openhands.agenthub.codeact_agent.tools.security_utils import (
    RISK_LEVELS,
    SECURITY_RISK_DESC,
)
from openhands.llm.tool_names import GENERATE_IMAGE_TOOL_NAME

_GENERATE_IMAGE_DESCRIPTION = """Generate an image from a text prompt using AI.

This tool uses advanced diffusion models (FLUX, SDXL) to create images from text descriptions.

### Supported Features:
- Text-to-image generation
- Multiple model options (FLUX, SDXL)
- Configurable resolution (512x512, 1024x1024, 1024x768)
- Custom styles and negative prompts
- GPU acceleration support

### Use Cases:
- Create concept art or illustrations
- Generate placeholder images for websites
- Create visual content for presentations
- Generate textures or patterns
"""


def create_generate_image_tool(
    base_url: str = 'http://localhost:3000',
) -> dict[str, Any]:
    """Create the image generation tool definition.
    
    Args:
        base_url: The base URL for the API endpoint
        
    Returns:
        Tool definition compatible with LiteLLM
    """
    return {
        'type': 'function',
        'function': {
            'name': GENERATE_IMAGE_TOOL_NAME,
            'description': refine_prompt(_GENERATE_IMAGE_DESCRIPTION),
            'parameters': {
                'type': 'object',
                'properties': {
                    'prompt': {
                        'type': 'string',
                        'description': refine_prompt(
                            'The text description of the image to generate. '
                            'Be as detailed as possible for better results.'
                        ),
                    },
                    'resolution': {
                        'type': 'string',
                        'description': refine_prompt(
                            'The resolution of the generated image. '
                            'Options: "512x512", "1024x1024", "1024x768", "768x1024". '
                            'Default: "1024x1024"'
                        ),
                        'enum': ['512x512', '1024x1024', '1024x768', '768x1024'],
                    },
                    'style': {
                        'type': 'string',
                        'description': refine_prompt(
                            'The style/model to use for generation. '
                            'Options: "default" (FLUX - fast, high quality), '
                            '"sdxl" (Stable Diffusion XL), '
                            '"realistic" (Stable Diffusion 2.1 for photorealistic). '
                            'Default: "default"'
                        ),
                        'enum': ['default', 'sdxl', 'realistic'],
                    },
                    'negative_prompt': {
                        'type': 'string',
                        'description': refine_prompt(
                            'Things to avoid in the image. '
                            'For example: "blurry, low quality, distorted"'
                        ),
                    },
                    'num_inference_steps': {
                        'type': 'integer',
                        'description': refine_prompt(
                            'Number of inference steps. Higher = better quality but slower. '
                            'Range: 1-50, Default: 28'
                        ),
                    },
                    'guidance_scale': {
                        'type': 'number',
                        'description': refine_prompt(
                            'How closely to follow the prompt. '
                            'Higher = more faithful to prompt. Range: 1-20, Default: 3.5'
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


async def execute_generate_image(
    prompt: str,
    resolution: str = '1024x1024',
    style: str = 'default',
    negative_prompt: str | None = None,
    num_inference_steps: int = 28,
    guidance_scale: float = 3.5,
    base_url: str = 'http://localhost:3000',
) -> str:
    """Execute image generation via API.
    
    Args:
        prompt: Text description of the image to generate
        resolution: Image resolution (e.g., "1024x1024")
        style: Generation style/model
        negative_prompt: Things to avoid in the image
        num_inference_steps: Number of inference steps
        guidance_scale: Guidance scale for generation
        base_url: Base URL for API
        
    Returns:
        Path to the generated image or error message
    """
    url = f'{base_url}/api/v1/generate-image'
    
    payload = {
        'prompt': prompt,
        'resolution': resolution,
        'style': style,
    }
    
    if negative_prompt:
        payload['negative_prompt'] = negative_prompt
    
    if num_inference_steps:
        payload['num_inference_steps'] = num_inference_steps
    
    if guidance_scale:
        payload['guidance_scale'] = guidance_scale
    
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(url, json=payload)
            response.raise_for_status()
            result = response.json()
            
            return f"Image generated successfully!\nPath: {result.get('image_path', 'unknown')}\nImage ID: {result.get('image_id', 'unknown')}\nResolution: {result.get('resolution', resolution)}\nModel: {result.get('model', style)}"
            
    except httpx.TimeoutException:
        return "Error: Image generation timed out. Please try again with fewer inference steps or a simpler prompt."
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 503:
            return "Error: Image generation service is not available. Please ensure the service is running and dependencies are installed."
        return f"Error: Failed to generate image - {e.response.status_code}: {e.response.text}"
    except Exception as e:
        return f"Error: Image generation failed - {str(e)}"

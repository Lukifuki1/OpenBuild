"""
Unit tests for the Image Generation Service.

These tests verify the core functionality of the image_service module,
including request validation, rate limiting, and error handling.
"""

import os
import pytest
from unittest.mock import Mock, patch, MagicMock


class TestImageGenerationRequest:
    """Tests for ImageGenerationRequest model."""

    def test_valid_request(self):
        """Test creating a valid image generation request."""
        from openhands.server.services.image_service import ImageGenerationRequest

        request = ImageGenerationRequest(
            prompt="A beautiful sunset over mountains",
            resolution="1024x1024",
            style="default"
        )

        assert request.prompt == "A beautiful sunset over mountains"
        assert request.resolution == "1024x1024"
        assert request.style == "default"

    def test_default_values(self):
        """Test default values for optional parameters."""
        from openhands.server.services.image_service import ImageGenerationRequest

        request = ImageGenerationRequest(prompt="Test prompt")

        assert request.resolution == "1024x1024"
        assert request.style == "default"
        assert request.num_inference_steps == 28
        assert request.guidance_scale == 3.5

    def test_invalid_prompt_too_short(self):
        """Test that empty prompt raises validation error."""
        from openhands.server.services.image_service import ImageGenerationRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ImageGenerationRequest(prompt="")

    def test_invalid_prompt_too_long(self):
        """Test that too long prompt raises validation error."""
        from openhands.server.services.image_service import ImageGenerationRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ImageGenerationRequest(prompt="x" * 1001)


class TestRateLimiting:
    """Tests for rate limiting functionality."""

    @patch.dict(os.environ, {'IMAGE_RATE_LIMIT': '5'})
    def test_rate_limit_allows_under_limit(self):
        """Test that requests under the limit are allowed."""
        from openhands.server.services.image_service import _check_rate_limit

        # Should allow requests under the limit
        for _ in range(5):
            assert _check_rate_limit("test_user", 5, 60) is True

    @patch.dict(os.environ, {'IMAGE_RATE_LIMIT': '3'})
    def test_rate_limit_blocks_over_limit(self):
        """Test that requests over the limit are blocked."""
        from openhands.server.services.image_service import _check_rate_limit

        # Fill up the rate limit
        for _ in range(3):
            _check_rate_limit("test_user", 3, 60)

        # Next request should be blocked
        assert _check_rate_limit("test_user", 3, 60) is False

    def test_rate_limit_none_user_allowed(self):
        """Test that requests without user ID are always allowed."""
        from openhands.server.services.image_service import _check_rate_limit

        assert _check_rate_limit(None, 1, 60) is True


class TestResolutionParsing:
    """Tests for resolution string parsing."""

    def test_valid_resolution(self):
        """Test parsing valid resolution strings."""
        from openhands.server.services.image_service import _get_resolution_tuple

        assert _get_resolution_tuple("1024x1024") == (1024, 1024)
        assert _get_resolution_tuple("1920x1080") == (1920, 1080)
        assert _get_resolution_tuple("512x512") == (512, 512)

    def test_invalid_resolution_default(self):
        """Test that invalid resolution returns default."""
        from openhands.server.services.image_service import _get_resolution_tuple

        assert _get_resolution_tuple("invalid") == (1024, 1024)
        assert _get_resolution_tuple("") == (1024, 1024)
        assert _get_resolution_tuple(None) == (1024, 1024)


class TestStylePresets:
    """Tests for style presets."""

    def test_style_presets_exist(self):
        """Test that all expected style presets are defined."""
        from openhands.server.services.image_service import STYLE_PRESETS

        expected_styles = ['default', 'anime', 'photorealistic', 'abstract', 'portrait', 'landscape']

        for style in expected_styles:
            assert style in STYLE_PRESETS

    def test_style_preset_structure(self):
        """Test that style presets have correct structure."""
        from openhands.server.services.image_service import STYLE_PRESETS

        for style_name, preset in STYLE_PRESETS.items():
            assert 'negative_prompt' in preset
            assert isinstance(preset['negative_prompt'], str)


class TestImageToImageRequest:
    """Tests for ImageToImageRequest model."""

    def test_valid_i2i_request(self):
        """Test creating a valid image-to-image request."""
        from openhands.server.services.image_service import ImageToImageRequest

        request = ImageToImageRequest(
            image_path="/path/to/image.png",
            prompt="Make it more vibrant"
        )

        assert request.image_path == "/path/to/image.png"
        assert request.prompt == "Make it more vibrant"
        assert request.strength == 0.75  # default

    def test_invalid_image_path(self):
        """Test that empty image path raises error."""
        from openhands.server.services.image_service import ImageToImageRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            ImageToImageRequest(image_path="", prompt="test")


class TestBatchGenerationRequest:
    """Tests for batch image generation request."""

    def test_valid_batch_request(self):
        """Test creating a valid batch generation request."""
        from openhands.server.services.image_service import BatchImageGenerationRequest

        request = BatchImageGenerationRequest(
            prompts=["prompt 1", "prompt 2", "prompt 3"]
        )

        assert len(request.prompts) == 3

    def test_empty_prompts_invalid(self):
        """Test that empty prompts list raises error."""
        from openhands.server.services.image_service import BatchImageGenerationRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            BatchImageGenerationRequest(prompts=[])

    def test_too_many_prompts_invalid(self):
        """Test that too many prompts raises error."""
        from openhands.server.services.image_service import BatchImageGenerationRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            BatchImageGenerationRequest(prompts=["x"] * 11)


class TestGPUMemoryManagement:
    """Tests for GPU memory management functions."""

    def test_clear_gpu_memory_no_cuda(self):
        """Test GPU memory clearing when CUDA not available."""
        from openhands.server.services.image_service import _clear_gpu_memory

        # Should not raise error even without CUDA
        _clear_gpu_memory()

    @patch('openhands.server.services.image_service.DIFFUSERS_AVAILABLE', True)
    @patch('openhands.server.services.image_service.torch.cuda.is_available')
    def test_clear_gpu_memory_with_cuda(self, mock_cuda_available):
        """Test GPU memory clearing when CUDA is available."""
        mock_cuda_available.return_value = True

        with patch('openhands.server.services.image_service.torch.cuda') as mock_cuda:
            from openhands.server.services.image_service import _clear_gpu_memory

            _clear_gpu_memory()

            mock_cuda.empty_cache.assert_called_once()


class TestInpaintingRequest:
    """Tests for InpaintingRequest model."""

    def test_valid_inpainting_request(self):
        """Test creating a valid inpainting request."""
        from openhands.server.services.image_service import InpaintingRequest

        request = InpaintingRequest(
            image_path="/path/to/image.png",
            mask_path="/path/to/mask.png",
            prompt="Replace the background"
        )

        assert request.image_path == "/path/to/image.png"
        assert request.mask_path == "/path/to/mask.png"
        assert request.prompt == "Replace the background"

    def test_inpainting_missing_mask(self):
        """Test that missing mask path raises error."""
        from openhands.server.services.image_service import InpaintingRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            InpaintingRequest(
                image_path="/path/to/image.png",
                mask_path="",
                prompt="test"
            )


class TestImageLoadingFromDataURL:
    """Tests for loading images from file paths and data URLs."""

    @patch('openhands.server.services.image_service.os.path.exists')
    def test_load_image_from_file_path(self, mock_exists):
        """Test loading image from a file path."""
        from openhands.server.services.image_service import _load_image_from_path_or_data_url
        from PIL import Image
        import io

        mock_exists.return_value = True

        # Create a mock image
        test_image = Image.new('RGB', (100, 100), color='red')

        with patch('builtins.open', create=True) as mock_open:
            mock_open.return_value.__enter__.return_value.read.return_value = b'fake_image_data'

            with patch('PIL.Image.open') as mock_image_open:
                mock_image_open.return_value.convert.return_value = test_image

                result = _load_image_from_path_or_data_url('/path/to/image.png')

                # Verify the path existence was checked
                mock_exists.assert_called_once_with('/path/to/image.png')

    def test_load_image_from_data_url(self):
        """Test loading image from a base64 data URL."""
        from openhands.server.services.image_service import _load_image_from_path_or_data_url
        from PIL import Image
        import base64

        # Create a simple test image and encode it as base64 data URL
        test_image = Image.new('RGB', (10, 10), color='blue')
        buffer = io.BytesIO()
        test_image.save(buffer, format='PNG')
        image_bytes = buffer.getvalue()
        b64_data = base64.b64encode(image_bytes).decode('utf-8')
        data_url = f'data:image/png;base64,{b64_data}'

        result = _load_image_from_path_or_data_url(data_url)

        assert isinstance(result, Image.Image)
        assert result.mode == 'RGB'

    def test_load_image_from_invalid_data_url(self):
        """Test that invalid data URL raises error."""
        from openhands.server.services.image_service import _load_image_from_path_or_data_url

        # Invalid base64 data
        with pytest.raises(Exception):
            _load_image_from_path_or_data_url('data:image/png;base64,invalid!@#$')

    @patch('openhands.server.services.image_service.os.path.exists')
    def test_load_image_from_nonexistent_file(self, mock_exists):
        """Test that loading from non-existent file raises error."""
        from openhands.server.services.image_service import _load_image_from_path_or_data_url

        mock_exists.return_value = False

        with pytest.raises(Exception):
            _load_image_from_path_or_data_url('/nonexistent/image.png')

    def test_load_image_from_bytes(self):
        """Test loading image from raw bytes."""
        from openhands.server.services.image_service import _load_image_from_path_or_data_url
        from PIL import Image
        import base64

        # Create a simple test image as bytes
        test_image = Image.new('RGB', (10, 10), color='green')
        buffer = io.BytesIO()
        test_image.save(buffer, format='PNG')
        image_bytes = buffer.getvalue()

        result = _load_image_from_path_or_data_url(image_bytes)

        assert isinstance(result, Image.Image)
        assert result.mode == 'RGB'


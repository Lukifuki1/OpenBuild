"""
Unit tests for the Video Generation Service.

These tests verify the core functionality of the video_service module,
including request validation, rate limiting, and error handling.
"""

import os
import pytest
from unittest.mock import Mock, patch, MagicMock


class TestVideoGenerationRequest:
    """Tests for VideoGenerationRequest model."""

    def test_valid_request(self):
        """Test creating a valid video generation request."""
        from openhands.server.services.video_service import VideoGenerationRequest

        request = VideoGenerationRequest(
            prompt="A flying bird",
            duration=5.0,
            fps=24,
            resolution="1024x576"
        )

        assert request.prompt == "A flying bird"
        assert request.duration == 5.0
        assert request.fps == 24
        assert request.resolution == "1024x576"

    def test_default_values(self):
        """Test default values for optional parameters."""
        from openhands.server.services.video_service import VideoGenerationRequest

        request = VideoGenerationRequest(prompt="Test prompt")

        assert request.duration == 5.0
        assert request.fps == 24
        assert request.resolution == "1024x576"
        assert request.num_inference_steps == 25
        assert request.guidance_scale == 7.0

    def test_duration_limits(self):
        """Test duration validation."""
        from openhands.server.services.video_service import VideoGenerationRequest
        from pydantic import ValidationError

        # Too short
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", duration=0.5)

        # Too long
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", duration=35.0)

    def test_fps_limits(self):
        """Test fps validation."""
        from openhands.server.services.video_service import VideoGenerationRequest
        from pydantic import ValidationError

        # Too low
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", fps=5)

        # Too high
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", fps=120)


class TestImageToVideoRequest:
    """Tests for ImageToVideoRequest model."""

    def test_valid_i2v_request(self):
        """Test creating a valid image-to-video request."""
        from openhands.server.services.video_service import ImageToVideoRequest

        request = ImageToVideoRequest(
            image_path="/path/to/image.png",
            prompt="Animate this"
        )

        assert request.image_path == "/path/to/image.png"
        assert request.prompt == "Animate this"

    def test_default_i2v_values(self):
        """Test default values for I2V."""
        from openhands.server.services.video_service import ImageToVideoRequest

        request = ImageToVideoRequest(
            image_path="/path/to/image.png",
            prompt="Animate this"
        )

        assert request.duration == 5.0
        assert request.fps == 24
        assert request.resolution == "1024x576"


class TestVideoRateLimiting:
    """Tests for video rate limiting functionality."""

    @patch.dict(os.environ, {'VIDEO_RATE_LIMIT': '5'})
    def test_rate_limit_allows_under_limit(self):
        """Test that requests under the limit are allowed."""
        from openhands.server.services.video_service import _check_rate_limit

        for _ in range(5):
            assert _check_rate_limit("test_user", 5, 60) is True

    @patch.dict(os.environ, {'VIDEO_RATE_LIMIT': '2'})
    def test_rate_limit_blocks_over_limit(self):
        """Test that requests over the limit are blocked."""
        from openhands.server.services.video_service import _check_rate_limit

        for _ in range(2):
            _check_rate_limit("test_user", 2, 60)

        assert _check_rate_limit("test_user", 2, 60) is False


class TestResolutionParsing:
    """Tests for video resolution string parsing."""

    def test_valid_resolutions(self):
        """Test parsing valid resolution strings."""
        from openhands.server.services.video_service import _get_resolution_tuple

        assert _get_resolution_tuple("1024x576") == (1024, 576)
        assert _get_resolution_tuple("512x512") == (512, 512)
        assert _get_resolution_tuple("256x256") == (256, 256)

    def test_invalid_resolution_default(self):
        """Test that invalid resolution returns default."""
        from openhands.server.services.video_service import _get_resolution_tuple

        assert _get_resolution_tuple("invalid") == (1024, 576)


class TestGPUMemoryManagement:
    """Tests for GPU memory management functions."""

    def test_clear_gpu_memory_no_cuda(self):
        """Test GPU memory clearing when CUDA not available."""
        from openhands.server.services.video_service import _clear_gpu_memory

        # Should not raise error even without CUDA
        _clear_gpu_memory()

    @patch('openhands.server.services.video_service.DIFFUSERS_VIDEO_AVAILABLE', True)
    @patch('openhands.server.services.video_service.torch.cuda.is_available')
    def test_clear_gpu_memory_with_cuda(self, mock_cuda_available):
        """Test GPU memory clearing when CUDA is available."""
        mock_cuda_available.return_value = True

        with patch('openhands.server.services.video_service.torch.cuda') as mock_cuda:
            from openhands.server.services.video_service import _clear_gpu_memory

            _clear_gpu_memory()

            mock_cuda.empty_cache.assert_called_once()


class TestVideoToVideoRequest:
    """Tests for VideoToVideoRequest model."""

    def test_valid_v2v_request(self):
        """Test creating a valid video-to-video request."""
        from openhands.server.services.video_service import VideoToVideoRequest

        request = VideoToVideoRequest(
            video_path="/path/to/video.mp4",
            prompt="Make it night time"
        )

        assert request.video_path == "/path/to/video.mp4"
        assert request.prompt == "Make it night time"


class TestVideoEditingRequest:
    """Tests for VideoEditingRequest model."""

    def test_valid_edit_request(self):
        """Test creating a valid video editing request."""
        from openhands.server.services.video_service import VideoEditingRequest

        request = VideoEditingRequest(
            video_path="/path/to/video.mp4",
            operation="reverse"
        )

        assert request.video_path == "/path/to/video.mp4"
        assert request.operation == "reverse"

    def test_valid_edit_with_params(self):
        """Test video editing with parameters."""
        from openhands.server.services.video_service import VideoEditingRequest

        request = VideoEditingRequest(
            video_path="/path/to/video.mp4",
            operation="trim",
            params={"start": 10, "end": 50}
        )

        assert request.params["start"] == 10
        assert request.params["end"] == 50

    def test_invalid_operation(self):
        """Test that invalid operation raises error."""
        from openhands.server.services.video_service import VideoEditingRequest
        from pydantic import ValidationError

        with pytest.raises(ValidationError):
            VideoEditingRequest(
                video_path="/path/to/video.mp4",
                operation="invalid"
            )


class TestVideoEnhancementRequest:
    """Tests for VideoEnhancementRequest model."""

    def test_valid_enhancement_request(self):
        """Test creating a valid video enhancement request."""
        from openhands.server.services.video_service import VideoEnhancementRequest

        request = VideoEnhancementRequest(
            video_path="/path/to/video.mp4",
            upscale_factor=2.0,
            denoise=True
        )

        assert request.video_path == "/path/to/video.mp4"
        assert request.upscale_factor == 2.0
        assert request.denoise is True

    def test_upscale_limits(self):
        """Test upscale factor validation."""
        from openhands.server.services.video_service import VideoEnhancementRequest
        from pydantic import ValidationError

        # Too low
        with pytest.raises(ValidationError):
            VideoEnhancementRequest(video_path="/test.mp4", upscale_factor=0.5)

        # Too high
        with pytest.raises(ValidationError):
            VideoEnhancementRequest(video_path="/test.mp4", upscale_factor=5.0)


class TestVideoGenerationResponse:
    """Tests for VideoGenerationResponse model."""

    def test_valid_response(self):
        """Test creating a valid video generation response."""
        from openhands.server.services.video_service import VideoGenerationResponse

        response = VideoGenerationResponse(
            video_path="/output/video_abc123.mp4",
            video_id="abc123",
            duration=5.0,
            fps=24,
            resolution="1024x576",
            model="stabilityai/stable-video-diffusion"
        )

        assert response.video_id == "abc123"
        assert response.duration == 5.0
        assert response.fps == 24

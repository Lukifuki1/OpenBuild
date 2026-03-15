"""
Integration tests for Image Generation API.

These tests verify the API endpoints work correctly with mocked responses.
"""

import pytest
from unittest.mock import Mock, patch, AsyncMock
from fastapi.testclient import TestClient


class TestImageGenerationAPI:
    """Integration tests for image generation API endpoints."""

    @pytest.fixture
    def mock_diffusers(self):
        """Mock diffusers library."""
        with patch('openhands.server.services.image_service.DIFFUSERS_AVAILABLE', True):
            with patch('openhands.server.services.image_service.torch') as mock_torch:
                mock_torch.cuda.is_available.return_value = False
                mock_torch.float16 = Mock()
                mock_torch.float32 = Mock()
                
                mock_pipeline = Mock()
                mock_pipeline.return_value = Mock(
                    images=[Mock(save=Mock())]
                )
                
                with patch('openhands.server.services.image_service.DiffusionPipeline') as mock_dp:
                    mock_dp.from_pretrained.return_value = mock_pipeline
                    yield mock_pipeline

    def test_generate_image_endpoint_validation(self):
        """Test that generate-image endpoint validates requests correctly."""
        from openhands.server.services.image_service import ImageGenerationRequest
        from pydantic import ValidationError
        
        # Valid request
        req = ImageGenerationRequest(prompt="test prompt")
        assert req.prompt == "test prompt"
        
        # Invalid - empty prompt
        with pytest.raises(ValidationError):
            ImageGenerationRequest(prompt="")

    def test_image_to_image_request_validation(self):
        """Test that transform-image endpoint validates requests correctly."""
        from openhands.server.services.image_service import ImageToImageRequest
        from pydantic import ValidationError
        
        # Valid request
        req = ImageToImageRequest(
            image_path="/path/to/image.png",
            prompt="transform this"
        )
        assert req.image_path == "/path/to/image.png"
        
        # Invalid - empty image path
        with pytest.raises(ValidationError):
            ImageToImageRequest(image_path="", prompt="test")

    def test_inpainting_request_validation(self):
        """Test that inpaint endpoint validates requests correctly."""
        from openhands.server.services.image_service import InpaintingRequest
        from pydantic import ValidationError
        
        # Valid request
        req = InpaintingRequest(
            image_path="/path/to/image.png",
            mask_path="/path/to/mask.png",
            prompt="inpaint this"
        )
        assert req.mask_path == "/path/to/mask.png"
        
        # Invalid - missing mask
        with pytest.raises(ValidationError):
            InpaintingRequest(
                image_path="/path/to/image.png",
                mask_path="",
                prompt="test"
            )

    def test_batch_generation_limits(self):
        """Test batch generation request limits."""
        from openhands.server.services.image_service import BatchImageGenerationRequest
        from pydantic import ValidationError
        
        # Valid - 10 prompts
        req = BatchImageGenerationRequest(prompts=["prompt"] * 10)
        assert len(req.prompts) == 10
        
        # Invalid - too many prompts
        with pytest.raises(ValidationError):
            BatchImageGenerationRequest(prompts=["prompt"] * 11)
        
        # Invalid - empty
        with pytest.raises(ValidationError):
            BatchImageGenerationRequest(prompts=[])

    def test_controlnet_request_validation(self):
        """Test ControlNet request validation."""
        from openhands.server.services.image_service import ControlNetRequest
        from pydantic import ValidationError
        
        # Valid request
        req = ControlNetRequest(
            prompt="generate this",
            control_image_path="/path/to/control.png",
            controlnet_type="canny"
        )
        assert req.controlnet_type == "canny"
        
        # Invalid - invalid controlnet type
        with pytest.raises(ValidationError):
            ControlNetRequest(
                prompt="test",
                control_image_path="/path/to/img.png",
                controlnet_type="invalid_type"
            )


class TestVideoGenerationAPI:
    """Integration tests for video generation API endpoints."""

    def test_video_generation_request_validation(self):
        """Test video generation request validation."""
        from openhands.server.services.video_service import VideoGenerationRequest
        from pydantic import ValidationError
        
        # Valid request
        req = VideoGenerationRequest(prompt="test video")
        assert req.duration == 5.0
        assert req.fps == 24
        
        # Invalid - too short duration
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", duration=0.5)
        
        # Invalid - too long duration
        with pytest.raises(ValidationError):
            VideoGenerationRequest(prompt="test", duration=35.0)

    def test_video_editing_operations(self):
        """Test video editing request validation."""
        from openhands.server.services.video_service import VideoEditingRequest
        from pydantic import ValidationError
        
        # Valid operations
        for op in ["trim", "crop", "reverse", "loop", "slow", "fast"]:
            req = VideoEditingRequest(
                video_path="/path/to/video.mp4",
                operation=op
            )
            assert req.operation == op
        
        # Invalid operation
        with pytest.raises(ValidationError):
            VideoEditingRequest(
                video_path="/path/to/video.mp4",
                operation="invalid"
            )

    def test_video_enhancement_limits(self):
        """Test video enhancement request limits."""
        from openhands.server.services.video_service import VideoEnhancementRequest
        from pydantic import ValidationError
        
        # Valid
        req = VideoEnhancementRequest(
            video_path="/path/to/video.mp4",
            upscale_factor=2.0
        )
        assert req.upscale_factor == 2.0
        
        # Invalid - upscale too high
        with pytest.raises(ValidationError):
            VideoEnhancementRequest(
                video_path="/path/to/video.mp4",
                upscale_factor=5.0
            )


class TestRateLimitingIntegration:
    """Integration tests for rate limiting."""

    def test_rate_limit_check(self):
        """Test rate limiting logic."""
        from openhands.server.services.image_service import _check_rate_limit
        import time
        
        # Should allow requests under limit
        for _ in range(3):
            result = _check_rate_limit("test_user_1", 3, 60)
            assert result is True
        
        # Should block requests over limit
        result = _check_rate_limit("test_user_1", 3, 60)
        assert result is False
        
        # Different user should be allowed
        result = _check_rate_limit("test_user_2", 3, 60)
        assert result is True
        
        # None user should always be allowed
        result = _check_rate_limit(None, 1, 60)
        assert result is True


class TestResolutionParsing:
    """Integration tests for resolution parsing."""

    def test_image_resolution_parsing(self):
        """Test image resolution parsing."""
        from openhands.server.services.image_service import _get_resolution_tuple
        
        tests = [
            ("1024x1024", (1024, 1024)),
            ("512x512", (512, 512)),
            ("1920x1080", (1920, 1080)),
            ("invalid", (1024, 1024)),
            (None, (1024, 1024)),
        ]
        
        for input_val, expected in tests:
            assert _get_resolution_tuple(input_val) == expected

    def test_video_resolution_parsing(self):
        """Test video resolution parsing."""
        from openhands.server.services.video_service import _get_resolution_tuple
        
        tests = [
            ("1024x576", (1024, 576)),
            ("512x512", (512, 512)),
            ("256x256", (256, 256)),
            ("invalid", (1024, 576)),
            (None, (1024, 576)),
        ]
        
        for input_val, expected in tests:
            assert _get_resolution_tuple(input_val) == expected


class TestStylePresets:
    """Integration tests for style presets."""

    def test_style_presets_exist(self):
        """Test all expected style presets are available."""
        from openhands.server.services.image_service import STYLE_PRESETS
        
        expected_styles = [
            'default', 'anime', 'photorealistic', 
            'abstract', 'portrait', 'landscape'
        ]
        
        for style in expected_styles:
            assert style in STYLE_PRESETS
            assert 'negative_prompt' in STYLE_PRESETS[style]

    def test_style_preset_negative_prompts(self):
        """Test style presets have valid negative prompts."""
        from openhands.server.services.image_service import STYLE_PRESETS
        
        for style_name, preset in STYLE_PRESETS.items():
            assert isinstance(preset['negative_prompt'], str)
            assert len(preset['negative_prompt']) > 0


class TestControlNetModels:
    """Integration tests for ControlNet models."""

    def test_controlnet_models_mapping(self):
        """Test ControlNet model mappings."""
        from openhands.server.services.image_service import CONTROLNET_MODELS
        
        expected_types = [
            'canny', 'depth', 'pose', 'seg', 
            'normal', 'inpaint', 'lineart', 
            'anime', 'scribble', 'softedge'
        ]
        
        for cn_type in expected_types:
            assert cn_type in CONTROLNET_MODELS
            assert isinstance(CONTROLNET_MODELS[cn_type], str)
            assert 'lllyasviel' in CONTROLNET_MODELS[cn_type] or 'Whoj' in CONTROLNET_MODELS[cn_type]

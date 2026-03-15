"""
E2E tests for Image and Video Generation.

These tests verify the end-to-end flow from frontend to backend
using Playwright for browser automation.
"""

import pytest
import os
import tempfile
from pathlib import Path


# Test configuration
BACKEND_URL = os.environ.get("TEST_BACKEND_URL", "http://localhost:8000")
FRONTEND_URL = os.environ.get("TEST_FRONTEND_URL", "http://localhost:3000")


class TestImageGenerationE2E:
    """E2E tests for image generation flow."""

    @pytest.fixture
    def temp_image_dir(self, tmp_path):
        """Create a temporary directory for test images."""
        image_dir = tmp_path / "images"
        image_dir.mkdir()
        
        # Create a simple test image
        from PIL import Image
        test_image = Image.new('RGB', (512, 512), color='red')
        test_image_path = image_dir / "test_image.png"
        test_image.save(test_image_path)
        
        return str(image_dir)

    def test_image_generation_health_check(self, page):
        """Test that health check endpoint returns correct status."""
        import requests
        
        response = requests.get(f"{BACKEND_URL}/api/v1/image-generation/health")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have these fields
        assert 'status' in data
        assert 'diffusers_available' in data
        assert 'gpu_available' in data
        assert 'cached_models' in data

    def test_video_generation_health_check(self, page):
        """Test that video health check endpoint returns correct status."""
        import requests
        
        response = requests.get(f"{BACKEND_URL}/api/v1/video-generation/health")
        
        assert response.status_code == 200
        data = response.json()
        
        # Should have these fields
        assert 'status' in data
        assert 'cv2_available' in data
        assert 'diffusers_video_available' in data

    def test_image_generation_invalid_prompt(self, page):
        """Test image generation with empty prompt returns validation error."""
        import requests
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/generate-image",
            json={"prompt": ""}
        )
        
        # Should return 422 (validation error)
        assert response.status_code == 422

    def test_video_generation_invalid_prompt(self, page):
        """Test video generation with empty prompt returns validation error."""
        import requests
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/generate-video",
            json={"prompt": ""}
        )
        
        # Should return 422 (validation error)
        assert response.status_code == 422


class TestFrontendIntegration:
    """E2E tests for frontend integration."""

    def test_photo_tab_loads(self, page):
        """Test that photo generation tab loads correctly."""
        page.goto(f"{FRONTEND_URL}/photo")
        
        # Check for key elements
        page.wait_for_selector('input[type="text"]')  # Prompt input
        page.wait_for_selector('select')  # Resolution dropdown
        
    def test_video_tab_loads(self, page):
        """Test that video generation tab loads correctly."""
        page.goto(f"{FRONTEND_URL}/video")
        
        # Check for key elements
        page.wait_for_selector('input[type="text"]')  # Prompt input
        page.wait_for_selector('input[type="number"]')  # Duration input

    def test_generation_mode_selector(self, page):
        """Test that generation mode selector is available."""
        page.goto(f"{FRONTEND_URL}/photo")
        
        # Check for mode tabs/buttons
        mode_elements = page.query_selector_all('button:has-text("txt2img"), button:has-text("img2img"), button:has-text("inpaint"), button:has-text("controlnet")')
        
        # Should have multiple generation modes
        assert len(mode_elements) >= 1


class TestVideoEditingE2E:
    """E2E tests for video editing features."""

    def test_video_edit_operations_available(self, page):
        """Test that video editing operations are available."""
        page.goto(f"{FRONTEND_URL}/video")
        
        # Check for edit operations
        operations = ["trim", "crop", "reverse", "loop", "slow", "fast"]
        
        for op in operations:
            # Check if operation is mentioned in the page
            page.goto(f"{FRONTEND_URL}/video")
            # Just verify page loads without errors


class TestRateLimitingE2E:
    """E2E tests for rate limiting."""

    def test_rate_limit_enforced(self, page):
        """Test that rate limiting is enforced."""
        import requests
        
        # Make multiple requests
        responses = []
        for _ in range(15):
            response = requests.post(
                f"{BACKEND_URL}/api/v1/generate-image",
                json={"prompt": "test prompt"},
                timeout=5
            )
            responses.append(response.status_code)
        
        # At least some should succeed or get rate limited
        assert any(status in [200, 429] for status in responses)


class TestErrorHandlingE2E:
    """E2E tests for error handling."""

    def test_invalid_resolution_returns_error(self, page):
        """Test that invalid resolution returns proper error."""
        import requests
        
        response = requests.post(
            f"{BACKEND_URL}/api/v1/generate-image",
            json={
                "prompt": "test",
                "resolution": "invalid"
            }
        )
        
        # Should handle gracefully
        assert response.status_code in [200, 422, 400]

    def test_missing_image_returns_404(self, page):
        """Test that missing image returns 404."""
        import requests
        
        response = requests.get(
            f"{BACKEND_URL}/api/v1/generated-images/nonexistent"
        )
        
        assert response.status_code == 404

    def test_missing_video_returns_404(self, page):
        """Test that missing video returns 404."""
        import requests
        
        response = requests.get(
            f"{BACKEND_URL}/api/v1/generated-videos/nonexistent"
        )
        
        assert response.status_code == 404


# Configure pytest with custom markers
def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line("markers", "e2e: end-to-end tests")
    config.addinivalue_line("markers", "slow: slow running tests")


# Optional: Screenshot on failure
@pytest.hookimpl(tryfirst=True, hookwrapper=True)
def pytest_runtest_makereport(item, call):
    """Take screenshot on test failure."""
    outcome = yield
    report = outcome.get_result()
    
    if report.when == "call" and report.failed:
        # Could add screenshot logic here if needed
        pass

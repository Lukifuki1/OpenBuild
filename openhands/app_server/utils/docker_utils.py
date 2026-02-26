from urllib.parse import urlparse, urlunparse

from openhands.utils.environment import is_running_in_docker


def replace_localhost_hostname_for_docker(
    url: str, replacement: str = 'host.docker.internal'
) -> str:
    """Replace localhost hostname in URL with the specified replacement when running in Docker.

    This function only performs the replacement when the code is running inside a Docker
    container. When not running in Docker, it returns the original URL unchanged.

    Only replaces the hostname if it's exactly 'localhost', preserving all other
    parts of the URL including port, path, query parameters, etc.

    Args:
        url: The URL to process
        replacement: The hostname to replace localhost with (default: 'host.docker.internal')

    Returns:
        URL with localhost hostname replaced if running in Docker and hostname is localhost,
        otherwise returns the original URL unchanged
    """
    if not is_running_in_docker():
        return url
    parsed = urlparse(url)
    if parsed.hostname == 'localhost':
        # Replace only the hostname part, preserving port and everything else
        netloc = parsed.netloc.replace('localhost', replacement, 1)
        return urlunparse(parsed._replace(netloc=netloc))
    return url


def replace_localhost_for_docker_target(
    url: str, replacement: str = 'host.docker.internal'
) -> str:
    """Replace localhost hostname so a Docker container can reach the host.

    Unlike :func:`replace_localhost_hostname_for_docker` (which only acts when
    the *current* process is inside Docker), this helper always performs the
    replacement.  Use it when preparing a URL that will be consumed by a Docker
    container (e.g. the agent-server sandbox) while the caller itself runs on
    the host.

    Args:
        url: The URL to process.
        replacement: The hostname to replace localhost with
            (default: ``host.docker.internal``).

    Returns:
        URL with ``localhost`` replaced by *replacement*, or the original URL
        if the hostname is not ``localhost``.
    """
    parsed = urlparse(url)
    if parsed.hostname == 'localhost':
        netloc = parsed.netloc.replace('localhost', replacement, 1)
        return urlunparse(parsed._replace(netloc=netloc))
    return url

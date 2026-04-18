import logging
import os
import time

from prometheus_client import Counter, start_http_server


STARTUPS = Counter(
    "artifactsmmo_python_startups_total",
    "Number of times the Artifactsmmo Python service started.",
)


def configure_logging() -> logging.Logger:
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return logging.getLogger("artifactsmmo-python")


def main() -> None:
    logger = configure_logging()
    metrics_port = int(os.getenv("METRICS_PORT", "8000"))

    start_http_server(metrics_port, addr="0.0.0.0")
    STARTUPS.inc()
    logger.info("Python service started")
    logger.info("Metrics available on port %s", metrics_port)

    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        logger.info("Python service stopped")


if __name__ == "__main__":
    main()

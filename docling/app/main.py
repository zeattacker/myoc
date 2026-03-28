import logging
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI

from app.routers import convert, health

logger = logging.getLogger("docling-service")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Log GPU availability on startup
    if torch.cuda.is_available():
        device = torch.cuda.get_device_name(0)
        logger.info(f"CUDA available: {device}")
    else:
        logger.warning("CUDA not available — running on CPU (will be slow)")

    # Pre-load Docling converter so first request isn't slow
    logger.info("Pre-loading Docling DocumentConverter...")
    from docling.document_converter import DocumentConverter

    DocumentConverter()
    logger.info("Docling ready")

    yield


app = FastAPI(title="Docling PDF Converter", lifespan=lifespan)
app.include_router(health.router)
app.include_router(convert.router)

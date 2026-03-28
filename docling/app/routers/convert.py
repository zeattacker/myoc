import os
import tempfile
from pathlib import Path

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

router = APIRouter()


class ConvertResponse(BaseModel):
    markdown: str
    pages: int
    tables: int
    method: str


@router.post("/v1/convert", response_model=ConvertResponse)
async def convert_pdf(
    file: UploadFile = File(...),
    ocr_lang: str = Form("eng+ind"),
    max_pages: int = Form(50),
):
    # Lazy import — keep startup fast, load heavy models on first request
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        EasyOcrOptions,
        OcrMacOptions,
        PdfPipelineOptions,
        TableFormerMode,
        TableStructureOptions,
    )
    from docling.document_converter import DocumentConverter, PdfFormatOption

    # Map lang codes: "eng+ind" → ["en", "id"] for EasyOCR
    lang_map = {"eng": "en", "ind": "id", "chi_sim": "ch_sim", "jpn": "ja"}
    ocr_langs = []
    for lang in ocr_lang.split("+"):
        ocr_langs.append(lang_map.get(lang, lang))
    if not ocr_langs:
        ocr_langs = ["en", "id"]

    pipeline_options = PdfPipelineOptions(
        do_ocr=True,
        do_table_structure=True,
        table_structure_options=TableStructureOptions(
            mode=TableFormerMode.ACCURATE,
        ),
        ocr_options=EasyOcrOptions(lang=ocr_langs),
    )

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        }
    )

    # Save upload to temp file
    suffix = Path(file.filename).suffix if file.filename else ".pdf"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = converter.convert(tmp_path)
        markdown = result.document.export_to_markdown()

        # Count tables and pages
        table_count = 0
        for element in result.document.iterate_items():
            item = element if not isinstance(element, tuple) else element[0]
            type_name = type(item).__name__
            if "Table" in type_name:
                table_count += 1

        page_count = 0
        try:
            page_count = result.document.num_pages()
        except Exception:
            # Fallback: count from page metadata
            page_count = len(set(
                getattr(prov, "page_no", 0)
                for item in result.document.iterate_items()
                for prov in (getattr(item if not isinstance(item, tuple) else item[0], "prov", []) or [])
            )) or 1

        return ConvertResponse(
            markdown=markdown,
            pages=page_count,
            tables=table_count,
            method="docling",
        )
    finally:
        os.unlink(tmp_path)

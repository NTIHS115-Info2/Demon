# plugins/news_scraper/strategies/remote/librarian.py
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
import asyncio
import re
import sys
import json
from loguru import logger
from data_models import LibrarianOutput, LibrarianResult, RelevantSection, LibrarianInput

class LibrarianStrategy:
    """ V12.0.4: Final Alpha Version """
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        logger.info(f"正在加載句向量模型: {model_name} ...")
        self.model = SentenceTransformer(model_name)
        logger.info("模型加載完成。")

    def _chunk_text(self, text, min_length=50, max_length=300):
        # ... (此函數與 V12 相同)
        sentences = re.split(r'(?<=[.!?\n\r。！？])\s*', text)
        chunks = []
        current_chunk = ""
        for sentence in sentences:
            if not sentence: continue
            if len(current_chunk) + len(sentence) <= max_length:
                current_chunk += " " + sentence
            else:
                if len(current_chunk.strip()) >= min_length: chunks.append(current_chunk.strip())
                current_chunk = sentence
        if len(current_chunk.strip()) >= min_length: chunks.append(current_chunk.strip())
        return chunks

    async def filter_content(self, text_content: str, query: str) -> LibrarianOutput:
        # ... (此函數與 V12 相同)
        try:
            chunks = self._chunk_text(text_content)
            if not chunks:
                return LibrarianOutput(success=True, result=LibrarianResult(relevant_sections=[]))
            
            chunk_embeddings = self.model.encode(chunks, convert_to_tensor=True).cpu().numpy()
            
            index = faiss.IndexFlatL2(chunk_embeddings.shape[1])
            index.add(chunk_embeddings)
            
            query_embedding = self.model.encode([query], convert_to_tensor=True).cpu().numpy()
            
            distances, indices = index.search(query_embedding, 3) # top_k=3
            
            results = [
                RelevantSection(chunk=chunks[indices[0][i]], score=float(distances[0][i]))
                for i in range(len(indices[0])) if indices[0][i] < len(chunks)
            ]
            
            return LibrarianOutput(success=True, result=LibrarianResult(relevant_sections=results))
        except Exception as e:
            error_message = f"LibrarianStrategy filter_content failed: {str(e)}"
            logger.exception(error_message)
            return LibrarianOutput(success=False, error=error_message)

def main():
    if len(sys.argv) > 2:
        try:
            text_content = sys.argv[1]
            query = sys.argv[2]
            
            async def async_main():
                librarian = LibrarianStrategy()
                result_model = await librarian.filter_content(text_content, query)
                sys.stdout.buffer.write(result_model.model_dump_json().encode('utf-8'))
            
            asyncio.run(async_main())
        except Exception as e:
            error_output = LibrarianOutput(success=False, error=str(e))
            sys.stdout.buffer.write(error_output.model_dump_json().encode('utf-8'))
    else:
        error_result = LibrarianOutput(success=False, error="Insufficient arguments for librarian.py")
        sys.stdout.buffer.write(error_output.model_dump_json().encode('utf-8'))

if __name__ == '__main__':
    main()
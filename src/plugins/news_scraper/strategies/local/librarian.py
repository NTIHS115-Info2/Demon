# src/plugins/news_scraper/strategies/local/librarian.py
import faiss
from sentence_transformers import SentenceTransformer
import asyncio, re, sys, json
from loguru import logger
from .data_models import LibrarianInput, LibrarianOutput, LibrarianResult, RelevantSection
import numpy as np

class LibrarianStrategy:
    """ V1.0.0-alpha: Final Version """
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        logger.info(f"正在加載句向量模型: {model_name} ...")
        self.model = SentenceTransformer(model_name)
        logger.info("模型加載完成。")

    def _chunk_text(self, text, min_length=50, max_length=300):
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

    async def filter_content(self, input_data: LibrarianInput) -> LibrarianOutput:
        try:
            chunks = self._chunk_text(input_data.text_content)
            if not chunks:
                return LibrarianOutput(success=True, result=LibrarianResult(relevant_sections=[]))
            
            # [Copilot Fix] 將 CPU 密集型任務移至線程池
            chunk_embeddings = await asyncio.to_thread(self.model.encode, chunks, convert_to_tensor=True)
            chunk_embeddings = chunk_embeddings.cpu().numpy()
            query_embedding = await asyncio.to_thread(self.model.encode, [input_data.query], convert_to_tensor=True)
            query_embedding = query_embedding.cpu().numpy()

            # [Copilot Fix] 標準化向量並使用 IndexFlatIP (內積/餘弦相似度)
            chunk_embeddings = chunk_embeddings / np.linalg.norm(chunk_embeddings, axis=1, keepdims=True)
            query_embedding = query_embedding / np.linalg.norm(query_embedding, axis=1, keepdims=True)
            
            index = faiss.IndexFlatIP(chunk_embeddings.shape[1])
            index.add(chunk_embeddings)
            
            scores, indices = index.search(query_embedding, 3) # top_k=3
            
            results = [
                RelevantSection(chunk=chunks[indices[0][i]], score=float(scores[0][i]))
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
            input_model = LibrarianInput(text_content=sys.argv[1], query=sys.argv[2])
            async def async_main():
                librarian = LibrarianStrategy()
                result_model = await librarian.filter_content(input_model)
                sys.stdout.buffer.write(result_model.model_dump_json().encode('utf-8'))
            asyncio.run(async_main())
        except Exception as e:
            # [Copilot Fix] 修正變數名稱錯誤
            error_output = LibrarianOutput(success=False, error=str(e))
            sys.stdout.buffer.write(error_output.model_dump_json().encode('utf-8'))
    else:
        error_result = LibrarianOutput(success=False, error="Insufficient arguments for librarian.py")
        sys.stdout.buffer.write(error_result.model_dump_json().encode('utf-8'))

if __name__ == '__main__':
    main()
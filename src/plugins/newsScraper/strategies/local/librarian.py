# src/plugins/newsScraper/strategies/local/librarian.py
import faiss
from sentence_transformers import SentenceTransformer
import asyncio
import re
import sys
import json
from pydantic import BaseModel, ValidationError, field_validator, ConfigDict


class LibrarianInput(BaseModel):
    model_config = ConfigDict(extra="ignore")
    text_content: str
    query: str
    top_k: int = 3
    device: str = "cpu"

    @field_validator("text_content", "query", mode="before")
    @classmethod
    def validate_required_text(cls, value):
        if value is None:
            raise ValueError("Text content and query cannot be empty")
        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                raise ValueError("Text content and query cannot be empty")
            return stripped
        return value

    @field_validator("top_k", mode="before")
    @classmethod
    def sanitize_top_k(cls, value):
        return _sanitize_positive_int(value, fallback=3)

    @field_validator("device", mode="before")
    @classmethod
    def normalize_device(cls, value):
        if value is None:
            return "cpu"
        if isinstance(value, str):
            stripped = value.strip()
            return stripped if stripped else "cpu"
        return value

def _sanitize_positive_int(value, fallback=3):
    try:
        parsed = int(value)
        if parsed > 0:
            return parsed
    except (TypeError, ValueError):
        # Fallback to default
        pass
    return fallback


class LibrarianStrategy:
    """
    圖書管理員策略 (Librarian Strategy) - V1.0.3
    核心職責：接收長篇文本內容與使用者查詢，利用向量語義搜索，過濾出與查詢最相關的文本片段。
    """
    def __init__(self, model_name='all-MiniLM-L6-v2'):
        self.model = SentenceTransformer(model_name)
        self.priority = 100

    def _chunk_text(self, text, min_length=50, max_length=300):
        sentences = re.split(r'(?<=[.!?。！？\n])\s+', text)
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

    async def filter_content(self, text_content: str, query: str, top_k: int = 3, device: str = 'cpu'):
        try:
            sanitized_device = (device or 'cpu').strip() or 'cpu'

            safe_top_k = _sanitize_positive_int(top_k, fallback=3)

            self.model.to(sanitized_device)
            chunks = self._chunk_text(text_content)
            if not chunks:
                return {"success": True, "result": {"relevant_sections": []}, "resultType": "object"}
            
            # 生成張量，它們會位於 self.model 所在的設備上 (device)
            chunk_embeddings_tensor = self.model.encode(chunks, convert_to_tensor=True)
            query_embedding_tensor = self.model.encode([query], convert_to_tensor=True)

            chunk_embeddings_ready = chunk_embeddings_tensor.to('cpu')
            query_embedding_ready = query_embedding_tensor.to('cpu')

            chunk_embeddings = chunk_embeddings_ready.numpy()
            query_embedding = query_embedding_ready.numpy()
            
            # [Copilot 審查修正] 改用餘弦相似度以獲得更準確的語義相關性分數
            # 1. 標準化向量 (L2 normalization)
            faiss.normalize_L2(chunk_embeddings)
            faiss.normalize_L2(query_embedding)
            
            # 2. 使用 IndexFlatIP (內積) 進行計算，這在標準化向量上等同於餘弦相似度
            index = faiss.IndexFlatIP(chunk_embeddings.shape[1])
            index.add(chunk_embeddings)
            
            similarities, indices = index.search(query_embedding, safe_top_k)
            
            results = []
            for i in range(len(indices[0])):
                idx = indices[0][i]
                if idx >= 0 and idx < len(chunks): # 確保索引有效
                    # 直接使用內積結果作為相似度分數
                    score = float(similarities[0][i])
                    results.append({"chunk": chunks[idx], "score": score})
            
            return {"success": True, "result": {"relevant_sections": results}, "resultType": "object"}
        except Exception as e:
            error_message = f"LibrarianStrategy filter_content failed: {str(e)}"
            return {"success": False, "error": error_message}

async def main():
    if len(sys.argv) == 2:
        try:
            payload = json.loads(sys.argv[1])
            input_model = LibrarianInput.model_validate(payload)
            librarian = LibrarianStrategy()
            result = await librarian.filter_content(
                text_content=input_model.text_content,
                query=input_model.query,
                top_k=input_model.top_k,
                device=input_model.device,
            )
            sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode("utf-8"))
        except (json.JSONDecodeError, ValidationError) as exc:
            error_result = {"success": False, "error": f"Invalid input: {exc}"}
            sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))
        except Exception as exc:
            error_result = {"success": False, "error": f"LibrarianStrategy failed: {exc}"}
            sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))
    else:
        error_result = {"success": False, "error": "No JSON payload provided to librarian.py"}
        sys.stdout.buffer.write(json.dumps(error_result, ensure_ascii=False).encode("utf-8"))

if __name__ == '__main__':
    asyncio.run(main())

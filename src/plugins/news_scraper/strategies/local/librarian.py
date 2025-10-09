# src/plugins/news_scraper/strategies/local/librarian.py
import numpy as np
import faiss
from sentence_transformers import SentenceTransformer
import asyncio
import re
import sys
import json

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
            self.model.to(device)
            chunks = self._chunk_text(text_content)
            if not chunks:
                return {"success": True, "result": {"relevant_sections": []}, "resultType": "object"}
            
            chunk_embeddings = self.model.encode(chunks, convert_to_tensor=True).cpu().numpy()
            query_embedding = self.model.encode([query], convert_to_tensor=True).cpu().numpy()

            # [Copilot 審查修正] 改用餘弦相似度以獲得更準確的語義相關性分數
            # 1. 標準化向量 (L2 normalization)
            faiss.normalize_L2(chunk_embeddings)
            faiss.normalize_L2(query_embedding)
            
            # 2. 使用 IndexFlatIP (內積) 進行計算，這在標準化向量上等同於餘弦相似度
            index = faiss.IndexFlatIP(chunk_embeddings.shape[1])
            index.add(chunk_embeddings)
            
            similarities, indices = index.search(query_embedding, top_k)
            
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
    if len(sys.argv) > 2:
        text_content = sys.argv[1]
        query = sys.argv[2]
        top_k = int(sys.argv[3]) if len(sys.argv) > 3 else 3
        device = sys.argv[4] if len(sys.argv) > 4 else 'cpu'

        librarian = LibrarianStrategy()
        result = await librarian.filter_content(text_content=text_content, query=query, top_k=top_k, device=device)
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    else:
        # [Copilot 審查修正] 為不正確的 CLI 使用提供清晰的錯誤提示
        print("Usage: python librarian.py <text_content> <query> [top_k] [device]", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    asyncio.run(main())
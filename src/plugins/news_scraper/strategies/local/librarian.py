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
        # 修正：更穩健的句子切分正則表達式
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

    async def filter_content(self, text_content: str, query: str, top_k: int = 3):
        try:
            chunks = self._chunk_text(text_content)
            if not chunks:
                return {"success": True, "result": {"relevant_sections": []}, "resultType": "object"}
            
            chunk_embeddings = self.model.encode(chunks, convert_to_tensor=True).cpu().numpy()
            
            index = faiss.IndexFlatL2(chunk_embeddings.shape[1])
            index.add(chunk_embeddings)
            
            query_embedding = self.model.encode([query], convert_to_tensor=True).cpu().numpy()
            
            distances, indices = index.search(query_embedding, top_k)
            
            results = []
            for i in range(len(indices[0])):
                idx = indices[0][i]
                # 確保索引在範圍內
                if idx < len(chunks):
                    # [合規性修正] score 應為相似度而非距離，此處用 1 / (1 + dist) 作為簡單示例
                    score = 1 / (1 + float(distances[0][i]))
                    results.append({"chunk": chunks[idx], "score": score})
            
            return {"success": True, "result": {"relevant_sections": results}, "resultType": "object"}
        except Exception as e:
            error_message = f"LibrarianStrategy filter_content failed: {str(e)}"
            return {"success": False, "error": error_message}

async def main():
    if len(sys.argv) > 2:
        text_content = sys.argv[1]
        query = sys.argv[2]
        librarian = LibrarianStrategy()
        result = await librarian.filter_content(text_content=text_content, query=query)
        # [教訓 2.1] 強制以 UTF-8 編碼輸出純淨 JSON
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False).encode('utf-8'))
    else:
        # 在被調用模式下不應有任何其他輸出
        pass

if __name__ == '__main__':
    asyncio.run(main())
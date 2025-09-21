# src/plugins/news_scraper/strategies/local/summarizer.py
import sys
import asyncio
from transformers import pipeline
from loguru import logger
from .data_models import SummarizerInput, SummarizerOutput, SummarizerResult, MultiAngleSummary

class SummarizerStrategy:
    def __init__(self, model_name='sshleifer/distilbart-cnn-12-6'):
        logger.info(f"正在加載摘要模型: {model_name} ...")
        self.summarizer = pipeline("summarization", model=model_name)
        logger.info("模型加載完成。")

    async def summarize_text(self, input_data: SummarizerInput) -> SummarizerOutput:
        try:
            length_config = {
                'short': {'min_length': 20, 'max_length': 50},
                'medium': {'min_length': 40, 'max_length': 100},
                'long': {'min_length': 80, 'max_length': 200}
            }
            config = length_config.get(input_data.length, length_config['medium'])

            if input_data.mode == 'multi':
                if not input_data.chunks:
                    return SummarizerOutput(success=True, result=SummarizerResult(multi_angle_summaries=[]))
                
                # [Copilot Fix] 將 CPU 密集型任務移至線程池
                summaries = await asyncio.to_thread(self.summarizer, input_data.chunks, **config)
                
                multi_angle_result = [
                    MultiAngleSummary(original_chunk=chunk, summary=item['summary_text'])
                    for chunk, item in zip(input_data.chunks, summaries)
                ]
                final_result = SummarizerResult(multi_angle_summaries=multi_angle_result)
            else: # 'single' 模式
                combined_text = ' '.join(input_data.chunks)
                if not combined_text.strip():
                    return SummarizerOutput(success=True, result=SummarizerResult(summary="No content to summarize."))
                
                # [Copilot Fix] 將 CPU 密集型任務移至線程池
                summary_list = await asyncio.to_thread(self.summarizer, combined_text, **config)
                summary_text = summary_list[0]['summary_text']
                final_result = SummarizerResult(summary=summary_text)

            return SummarizerOutput(success=True, result=final_result)
        except Exception as e:
            error_message = f"SummarizerStrategy failed: {str(e)}"
            logger.exception(error_message)
            return SummarizerOutput(success=False, error=error_message)

def main():
    if len(sys.argv) > 1:
        try:
            input_model = SummarizerInput.model_validate_json(sys.argv[1])
            async def async_main():
                summarizer = SummarizerStrategy()
                result_model = await summarizer.summarize_text(input_model)
                sys.stdout.buffer.write(result_model.model_dump_json().encode('utf-8'))
            asyncio.run(async_main())
        except Exception as e:
            error_output = SummarizerOutput(success=False, error=f"Invalid JSON input or processing error: {e}")
            sys.stdout.buffer.write(error_output.model_dump_json().encode('utf-8'))
    else:
        error_output = SummarizerOutput(success=False, error="No JSON input provided to summarizer.py")
        sys.stdout.buffer.write(error_output.model_dump_json().encode('utf-8'))

if __name__ == '__main__':
    main()
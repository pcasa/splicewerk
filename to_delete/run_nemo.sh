#!/bin/bash
cd "$(dirname "$0")/.."

curl -X POST https://integrate.api.nvidia.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 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" \
  -d @to_delete/nemo_ffmpeg_request.json \
  --max-time 300 \
  > to_delete/nemo_ffmpeg_response.txt

python3 -c "
import json
with open('to_delete/nemo_ffmpeg_response.txt') as f:
    d = json.load(f)
print(d['choices'][0]['message']['content'])
" > to_delete/nemo_ffmpeg_review.txt && cat to_delete/nemo_ffmpeg_review.txt

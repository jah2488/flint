#!/usr/bin/env python3
# Token-count helper for measure.mjs. Reads a JSON array of strings from the file given
# as argv[1] and prints a JSON array of token counts (tiktoken o200k_base, OpenAI's BPE,
# an approximation of Claude's tokenizer; ratios between arms are meaningful, absolute
# counts are approximate, exactly as caveman's eval notes).
import json
import sys

import tiktoken

enc = tiktoken.get_encoding("o200k_base")
texts = json.load(open(sys.argv[1], encoding="utf-8"))
print(json.dumps([len(enc.encode(t or "")) for t in texts]))

"""Emit batch JSON for MCP push_files (stdout)."""
import json
import sys

batch_num = int(sys.argv[1])
path = rf"D:\private\academic agent\_push_batch_{batch_num}.json"
with open(path, encoding="utf-8") as f:
    data = json.load(f)
json.dump(data, sys.stdout, ensure_ascii=False)
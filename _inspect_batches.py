import json
import os

for i in range(1, 6):
    p = rf"D:\private\academic agent\_push_batch_{i}.json"
    s = os.path.getsize(p)
    b = json.load(open(p, encoding="utf-8"))
    print(f"batch {i}: {s/1024:.1f} KB, {len(b['files'])} files")
    for f in b["files"]:
        print(f"  {f['path']}")
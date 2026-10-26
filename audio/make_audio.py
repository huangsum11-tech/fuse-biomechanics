# 用法：python3 audio/make_audio.py  → 由 index.html 抽出所有肌肉英文名（latin），
# 用 Microsoft 神經網絡語音（edge-tts）生成真人感讀音 mp3，放喺 audio/muscles/。
# 已存在嘅檔案會跳過；檔名規則要同 index.html 嘅 _muscleAudioSlug() 一致。
import asyncio, os, re, json
import edge_tts
D = os.path.dirname(os.path.abspath(__file__))
H = os.path.join(D, '..', 'index.html')
VOICE, RATE = 'en-US-AndrewNeural', '-12%'
s = open(H, encoding='utf-8').read()
names = set(re.findall(r"latin:'([^']+)'", s)) | set(re.findall(r'latin:"([^"]+)"', s))
def clean(t): return re.sub(r'\s*\([^)]*\)\s*', ' ', t).strip()
def slug(t): return re.sub(r'[^a-z0-9]+', '-', clean(t).lower()).strip('-')
async def main():
    todo = {}
    for n in names:
        c = clean(n)
        if c: todo[slug(n)] = c
    made = 0
    for k, text in sorted(todo.items()):
        out = os.path.join(D, 'muscles', k + '.mp3')
        if os.path.exists(out) and os.path.getsize(out) > 0: continue
        for tries in range(4):  # 網絡偶爾會冇回應，重試幾次
            try:
                await asyncio.wait_for(edge_tts.Communicate(text, VOICE, rate=RATE).save(out), 20); made += 1; break
            except Exception as e:
                if os.path.exists(out): os.remove(out)
                print('retry', k, e); await asyncio.sleep(3)
    json.dump(sorted(todo), open(os.path.join(D, 'muscles', 'index.json'), 'w'))
    print('names', len(todo), 'generated', made)
asyncio.run(main())

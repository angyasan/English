const fs = require('fs');

const INBOX_PATH = 'inbox.txt';
const HTML_PATH = 'index.html';

// 各カテゴリの「既存の」終端コメント（コード内にすでに存在するもの）
// 新しいカテゴリを使いたい場合はここに追記し、index.html側にも
// 同じ内容のコメントをそのカテゴリ配列の末尾に追加してください。
const CATEGORY_MARKERS = {
  others: 'その他そのたそのほかsonota',
  various: '色々いろいろiroiro',
  verbs: '動詞どうしdousi',
  nouns: '名詞めいしmeisi',
  adverbs: '副詞ふくしhukushifukusi',
  adjectives: '形容詞けいようしkeiyousi',
  tenses: '時制じせいzisei',
  prepositions: '前置詞ぜんちしzentisi',
  conjunctions: '接続詞せつぞくしsetuzokusi',
  nsfw: 'だめーダメーdame',
  // pronouns には目印コメントがまだ無いので、使う場合は index.html の
  // pronouns 配列の最後（"]," の直前）に <!-- 代名詞だいめいしdaimeishi --> を追加してください。
  // pronouns: '代名詞だいめいしdaimeishi',
};

const CATEGORY_LIST = Object.keys(CATEGORY_MARKERS);

async function classifyEntry(jp, en) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system:
        '英単語帳に新しい単語を追加するための判定を行います。' +
        `以下のカテゴリのうち最も適切なものを1つ選び、` +
        `英語表現のカタカナ読みを生成してください。` +
        `カテゴリ一覧: ${CATEGORY_LIST.join(', ')}` +
        `（others=その他表現/構文, various=日常フレーズ, verbs=動詞, nouns=名詞, ` +
        `adverbs=副詞, adjectives=形容詞, tenses=時間表現, prepositions=前置詞, ` +
        `conjunctions=接続詞, nsfw=性的な内容）` +
        '出力は必ずJSONのみ。他の文字は一切含めないこと。' +
        '形式: {"category":"verbs","reading":"カタカナ"}',
      messages: [
        { role: 'user', content: `日本語: ${jp}\n英語: ${en}` },
      ],
    }),
  });
  const data = await res.json();
  const text = data.content?.[0]?.text?.trim() || '{}';
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      category: CATEGORY_LIST.includes(parsed.category) ? parsed.category : null,
      reading: parsed.reading || '',
    };
  } catch (e) {
    console.log('AIの返答をJSONとして解析できませんでした:', text);
    return { category: null, reading: '' };
  }
}

function escapeForJs(str) {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function main() {
  if (!fs.existsSync(INBOX_PATH)) {
    console.log('inbox.txt が見つかりません。終了します。');
    return;
  }
  const raw = fs.readFileSync(INBOX_PATH, 'utf8').trim();
  if (!raw) {
    console.log('inbox.txt は空です。終了します。');
    return;
  }

  // 空行で区切られたブロック、各ブロックは「日本語」→「英語」の2行
  const blocks = raw.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const processed = [];
  const skipped = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) {
      skipped.push(`形式が不正: ${block}`);
      continue;
    }
    const [jp, en] = lines;

    const { category, reading } = await classifyEntry(jp, en);
    if (!category) {
      skipped.push(`カテゴリ判定失敗: ${jp} / ${en}`);
      continue;
    }

    const markerText = CATEGORY_MARKERS[category];
    const markerFull = `<!-- ${markerText} -->`;
    if (!html.includes(markerFull)) {
      skipped.push(`${HTML_PATH}内に目印(${markerFull})が見つからず: ${jp}`);
      continue;
    }

    const entryLine = `      { "jp": "${escapeForJs(jp)}", "en": "${escapeForJs(en)}", "reading": "${escapeForJs(reading)}" },`;
    html = html.replace(markerFull, `${entryLine}\n${markerFull}`);
    processed.push(`[${category}] ${jp} / ${en} (${reading})`);
  }

  fs.writeFileSync(HTML_PATH, html, 'utf8');
  fs.writeFileSync(INBOX_PATH, '', 'utf8');

  console.log('追加したエントリ:\n' + processed.join('\n'));
  if (skipped.length) {
    console.log('\nスキップしたエントリ:\n' + skipped.join('\n'));
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

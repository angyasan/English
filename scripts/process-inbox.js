const fs = require('fs');

const INBOX_PATH = 'inbox.txt';
const HTML_PATH = 'index.html';

// 各カテゴリの「既存の」終端コメント（コード内にすでに存在するもの）
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
  // pronouns を使う場合は index.html の pronouns 配列の末尾（"]," の直前）に
  // <!-- 代名詞だいめいしdaimeishi --> を追加してから、下のコメントを外してください。
  // pronouns: '代名詞だいめいしdaimeishi',
};
const CATEGORY_LIST = Object.keys(CATEGORY_MARKERS);

// ブロックの1行目にこれを単独で書くと、それ以降のブロックは
// 次に別のラベルが出てくるまでずっとそのカテゴリに確定される（漢字・ひらがな両対応）
const JAPANESE_LABEL_TO_KEY = {
  'その他': 'others', 'そのた': 'others',
  '色々': 'various', 'いろいろ': 'various',
  '動詞': 'verbs', 'どうし': 'verbs',
  '名詞': 'nouns', 'めいし': 'nouns',
  '副詞': 'adverbs', 'ふくし': 'adverbs',
  '形容詞': 'adjectives', 'けいようし': 'adjectives',
  '時制': 'tenses', 'じせい': 'tenses',
  '前置詞': 'prepositions', 'ぜんちし': 'prepositions',
  '接続詞': 'conjunctions', 'せつぞくし': 'conjunctions',
  'ダメー': 'nsfw', 'だめー': 'nsfw',
};
// これを書くと、以降はまたAIの自動判定に戻る
const AUTO_LABELS = ['自動', 'AI', 'auto'];

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
        `（others=その他の表現・構文・言い回し, various=日常会話フレーズ・決まり文句, ` +
        `verbs=動詞・動作を表す表現（英語が複数単語の熟語/句動詞でも、日本語訳が動作を表すなら動詞）, ` +
        `nouns=名詞・物や概念（英語が動詞としても使える単語でも、日本語訳が物や概念を指すなら名詞）, ` +
        `adverbs=副詞, adjectives=形容詞, tenses=時間・時制表現, prepositions=前置詞, ` +
        `conjunctions=接続詞, nsfw=性的な内容）` +
        '判定は英単語の形ではなく、日本語訳が表す意味・品詞を最優先すること。' +
        '出力は必ずJSONのみ。他の文字は一切含めないこと。' +
        '形式: {"category":"verbs","reading":"カタカナ"}',
      messages: [
        { role: 'user', content: `日本語: ${jp}\n英語: ${en}` },
      ],
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    console.log(`APIエラー (status ${res.status}):`, JSON.stringify(data));
    return { category: null, reading: '' };
  }

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

function toJsArray(arr) {
  return '[' + arr.map(s => `"${escapeForJs(s)}"`).join(', ') + ']';
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

  // 空行1つ以上でブロックに分割。ブロック内はさらに行に分割。
  const blocks = raw
    .split(/\n\s*\n+/)
    .map(b => b.split('\n').map(l => l.trim()).filter(Boolean))
    .filter(lines => lines.length > 0);

  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const processed = [];
  const skipped = [];
  let stickyCategory = null; // nullなら常にAI判定

  for (const lines of blocks) {
    // ブロックが1行だけ かつ ラベルなら、状態を更新して次のブロックへ
    if (lines.length === 1) {
      const only = lines[0];
      if (JAPANESE_LABEL_TO_KEY[only]) {
        stickyCategory = JAPANESE_LABEL_TO_KEY[only];
        continue;
      }
      if (AUTO_LABELS.includes(only)) {
        stickyCategory = null;
        continue;
      }
      skipped.push(`1行だけのブロックがラベルとして認識できません: ${only}`);
      continue;
    }

    // ブロックの先頭行がラベルなら、そのブロック内だけ有効なカテゴリとして扱う
    let linesForEntry = lines;
    let blockCategory = stickyCategory;
    if (JAPANESE_LABEL_TO_KEY[lines[0]]) {
      blockCategory = JAPANESE_LABEL_TO_KEY[lines[0]];
      stickyCategory = blockCategory;
      linesForEntry = lines.slice(1);
    } else if (AUTO_LABELS.includes(lines[0])) {
      blockCategory = null;
      stickyCategory = null;
      linesForEntry = lines.slice(1);
    }

    if (linesForEntry.length < 2) {
      skipped.push(`日本語/英語が足りないブロック: ${lines.join(' / ')}`);
      continue;
    }

    // 「その他」以外は、余った行を単なる追加エントリ(2行ずつ)として扱う。
    // 「その他」のときだけ、余った行を例文(exampleJp/example)として扱う。
    const isOthersBlock = blockCategory === 'others';
    const entryGroups = [];
    if (isOthersBlock) {
      entryGroups.push(linesForEntry);
    } else {
      for (let i = 0; i + 1 < linesForEntry.length; i += 2) {
        entryGroups.push([linesForEntry[i], linesForEntry[i + 1]]);
      }
      if (linesForEntry.length % 2 !== 0) {
        skipped.push(`行数が奇数のため最後の1行を無視: ${linesForEntry[linesForEntry.length - 1]}`);
      }
    }

    for (const groupLines of entryGroups) {
    const jp = groupLines[0];
    const en = groupLines[1];
    let rest = groupLines.slice(2);
    if (rest.length % 2 !== 0) {
      skipped.push(`例文の行数が奇数のため最後の1行を無視: ${jp}`);
      rest = rest.slice(0, -1);
    }
    const exampleJp = [];
    const example = [];
    for (let i = 0; i < rest.length; i += 2) {
      exampleJp.push(rest[i]);
      example.push(rest[i + 1]);
    }

    const result = await classifyEntry(jp, en);
    const category = blockCategory || result.category;
    const reading = result.reading;

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

    let entryLine;
    if (category === 'others' && example.length > 0) {
      entryLine =
        `      { "jp": "${escapeForJs(jp)}", "en": "${escapeForJs(en)}", ` +
        `"reading": "${escapeForJs(reading)}", "example": ${toJsArray(example)}, ` +
        `"exampleJp": ${toJsArray(exampleJp)} },`;
    } else {
      entryLine = `      { "jp": "${escapeForJs(jp)}", "en": "${escapeForJs(en)}", "reading": "${escapeForJs(reading)}" },`;
    }

    html = html.replace(markerFull, `${entryLine}\n${markerFull}`);
    processed.push(`[${category}] ${jp} / ${en} (${reading})${example.length ? ` 例文${example.length}件` : ''}`);
    }
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

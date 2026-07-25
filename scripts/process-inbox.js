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

// メモの1行目にこれらの日本語ラベルを書くと、AI判定を経由せず
// そのカテゴリに確定させられる（例: "動詞" と書いてから jp/en の2行）
const JAPANESE_LABEL_TO_KEY = {
  'その他': 'others',
  '色々': 'various',
  '動詞': 'verbs',
  '名詞': 'nouns',
  '副詞': 'adverbs',
  '形容詞': 'adjectives',
  '時制': 'tenses',
  '前置詞': 'prepositions',
  '接続詞': 'conjunctions',
  'ダメー': 'nsfw',
};

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
        '例: 「電子タバコ」→英語がvapeでも意味は物なのでnouns。' +
        '「打ち明ける」→英語が複数単語(let someone in on)でも動作なのでverbs。' +
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

  // 空行の有無に関わらず、中身のある行だけを取り出して2行ずつペアにする
  const allLines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  let html = fs.readFileSync(HTML_PATH, 'utf8');
  const processed = [];
  const skipped = [];

  for (let i = 0; i < allLines.length; ) {
    const forcedCategory = JAPANESE_LABEL_TO_KEY[allLines[i]];
    let jp, en, category, reading;

    if (forcedCategory) {
      // 1行目がカテゴリ名 → 次の2行がjp/en、AI判定はスキップ
      if (i + 2 >= allLines.length) {
        skipped.push(`カテゴリ指定(${allLines[i]})の後に日本語/英語が足りません`);
        break;
      }
      jp = allLines[i + 1];
      en = allLines[i + 2];
      category = forcedCategory;
      const result = await classifyEntry(jp, en); // 読みだけ使う
      reading = result.reading;
      i += 3;
    } else {
      if (i + 1 >= allLines.length) {
        skipped.push(`ペアが不完全なため無視: ${allLines[i]}`);
        break;
      }
      jp = allLines[i];
      en = allLines[i + 1];
      const result = await classifyEntry(jp, en);
      category = result.category;
      reading = result.reading;
      i += 2;
    }

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

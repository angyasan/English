// 音声ファイル生成と単語帳アプリで共通に使う処理
const fs = require('fs');
const vm = require('vm');

// index.html から単語データ（originalData）を取り出す
function loadVocab(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  const start = html.indexOf('const originalData = {');
  const end = html.indexOf('\n};', start);
  if (start < 0 || end < 0) throw new Error('index.html に originalData が見つかりません');
  const literal = html
    .slice(start + 'const originalData = '.length, end + 2)
    .replace(/<!--[\s\S]*?-->/g, '');
  return vm.runInNewContext('(' + literal + ')');
}

// 英語欄の文字列 → 音声ファイル名（アプリ側の audioFileFor と同じ計算）
function audioId(text) {
  let h1 = 0x811c9dc5;
  let h2 = 5381;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2, 33) + c) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// 読み上げ用に、日本語の説明や記号を取り除いて英語だけにする
// 例: "wanna+動詞の原形" → "wanna" / "dorm/dormitory" → "dorm, dormitory"
const JAPANESE = /[　-ヿ㐀-鿿＀-￯〜～※]/;
function speechText(text) {
  const tokens = String(text)
    .replace(/[＋+]/g, ' + ')
    .replace(/[／/]/g, ' / ')
    .replace(/[〜～~]/g, ' ')
    .split(/\s+/)
    .filter(tok => tok && !JAPANESE.test(tok));
  const cleaned = tokens.join(' ')
    .replace(/\+/g, ' ')
    .replace(/[()]/g, '')
    .replace(/\s*\/\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,.]+|[\s,]+$/g, '')
    .trim();
  return /[a-zA-Z0-9]/.test(cleaned) ? cleaned : '';
}

// 音声を作る対象（英語欄と「その他」の例文）を重複なしで集める
function collectTexts(vocab) {
  const texts = new Set();
  for (const type in vocab) {
    for (const item of vocab[type]) {
      if (item.en) texts.add(item.en);
      (item.example || []).forEach(e => texts.add(e));
    }
  }
  return [...texts];
}

module.exports = { loadVocab, audioId, speechText, collectTexts };

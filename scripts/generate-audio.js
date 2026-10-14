// 単語帳の英語（単語・熟語・例文）の音声ファイルを Google Text-to-Speech で作る
// - まだ音声がないものだけ作る（作り済みはそのまま。何度実行しても大丈夫）
// - 単語データから消えた（英語を書き換えた）ものの古い音声は削除する
// - GOOGLE_TTS_API_KEY がなければ何もせず終了する
const fs = require('fs');
const path = require('path');
const { loadVocab, audioId, speechText, collectTexts } = require('./audio-lib');

const HTML_PATH = 'index.html';
const AUDIO_DIR = 'audio';
const API_KEY = process.env.GOOGLE_TTS_API_KEY;
// 一番自然な声（Chirp 3 HD）を使い、使えなければ Neural2 にする
const VOICES = [process.env.TTS_VOICE || 'en-US-Chirp3-HD-Aoede', 'en-US-Neural2-F'];
const CONCURRENCY = 4;

let voice = VOICES[0];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function synthesize(text, voiceName = voice) {
  let lastError = '';
  for (let attempt = 0; attempt < 8; attempt++) {
    // 混雑・通信切れのときは、待つ時間を少しずつ延ばしてやり直す（1,2,4,8…最大30秒）
    if (attempt > 0) await sleep(Math.min(30000, 1000 * 2 ** (attempt - 1)));
    let res;
    try {
      res = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: 'en-US', name: voiceName },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      });
    } catch (e) {
      lastError = `通信エラー: ${e.message}`;
      continue;
    }
    if (res.ok) {
      const data = await res.json();
      return Buffer.from(data.audioContent, 'base64');
    }
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      lastError = `status ${res.status}: ${body.slice(0, 200)}`;
      continue;
    }
    throw new Error(`Text-to-Speech エラー (status ${res.status}): ${body.slice(0, 300)}`);
  }
  throw new Error(`何度やり直しても作れませんでした（最後のエラー ${lastError}）`);
}

// 最初に1回試して、使える声を決める（全部の音声を同じ声にそろえるため）
async function chooseVoice() {
  for (const name of VOICES) {
    try {
      await synthesize('Hello', name);
      return name;
    } catch (e) {
      console.log(`声 ${name} は使えませんでした: ${e.message}`);
    }
  }
  throw new Error('使える声がありませんでした（キーやAPIの有効化を確認してください）');
}

async function main() {
  if (!API_KEY) {
    console.log('GOOGLE_TTS_API_KEY が未設定のため、音声の作成をスキップします。');
    return;
  }
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  const texts = collectTexts(loadVocab(HTML_PATH));
  const wanted = new Map(); // ファイル名 → 読み上げる文字
  for (const text of texts) {
    const speech = speechText(text);
    if (speech) wanted.set(`${audioId(text)}.mp3`, speech);
  }

  const existing = new Set(fs.readdirSync(AUDIO_DIR).filter(f => f.endsWith('.mp3')));
  const todo = [...wanted].filter(([file]) => !existing.has(file));
  const stale = [...existing].filter(file => !wanted.has(file));

  for (const file of stale) fs.unlinkSync(path.join(AUDIO_DIR, file));

  console.log(`対象 ${wanted.size} 件 / 作成 ${todo.length} 件 / 削除 ${stale.length} 件`);
  if (todo.length === 0) return;
  voice = await chooseVoice();
  console.log(`使う声: ${voice}`);

  let done = 0;
  let chars = 0;
  const failed = [];
  const queue = [...todo];
  async function worker() {
    while (queue.length) {
      const [file, speech] = queue.shift();
      try {
        fs.writeFileSync(path.join(AUDIO_DIR, file), await synthesize(speech));
        chars += speech.length;
      } catch (e) {
        failed.push(`${speech}: ${e.message}`);
      }
      done++;
      if (done % 200 === 0) console.log(`  ${done} / ${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log(`完了：作成 ${todo.length - failed.length} 件（${chars} 文字、声 ${voice}）`);
  if (failed.length) {
    console.log(`作れなかったもの ${failed.length} 件:\n` + failed.slice(0, 20).join('\n'));
    // 一部だけ失敗しても、作れた分は保存する。全部失敗したときだけエラーにする
    if (failed.length === todo.length) process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

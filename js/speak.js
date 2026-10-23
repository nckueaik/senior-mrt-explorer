// 「唸給我聽」：手機內建國語語音
let voice = null;

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  voice = voices.find(v => v.lang === 'zh-TW') || voices.find(v => v.lang.startsWith('zh')) || null;
}
if ('speechSynthesis' in globalThis) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const canSpeak = () => 'speechSynthesis' in globalThis;

export function speak(text) {
  if (!canSpeak()) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'zh-TW';
  if (voice) u.voice = voice;
  u.rate = 0.85; // 放慢一點
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (canSpeak()) speechSynthesis.cancel();
}
